import { Notification, app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from "electron";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, homedir, platform, release } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TeamalignedRuntime } from "@runtime";
import type {
  AttachmentAssetRecord,
  AvatarAssetScope,
  ConnectMcpInput,
  ConversationImageExportInput,
  ConversationImageExportResult,
  CreateAgentInput,
  CreateTeamInput,
  EnsureConversationInput,
  FeedbackChannel,
  MessageRecord,
  NotificationRecord,
  ProviderId,
  PreviewWorkspaceReferencesInput,
  RendererErrorReport,
  RunControlPayload,
  SearchWorkspaceFilesInput,
  SaveAttachmentAssetInput,
  SavePromptAliasInput,
  SendInputPayload,
  ProviderConnectionTestInput,
  UpdateAgentInput,
  UpdateAgentSkillsInput,
  UpdateAgentMcpsInput,
  UpdateTeamInput,
  UpdateProfileInput,
  UpdateProviderInput,
  UpdateSettingsInput,
} from "@shared";
import { evaluateNotificationDispatch, type RuntimeNotificationChannel } from "./notification-policy.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
const isNotificationDebug = isDev || process.env.TA_NOTIFY_DEBUG === "1";
const notificationDebugLogPath = join(homedir(), ".teamaligned", "logs", "notification-dispatch.log");
const startupLogPath = join(homedir(), ".teamaligned", "logs", "startup.log");
const errorLogPath = join(homedir(), ".teamaligned", "logs", "errors.log");
const feedbackIssueUrl = "https://github.com/Sud0x67/team-aligned/issues/new";
const feedbackEmail = "jokeroller@163.com";
const providerKeyHelpUrls: Record<ProviderId, string> = {
  openai: "https://platform.openai.com/api-keys",
  qwen: "https://help.aliyun.com/zh/model-studio/get-api-key",
};

let mainWindow: BrowserWindow | null = null;
let runtime: TeamalignedRuntime | null = null;
let runtimeReady: Promise<TeamalignedRuntime> | null = null;
const activeSystemNotifications = new Set<Notification>();

function appendStartupLog(event: string, payload: Record<string, unknown> = {}) {
  const line = `${new Date().toISOString()} ${event} ${JSON.stringify(payload)}\n`;
  try {
    mkdirSync(dirname(startupLogPath), { recursive: true });
    appendFileSync(startupLogPath, line, "utf8");
  } catch {
    // Startup diagnostics must never block opening the app.
  }
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack ?? null,
    };
  }

  return {
    name: typeof error,
    message: String(error),
    stack: null,
  };
}

function appendErrorLog(event: string, payload: Record<string, unknown> = {}) {
  const line = `${new Date().toISOString()} ${event} ${JSON.stringify(payload)}\n`;
  try {
    mkdirSync(dirname(errorLogPath), { recursive: true });
    appendFileSync(errorLogPath, line, "utf8");
  } catch {
    // Error reporting must stay best-effort.
  }
}

process.on("uncaughtException", (error) => {
  appendErrorLog("main:uncaughtException", serializeError(error));
});

process.on("unhandledRejection", (reason) => {
  appendErrorLog("main:unhandledRejection", serializeError(reason));
});

function appendNotificationDebug(event: string, payload: Record<string, unknown>) {
  if (!isNotificationDebug) return;
  const line = `${new Date().toISOString()} ${event} ${JSON.stringify(payload)}\n`;
  try {
    mkdirSync(dirname(notificationDebugLogPath), { recursive: true });
    appendFileSync(notificationDebugLogPath, line, "utf8");
  } catch {
    // Keep notification flow resilient even when debug file is unavailable.
  }
}

async function getReadyRuntime() {
  if (runtimeReady) {
    return runtimeReady;
  }
  if (runtime) {
    return runtime;
  }
  throw new Error("TeamAligned runtime is not initialized.");
}

function canDispatchSystemNotification(channel: RuntimeNotificationChannel, notification: NotificationRecord) {
  if (!runtime) return false;

  const snapshot = runtime.getSnapshot();
  const window = mainWindow;
  const windowVisible = window
    ? !window.isDestroyed() && window.isVisible() && !window.isMinimized() && window.isFocused()
    : false;
  const decision = evaluateNotificationDispatch({
    channel,
    notification,
    settings: snapshot.settings,
    isNotificationSupported: Notification.isSupported(),
    windowVisible,
  });
  const dispatchPayload = {
    channel,
    decision: decision.reason,
    notificationId: notification.id,
    conversationId: notification.relatedConversationId,
  };
  appendNotificationDebug("notification:dispatch", dispatchPayload);
  if (isNotificationDebug) console.info("[notification:dispatch]", dispatchPayload);
  return decision.allowed;
}

function dispatchSystemNotification(input: {
  channel: RuntimeNotificationChannel;
  notification: NotificationRecord;
}) {
  if (!canDispatchSystemNotification(input.channel, input.notification)) {
    return;
  }

  const conversationId = input.notification.relatedConversationId;
  if (!conversationId) {
    return;
  }

  const systemNotification = new Notification({
    title: input.notification.title,
    body: input.notification.body,
    silent: false,
  });
  activeSystemNotifications.add(systemNotification);

  const cleanup = () => {
    activeSystemNotifications.delete(systemNotification);
  };

  systemNotification.on("show", () => {
    const showPayload = { notificationId: input.notification.id, conversationId };
    appendNotificationDebug("notification:show", showPayload);
    if (isNotificationDebug) console.info("[notification:show]", showPayload);
    if (process.platform === "darwin") {
      app.dock?.bounce("informational");
    }
  });

  systemNotification.on("click", async () => {
    const clickPayload = { notificationId: input.notification.id, conversationId };
    appendNotificationDebug("notification:click", clickPayload);
    if (isNotificationDebug) console.info("[notification:click]", clickPayload);
    if (!mainWindow || mainWindow.isDestroyed()) {
      await createWindow();
    }

    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }

    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }

    mainWindow.focus();
    mainWindow.webContents.send("teamaligned:open-conversation", {
      conversationId,
      relatedRunId: input.notification.relatedRunId,
    });
    cleanup();
  });

  systemNotification.on("close", cleanup);
  systemNotification.on("failed", (_event, error) => {
    const failPayload = { notificationId: input.notification.id, conversationId, error };
    appendNotificationDebug("notification:failed", failPayload);
    if (isNotificationDebug) console.warn("[notification:failed]", failPayload);
    cleanup();
  });

  systemNotification.show();
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "teamaligned-asset",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

function resolveRuntimeRoot() {
  return join(homedir(), ".teamaligned");
}

function resolveDiagnosticsDir() {
  return join(resolveRuntimeRoot(), "diagnostics");
}

function readTextTail(filePath: string, maxChars = 32_000) {
  if (!existsSync(filePath)) return null;

  const content = readFileSync(filePath, "utf8");
  if (content.length <= maxChars) return content;
  return `[truncated to last ${maxChars} chars]\n${content.slice(-maxChars)}`;
}

function getDiagnosticsSnapshot() {
  const snapshot = runtime?.getSnapshot();
  const activeProvider = snapshot?.providers.find((provider) => provider.isActive);

  return {
    generatedAt: new Date().toISOString(),
    app: {
      name: app.getName(),
      version: app.getVersion(),
      packaged: app.isPackaged,
      dev: isDev,
    },
    system: {
      platform: platform(),
      release: release(),
      arch: arch(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
    paths: {
      runtimeRoot: resolveRuntimeRoot(),
      diagnosticsDir: resolveDiagnosticsDir(),
      notificationDebugLogPath,
    },
    settings: snapshot
      ? {
          language: snapshot.settings.language,
          theme: snapshot.settings.theme,
          activeProviderId: snapshot.settings.activeProviderId,
          onboardingCompleted: snapshot.settings.onboardingCompleted,
          notifications: {
            agentMessages: snapshot.settings.notifyAgentComplete,
            mentions: snapshot.settings.notifyMention,
            groupMessages: snapshot.settings.notifyGroup,
          },
        }
      : null,
    profile: snapshot
      ? {
          hasName: snapshot.profile.name.trim().length > 0,
          hasBio: snapshot.profile.bio.trim().length > 0,
          hasAvatar: Boolean(snapshot.profile.avatarPath),
        }
      : null,
    activeProvider: activeProvider
      ? {
          id: activeProvider.id,
          label: activeProvider.label,
          baseUrl: activeProvider.baseUrl,
          defaultModel: activeProvider.defaultModel,
          supportsToolCalling: activeProvider.supportsToolCalling,
          supportsStreaming: activeProvider.supportsStreaming,
          apiKeyConfigured: activeProvider.apiKey.trim().length > 0,
        }
      : null,
    counts: snapshot
      ? {
          agents: snapshot.agents.length,
          teams: snapshot.teams.length,
          conversations: snapshot.conversations.length,
          runs: snapshot.runs.length,
          attachments: snapshot.attachments.length,
          artifacts: snapshot.artifacts.length,
          toolInvocations: snapshot.toolInvocations.length,
          notifications: snapshot.notifications.length,
        }
      : null,
    mcpConnections: (snapshot?.mcpConnections ?? []).map((connection) => ({
      serverId: connection.serverId,
      enabled: connection.enabled,
      transport: connection.transport,
      status: connection.status,
      lastCheckedAt: connection.lastCheckedAt,
      lastError: connection.lastError,
      discoveredToolCount: connection.discoveredTools.length,
      hasCommand: Boolean(connection.command),
      hasUrl: Boolean(connection.url),
      hasCwd: Boolean(connection.cwd),
      envKeyCount: Object.keys(connection.envEntries).length,
      headerKeyCount: Object.keys(connection.headers).length,
    })),
    recentRuns: (snapshot?.runs ?? []).slice(-12).map((run) => ({
      id: run.id,
      conversationId: run.conversationId,
      kind: run.kind,
      status: run.status,
      title: run.title,
      stepIndex: run.stepIndex,
      totalSteps: run.totalSteps,
      updatedAt: run.updatedAt,
    })),
    recentNotifications: (snapshot?.notifications ?? []).slice(-12).map((notification) => ({
      id: notification.id,
      type: notification.type,
      title: notification.title,
      read: notification.read,
      createdAt: notification.createdAt,
      hasConversation: Boolean(notification.relatedConversationId),
      hasRun: Boolean(notification.relatedRunId),
    })),
    notificationDebugLogTail: readTextTail(notificationDebugLogPath),
  };
}

function buildFeedbackBody() {
  const snapshot = runtime?.getSnapshot();
  const activeProvider = snapshot?.providers.find((provider) => provider.isActive);
  return [
    "Please describe what happened:",
    "",
    "Steps to reproduce:",
    "1. ",
    "",
    "Expected result:",
    "",
    "Actual result:",
    "",
    "Environment:",
    `- TeamAligned: ${app.getVersion()}`,
    `- Platform: ${platform()} ${release()} ${arch()}`,
    `- Provider: ${activeProvider?.id ?? snapshot?.settings.activeProviderId ?? "unknown"}`,
    "",
    "If possible, attach the diagnostics JSON exported from Settings -> Help and feedback.",
  ].join("\n");
}

async function openFeedbackChannel(channel: FeedbackChannel) {
  const body = buildFeedbackBody();
  const subject = `TeamAligned feedback ${app.getVersion()}`;
  const query = new URLSearchParams({
    title: subject,
    body,
  });

  try {
    if (channel === "github") {
      await shell.openExternal(`${feedbackIssueUrl}?${query.toString()}`);
      return true;
    }

    if (channel === "email") {
      const mailQuery = new URLSearchParams({
        subject,
        body,
      });
      await shell.openExternal(`mailto:${feedbackEmail}?${mailQuery.toString()}`);
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

async function openProviderKeyHelp(providerId: ProviderId) {
  const url = providerKeyHelpUrls[providerId];
  if (!url) return false;

  try {
    await shell.openExternal(url);
    return true;
  } catch {
    return false;
  }
}

function sanitizeExportFileName(value: string) {
  const normalized = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "conversation";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatMessageTime(timestamp: number) {
  return new Date(timestamp).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function getMessageAttachments(message: MessageRecord): AttachmentAssetRecord[] {
  const attachments = message.metadata?.attachments;
  return Array.isArray(attachments) ? (attachments as AttachmentAssetRecord[]) : [];
}

function buildConversationImageExportHtml(input: {
  title: string;
  exportedAt: number;
  messages: MessageRecord[];
}) {
  const rows = input.messages
    .map((message) => {
      const isUser = message.senderKind === "user";
      const bubbleClass = isUser ? "bubble bubble-user" : "bubble bubble-agent";
      const rowClass = isUser ? "row row-user" : "row row-agent";
      const messageHtml = escapeHtml(message.content).replace(/\n/g, "<br/>");
      const attachments = getMessageAttachments(message);
      const attachmentHtml =
        attachments.length === 0
          ? ""
          : `<div class="attachments">
            ${attachments
              .map((attachment) => {
                const escapedName = escapeHtml(attachment.name);
                const isImage = attachment.mimeType.startsWith("image/");
                const imagePreview =
                  isImage && existsSync(attachment.path)
                    ? `<img class="attachment-image" src="${escapeHtml(pathToFileURL(attachment.path).toString())}" alt="${escapedName}" />`
                    : "";
                return `<div class="attachment">
                  <div class="attachment-name">${escapedName}</div>
                  ${imagePreview}
                </div>`;
              })
              .join("")}
          </div>`;

      return `<section class="${rowClass}">
        <div class="meta">
          <span class="sender">${escapeHtml(message.senderName)}</span>
          <span class="dot">·</span>
          <span class="time">${formatMessageTime(message.createdAt)}</span>
        </div>
        <div class="${bubbleClass}">
          ${messageHtml || "&nbsp;"}
          ${attachmentHtml}
        </div>
      </section>`;
    })
    .join("");

  const exportedAtText = formatMessageTime(input.exportedAt);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(input.title)}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f5f6fb;
      color: #1f1f38;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      line-height: 1.6;
      padding: 40px;
    }
    .sheet {
      width: 960px;
      margin: 0 auto;
      border-radius: 24px;
      background: #ffffff;
      border: 1px solid #e8e8f2;
      box-shadow: 0 12px 32px rgba(42, 34, 84, 0.12);
      overflow: hidden;
    }
    .header {
      padding: 24px 28px 18px 28px;
      border-bottom: 1px solid #efeff8;
      background: linear-gradient(120deg, #faf9ff 0%, #ffffff 70%);
    }
    .title {
      margin: 0;
      font-size: 24px;
      font-weight: 700;
      color: #1c1b35;
      letter-spacing: 0.01em;
    }
    .subtitle {
      margin-top: 6px;
      font-size: 13px;
      color: #7a7b98;
    }
    .thread {
      padding: 22px 24px 28px 24px;
    }
    .row {
      display: flex;
      flex-direction: column;
      margin-bottom: 18px;
    }
    .row-user { align-items: flex-end; }
    .row-agent { align-items: flex-start; }
    .meta {
      font-size: 12px;
      color: #7a7b98;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
      max-width: 75%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sender {
      font-weight: 600;
      color: #36385a;
    }
    .dot {
      color: #b2b3c7;
    }
    .bubble {
      max-width: 75%;
      border-radius: 18px;
      padding: 14px 16px;
      font-size: 15px;
      line-height: 1.7;
      word-break: break-word;
      box-shadow: 0 1px 0 rgba(31, 31, 56, 0.04);
    }
    .bubble-agent {
      background: #f3f3fb;
      color: #21223f;
      border-top-left-radius: 8px;
    }
    .bubble-user {
      background: linear-gradient(140deg, #6f3bf2 0%, #7a40ff 60%, #8f4fff 100%);
      color: #ffffff;
      border-top-right-radius: 8px;
    }
    .attachments {
      margin-top: 10px;
      display: grid;
      gap: 8px;
    }
    .attachment {
      border-radius: 12px;
      border: 1px solid rgba(136, 138, 168, 0.35);
      background: rgba(255, 255, 255, 0.62);
      padding: 8px 10px;
      color: inherit;
    }
    .attachment-name {
      font-size: 12px;
      opacity: 0.9;
      word-break: break-all;
    }
    .attachment-image {
      margin-top: 8px;
      max-width: 100%;
      max-height: 320px;
      border-radius: 10px;
      object-fit: cover;
      border: 1px solid rgba(136, 138, 168, 0.3);
    }
  </style>
</head>
<body>
  <main class="sheet">
    <header class="header">
      <h1 class="title">${escapeHtml(input.title)}</h1>
      <div class="subtitle">导出时间 ${exportedAtText} · 共 ${input.messages.length} 条消息</div>
    </header>
    <section class="thread">
      ${rows}
    </section>
  </main>
</body>
</html>`;
}

async function renderConversationImageFromHtml(html: string) {
  const viewportWidth = 1080;
  const captureWindow = new BrowserWindow({
    show: false,
    width: viewportWidth,
    height: 1200,
    backgroundColor: "#f5f6fb",
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  try {
    await captureWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    const contentHeightRaw = await captureWindow.webContents.executeJavaScript(`
      new Promise((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const height = Math.max(
              document.body.scrollHeight,
              document.documentElement.scrollHeight,
              document.body.offsetHeight,
              document.documentElement.offsetHeight
            );
            resolve(height);
          });
        });
      });
    `);
    const contentHeight = clamp(Number(contentHeightRaw) || 0, 640, 12000);

    captureWindow.setContentSize(viewportWidth, contentHeight);
    await sleep(70);

    const image = await captureWindow.webContents.capturePage({
      x: 0,
      y: 0,
      width: viewportWidth,
      height: contentHeight,
    });

    return image.toPNG();
  } finally {
    if (!captureWindow.isDestroyed()) {
      captureWindow.destroy();
    }
  }
}

async function exportConversationImage(
  payload: ConversationImageExportInput,
): Promise<ConversationImageExportResult> {
  const readyRuntime = await getReadyRuntime();
  const snapshot = readyRuntime.getSnapshot();
  const conversation = snapshot.conversations.find((item) => item.id === payload.conversationId);
  if (!conversation) {
    throw new Error(`未找到会话：${payload.conversationId}`);
  }

  const conversationMessages = (snapshot.messages[payload.conversationId] ?? []).filter(
    (message) => message.visibility === "public",
  );
  const selectedIds = new Set(payload.messageIds);
  const selectedMessages =
    selectedIds.size === 0
      ? conversationMessages
      : conversationMessages.filter((message) => selectedIds.has(message.id));

  if (selectedMessages.length === 0) {
    throw new Error("没有可导出的聊天消息");
  }

  const exportedAt = Date.now();
  const exportDir = join(resolveRuntimeRoot(), "exports", payload.conversationId, "images");
  mkdirSync(exportDir, { recursive: true });
  const timestamp = new Date(exportedAt).toISOString().replace(/[:.]/g, "-");
  const title = sanitizeExportFileName(conversation.title);
  const filePath = join(exportDir, `${title}-${timestamp}.png`);
  const html = buildConversationImageExportHtml({
    title: conversation.title,
    exportedAt,
    messages: selectedMessages,
  });
  const imageBuffer = await renderConversationImageFromHtml(html);
  writeFileSync(filePath, imageBuffer);
  shell.showItemInFolder(filePath);

  return {
    conversationId: payload.conversationId,
    filePath,
    exportedAt,
    messageCount: selectedMessages.length,
  };
}

function isPathInside(parentPath: string, childPath: string) {
  const relativePath = relative(resolve(parentPath), resolve(childPath));
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.startsWith("/"));
}

function getAllowedAssetRoots() {
  const roots = new Set<string>([resolveRuntimeRoot()]);
  const snapshot = runtime?.getSnapshot();

  for (const agent of snapshot?.agents ?? []) {
    roots.add(resolve(agent.workspacePath));
  }

  for (const team of snapshot?.teams ?? []) {
    roots.add(resolve(team.workspacePath));
  }

  return Array.from(roots);
}

function registerAssetProtocol() {
  protocol.handle("teamaligned-asset", (request) => {
    const url = new URL(request.url);
    const assetPath = resolve(decodeURIComponent(url.pathname.slice(1)));
    const allowedRoots = getAllowedAssetRoots();
    if (!allowedRoots.some((root) => isPathInside(root, assetPath))) {
      return new Response("Forbidden", { status: 403 });
    }
    return net.fetch(pathToFileURL(assetPath).toString());
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1180,
    minHeight: 780,
    title: "teamaligned",
    backgroundColor: "#f6f7fb",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.on("unresponsive", () => {
    appendErrorLog("window:unresponsive", {});
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    appendErrorLog("renderer:process-gone", details as unknown as Record<string, unknown>);
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    appendErrorLog("renderer:did-fail-load", {
      errorCode,
      errorDescription,
      validatedURL,
    });
  });
}

function broadcastSnapshot() {
  if (!runtime) return;
  const snapshot = runtime.getSnapshot();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("teamaligned:snapshot", snapshot);
}

app.whenReady().then(async () => {
  const startupStartedAt = Date.now();
  app.setName("teamaligned");
  const runtimeRoot = resolveRuntimeRoot();
  mkdirSync(runtimeRoot, { recursive: true });
  appendStartupLog("startup:begin", {
    runtimeRoot,
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
  });
  registerAssetProtocol();

  let resolveRuntimeReady!: (value: TeamalignedRuntime) => void;
  let rejectRuntimeReady!: (reason: unknown) => void;
  runtimeReady = new Promise<TeamalignedRuntime>((resolveRuntime, rejectRuntime) => {
    resolveRuntimeReady = resolveRuntime;
    rejectRuntimeReady = rejectRuntime;
  });

  ipcMain.handle("teamaligned:bootstrap", async () => (await getReadyRuntime()).getStartupSnapshot());
  ipcMain.handle("teamaligned:load-conversation-data", async (_event, conversationId: string) =>
    (await getReadyRuntime()).getConversationSnapshot(conversationId),
  );
  ipcMain.handle("teamaligned:report-renderer-error", async (_event, payload: RendererErrorReport) => {
    appendErrorLog("renderer:error", payload as unknown as Record<string, unknown>);
    return true;
  });
  ipcMain.handle("teamaligned:send-input", async (_event, payload: SendInputPayload) =>
    (await getReadyRuntime()).sendInput(payload),
  );
  ipcMain.handle("teamaligned:search-workspace-files", async (_event, payload: SearchWorkspaceFilesInput) =>
    (await getReadyRuntime()).searchWorkspaceFiles(payload),
  );
  ipcMain.handle("teamaligned:preview-workspace-references", async (_event, payload: PreviewWorkspaceReferencesInput) =>
    (await getReadyRuntime()).previewWorkspaceReferences(payload),
  );
  ipcMain.handle("teamaligned:control-run", async (_event, payload: RunControlPayload) =>
    (await getReadyRuntime()).controlRun(payload),
  );
  ipcMain.handle("teamaligned:create-agent", async (_event, payload: CreateAgentInput) =>
    (await getReadyRuntime()).createAgent(payload),
  );
  ipcMain.handle("teamaligned:create-team", async (_event, payload: CreateTeamInput) =>
    (await getReadyRuntime()).createTeam(payload),
  );
  ipcMain.handle("teamaligned:delete-agent", async (_event, agentId: string) =>
    (await getReadyRuntime()).deleteAgent(agentId),
  );
  ipcMain.handle("teamaligned:delete-team", async (_event, teamId: string) =>
    (await getReadyRuntime()).deleteTeam(teamId),
  );
  ipcMain.handle("teamaligned:delete-conversation", async (_event, conversationId: string) =>
    (await getReadyRuntime()).deleteConversation(conversationId),
  );
  ipcMain.handle("teamaligned:ensure-conversation", async (_event, payload: EnsureConversationInput) =>
    (await getReadyRuntime()).ensureConversation(payload),
  );
  ipcMain.handle("teamaligned:update-agent", async (_event, payload: UpdateAgentInput) =>
    (await getReadyRuntime()).updateAgent(payload),
  );
  ipcMain.handle("teamaligned:update-team", async (_event, payload: UpdateTeamInput) =>
    (await getReadyRuntime()).updateTeam(payload),
  );
  ipcMain.handle("teamaligned:refresh-skill-catalog", async () =>
    (await getReadyRuntime()).refreshSkillCatalog(),
  );
  ipcMain.handle("teamaligned:install-skill", async (_event, skillId: string) =>
    (await getReadyRuntime()).installSkill(skillId),
  );
  ipcMain.handle("teamaligned:remove-skill", async (_event, skillId: string) =>
    (await getReadyRuntime()).removeSkill(skillId),
  );
  ipcMain.handle("teamaligned:save-prompt-alias", async (_event, payload: SavePromptAliasInput) =>
    (await getReadyRuntime()).savePromptAlias(payload),
  );
  ipcMain.handle("teamaligned:remove-prompt-alias", async (_event, promptAliasId: string) =>
    (await getReadyRuntime()).removePromptAlias(promptAliasId),
  );
  ipcMain.handle("teamaligned:refresh-mcp-catalog", async () =>
    (await getReadyRuntime()).refreshMcpCatalog(),
  );
  ipcMain.handle("teamaligned:connect-mcp", async (_event, payload: ConnectMcpInput) =>
    (await getReadyRuntime()).connectMcp(payload),
  );
  ipcMain.handle("teamaligned:authorize-mcp", async (_event, serverId: string) =>
    (await getReadyRuntime()).authorizeMcp(serverId, (authorizationUrl) =>
      shell.openExternal(authorizationUrl),
    ),
  );
  ipcMain.handle("teamaligned:check-mcp-health", async (_event, serverId: string) =>
    (await getReadyRuntime()).checkMcpHealth(serverId),
  );
  ipcMain.handle("teamaligned:disconnect-mcp", async (_event, serverId: string) =>
    (await getReadyRuntime()).disconnectMcp(serverId),
  );
  ipcMain.handle("teamaligned:toggle-extension", async (_event, extensionId: string) =>
    (await getReadyRuntime()).toggleExtension(extensionId),
  );
  ipcMain.handle("teamaligned:update-agent-skills", async (_event, payload: UpdateAgentSkillsInput) =>
    (await getReadyRuntime()).updateAgentSkills(payload),
  );
  ipcMain.handle("teamaligned:update-agent-mcps", async (_event, payload: UpdateAgentMcpsInput) =>
    (await getReadyRuntime()).updateAgentMcps(payload),
  );
  ipcMain.handle("teamaligned:update-settings", async (_event, payload: UpdateSettingsInput) =>
    (await getReadyRuntime()).updateSettings(payload),
  );
  ipcMain.handle("teamaligned:update-profile", async (_event, payload: UpdateProfileInput) =>
    (await getReadyRuntime()).updateProfile(payload),
  );
  ipcMain.handle("teamaligned:update-provider", async (_event, payload: UpdateProviderInput) =>
    (await getReadyRuntime()).updateProvider(payload),
  );
  ipcMain.handle(
    "teamaligned:test-provider-connection",
    async (_event, payload: ProviderConnectionTestInput) =>
      (await getReadyRuntime()).testProviderConnection(payload),
  );
  ipcMain.handle(
    "teamaligned:save-avatar-asset",
    async (
      _event,
      payload: {
        scope: AvatarAssetScope;
        dataUrl: string;
        fileNameHint?: string;
      },
    ) => (await getReadyRuntime()).saveAvatarAsset(payload),
  );
  ipcMain.handle(
    "teamaligned:save-attachment-asset",
    async (_event, payload: SaveAttachmentAssetInput) =>
      (await getReadyRuntime()).saveAttachmentAsset(payload),
  );
  ipcMain.handle("teamaligned:export-conversation-data", async (_event, conversationId: string) =>
    (await getReadyRuntime()).exportConversationData(conversationId),
  );
  ipcMain.handle(
    "teamaligned:export-conversation-image",
    async (_event, payload: ConversationImageExportInput) => exportConversationImage(payload),
  );
  ipcMain.handle("teamaligned:export-diagnostics", async () => {
    await getReadyRuntime();
    const diagnosticsDir = resolveDiagnosticsDir();
    mkdirSync(diagnosticsDir, { recursive: true });
    const safeTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = join(diagnosticsDir, `teamaligned-diagnostics-${safeTimestamp}.json`);
    const exportedAt = Date.now();
    writeFileSync(filePath, JSON.stringify(getDiagnosticsSnapshot(), null, 2), "utf8");
    shell.showItemInFolder(filePath);
    return { filePath, exportedAt };
  });
  ipcMain.handle("teamaligned:open-diagnostics-folder", async () => {
    try {
      const diagnosticsDir = resolveDiagnosticsDir();
      mkdirSync(diagnosticsDir, { recursive: true });
      mkdirSync(dirname(notificationDebugLogPath), { recursive: true });
      const error = await shell.openPath(diagnosticsDir);
      return error.length === 0;
    } catch {
      return false;
    }
  });
  ipcMain.handle("teamaligned:open-feedback-channel", async (_event, channel: FeedbackChannel) =>
    openFeedbackChannel(channel),
  );
  ipcMain.handle("teamaligned:open-provider-key-help", async (_event, providerId: ProviderId) =>
    openProviderKeyHelp(providerId),
  );
  ipcMain.handle("teamaligned:mark-notifications-read", async () =>
    (await getReadyRuntime()).markNotificationsRead(),
  );
  ipcMain.handle("teamaligned:mark-conversation-read", async (_event, conversationId: string) =>
    (await getReadyRuntime()).markConversationRead(conversationId),
  );
  ipcMain.handle("teamaligned:open-notification-settings", async () => {
    try {
      if (process.platform === "darwin") {
        const macNotificationUris = [
          "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
          "x-apple.systempreferences:com.apple.preference.notifications",
        ];
        for (const uri of macNotificationUris) {
          try {
            await shell.openExternal(uri);
            return true;
          } catch {
            continue;
          }
        }
        return false;
      }

      if (process.platform === "win32") {
        await shell.openExternal("ms-settings:notifications");
        return true;
      }

      return false;
    } catch {
      return false;
    }
  });
  ipcMain.handle("teamaligned:select-directory", async (_event, payload?: { title?: string }) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return null;
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
      title: payload?.title?.trim() || "Select directory",
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("teamaligned:open-workspace", async (_event, workspacePath: string) => {
    await shell.openPath(workspacePath);
  });

  await createWindow();
  appendStartupLog("startup:window-ready", { elapsedMs: Date.now() - startupStartedAt });

  void (async () => {
    const runtimeStartedAt = Date.now();
    appendStartupLog("startup:runtime-init-start");
    const nextRuntime = new TeamalignedRuntime(runtimeRoot);
    runtime = nextRuntime;
    nextRuntime.on("snapshot", broadcastSnapshot);
    nextRuntime.on(
      "notification",
      (payload: { channel: RuntimeNotificationChannel; notification: NotificationRecord }) => {
        dispatchSystemNotification(payload);
      },
    );
    nextRuntime.on("runtime-error", (payload: Record<string, unknown>) => {
      appendErrorLog("runtime:error", payload);
    });
    await nextRuntime.init();
    appendStartupLog("startup:runtime-ready", {
      elapsedMs: Date.now() - runtimeStartedAt,
      totalElapsedMs: Date.now() - startupStartedAt,
    });
    resolveRuntimeReady(nextRuntime);
  })().catch((error) => {
    appendStartupLog("startup:runtime-failed", {
      message: error instanceof Error ? error.message : String(error),
      totalElapsedMs: Date.now() - startupStartedAt,
    });
    rejectRuntimeReady(error);
  });

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
}).catch((error) => {
  appendErrorLog("main:startup-failed", serializeError(error));
  throw error;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

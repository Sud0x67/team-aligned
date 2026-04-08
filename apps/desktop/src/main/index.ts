import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from "electron";
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TeamalignedRuntime } from "@runtime";
import type {
  AvatarAssetScope,
  ConnectMcpInput,
  CreateAgentInput,
  CreateTeamInput,
  RunControlPayload,
  SaveAttachmentAssetInput,
  SendInputPayload,
  ProviderConnectionTestInput,
  UpdateAgentSkillsInput,
  UpdateAgentMcpsInput,
  UpdateProfileInput,
  UpdateProviderInput,
  UpdateSettingsInput,
  UpdateTeamMcpsInput,
} from "@shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let runtime: TeamalignedRuntime | null = null;

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

function hasRuntimeData(rootDir: string) {
  return [
    "settings.json",
    "app.db",
    "transcripts",
    "workspaces",
    "skills",
  ].some((entry) => existsSync(join(rootDir, entry)));
}

function resolveRuntimeRoot() {
  return join(homedir(), ".teamaligned");
}

function copyMissingRuntimeEntries(sourceRoot: string, targetRoot: string) {
  if (!existsSync(sourceRoot)) return;
  mkdirSync(targetRoot, { recursive: true });

  for (const entry of readdirSync(sourceRoot)) {
    const sourcePath = join(sourceRoot, entry);
    const targetPath = join(targetRoot, entry);

    if (!existsSync(targetPath)) {
      cpSync(sourcePath, targetPath, { recursive: true });
      continue;
    }

    if (statSync(sourcePath).isDirectory() && statSync(targetPath).isDirectory()) {
      copyMissingRuntimeEntries(sourcePath, targetPath);
    }
  }
}

function migrateLegacyRuntimeRoot(targetRoot: string) {
  mkdirSync(targetRoot, { recursive: true });

  const legacyRoots = [
    join(homedir(), "teamaligned"),
    join(app.getPath("userData"), "teamaligned"),
  ];

  for (const legacyRoot of legacyRoots) {
    if (legacyRoot === targetRoot) {
      continue;
    }
    if (!hasRuntimeData(legacyRoot)) {
      continue;
    }
    copyMissingRuntimeEntries(legacyRoot, targetRoot);
  }
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
}

function broadcastSnapshot() {
  if (!runtime) return;
  const snapshot = runtime.getSnapshot();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("teamaligned:snapshot", snapshot);
}

app.whenReady().then(async () => {
  const runtimeRoot = resolveRuntimeRoot();
  migrateLegacyRuntimeRoot(runtimeRoot);
  registerAssetProtocol();
  runtime = new TeamalignedRuntime(runtimeRoot);
  await runtime.init();
  runtime.on("snapshot", broadcastSnapshot);

  ipcMain.handle("teamaligned:bootstrap", async () => runtime?.getSnapshot());
  ipcMain.handle("teamaligned:send-input", async (_event, payload: SendInputPayload) =>
    runtime?.sendInput(payload),
  );
  ipcMain.handle("teamaligned:control-run", async (_event, payload: RunControlPayload) =>
    runtime?.controlRun(payload),
  );
  ipcMain.handle("teamaligned:create-agent", async (_event, payload: CreateAgentInput) =>
    runtime?.createAgent(payload),
  );
  ipcMain.handle("teamaligned:create-team", async (_event, payload: CreateTeamInput) =>
    runtime?.createTeam(payload),
  );
  ipcMain.handle("teamaligned:refresh-skill-catalog", async () => runtime?.refreshSkillCatalog());
  ipcMain.handle("teamaligned:install-skill", async (_event, skillId: string) =>
    runtime?.installSkill(skillId),
  );
  ipcMain.handle("teamaligned:remove-skill", async (_event, skillId: string) =>
    runtime?.removeSkill(skillId),
  );
  ipcMain.handle("teamaligned:refresh-mcp-catalog", async () => runtime?.refreshMcpCatalog());
  ipcMain.handle("teamaligned:connect-mcp", async (_event, payload: ConnectMcpInput) =>
    runtime?.connectMcp(payload),
  );
  ipcMain.handle("teamaligned:check-mcp-health", async (_event, serverId: string) =>
    runtime?.checkMcpHealth(serverId),
  );
  ipcMain.handle("teamaligned:disconnect-mcp", async (_event, serverId: string) =>
    runtime?.disconnectMcp(serverId),
  );
  ipcMain.handle("teamaligned:toggle-extension", async (_event, extensionId: string) =>
    runtime?.toggleExtension(extensionId),
  );
  ipcMain.handle("teamaligned:update-agent-skills", async (_event, payload: UpdateAgentSkillsInput) =>
    runtime?.updateAgentSkills(payload),
  );
  ipcMain.handle("teamaligned:update-agent-mcps", async (_event, payload: UpdateAgentMcpsInput) =>
    runtime?.updateAgentMcps(payload),
  );
  ipcMain.handle("teamaligned:update-team-mcps", async (_event, payload: UpdateTeamMcpsInput) =>
    runtime?.updateTeamMcps(payload),
  );
  ipcMain.handle("teamaligned:update-settings", async (_event, payload: UpdateSettingsInput) =>
    runtime?.updateSettings(payload),
  );
  ipcMain.handle("teamaligned:update-profile", async (_event, payload: UpdateProfileInput) =>
    runtime?.updateProfile(payload),
  );
  ipcMain.handle("teamaligned:update-provider", async (_event, payload: UpdateProviderInput) =>
    runtime?.updateProvider(payload),
  );
  ipcMain.handle(
    "teamaligned:test-provider-connection",
    async (_event, payload: ProviderConnectionTestInput) => runtime?.testProviderConnection(payload),
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
    ) => runtime?.saveAvatarAsset(payload),
  );
  ipcMain.handle(
    "teamaligned:save-attachment-asset",
    async (_event, payload: SaveAttachmentAssetInput) => runtime?.saveAttachmentAsset(payload),
  );
  ipcMain.handle("teamaligned:mark-notifications-read", async () => runtime?.markNotificationsRead());
  ipcMain.handle("teamaligned:mark-conversation-read", async (_event, conversationId: string) =>
    runtime?.markConversationRead(conversationId),
  );
  ipcMain.handle("teamaligned:select-directory", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return null;
    }
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
      title: "选择 MCP 工作目录",
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("teamaligned:open-workspace", async (_event, workspacePath: string) => {
    await shell.openPath(workspacePath);
  });

  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

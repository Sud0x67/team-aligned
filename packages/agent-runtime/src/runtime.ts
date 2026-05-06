import { EventEmitter } from "node:events";
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { nanoid } from "nanoid";
import type { HITLRequest, HITLResponse, InterruptOnConfig } from "langchain";
import {
  isSystemBuiltinSkillId,
  isTeamAlignedAssistantAgentId,
  parseSlashCommand,
} from "@teamaligned/shared";
import type {
  AgentRecord,
  AttachmentAssetRecord,
  AppSnapshot,
  AvatarAssetScope,
  ConversationExportResult,
  ConnectMcpInput,
  ConversationRecord,
  EnsureConversationInput,
  EnsureConversationResult,
  McpCatalogRecord,
  McpConnectionRecord,
  MessageVisibility,
  NotificationRecord,
  PromptAliasRecord,
  ProviderConnectionTestInput,
  ProviderConfig,
  PreviewWorkspaceReferencesInput,
  RunControlPayload,
  SearchWorkspaceFilesInput,
  SavePromptAliasInput,
  SaveAttachmentAssetInput,
  RunRecord,
  RunStatus,
  SendInputPayload,
  SkillCatalogRecord,
  TeamContext,
  TeamRecord,
  ToolExecutionApprovalInput,
  UpdateAgentInput,
  UpdateAgentSkillsInput,
  UpdateAgentMcpsInput,
  UpdateTeamInput,
  UpdateProfileInput,
  UpdateProviderInput,
  UpdateSettingsInput,
} from "@teamaligned/shared";
import { AppStorage } from "./storage.ts";
import {
  createProviderModel,
  extractAgentText,
  invokeSingleChatDeepAgent,
  isProviderTimeoutError,
  normalizeProviderErrorMessage,
  testProviderConnection as runProviderConnectionTest,
  type ToolApprovalInterruptHandler,
  type ToolApprovalInterruptOn,
  validateProviderForSingleChat,
} from "./deep-agent.ts";
import {
  fetchSkillCatalog,
  installSkillFromRegistry,
} from "./skill-registry.ts";
import {
  buildMcpConnection,
  fetchMcpCatalog,
  validateLocalMcpLauncher,
} from "./mcp-registry.ts";
import {
  authorizeMcpConnection,
  checkMcpConnection as healthCheckMcpConnection,
} from "./mcp-runtime.ts";
import { buildChildProcessEnv } from "./process-env.ts";
import { sanitizeMcpToolName, type McpInvocationEvent } from "./mcp-tools.ts";
import {
  buildRuntimeLangChainTools,
  normalizeRuntimeToolErrorMessage,
  type RuntimeToolInvocationEvent,
  type ToolExecutionPolicy,
  type ToolExecutionPolicyDecision,
  type ToolExecutionPolicyRequest,
} from "./agent-tools.ts";
import {
  buildNextHandoffState,
  buildExecutionBatches,
  executeNaturalTeamWorkItem,
  MAX_AGENT_MESSAGES_PER_TURN,
  generateNaturalTeamAgentMessage,
  MAX_TEAM_SUBROUNDS,
  MAX_TEAM_TURN_MESSAGES,
  normalizeTeamHandoffState,
  orchestrateTeamTurn,
  resolveMentionedMembers,
  shouldApplyTeamHandoffContinuity,
  TEAM_MEMBER_LIMIT,
  type TeamExecutionPlan,
  type TeamTurnPlan,
  type TeamExecutionWorkItem,
  type NaturalTeamAgentMessage,
} from "./team-runtime.ts";
import { byLanguage, detectRuntimeLanguage, formatList, type RuntimeLanguage } from "./runtime-language.ts";
import {
  previewWorkspaceReferences,
  resolveWorkspaceReferences,
  searchWorkspaceFiles as searchWorkspaceFilesInWorkspace,
} from "./workspace-file-search.ts";
import { getRuntimeTimeouts } from "./runtime-timeouts.ts";
import {
  compactMemoryFile,
  formatMemoryEntry,
  type MemoryCompactionSummaryInput,
} from "./memory-compaction.ts";

type RunStep = {
  label: string;
  delayMs?: number;
  execute: () => Promise<void> | void;
};

type ActiveRunController = {
  runId: string;
  conversationId: string;
  steps: RunStep[];
  timer: NodeJS.Timeout | null;
  busy: boolean;
  childProcess: ReturnType<typeof spawn> | null;
};

type SystemNotificationChannel = "agent_message" | "mention" | "group_message" | null;

type SlashDirectiveContext = {
  cleanedInput: string;
  skill: SkillCatalogRecord | null;
  promptAlias: PromptAliasRecord | null;
};

type RuntimeErrorLog = {
  source: string;
  name: string;
  message: string;
  stack: string | null;
  metadata: Record<string, unknown> | null;
};

type PendingToolApproval = {
  id: string;
  conversationId: string;
  runId: string;
  messageId: string;
  request: ToolExecutionPolicyRequest;
  requestFingerprint: string;
  actorName: string;
  responseLanguage: RuntimeLanguage;
  allowNextMatchingRequest: boolean;
  resolve: (decision: ToolExecutionPolicyDecision) => void;
};

type ToolApprovalRequestFactory = (args: Record<string, unknown>) => ToolExecutionPolicyRequest;

type ToolApprovalInterruptRuntime = {
  interruptOn: ToolApprovalInterruptOn;
  requestByToolName: Map<string, ToolApprovalRequestFactory>;
  handler: ToolApprovalInterruptHandler;
};

type MemoryAppendContext = {
  provider?: ProviderConfig;
  responseLanguage?: RuntimeLanguage;
  conversationId?: string;
  runId?: string;
  actorId?: string | null;
  actorName?: string | null;
  phase?: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  return Promise.race<T>([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error(label)), timeoutMs);
    }),
  ]);
}

function trimOutput(text: string, max = 2400) {
  const value = text.trim();
  return value.length <= max ? value : `${value.slice(0, max)}\n...`;
}

function isSafeChildPath(parentPath: string, childPath: string) {
  const relativePath = relative(resolve(parentPath), resolve(childPath));
  return relativePath !== "" && !relativePath.startsWith("..") && !relativePath.startsWith("/");
}

function trimHeadline(text: string, max = 120) {
  const value = text.trim().replace(/\s+/g, " ");
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}

const workspaceInternalDirName = ".teamaligned";

function previewToolArgs(args: Record<string, unknown>, max = 1400) {
  try {
    const json = JSON.stringify(args, null, 2);
    if (!json) return "{}";
    return json.length <= max ? json : `${json.slice(0, max)}\n...`;
  } catch {
    return "[unserializable input]";
  }
}

export function shouldRequireToolApproval(request: ToolExecutionPolicyRequest) {
  if (request.operation === "read") {
    return false;
  }

  if (request.workspaceScoped && request.operation === "write") {
    return false;
  }

  if (request.operation === "network") {
    return request.riskLevel === "high";
  }

  if (request.operation === "skill") {
    return request.riskLevel !== "low";
  }

  return (
    request.operation === "write" ||
    request.operation === "command" ||
    request.operation === "mcp" ||
    request.operation === "skill" ||
    request.riskLevel === "high"
  );
}

function createApprovalInterruptConfig(description: string): InterruptOnConfig {
  return {
    allowedDecisions: ["approve", "reject"],
    description,
  };
}

function normalizeToolArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return {};
  }
  return args as Record<string, unknown>;
}

function createToolApprovalRequestFingerprint(
  conversationId: string,
  request: ToolExecutionPolicyRequest,
) {
  return JSON.stringify({
    conversationId,
    serverId: request.serverId,
    toolName: request.toolName,
    operation: request.operation,
    args: request.args,
  });
}

function createToolApprovalFingerprintHash(fingerprint: string) {
  return createHash("sha256").update(fingerprint).digest("hex");
}

function createToolApprovalRejectMessage(input: {
  actorName: string;
  request: ToolExecutionPolicyRequest;
  responseLanguage: RuntimeLanguage;
  reason?: string;
}) {
  const reason =
    input.reason ||
    byLanguage(input.responseLanguage, {
      zh: "用户拒绝了这次工具执行。",
      en: "The user denied this tool execution.",
    });
  return byLanguage(input.responseLanguage, {
    zh: `${reason} 不要再次自动请求同一个权限。请明确告诉用户 ${input.actorName} 未执行 ${input.request.serverName}.${input.request.toolName}，并给出无需该权限的替代方案。`,
    en: `${reason} Do not automatically request the same permission again. Tell the user that ${input.actorName} did not run ${input.request.serverName}.${input.request.toolName}, and offer an alternative that does not require this permission.`,
  });
}

function createRuntimeToolApprovalRequests(): Map<string, ToolApprovalRequestFactory> {
  return new Map<string, ToolApprovalRequestFactory>([
    [
      "workspace_run_command",
      (args) => ({
        serverId: "local-shell",
        serverName: "Workspace Shell",
        toolName: "run_workspace_command",
        operation: "command",
        riskLevel: "high",
        args,
        description: "Run a shell command in the current workspace.",
        workspaceScoped: true,
      }),
    ],
    [
      "skill_run_script",
      (args) => ({
        serverId: "teamaligned-skills",
        serverName: "TeamAligned Skills",
        toolName: "skill_run_script",
        operation: "skill",
        riskLevel: "medium",
        args,
        description: "Run a bundled script from an allowlisted Skill.",
      }),
    ],
  ]);
}

function createRuntimeToolApprovalInterruptOn(): ToolApprovalInterruptOn {
  return {
    workspace_run_command: createApprovalInterruptConfig(
      "Run a shell command in the current workspace. Commands require user approval.",
    ),
    skill_run_script: createApprovalInterruptConfig(
      "Run a script bundled with an allowlisted Skill. Skill script execution requires user approval.",
    ),
  };
}

function serializeRuntimeError(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: sanitizeSensitiveText(error.message),
      stack: error.stack ? sanitizeSensitiveText(error.stack) : null,
    };
  }

  return {
    name: typeof error,
    message: sanitizeSensitiveText(String(error)),
    stack: null,
  };
}

function sanitizeSensitiveText(value: string) {
  return value
    .replace(/(api[_-]?key|authorization|bearer|token|secret|password)(["'\s:=]+)([^"',\s}]+)/gi, "$1$2[redacted]")
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, "sk-[redacted]");
}

function sanitizeRuntimeMetadata(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[redacted]";
  if (typeof value === "string") return sanitizeSensitiveText(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeRuntimeMetadata(item, depth + 1));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (/api[_-]?key|authorization|bearer|token|secret|password|headers?|env/i.test(key)) {
        return [key, "[redacted]"];
      }
      return [key, sanitizeRuntimeMetadata(item, depth + 1)];
    }),
  );
}

function sanitizeExportName(value: string) {
  const normalized = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "conversation";
}

function summarizeAttachments(attachments: AttachmentAssetRecord[], responseLanguage: RuntimeLanguage) {
  if (attachments.length === 0) return "";
  return responseLanguage === "en"
    ? attachments.map((attachment) => attachment.name).join(", ")
    : attachments.map((attachment) => attachment.name).join("、");
}

function buildUserMessageContent(
  input: string,
  attachments: AttachmentAssetRecord[],
  responseLanguage: RuntimeLanguage,
) {
  const trimmed = input.trim();
  if (trimmed) {
    return trimmed;
  }
  return byLanguage(responseLanguage, {
    zh: `已上传附件：${summarizeAttachments(attachments, responseLanguage)}`,
    en: `Uploaded attachments: ${summarizeAttachments(attachments, responseLanguage)}`,
  });
}

function buildRuntimePrompt(
  input: string,
  attachments: AttachmentAssetRecord[],
  responseLanguage: RuntimeLanguage,
) {
  const trimmed = input.trim();
  if (attachments.length === 0) {
    return trimmed;
  }

  const attachmentLines = attachments
    .map(
      (attachment) =>
        byLanguage(responseLanguage, {
          zh: `- ${attachment.name}\n  路径：${attachment.path}\n  类型：${attachment.mimeType}\n  大小：${attachment.sizeBytes} bytes`,
          en: `- ${attachment.name}\n  Path: ${attachment.path}\n  Type: ${attachment.mimeType}\n  Size: ${attachment.sizeBytes} bytes`,
        }),
    )
    .join("\n");

  const body =
    trimmed ||
    byLanguage(responseLanguage, {
      zh: "我上传了一些附件，请结合附件内容帮助我。",
      en: "I uploaded some attachments. Please help based on them.",
    });
  return byLanguage(responseLanguage, {
    zh: `${body}\n\n附件列表：\n${attachmentLines}`,
    en: `${body}\n\nAttachment list:\n${attachmentLines}`,
  });
}

function buildWorkspaceReferencePrompt(input: {
  baseInput: string;
  references: ReturnType<typeof resolveWorkspaceReferences>;
  responseLanguage: RuntimeLanguage;
}) {
  const { baseInput, references, responseLanguage } = input;
  const sections: string[] = [];

  if (references.resolved.length > 0) {
    const referenceBlocks = references.resolved.map((reference) =>
      byLanguage(responseLanguage, {
        zh: `- #${reference.path}${reference.truncated ? "（已截断）" : ""}\n\`\`\`\n${reference.content}\n\`\`\``,
        en: `- #${reference.path}${reference.truncated ? " (truncated)" : ""}\n\`\`\`\n${reference.content}\n\`\`\``,
      }),
    );
    sections.push(
      byLanguage(responseLanguage, {
        zh: `用户通过 # 引用了以下 workspace 文件，请优先基于这些内容回复：\n${referenceBlocks.join("\n\n")}`,
        en: `The user referenced these workspace files via #. Prioritize them in your response:\n${referenceBlocks.join("\n\n")}`,
      }),
    );
  }

  if (references.unresolved.length > 0) {
    sections.push(
      byLanguage(responseLanguage, {
        zh: `以下 # 引用未解析，请明确告知用户并引导确认路径：${references.unresolved
          .map((value) => `#${value}`)
          .join("、")}`,
        en: `These # references could not be resolved. Tell the user clearly and ask to verify paths: ${references.unresolved
          .map((value) => `#${value}`)
          .join(", ")}`,
      }),
    );
  }

  if (sections.length === 0) return baseInput;
  return `${baseInput}\n\n${sections.join("\n\n")}`;
}

function extractSlashAliases(input: string) {
  const aliases = new Set<string>();
  for (const match of input.matchAll(/(?:^|\s)\/([a-zA-Z0-9][a-zA-Z0-9_-]{0,47})(?=\s|$|[，。,.!?;；:：])/g)) {
    aliases.add(match[1].toLowerCase());
  }
  return Array.from(aliases).slice(0, 3);
}

function stripSlashAlias(input: string, alias: string) {
  return input
    .replace(new RegExp(`(^|\\s)\\/${alias}(?=\\s|$|[，。,.!?;；:：])`, "i"), "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function getMcpConfiguredHint(server: McpCatalogRecord, responseLanguage: RuntimeLanguage) {
  if (server.transport === "http") {
    return byLanguage(responseLanguage, {
      zh: `${server.name} 已加入本地连接列表。请在扩展页补充远端 URL、请求头或 Token 后，再点击“保存并检测”。`,
      en: `${server.name} has been added locally. In Extensions, fill remote URL/headers/token, then click "Save and Check".`,
    });
  }

  if (server.authType === "env") {
    return byLanguage(responseLanguage, {
      zh: `${server.name} 已加入本地连接列表。请在扩展页补充环境变量后，再点击“保存并检测”。`,
      en: `${server.name} has been added locally. In Extensions, add required environment variables, then click "Save and Check".`,
    });
  }

  if (server.authType === "header") {
    return byLanguage(responseLanguage, {
      zh: `${server.name} 已加入本地连接列表。请在扩展页补充请求头后，再点击“保存并检测”。`,
      en: `${server.name} has been added locally. In Extensions, add required headers, then click "Save and Check".`,
    });
  }

  return byLanguage(responseLanguage, {
    zh: `${server.name} 已加入本地连接列表。请在扩展页确认本地启动命令后，再点击“保存并检测”。`,
    en: `${server.name} has been added locally. In Extensions, verify the local launch command, then click "Save and Check".`,
  });
}

function chooseTeamRepresentative(team: TeamRecord, agents: AgentRecord[]) {
  const members = agents.filter((agent) => team.memberIds.includes(agent.id));
  return (
    members.find((agent) => agent.role.includes("经理") || agent.name === "Planner") ??
    members[0]
  );
}

export class TeamalignedRuntime extends EventEmitter {
  private readonly storage: AppStorage;
  private readonly activeRuns = new Map<string, ActiveRunController>();
  private readonly pendingToolApprovals = new Map<string, PendingToolApproval>();
  private readonly approvedToolApprovalFingerprints = new Set<string>();
  private readonly deniedToolApprovalFingerprints = new Set<string>();
  private readonly memoryCompactions = new Map<string, Promise<void>>();
  private readonly conversationReadPresence = new Map<string, number>();
  private catalogSyncStarted = false;
  private static readonly notificationPresenceWindowMs = 15_000;
  private readonly singleChatSessions = new Map<
    string,
    {
      signature: string;
      agent: ReturnType<typeof import("deepagents").createDeepAgent>;
      initialized: boolean;
    }
  >();

  constructor(private readonly dataDir: string) {
    super();
    mkdirSync(dataDir, { recursive: true });
    this.storage = new AppStorage(dataDir);
  }

  async init() {
    this.storage.init();
    this.recoverInterruptedRuns();
    this.emitSnapshot(this.getStartupSnapshot());
    setTimeout(() => {
      void this.syncCatalogsInBackground();
    }, 0);
  }

  getSnapshot(): AppSnapshot {
    return this.storage.getSnapshot();
  }

  private persistMcpConnectionUpdate(connection: McpConnectionRecord) {
    this.storage.upsertMcpConnection(connection);
    this.emitSnapshot();
  }

  getStartupSnapshot(): AppSnapshot {
    const firstConversationId = this.storage.listConversations()[0]?.id;
    return this.storage.getSnapshot({
      conversationIds: firstConversationId ? [firstConversationId] : [],
      messageLimit: 80,
    });
  }

  getConversationSnapshot(conversationId: string): AppSnapshot {
    return this.storage.getSnapshot({
      conversationIds: [conversationId],
      messageLimit: 200,
    });
  }

  private async syncCatalogsInBackground() {
    if (this.catalogSyncStarted) {
      return;
    }
    this.catalogSyncStarted = true;

    const [skillResult, mcpResult] = await Promise.allSettled([
      withTimeout(fetchSkillCatalog(), 2500, "Skill catalog sync timed out"),
      withTimeout(fetchMcpCatalog(), 2500, "MCP catalog sync timed out"),
    ]);

    let changed = false;
    if (skillResult.status === "fulfilled") {
      this.storage.replaceSkillCatalog(skillResult.value);
      changed = true;
    } else {
      this.emitRuntimeError("runtime:skill-catalog-sync", skillResult.reason);
    }
    if (mcpResult.status === "fulfilled") {
      this.storage.replaceMcpCatalog(mcpResult.value);
      changed = true;
    } else {
      this.emitRuntimeError("runtime:mcp-catalog-sync", mcpResult.reason);
    }

    if (changed) {
      this.emitSnapshot(this.getStartupSnapshot());
    }
  }

  private emitRuntimeError(
    source: string,
    error: unknown,
    metadata: Record<string, unknown> | null = null,
  ) {
    this.emit("runtime-error", {
      source,
      ...serializeRuntimeError(error),
      metadata: metadata ? (sanitizeRuntimeMetadata(metadata) as Record<string, unknown>) : null,
    } satisfies RuntimeErrorLog);
  }

  private emitRunRuntimeError(
    source: string,
    error: unknown,
    metadata: Record<string, unknown> = {},
  ) {
    this.emitRuntimeError(source, error, metadata);
  }

  private appendRunProgressMetadata(
    runId: string,
    entry: {
      content: string;
      phase?: string;
      actorId?: string | null;
      actorName?: string | null;
      kind?: string;
    },
  ) {
    const run = this.storage.getRun(runId);
    if (!run) return;
    const metadata = run.metadata ?? {};
    const existing = Array.isArray(metadata.progressTail)
      ? metadata.progressTail.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
      : [];
    const nextEntry = {
      ...entry,
      content: trimOutput(entry.content, 1200),
      createdAt: Date.now(),
    };
    this.storage.updateRun(runId, {
      metadata: {
        ...metadata,
        progressTail: [...existing, nextEntry].slice(-8),
        latestProgress: nextEntry,
      },
    });
  }

  private updateRunReasoningMetadata(
    runId: string,
    aggregatedText: string,
    input: {
      actorId?: string | null;
      actorName?: string | null;
      phase?: string;
    } = {},
  ) {
    const run = this.storage.getRun(runId);
    if (!run) return;
    const text = trimOutput(aggregatedText, 4000);
    this.storage.updateRun(runId, {
      metadata: {
        ...(run.metadata ?? {}),
        reasoningText: text,
        reasoningUpdatedAt: Date.now(),
        reasoningActorId: input.actorId ?? null,
        reasoningActorName: input.actorName ?? null,
        reasoningPhase: input.phase ?? null,
      },
    });
  }

  private createAppNotification(
    input: Omit<NotificationRecord, "id" | "read" | "createdAt"> & { createdAt?: number },
    channel: SystemNotificationChannel = null,
    options: { bypassReadSuppression?: boolean } = {},
  ) {
    if (
      !options.bypassReadSuppression &&
      input.relatedConversationId &&
      this.shouldSuppressConversationNotification(input.relatedConversationId)
    ) {
      return null;
    }
    const notification = this.storage.createNotification(input);
    this.emit("notification", { notification, channel });
    return notification;
  }

  private shouldSuppressConversationNotification(conversationId: string) {
    this.pruneConversationReadPresence();
    const conversation = this.storage.getConversation(conversationId);
    if (!conversation) {
      return false;
    }

    // If the conversation is already marked read, there is no value in
    // adding another notification-center item for it.
    if (conversation.unread <= 0) {
      return true;
    }

    const lastReadAt = this.conversationReadPresence.get(conversationId);
    if (!lastReadAt) {
      return false;
    }

    return Date.now() - lastReadAt <= TeamalignedRuntime.notificationPresenceWindowMs;
  }

  private pruneConversationReadPresence() {
    const nowAt = Date.now();
    for (const [conversationId, timestamp] of this.conversationReadPresence) {
      if (nowAt - timestamp > TeamalignedRuntime.notificationPresenceWindowMs) {
        this.conversationReadPresence.delete(conversationId);
      }
    }
  }

  private getConversationNotificationChannel(conversationId: string): SystemNotificationChannel {
    const conversation = this.storage.getConversation(conversationId);
    if (!conversation) {
      return null;
    }

    return conversation.kind === "agent" ? "agent_message" : "group_message";
  }

  private resolveResponseLanguage(
    conversation: ConversationRecord | null | undefined,
    latestInput: string,
    settingLanguage: string,
  ): RuntimeLanguage {
    const fallback: RuntimeLanguage = settingLanguage === "en" ? "en" : "zh";
    if (latestInput.trim().length > 0) {
      return detectRuntimeLanguage(latestInput, fallback);
    }
    if (conversation) {
      const latestUserMessage = this.storage
        .listMessages(conversation.id)
        .slice()
        .reverse()
        .find((message) => message.senderKind === "user" && message.visibility === "public");
      if (latestUserMessage) {
        return detectRuntimeLanguage(latestUserMessage.content, fallback);
      }
    }
    return fallback;
  }

  private getRunResponseLanguage(run: RunRecord): RuntimeLanguage {
    const value = run.metadata?.responseLanguage;
    return value === "en" ? "en" : "zh";
  }

  private isRunTerminal(runId: string) {
    const run = this.storage.getRun(runId);
    return !run || ["cancelled", "failed", "completed"].includes(run.status);
  }

  async sendInput(payload: SendInputPayload) {
    const snapshot = this.storage.getSnapshot();
    const conversation = snapshot.conversations.find((item) => item.id === payload.conversationId);
    if (!conversation) {
      return this.getSnapshot();
    }
    const responseLanguage = this.resolveResponseLanguage(
      conversation,
      payload.input,
      snapshot.settings.language,
    );

    this.storage.resetUnread(payload.conversationId);

    const attachments = payload.attachments ?? [];
    const command = parseSlashCommand(payload.input);
    if (command) {
      this.storage.addMessage({
        conversationId: payload.conversationId,
        senderId: "user",
        senderName: byLanguage(responseLanguage, { zh: "你", en: "You" }),
        senderKind: "user",
        messageType: "command",
        visibility: "public",
        content: command.raw,
        mentions: [],
        runId: null,
        metadata: { command: command.name, args: command.args },
        createdAt: Date.now(),
      });
      await this.handleSlashCommand(conversation, command.name, command.args, responseLanguage);
      this.storage.resetUnread(payload.conversationId);
      this.emitSnapshot();
      return this.getSnapshot();
    }

    const slashDirectives = this.resolveSlashDirectives(conversation, payload.input);
    const workspacePath = this.getWorkspaceForConversation(
      conversation,
      snapshot.agents,
      snapshot.teams,
    );
    const workspaceReferences = resolveWorkspaceReferences({
      workspacePath,
      content: slashDirectives.cleanedInput,
    });

    const mentionResolution = resolveMentionedMembers(payload.input, snapshot.agents);
    const mentionedAgentIds = mentionResolution.matchedIds;

    this.storage.addMessage({
      conversationId: payload.conversationId,
      senderId: "user",
      senderName: byLanguage(responseLanguage, { zh: "你", en: "You" }),
      senderKind: "user",
      messageType: "user",
      visibility: "public",
      content: buildUserMessageContent(payload.input, attachments, responseLanguage),
      mentions: mentionedAgentIds,
      runId: null,
      metadata: {
        rawInput: payload.input,
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(workspaceReferences.resolved.length > 0
          ? {
              workspaceReferences: workspaceReferences.resolved.map((reference) => ({
                token: reference.token,
                path: reference.path,
                absolutePath: reference.absolutePath,
                truncated: reference.truncated,
              })),
            }
          : {}),
        ...(workspaceReferences.unresolved.length > 0
          ? { unresolvedWorkspaceReferences: workspaceReferences.unresolved }
          : {}),
        ...(slashDirectives.skill
          ? { temporarySkill: slashDirectives.skill.id, temporarySkillSlug: slashDirectives.skill.slug }
          : {}),
        ...(slashDirectives.promptAlias
          ? { promptAlias: slashDirectives.promptAlias.id, promptAliasName: slashDirectives.promptAlias.alias }
          : {}),
      },
      createdAt: Date.now(),
    });

    const runtimeInput = this.buildSlashEnhancedRuntimeInput(
      conversation,
      buildWorkspaceReferencePrompt({
        baseInput: buildRuntimePrompt(slashDirectives.cleanedInput, attachments, responseLanguage),
        references: workspaceReferences,
        responseLanguage,
      }),
      slashDirectives,
      responseLanguage,
    );

    if (conversation.kind === "agent") {
      await this.startAgentRun(conversation, runtimeInput, slashDirectives, attachments, responseLanguage);
    } else {
      const team = snapshot.teams.find((item) => item.id === conversation.targetId);
      const memberIds = new Set(team?.memberIds ?? []);
      const explicitMentionIds = mentionedAgentIds.filter((id) => memberIds.has(id));
      const outOfTeamMentions = mentionResolution.matchedMembers
        .filter((agent) => !memberIds.has(agent.id))
        .map((agent) => `@${agent.name}`);
      const unresolvedMentions = mentionResolution.unresolvedTokens.map((token) => `@${token}`);
      if (outOfTeamMentions.length > 0 || unresolvedMentions.length > 0) {
        const ignored = Array.from(new Set([...outOfTeamMentions, ...unresolvedMentions]));
        this.addPublicNotice(
          conversation.id,
          byLanguage(responseLanguage, {
            zh: `以下 @ 未命中当前群组成员，已忽略：${formatList(ignored, responseLanguage)}。${
              explicitMentionIds.length > 0 ? "我会按已命中的 @ 继续执行。" : "我将按语义选择当前群组成员继续。"
            }`,
            en: `Ignored mentions not found in this group: ${formatList(ignored, responseLanguage)}. ${
              explicitMentionIds.length > 0
                ? "I'll continue with the valid @ mentions."
                : "I'll continue by semantic member selection."
            }`,
          }),
        );
      }
      await this.startTeamRun(
        conversation,
        runtimeInput,
        slashDirectives,
        explicitMentionIds,
        attachments,
        responseLanguage,
      );
    }

    this.emitSnapshot();
    return this.getSnapshot();
  }

  async controlRun(payload: RunControlPayload) {
    const conversation = this.storage.getConversation(payload.conversationId);
    const settingsLanguage = this.storage.getSnapshot().settings.language;
    const responseLanguage = this.resolveResponseLanguage(conversation, "", settingsLanguage);
    const latest = this.storage
      .listRuns()
      .find(
        (run) =>
          run.conversationId === payload.conversationId &&
          !["completed", "failed", "cancelled"].includes(run.status),
      );

    if (!latest) {
      this.addSystemMessage(
        payload.conversationId,
        byLanguage(responseLanguage, {
          zh: "当前会话没有可控制的任务。",
          en: "There is no controllable run in this conversation.",
        }),
      );
      this.emitSnapshot();
      return this.getSnapshot();
    }

    const controller = this.activeRuns.get(latest.id);

    if (payload.action === "pause") {
      if (latest.status === "paused" || latest.status === "pausing") {
        return this.getSnapshot();
      }

      if (controller && !controller.busy) {
        if (controller.timer) clearTimeout(controller.timer);
        controller.timer = null;
        this.storage.updateRun(latest.id, { status: "paused" });
        this.addRunMessage(
          payload.conversationId,
          latest.id,
          byLanguage(responseLanguage, {
            zh: "任务已暂停，可稍后继续。",
            en: "Run paused. You can resume later.",
          }),
          "system",
        );
      } else {
        this.storage.updateRun(latest.id, { status: "pausing" });
        this.addRunMessage(
          payload.conversationId,
          latest.id,
          byLanguage(responseLanguage, {
            zh: "已收到暂停请求，将在当前步骤结束后暂停。",
            en: "Pause request received. The run will pause after the current step.",
          }),
          "system",
        );
      }
    }

    if (payload.action === "resume") {
      if (latest.status !== "paused") {
        return this.getSnapshot();
      }

      this.storage.updateRun(latest.id, { status: "resuming" });
      this.addRunMessage(
        payload.conversationId,
        latest.id,
        byLanguage(responseLanguage, {
          zh: "任务正在恢复执行。",
          en: "Run is resuming.",
        }),
        "system",
      );
      if (controller) {
        this.scheduleNext(controller, 300);
      }
    }

    if (payload.action === "cancel") {
      this.stopRunController(latest.id);
      this.cancelPendingToolApprovalsForRun(latest.id, responseLanguage);
      this.finalizeStreamingMessagesForRun(payload.conversationId, latest.id, "cancelled");
      this.storage.updateRun(latest.id, { status: "cancelled" });
      this.storage.cancelPendingRunSteps(latest.id);
      this.resetTeamHandoffAfterCancellation(payload.conversationId, responseLanguage);
      this.addRunMessage(
        payload.conversationId,
        latest.id,
        byLanguage(responseLanguage, {
          zh: "任务已取消。",
          en: "Run cancelled.",
        }),
        "system",
      );
      this.addTeamCancellationMessage(payload.conversationId, latest.id, responseLanguage);
    }

    this.emitSnapshot();
    return this.getSnapshot();
  }

  async resolveToolExecutionApproval(payload: ToolExecutionApprovalInput) {
    const pending = this.pendingToolApprovals.get(payload.approvalId);
    if (!pending) {
      return this.getSnapshot();
    }

    this.resolvePendingToolApproval(pending, payload.decision);

    this.emitSnapshot();
    return this.getSnapshot();
  }

  private resolvePendingToolApproval(
    pending: PendingToolApproval,
    decision: ToolExecutionApprovalInput["decision"],
  ) {
    this.pendingToolApprovals.delete(pending.id);
    const approved = decision === "approved" || decision === "approved_for_conversation";
    if (!approved) {
      this.deniedToolApprovalFingerprints.add(pending.requestFingerprint);
    } else if (decision === "approved_for_conversation") {
      this.storage.rememberToolApprovalForConversation(
        pending.conversationId,
        createToolApprovalFingerprintHash(pending.requestFingerprint),
      );
    } else if (pending.allowNextMatchingRequest) {
      this.approvedToolApprovalFingerprints.add(pending.requestFingerprint);
    }
    const content = approved
      ? decision === "approved_for_conversation"
        ? byLanguage(pending.responseLanguage, {
            zh: `已允许 ${pending.actorName} 执行 ${pending.request.serverName}.${pending.request.toolName}，当前会话中相同请求将自动允许。`,
            en: `Allowed ${pending.actorName} to run ${pending.request.serverName}.${pending.request.toolName}; the same request will be allowed automatically in this conversation.`,
          })
        : byLanguage(pending.responseLanguage, {
            zh: `已允许 ${pending.actorName} 执行 ${pending.request.serverName}.${pending.request.toolName}。`,
            en: `Allowed ${pending.actorName} to run ${pending.request.serverName}.${pending.request.toolName}.`,
          })
      : byLanguage(pending.responseLanguage, {
          zh: `已拒绝 ${pending.actorName} 执行 ${pending.request.serverName}.${pending.request.toolName}。`,
          en: `Denied ${pending.actorName} from running ${pending.request.serverName}.${pending.request.toolName}.`,
        });

    const message = this.storage
      .listMessages(pending.conversationId)
      .find((item) => item.id === pending.messageId);
    this.storage.updateMessage(pending.messageId, {
      content,
      metadata: {
        ...(message?.metadata ?? {}),
        approvalStatus: decision,
        resolvedAt: Date.now(),
      },
    });

    pending.resolve(
      approved
        ? { allow: true }
        : {
            allow: false,
            reason: byLanguage(pending.responseLanguage, {
              zh: "用户拒绝了这次工具执行。",
              en: "The user denied this tool execution.",
            }),
          },
    );
  }

  async searchWorkspaceFiles(payload: SearchWorkspaceFilesInput) {
    const snapshot = this.storage.getSnapshot();
    const conversation = snapshot.conversations.find((item) => item.id === payload.conversationId);
    if (!conversation) return [];

    const workspacePath = this.getWorkspaceForConversation(
      conversation,
      snapshot.agents,
      snapshot.teams,
    );

    return searchWorkspaceFilesInWorkspace({
      workspacePath,
      query: payload.query,
      limit: payload.limit,
    });
  }

  async previewWorkspaceReferences(payload: PreviewWorkspaceReferencesInput) {
    const snapshot = this.storage.getSnapshot();
    const conversation = snapshot.conversations.find((item) => item.id === payload.conversationId);
    if (!conversation) return [];

    const workspacePath = this.getWorkspaceForConversation(
      conversation,
      snapshot.agents,
      snapshot.teams,
    );

    return previewWorkspaceReferences({
      workspacePath,
      content: payload.content,
    });
  }

  async createAgent(payload: Parameters<AppStorage["createAgent"]>[0]) {
    this.storage.createAgent(payload);
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async createTeam(payload: Parameters<AppStorage["createTeam"]>[0]) {
    this.storage.createTeam(payload);
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async deleteAgent(agentId: string) {
    const snapshot = this.storage.getSnapshot();
    const responseLanguage: RuntimeLanguage = snapshot.settings.language === "en" ? "en" : "zh";
    const agent = snapshot.agents.find((item) => item.id === agentId);
    if (!agent) {
      throw new Error(
        byLanguage(responseLanguage, {
          zh: "未找到要删除的 Agent。",
          en: "Agent to delete was not found.",
        }),
      );
    }
    if (isTeamAlignedAssistantAgentId(agent.id)) {
      throw new Error(
        byLanguage(responseLanguage, {
          zh: "TeamAligned 助手是系统内置 Agent，不能删除。",
          en: "TeamAligned assistant is a built-in Agent and cannot be deleted.",
        }),
      );
    }

    const conversationId = `conv-${agent.id}`;
    const teamConversationIds = snapshot.teams
      .filter((team) => team.memberIds.includes(agent.id))
      .map((team) => `conv-${team.id}`);
    const blockedConversationIds = new Set([conversationId, ...teamConversationIds]);
    const hasActiveRun = snapshot.runs.some(
      (run) =>
        blockedConversationIds.has(run.conversationId) &&
        !["completed", "failed", "cancelled"].includes(run.status),
    );
    if (hasActiveRun) {
      throw new Error(
        byLanguage(responseLanguage, {
          zh: "该 Agent 或所在群组仍有运行中的任务，请先取消任务后再删除。",
          en: "This Agent or one of its groups still has an active run. Cancel it before deleting.",
        }),
      );
    }

    this.storage.deleteAgent(agent.id);
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async deleteTeam(teamId: string) {
    const snapshot = this.storage.getSnapshot();
    const responseLanguage: RuntimeLanguage = snapshot.settings.language === "en" ? "en" : "zh";
    const team = snapshot.teams.find((item) => item.id === teamId);
    if (!team) {
      throw new Error(
        byLanguage(responseLanguage, {
          zh: "未找到要删除的群组。",
          en: "Group to delete was not found.",
        }),
      );
    }

    const conversationId = `conv-${team.id}`;
    const hasActiveRun = snapshot.runs.some(
      (run) =>
        run.conversationId === conversationId &&
        !["completed", "failed", "cancelled"].includes(run.status),
    );
    if (hasActiveRun) {
      throw new Error(
        byLanguage(responseLanguage, {
          zh: "该群组仍有运行中的任务，请先取消任务后再删除。",
          en: "This group still has an active run. Cancel it before deleting.",
        }),
      );
    }

    this.storage.deleteTeam(team.id);
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async deleteConversation(conversationId: string) {
    const snapshot = this.storage.getSnapshot();
    const responseLanguage: RuntimeLanguage = snapshot.settings.language === "en" ? "en" : "zh";
    const conversation = snapshot.conversations.find((item) => item.id === conversationId);
    if (!conversation) {
      throw new Error(
        byLanguage(responseLanguage, {
          zh: "未找到要删除的会话。",
          en: "Conversation to delete was not found.",
        }),
      );
    }

    const hasActiveRun = snapshot.runs.some(
      (run) =>
        run.conversationId === conversation.id &&
        !["completed", "failed", "cancelled"].includes(run.status),
    );
    if (hasActiveRun) {
      throw new Error(
        byLanguage(responseLanguage, {
          zh: "该会话仍有运行中的任务，请先取消任务后再删除。",
          en: "This conversation still has an active run. Cancel it before deleting.",
        }),
      );
    }

    this.storage.deleteConversation(conversation.id);
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async ensureConversation(payload: EnsureConversationInput): Promise<EnsureConversationResult> {
    const conversation = this.storage.ensureConversation(payload);
    this.emitSnapshot();
    return {
      snapshot: this.getSnapshot(),
      conversationId: conversation.id,
    };
  }

  async updateAgent(payload: UpdateAgentInput) {
    const snapshot = this.storage.getSnapshot();
    const responseLanguage: RuntimeLanguage = snapshot.settings.language === "en" ? "en" : "zh";
    if (isTeamAlignedAssistantAgentId(payload.agentId)) {
      throw new Error(
        byLanguage(responseLanguage, {
          zh: "TeamAligned 助手是系统内置 Agent，不能编辑。",
          en: "TeamAligned assistant is a built-in Agent and cannot be edited.",
        }),
      );
    }
    this.storage.updateAgent(payload);
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async updateTeam(payload: UpdateTeamInput) {
    this.storage.updateTeam(payload);
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async toggleExtension(extensionId: string) {
    this.storage.toggleExtension(extensionId);
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async refreshSkillCatalog() {
    const settingsLanguage = this.storage.getSnapshot().settings.language;
    const responseLanguage: RuntimeLanguage = settingsLanguage === "en" ? "en" : "zh";
    const catalog = await fetchSkillCatalog();
    this.storage.replaceSkillCatalog(catalog);
    this.createAppNotification({
      type: "extension",
      title: byLanguage(responseLanguage, { zh: "Skill catalog 已同步", en: "Skill catalog synced" }),
      body: byLanguage(responseLanguage, {
        zh: `已同步 ${catalog.length} 个 Skill 元数据。`,
        en: `Synced ${catalog.length} skill metadata entries.`,
      }),
      relatedConversationId: null,
      relatedRunId: null,
    });
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async installSkill(skillId: string) {
    const settingsLanguage = this.storage.getSnapshot().settings.language;
    const responseLanguage: RuntimeLanguage = settingsLanguage === "en" ? "en" : "zh";
    const skill = this.storage.getSkillCatalogEntry(skillId);
    if (!skill) {
      this.createAppNotification({
        type: "system",
        title: byLanguage(responseLanguage, { zh: "Skill 安装失败", en: "Skill install failed" }),
        body: byLanguage(responseLanguage, {
          zh: `未找到 Skill：${skillId}`,
          en: `Skill not found: ${skillId}`,
        }),
        relatedConversationId: null,
        relatedRunId: null,
      });
      this.emitSnapshot();
      return this.getSnapshot();
    }
    if (isSystemBuiltinSkillId(skill.id)) {
      this.storage.markSkillInstalled({
        skillId: skill.id,
        installPath: "",
        version: skill.version,
      });
      this.emitSnapshot();
      return this.getSnapshot();
    }

    const installed = await installSkillFromRegistry({
      skill,
      installRoot: this.storage.skillInstallRoot,
    });
    this.storage.markSkillInstalled({
      skillId,
      installPath: installed.installPath,
      version: installed.version,
    });
    this.createAppNotification({
      type: "extension",
      title: byLanguage(responseLanguage, { zh: "Skill 已安装", en: "Skill installed" }),
      body: byLanguage(responseLanguage, {
        zh: `${skill.displayName || skill.name} 已安装到全局目录。`,
        en: `${skill.displayName || skill.name} has been installed globally.`,
      }),
      relatedConversationId: null,
      relatedRunId: null,
    });
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async removeSkill(skillId: string) {
    const settingsLanguage = this.storage.getSnapshot().settings.language;
    const responseLanguage: RuntimeLanguage = settingsLanguage === "en" ? "en" : "zh";
    const skill = this.storage.getSkillCatalogEntry(skillId);
    if (!skill) {
      this.createAppNotification({
        type: "system",
        title: byLanguage(responseLanguage, { zh: "Skill 移除失败", en: "Skill removal failed" }),
        body: byLanguage(responseLanguage, {
          zh: `未找到 Skill：${skillId}`,
          en: `Skill not found: ${skillId}`,
        }),
        relatedConversationId: null,
        relatedRunId: null,
      });
      this.emitSnapshot();
      return this.getSnapshot();
    }
    if (isSystemBuiltinSkillId(skill.id)) {
      throw new Error(
        byLanguage(responseLanguage, {
          zh: "内置 Skill 不能移除。",
          en: "Built-in skills cannot be removed.",
        }),
      );
    }

    if (skill.installPath && isSafeChildPath(this.storage.skillInstallRoot, skill.installPath)) {
      rmSync(skill.installPath, { recursive: true, force: true });
    }

    this.storage.markSkillRemoved(skill.id);
    this.createAppNotification({
      type: "extension",
      title: byLanguage(responseLanguage, { zh: "Skill 已移除", en: "Skill removed" }),
      body: byLanguage(responseLanguage, {
        zh: `${skill.displayName || skill.name} 已从全局目录移除。`,
        en: `${skill.displayName || skill.name} has been removed from global install.`,
      }),
      relatedConversationId: null,
      relatedRunId: null,
    });
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async savePromptAlias(payload: SavePromptAliasInput) {
    const settingsLanguage = this.storage.getSnapshot().settings.language;
    const responseLanguage: RuntimeLanguage = settingsLanguage === "en" ? "en" : "zh";
    const promptAlias = this.storage.savePromptAlias(payload);
    this.createAppNotification({
      type: "extension",
      title: byLanguage(responseLanguage, { zh: "Prompt 已保存", en: "Prompt saved" }),
      body: byLanguage(responseLanguage, {
        zh: `/${promptAlias.alias} 已可在聊天中使用。`,
        en: `/${promptAlias.alias} is now available in chat.`,
      }),
      relatedConversationId: null,
      relatedRunId: null,
    });
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async removePromptAlias(promptAliasId: string) {
    const settingsLanguage = this.storage.getSnapshot().settings.language;
    const responseLanguage: RuntimeLanguage = settingsLanguage === "en" ? "en" : "zh";
    const existing = this.storage.listPromptAliases().find((item) => item.id === promptAliasId);
    this.storage.removePromptAlias(promptAliasId);
    this.createAppNotification({
      type: "extension",
      title: byLanguage(responseLanguage, { zh: "Prompt 已移除", en: "Prompt removed" }),
      body: byLanguage(responseLanguage, {
        zh: existing ? `/${existing.alias} 已从自定义命令中移除。` : "自定义 Prompt 已移除。",
        en: existing ? `/${existing.alias} has been removed from custom commands.` : "Custom prompt has been removed.",
      }),
      relatedConversationId: null,
      relatedRunId: null,
    });
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async refreshMcpCatalog() {
    const settingsLanguage = this.storage.getSnapshot().settings.language;
    const responseLanguage: RuntimeLanguage = settingsLanguage === "en" ? "en" : "zh";
    const catalog = await fetchMcpCatalog();
    this.storage.replaceMcpCatalog(catalog);
    this.createAppNotification({
      type: "extension",
      title: byLanguage(responseLanguage, { zh: "MCP catalog 已同步", en: "MCP catalog synced" }),
      body: byLanguage(responseLanguage, {
        zh: `已同步 ${catalog.length} 个 MCP 元数据。`,
        en: `Synced ${catalog.length} MCP metadata entries.`,
      }),
      relatedConversationId: null,
      relatedRunId: null,
    });
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async connectMcp(payload: ConnectMcpInput) {
    const settingsLanguage = this.storage.getSnapshot().settings.language;
    const responseLanguage: RuntimeLanguage = settingsLanguage === "en" ? "en" : "zh";
    const server = this.storage.getMcpCatalogEntry(payload.serverId);
    if (!server) {
      this.createAppNotification({
        type: "system",
        title: byLanguage(responseLanguage, { zh: "MCP 连接失败", en: "MCP connection failed" }),
        body: byLanguage(responseLanguage, {
          zh: `未找到 MCP：${payload.serverId}`,
          en: `MCP not found: ${payload.serverId}`,
        }),
        relatedConversationId: null,
        relatedRunId: null,
      });
      this.emitSnapshot();
      return this.getSnapshot();
    }

    const existing = this.storage.getMcpConnection(server.id);
    const baseConnection = existing ?? buildMcpConnection(server);
    const connection = {
      ...baseConnection,
      command: payload.command ?? baseConnection.command,
      args: payload.args ?? baseConnection.args,
      url: payload.url ?? baseConnection.url,
      envEntries: {
        ...baseConnection.envEntries,
        ...(payload.envEntries ?? {}),
      },
      headers: {
        ...baseConnection.headers,
        ...(payload.headers ?? {}),
      },
      cwd: payload.cwd ?? baseConnection.cwd,
      enabled: payload.enabled ?? baseConnection.enabled,
    };

    const launcherIssue = validateLocalMcpLauncher(
      {
        ...server,
        launcherCommand: connection.command,
      },
      responseLanguage,
    );
    const checkedConnection = launcherIssue
      ? {
          ...connection,
          enabled: false,
          status: "error" as const,
          lastCheckedAt: Date.now(),
          lastError: launcherIssue,
        }
      : await healthCheckMcpConnection({
          catalog: server,
          connection,
          workspacePath: connection.cwd || this.storage.workspaceRoot,
          responseLanguage,
          onConnectionUpdated: (updatedConnection) => this.persistMcpConnectionUpdate(updatedConnection),
        });

    this.storage.upsertMcpConnection(checkedConnection);
    this.createAppNotification({
      type: checkedConnection.status === "connected" ? "extension" : "system",
      title:
        checkedConnection.status === "connected"
          ? byLanguage(responseLanguage, { zh: "MCP 已连接", en: "MCP connected" })
          : checkedConnection.status === "configured"
            ? byLanguage(responseLanguage, { zh: "MCP 已保存待配置", en: "MCP saved, pending config" })
            : byLanguage(responseLanguage, { zh: "MCP 连接失败", en: "MCP connection failed" }),
      body:
        checkedConnection.status === "connected"
          ? byLanguage(responseLanguage, {
              zh: `${server.name} 已连接成功，并发现 ${checkedConnection.discoveredTools.length} 个工具。下一步可以在 Agent 编辑里分配这个 MCP，或在聊天中输入 /mcp 查看可用能力。`,
              en: `${server.name} connected successfully, discovered ${checkedConnection.discoveredTools.length} tools. Next, assign this MCP in Agent editing, or type /mcp in chat to view available capabilities.`,
            })
          : checkedConnection.status === "configured"
            ? getMcpConfiguredHint(server, responseLanguage)
            : byLanguage(responseLanguage, {
                zh: `${server.name} 连接失败：${checkedConnection.lastError ?? "未知错误"}`,
                en: `${server.name} connection failed: ${checkedConnection.lastError ?? "unknown error"}`,
              }),
      relatedConversationId: null,
      relatedRunId: null,
    });
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async authorizeMcp(
    serverId: string,
    openAuthorizationUrl?: (authorizationUrl: string) => void | Promise<void>,
  ) {
    const settingsLanguage = this.storage.getSnapshot().settings.language;
    const responseLanguage: RuntimeLanguage = settingsLanguage === "en" ? "en" : "zh";
    const server = this.storage.getMcpCatalogEntry(serverId);
    const connection = this.storage.getMcpConnection(serverId);
    if (!server || !connection) {
      this.createAppNotification({
        type: "system",
        title: byLanguage(responseLanguage, { zh: "MCP 授权失败", en: "MCP authorization failed" }),
        body: byLanguage(responseLanguage, {
          zh: `未找到 MCP 连接：${serverId}`,
          en: `MCP connection not found: ${serverId}`,
        }),
        relatedConversationId: null,
        relatedRunId: null,
      });
      this.emitSnapshot();
      return this.getSnapshot();
    }

    const checked = await authorizeMcpConnection({
      catalog: server,
      connection,
      workspacePath: connection.cwd || this.storage.workspaceRoot,
      responseLanguage,
      openAuthorizationUrl,
      onConnectionUpdated: (updatedConnection) => this.persistMcpConnectionUpdate(updatedConnection),
    });
    this.storage.upsertMcpConnection(checked);
    this.createAppNotification({
      type: checked.status === "connected" ? "extension" : "system",
      title:
        checked.status === "connected"
          ? byLanguage(responseLanguage, { zh: "MCP 授权完成", en: "MCP authorized" })
          : byLanguage(responseLanguage, { zh: "MCP 授权待完成", en: "MCP authorization pending" }),
      body:
        checked.status === "connected"
          ? byLanguage(responseLanguage, {
              zh: `${server.name} 已授权并连接成功，发现 ${checked.discoveredTools.length} 个工具。`,
              en: `${server.name} is authorized and connected with ${checked.discoveredTools.length} tools discovered.`,
            })
          : byLanguage(responseLanguage, {
              zh: `${server.name} 仍需完成授权：${checked.lastError ?? "请在浏览器完成登录后重试。"}`,
              en: `${server.name} still needs authorization: ${checked.lastError ?? "Finish login in the browser, then retry."}`,
            }),
      relatedConversationId: null,
      relatedRunId: null,
    });
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async checkMcpHealth(serverId: string) {
    const settingsLanguage = this.storage.getSnapshot().settings.language;
    const responseLanguage: RuntimeLanguage = settingsLanguage === "en" ? "en" : "zh";
    const server = this.storage.getMcpCatalogEntry(serverId);
    const connection = this.storage.getMcpConnection(serverId);
    if (!server || !connection) {
      this.createAppNotification({
        type: "system",
        title: byLanguage(responseLanguage, { zh: "MCP 检测失败", en: "MCP health check failed" }),
        body: byLanguage(responseLanguage, {
          zh: `未找到 MCP 连接：${serverId}`,
          en: `MCP connection not found: ${serverId}`,
        }),
        relatedConversationId: null,
        relatedRunId: null,
      });
      this.emitSnapshot();
      return this.getSnapshot();
    }

    const checked = await healthCheckMcpConnection({
      catalog: server,
      connection,
      workspacePath: connection.cwd || this.storage.workspaceRoot,
      responseLanguage,
      onConnectionUpdated: (updatedConnection) => this.persistMcpConnectionUpdate(updatedConnection),
    });
    this.storage.upsertMcpConnection(checked);
    this.createAppNotification({
      type: checked.status === "connected" ? "extension" : "system",
      title:
        checked.status === "connected"
          ? byLanguage(responseLanguage, { zh: "MCP 检测通过", en: "MCP health check passed" })
          : byLanguage(responseLanguage, { zh: "MCP 检测失败", en: "MCP health check failed" }),
      body:
        checked.status === "connected"
          ? byLanguage(responseLanguage, {
              zh: `${server.name} 当前可用，已发现 ${checked.discoveredTools.length} 个工具。可在 Agent 编辑里分配，或在聊天中输入 /mcp 查看。`,
              en: `${server.name} is available, discovered ${checked.discoveredTools.length} tools. Assign it in Agent editing, or type /mcp in chat to view it.`,
            })
          : byLanguage(responseLanguage, {
              zh: `${server.name} 检测失败：${checked.lastError ?? "未知错误"}`,
              en: `${server.name} check failed: ${checked.lastError ?? "unknown error"}`,
            }),
      relatedConversationId: null,
      relatedRunId: null,
    });
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async disconnectMcp(serverId: string) {
    const settingsLanguage = this.storage.getSnapshot().settings.language;
    const responseLanguage: RuntimeLanguage = settingsLanguage === "en" ? "en" : "zh";
    const server = this.storage.getMcpCatalogEntry(serverId);
    this.storage.removeMcpConnection(serverId);
    this.createAppNotification({
      type: "extension",
      title: byLanguage(responseLanguage, { zh: "MCP 已移除", en: "MCP removed" }),
      body: byLanguage(responseLanguage, {
        zh: `${server?.name ?? serverId} 已从本地连接列表中移除。`,
        en: `${server?.name ?? serverId} has been removed from local connections.`,
      }),
      relatedConversationId: null,
      relatedRunId: null,
    });
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async updateAgentSkills(payload: UpdateAgentSkillsInput) {
    this.storage.updateAgentSkillWhitelist(payload);
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async updateAgentMcps(payload: UpdateAgentMcpsInput) {
    this.storage.updateAgentMcpWhitelist(payload);
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async updateSettings(payload: UpdateSettingsInput) {
    this.storage.setSettings(payload);
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async updateProfile(payload: UpdateProfileInput) {
    this.storage.setProfile(payload);
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async updateProvider(payload: UpdateProviderInput) {
    const existing = this.storage.listProviders().find((provider) => provider.id === payload.id) ?? null;
    if (!existing) {
      throw new Error(`未找到 provider：${payload.id}`);
    }

    const mergedProvider: ProviderConfig = {
      ...existing,
      ...payload,
      id: payload.id,
    };
    if (mergedProvider.isActive) {
      const testResult = await runProviderConnectionTest({
        id: mergedProvider.id,
        label: mergedProvider.label,
        baseUrl: mergedProvider.baseUrl,
        apiKey: mergedProvider.apiKey,
        defaultModel: mergedProvider.defaultModel,
        supportsToolCalling: mergedProvider.supportsToolCalling,
        supportsStreaming: mergedProvider.supportsStreaming,
      });
      if (!testResult.ok) {
        throw new Error(testResult.message);
      }
    }

    this.storage.updateProvider(payload);
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async testProviderConnection(payload: ProviderConnectionTestInput) {
    return runProviderConnectionTest(payload);
  }

  async saveAvatarAsset(input: {
    scope: AvatarAssetScope;
    dataUrl: string;
    fileNameHint?: string;
  }) {
    return this.storage.saveAvatarAsset(input);
  }

  async saveAttachmentAsset(input: SaveAttachmentAssetInput) {
    return this.storage.saveAttachmentAsset(input);
  }

  async exportConversationData(conversationId: string): Promise<ConversationExportResult> {
    const snapshot = this.storage.getSnapshot();
    const conversation = snapshot.conversations.find((item) => item.id === conversationId);
    if (!conversation) {
      throw new Error(`未找到会话：${conversationId}`);
    }

    const messages = snapshot.messages[conversationId] ?? [];
    const runs = snapshot.runs
      .filter((run) => run.conversationId === conversationId)
      .sort((a, b) => a.createdAt - b.createdAt);
    const runIdSet = new Set(runs.map((run) => run.id));
    const runSteps = snapshot.runSteps
      .filter((step) => step.conversationId === conversationId || runIdSet.has(step.runId))
      .sort((a, b) =>
        a.runId === b.runId ? a.stepIndex - b.stepIndex : a.runId.localeCompare(b.runId, "en"),
      );
    const artifacts = snapshot.artifacts
      .filter(
        (artifact) =>
          artifact.conversationId === conversationId ||
          (artifact.runId !== null && runIdSet.has(artifact.runId)),
      )
      .sort((a, b) => a.createdAt - b.createdAt);
    const attachments = snapshot.attachments
      .filter((attachment) => attachment.conversationId === conversationId || (attachment.runId && runIdSet.has(attachment.runId)))
      .sort((a, b) => a.createdAt - b.createdAt);
    const toolInvocations = snapshot.toolInvocations
      .filter(
        (invocation) =>
          invocation.conversationId === conversationId ||
          (invocation.runId !== null && runIdSet.has(invocation.runId)),
      )
      .sort((a, b) => a.createdAt - b.createdAt);

    const exportedAt = Date.now();
    const exportDir = join(this.storage.rootDir, "exports", conversationId);
    mkdirSync(exportDir, { recursive: true });
    const timestamp = new Date(exportedAt).toISOString().replace(/[:.]/g, "-");
    const title = sanitizeExportName(conversation.title);
    const filePath = join(exportDir, `${title}-${timestamp}.json`);

    const targetWorkspacePath =
      conversation.kind === "agent"
        ? snapshot.agents.find((agent) => agent.id === conversation.targetId)?.workspacePath ?? null
        : snapshot.teams.find((team) => team.id === conversation.targetId)?.workspacePath ?? null;

    const transcriptPaths = this.storage.getConversationTranscriptPaths(conversationId);
    const exportPayload = {
      schemaVersion: 1,
      exportedAt,
      rootDir: this.storage.rootDir,
      conversation,
      workspacePath: targetWorkspacePath,
      transcriptPaths,
      messageCount: messages.length,
      runCount: runs.length,
      runStepCount: runSteps.length,
      artifactCount: artifacts.length,
      attachmentCount: attachments.length,
      toolInvocationCount: toolInvocations.length,
      messages,
      runs,
      runSteps,
      artifacts,
      attachments,
      toolInvocations,
    };

    writeFileSync(filePath, JSON.stringify(exportPayload, null, 2), "utf8");

    return {
      conversationId,
      filePath,
      exportedAt,
      messageCount: messages.length,
      runCount: runs.length,
      runStepCount: runSteps.length,
      artifactCount: artifacts.length,
      attachmentCount: attachments.length,
      toolInvocationCount: toolInvocations.length,
    };
  }

  private async requestToolExecutionApproval(input: {
    conversationId: string;
    runId: string;
    actorName: string;
    responseLanguage: RuntimeLanguage;
    request: ToolExecutionPolicyRequest;
    allowNextMatchingRequest?: boolean;
  }) {
    const approvalId = `approval-${nanoid(8)}`;
    const argsPreview = previewToolArgs(input.request.args);
    const requestFingerprint = createToolApprovalRequestFingerprint(
      input.conversationId,
      input.request,
    );
    const approvalTitle = byLanguage(input.responseLanguage, {
      zh: "需要确认工具执行",
      en: "Tool execution needs approval",
    });
    const approvalBody = byLanguage(input.responseLanguage, {
      zh: `${input.actorName} 想执行 ${input.request.serverName}.${input.request.toolName}，需要你确认。`,
      en: `${input.actorName} wants to run ${input.request.serverName}.${input.request.toolName}. Please confirm.`,
    });
    const message = this.storage.addMessage(
      {
        conversationId: input.conversationId,
        senderId: "system",
        senderName: "TeamAligned",
        senderKind: "system",
        messageType: "notification",
        visibility: "system",
        content: approvalBody,
        mentions: [],
        runId: input.runId,
        metadata: {
          cardType: "tool_approval",
          approvalId,
          approvalStatus: "pending",
          actorName: input.actorName,
          serverId: input.request.serverId,
          serverName: input.request.serverName,
          toolName: input.request.toolName,
          operation: input.request.operation,
          riskLevel: input.request.riskLevel,
          description: input.request.description,
          argsPreview,
        },
        createdAt: Date.now(),
      },
      { skipTranscript: true },
    );
    this.storage.touchConversation(input.conversationId, approvalBody, true);
    this.createAppNotification(
      {
        type: "system",
        title: approvalTitle,
        body: approvalBody,
        relatedConversationId: input.conversationId,
        relatedRunId: input.runId,
      },
      this.getConversationNotificationChannel(input.conversationId),
      { bypassReadSuppression: true },
    );
    this.emitSnapshot();

    return await new Promise<ToolExecutionPolicyDecision>((resolve) => {
      this.pendingToolApprovals.set(approvalId, {
        id: approvalId,
        conversationId: input.conversationId,
        runId: input.runId,
        messageId: message.id,
        request: input.request,
        requestFingerprint,
        actorName: input.actorName,
        responseLanguage: input.responseLanguage,
        allowNextMatchingRequest: input.allowNextMatchingRequest ?? false,
        resolve,
      });
    });
  }

  private resolveToolApprovalStrategy(
    input: {
      conversationId: string;
      runId: string;
      actorName: string;
      responseLanguage: RuntimeLanguage;
    },
    request: ToolExecutionPolicyRequest,
  ): ToolExecutionPolicyDecision | null {
    if (!shouldRequireToolApproval(request)) {
      return { allow: true };
    }

    const requestFingerprint = createToolApprovalRequestFingerprint(input.conversationId, request);
    if (
      this.deniedToolApprovalFingerprints.has(requestFingerprint)
    ) {
      return {
        allow: false,
        reason: createToolApprovalRejectMessage({
          actorName: input.actorName,
          request,
          responseLanguage: input.responseLanguage,
        }),
      };
    }

    if (this.isRunTerminal(input.runId)) {
      return {
        allow: false,
        reason: byLanguage(input.responseLanguage, {
          zh: "当前任务已经结束，无法继续执行工具。",
          en: "This run has already ended, so the tool cannot continue.",
        }),
      };
    }

    if (this.approvedToolApprovalFingerprints.has(requestFingerprint)) {
      this.approvedToolApprovalFingerprints.delete(requestFingerprint);
      return { allow: true };
    }

    if (
      this.storage.hasRememberedToolApprovalForConversation(
        input.conversationId,
        createToolApprovalFingerprintHash(requestFingerprint),
      )
    ) {
      return { allow: true };
    }

    return null;
  }

  private createToolApprovalInterruptRuntime(input: {
    conversationId: string;
    runId: string;
    actorName: string;
    responseLanguage: RuntimeLanguage;
    mcpServers: McpCatalogRecord[];
    mcpConnections: McpConnectionRecord[];
  }): ToolApprovalInterruptRuntime {
    const interruptOn: ToolApprovalInterruptOn = {
      ...createRuntimeToolApprovalInterruptOn(),
    };
    const requestByToolName = createRuntimeToolApprovalRequests();
    const connectionMap = new Map(input.mcpConnections.map((connection) => [connection.serverId, connection]));

    for (const server of input.mcpServers) {
      const connection = connectionMap.get(server.id);
      if (!connection || !connection.enabled || connection.status !== "connected") {
        continue;
      }
      for (const toolItem of connection.discoveredTools) {
        const sanitizedName = sanitizeMcpToolName(server.slug, toolItem.name);
        const factory: ToolApprovalRequestFactory = (args) => ({
          serverId: server.id,
          serverName: server.name,
          toolName: toolItem.name,
          operation: "mcp",
          riskLevel: server.riskLevel,
          args,
          description: toolItem.description?.trim() || `Call MCP tool ${server.name}.${toolItem.name}.`,
        });
        const previewRequest = factory({});
        if (!shouldRequireToolApproval(previewRequest)) {
          continue;
        }
        requestByToolName.set(sanitizedName, factory);
        interruptOn[sanitizedName] = createApprovalInterruptConfig(
          `Call MCP tool ${server.name}.${toolItem.name}. MCP tool execution requires user approval.`,
        );
      }
    }

    return {
      interruptOn,
      requestByToolName,
      handler: async (request) =>
        await this.resolveToolApprovalInterrupt({
          ...input,
          request,
          requestByToolName,
        }),
    };
  }

  private async resolveToolApprovalInterrupt(input: {
    conversationId: string;
    runId: string;
    actorName: string;
    responseLanguage: RuntimeLanguage;
    request: HITLRequest;
    requestByToolName: Map<string, ToolApprovalRequestFactory>;
  }): Promise<HITLResponse> {
    const decisions: HITLResponse["decisions"] = [];

    for (const action of input.request.actionRequests) {
      const args = normalizeToolArgs(action.args);
      const requestFactory = input.requestByToolName.get(action.name);
      const toolRequest = requestFactory
        ? requestFactory(args)
        : {
            serverId: "deep-agent",
            serverName: "DeepAgent",
            toolName: action.name,
            operation: "command" as const,
            riskLevel: "high" as const,
            args,
            description: action.description || `Run ${action.name}.`,
          };
      const strategyDecision = this.resolveToolApprovalStrategy(input, toolRequest);
      const decision =
        strategyDecision ??
        (await this.requestToolExecutionApproval({
          conversationId: input.conversationId,
          runId: input.runId,
          actorName: input.actorName,
          responseLanguage: input.responseLanguage,
          request: toolRequest,
          allowNextMatchingRequest: true,
        }));

      if (decision.allow) {
        decisions.push({ type: "approve" });
        continue;
      }

      decisions.push({
        type: "reject",
        message: createToolApprovalRejectMessage({
          actorName: input.actorName,
          request: toolRequest,
          responseLanguage: input.responseLanguage,
          reason: decision.reason,
        }),
      });
    }

    return { decisions };
  }

  private createToolExecutionPolicy(input: {
    conversationId: string;
    runId: string;
    actorName: string;
    responseLanguage: RuntimeLanguage;
  }): ToolExecutionPolicy {
    return async (request) => {
      const decision = this.resolveToolApprovalStrategy(input, request);
      if (decision) return decision;
      return await this.requestToolExecutionApproval({
        ...input,
        request,
      });
    };
  }

  private clearToolApprovalRuntimeStateForConversation(conversationId: string) {
    const conversationMarker = `"conversationId":"${conversationId}"`;
    for (const fingerprint of [...this.approvedToolApprovalFingerprints]) {
      if (fingerprint.includes(conversationMarker)) {
        this.approvedToolApprovalFingerprints.delete(fingerprint);
      }
    }
    for (const fingerprint of [...this.deniedToolApprovalFingerprints]) {
      if (fingerprint.includes(conversationMarker)) {
        this.deniedToolApprovalFingerprints.delete(fingerprint);
      }
    }
  }

  private cancelPendingToolApprovalsForRun(
    runId: string,
    responseLanguage: RuntimeLanguage,
    reason?: string,
  ) {
    for (const pending of [...this.pendingToolApprovals.values()]) {
      if (pending.runId !== runId) {
        continue;
      }
      this.pendingToolApprovals.delete(pending.id);
      const content = reason ??
        byLanguage(responseLanguage, {
          zh: "任务已结束，这次工具确认已取消。",
          en: "The run ended, so this tool approval was cancelled.",
        });
      const message = this.storage
        .listMessages(pending.conversationId)
        .find((item) => item.id === pending.messageId);
      this.storage.updateMessage(pending.messageId, {
        content,
        metadata: {
          ...(message?.metadata ?? {}),
          approvalStatus: "cancelled",
          resolvedAt: Date.now(),
        },
      });
      pending.resolve({
        allow: false,
        reason: content,
      });
    }
  }

  private createToolInvocationObserver(conversationId: string, runId: string) {
    return async (event: McpInvocationEvent | RuntimeToolInvocationEvent) => {
      if (this.isRunTerminal(runId)) {
        return;
      }
      if (event.phase === "start") {
        this.storage.createToolInvocation({
          id: event.invocationId,
          conversationId,
          runId,
          serverId: "server" in event ? event.server.id : event.serverId,
          serverName: "server" in event ? event.server.name : event.serverName,
          toolName: event.toolName,
          status: "running",
          inputJson: JSON.stringify(event.args),
          metadata: {
            transport: "server" in event ? event.server.transport : "local",
          },
          createdAt: event.startedAt,
        });
        return;
      }

      if (event.phase === "success") {
        this.storage.updateToolInvocation(event.invocationId, {
          status: "completed",
          outputText: event.output,
          completedAt: event.completedAt,
        });
        return;
      }

      this.storage.updateToolInvocation(event.invocationId, {
        status: "failed",
        errorText: event.error,
        completedAt: event.completedAt,
      });
      this.emitRunRuntimeError("runtime:tool-invocation", new Error(event.error), {
        conversationId,
        runId,
        serverId: "server" in event ? event.server.id : event.serverId,
        serverName: "server" in event ? event.server.name : event.serverName,
        toolName: event.toolName,
        phase: "tool_error",
        elapsedMs:
          typeof event.completedAt === "number" && typeof event.startedAt === "number"
            ? event.completedAt - event.startedAt
            : null,
      });
    };
  }

  private createAgentToolInvocationObserver(input: {
    conversationId: string;
    runId: string;
    agent: AgentRecord;
    responseLanguage: RuntimeLanguage;
  }) {
    const baseObserver = this.createToolInvocationObserver(input.conversationId, input.runId);
    const announcedToolStarts = new Set<string>();
    return async (event: McpInvocationEvent | RuntimeToolInvocationEvent) => {
      if (this.isRunTerminal(input.runId)) {
        return;
      }
      await baseObserver(event);
      if (this.isRunTerminal(input.runId)) {
        return;
      }

      const toolName = event.toolName.replace(/^workspace_/, "");
      const sourceName = "server" in event ? event.server.name : event.serverName;
      const isLocalTool = !("server" in event);

      if (event.phase === "start") {
        let content: string | null = null;
        if (toolName === "web_search") {
          content = byLanguage(input.responseLanguage, {
            zh: `${input.agent.name} 正在搜索网页来源。`,
            en: `${input.agent.name} is searching web sources.`,
          });
        } else if (toolName === "web_fetch") {
          content = byLanguage(input.responseLanguage, {
            zh: `${input.agent.name} 正在抓取网页正文并提取关键信息。`,
            en: `${input.agent.name} is fetching the webpage and extracting key points.`,
          });
        } else if (toolName === "run_workspace_command") {
          content = byLanguage(input.responseLanguage, {
            zh: `${input.agent.name} 正在执行命令确认环境。`,
            en: `${input.agent.name} is running a command to verify the environment.`,
          });
        } else if (!isLocalTool) {
          content = byLanguage(input.responseLanguage, {
            zh: `${input.agent.name} 正在调用 ${sourceName} 的 ${toolName}。`,
            en: `${input.agent.name} is calling ${toolName} from ${sourceName}.`,
          });
        }
        if (!content) {
          return;
        }
        const dedupeKey = `${toolName}:${sourceName}:${isLocalTool ? "local" : "remote"}`;
        if (announcedToolStarts.has(dedupeKey) && toolName !== "run_workspace_command") {
          return;
        }
        announcedToolStarts.add(dedupeKey);
        this.addRunMessage(input.conversationId, input.runId, content, "system", {
          stage: "tool_start",
          toolName,
          sourceName,
          local: isLocalTool,
        });
        this.emitSnapshot();
        return;
      }

      if (event.phase === "success") {
        let content: string | null = null;
        if (toolName === "web_search") {
          content = byLanguage(input.responseLanguage, {
            zh: `${input.agent.name} 已拿到网页检索结果，正在整理结论。`,
            en: `${input.agent.name} got web search results and is synthesizing conclusions.`,
          });
        } else if (toolName === "web_fetch") {
          content = byLanguage(input.responseLanguage, {
            zh: `${input.agent.name} 已完成网页抓取，正在基于来源回答。`,
            en: `${input.agent.name} finished webpage fetching and is preparing a source-grounded answer.`,
          });
        } else if (!isLocalTool) {
          content = byLanguage(input.responseLanguage, {
            zh: `${input.agent.name} 已拿到 ${sourceName}.${toolName} 的结果。`,
            en: `${input.agent.name} got the result from ${sourceName}.${toolName}.`,
          });
        }
        if (!content) {
          return;
        }
        this.addRunMessage(input.conversationId, input.runId, content, "system", {
          stage: "tool_success",
          toolName,
          sourceName,
          local: isLocalTool,
        });
        this.emitSnapshot();
        return;
      }

      if (event.phase === "error") {
        const isAuthError = /oauth|authorize|authorization|授权|权限|permission|401|unauthorized/i.test(event.error);
        const shouldSurfaceError =
          toolName === "web_search" ||
          toolName === "web_fetch" ||
          toolName === "run_workspace_command" ||
          !isLocalTool ||
          isAuthError;
        if (!shouldSurfaceError) {
          return;
        }
        const displayError = normalizeRuntimeToolErrorMessage({
          toolName,
          serverName: sourceName,
          error: event.error,
          responseLanguage: input.responseLanguage,
        });
        const content = isLocalTool
          ? byLanguage(input.responseLanguage, {
              zh: `${input.agent.name} 在 ${toolName} 这一步遇到问题：\n${displayError}`,
              en: `${input.agent.name} hit an issue in ${toolName}:\n${displayError}`,
            })
          : byLanguage(input.responseLanguage, {
              zh: `${input.agent.name} 在 ${sourceName}.${toolName} 这一步遇到问题：\n${displayError}`,
              en: `${input.agent.name} hit an issue in ${sourceName}.${toolName}:\n${displayError}`,
            });
        this.addRunMessage(input.conversationId, input.runId, content, "system", {
          stage: "tool_error",
          toolName,
          sourceName,
          local: isLocalTool,
          error: event.error,
          displayError,
          ...(!isLocalTool && isAuthError
            ? {
                cardType: "mcp_oauth",
                serverId: event.server.id,
              }
            : {}),
        });
        this.emitSnapshot();
      }
    };
  }

  private createTeamToolInvocationObserver(input: {
    conversationId: string;
    runId: string;
    speaker: AgentRecord;
    responseLanguage: RuntimeLanguage;
    onUpdate?: (content: string, metadata?: Record<string, unknown>) => void;
  }) {
    const baseObserver = this.createToolInvocationObserver(input.conversationId, input.runId);
    let announcedContextLookup = false;
    const announcedToolStarts = new Set<string>();
    const addPublicProcessMessage = (content: string, metadata: Record<string, unknown>) => {
      this.storage.addMessage(
        {
          conversationId: input.conversationId,
          senderId: input.speaker.id,
          senderName: input.speaker.name,
          senderKind: "agent",
          messageType: "agent",
          visibility: "public",
          content,
          mentions: [],
          runId: input.runId,
          metadata: {
            teamProcess: true,
            ...metadata,
          },
          createdAt: Date.now(),
        },
        { skipTranscript: true },
      );
      this.emitSnapshot();
    };
    return async (event: McpInvocationEvent | RuntimeToolInvocationEvent) => {
      if (this.isRunTerminal(input.runId)) {
        return;
      }
      await baseObserver(event);
      if (this.isRunTerminal(input.runId)) {
        return;
      }

      const toolName = event.toolName.replace(/^workspace_/, "");
      const sourceName = "server" in event ? event.server.name : event.serverName;
      const isLocalTool = !("server" in event);
      if (event.phase === "start") {
        let content: string | null = null;
        if (
          ["list_directory", "read_text_file", "read_file", "search_workspace", "skill_list", "skill_load", "skill_read_file"].includes(toolName)
        ) {
          if (!announcedContextLookup) {
            announcedContextLookup = true;
            content = isLocalTool
              ? byLanguage(input.responseLanguage, {
                  zh: `${input.speaker.name}：我先看一下现有文件和上下文。`,
                  en: `${input.speaker.name}: I'll quickly scan the existing files and context first.`,
                })
              : byLanguage(input.responseLanguage, {
                  zh: `${input.speaker.name}：我先从 ${sourceName} 里取一下相关上下文。`,
                  en: `${input.speaker.name}: I'll fetch related context from ${sourceName} first.`,
                });
          }
        } else if (toolName === "web_search") {
          content = byLanguage(input.responseLanguage, {
            zh: `${input.speaker.name}：我先在网页上检索相关信息。`,
            en: `${input.speaker.name}: I’ll search the web for relevant information first.`,
          });
        } else if (toolName === "web_fetch") {
          content = byLanguage(input.responseLanguage, {
            zh: `${input.speaker.name}：我先抓取网页正文并提取关键内容。`,
            en: `${input.speaker.name}: I’ll fetch the webpage content and extract key points first.`,
          });
        } else if (["write_text_file", "write_file", "edit_file"].includes(toolName)) {
          content = isLocalTool
            ? byLanguage(input.responseLanguage, {
                zh: `${input.speaker.name}：我开始把这部分改进文件里。`,
                en: `${input.speaker.name}: I'm starting to apply this change to files.`,
              })
            : byLanguage(input.responseLanguage, {
                zh: `${input.speaker.name}：我先通过 ${sourceName} 改这部分内容。`,
                en: `${input.speaker.name}: I'll update this part via ${sourceName} first.`,
              });
        } else if (toolName === "run_workspace_command") {
          content = byLanguage(input.responseLanguage, {
            zh: `${input.speaker.name}：我先跑一个命令确认一下。`,
            en: `${input.speaker.name}: I'll run a command to verify this first.`,
          });
        } else if (toolName === "skill_run_script") {
          content = byLanguage(input.responseLanguage, {
            zh: `${input.speaker.name}：我会运行 Skill 附带脚本来辅助处理。`,
            en: `${input.speaker.name}: I’ll run a bundled Skill script to help with this.`,
          });
        } else {
          content = isLocalTool
            ? byLanguage(input.responseLanguage, {
                zh: `${input.speaker.name}：我先调用 ${toolName} 看看。`,
                en: `${input.speaker.name}: I'll run ${toolName} first.`,
              })
            : byLanguage(input.responseLanguage, {
                zh: `${input.speaker.name}：我先调用 ${sourceName} 的 ${toolName} 看看。`,
                en: `${input.speaker.name}: I'll call ${toolName} from ${sourceName} first.`,
              });
        }
        if (!content) {
          return;
        }
        const dedupeKey = `${toolName}:${sourceName}:${isLocalTool ? "local" : "remote"}`;
        if (announcedToolStarts.has(dedupeKey) && toolName !== "run_workspace_command") {
          return;
        }
        announcedToolStarts.add(dedupeKey);
        const metadata = {
          phase: "tool_start",
          toolName,
          sourceName,
          local: isLocalTool,
        };
        addPublicProcessMessage(content, metadata);
        input.onUpdate?.(content, metadata);
        return;
      }

      if (event.phase === "success") {
        let content: string | null = null;
        if (["write_text_file", "write_file", "edit_file"].includes(toolName)) {
          content = isLocalTool
            ? byLanguage(input.responseLanguage, {
                zh: `${input.speaker.name}：这部分改动已经写进文件了。`,
                en: `${input.speaker.name}: This part has been written to file.`,
              })
            : byLanguage(input.responseLanguage, {
                zh: `${input.speaker.name}：我已经通过 ${sourceName} 把这部分改动提交出去了。`,
                en: `${input.speaker.name}: I've submitted this change via ${sourceName}.`,
              });
        } else if (toolName === "web_search") {
          content = byLanguage(input.responseLanguage, {
            zh: `${input.speaker.name}：我拿到网页检索结果了，继续整理要点。`,
            en: `${input.speaker.name}: I got web search results and will now synthesize key points.`,
          });
        } else if (toolName === "web_fetch") {
          content = byLanguage(input.responseLanguage, {
            zh: `${input.speaker.name}：网页内容抓取完成，我继续基于来源给出结论。`,
            en: `${input.speaker.name}: Web content fetched. I’ll continue with source-grounded conclusions.`,
          });
        } else if (toolName === "run_workspace_command") {
          content = byLanguage(input.responseLanguage, {
            zh: `${input.speaker.name}：命令已经跑完了，我继续往下处理。`,
            en: `${input.speaker.name}: Command finished. I'll continue.`,
          });
        } else if (toolName === "skill_run_script") {
          content = byLanguage(input.responseLanguage, {
            zh: `${input.speaker.name}：Skill 脚本已经执行完成，我继续整理结果。`,
            en: `${input.speaker.name}: The Skill script finished. I’ll continue synthesizing the result.`,
          });
        } else if (
          !["list_directory", "read_text_file", "read_file", "search_workspace", "skill_list", "skill_load", "skill_read_file"].includes(toolName)
        ) {
          content = isLocalTool
            ? byLanguage(input.responseLanguage, {
                zh: `${input.speaker.name}：我拿到 ${toolName} 这一步的结果了，继续推进。`,
                en: `${input.speaker.name}: Got results from ${toolName}. I'll keep moving.`,
              })
            : byLanguage(input.responseLanguage, {
                zh: `${input.speaker.name}：我已经拿到 ${sourceName} 的 ${toolName} 结果，继续推进。`,
                en: `${input.speaker.name}: Got ${toolName} results from ${sourceName}. I'll keep moving.`,
              });
        }
        if (!content) {
          return;
        }
        const metadata = {
          phase: "tool_success",
          toolName,
          sourceName,
          local: isLocalTool,
        };
        addPublicProcessMessage(content, metadata);
        input.onUpdate?.(content, metadata);
        return;
      }

      if (event.phase === "error") {
        const isAuthError = /oauth|authorize|authorization|授权|权限|permission|401|unauthorized/i.test(event.error);
        const displayError = normalizeRuntimeToolErrorMessage({
          toolName,
          serverName: sourceName,
          error: event.error,
          responseLanguage: input.responseLanguage,
        });
        const content = isLocalTool
          ? byLanguage(input.responseLanguage, {
              zh: `${input.speaker.name}：我在 ${toolName} 这一步遇到了问题。\n${displayError}`,
              en: `${input.speaker.name}: I hit a problem during ${toolName}.\n${displayError}`,
            })
          : byLanguage(input.responseLanguage, {
              zh: `${input.speaker.name}：我在 ${sourceName}.${toolName} 这一步遇到了问题。\n${displayError}`,
              en: `${input.speaker.name}: I hit a problem during ${sourceName}.${toolName}.\n${displayError}`,
            });
        const metadata = {
          phase: "tool_error",
          toolName,
          sourceName,
          local: isLocalTool,
          error: event.error,
          displayError,
          ...(!isLocalTool && isAuthError
            ? {
                cardType: "mcp_oauth",
                serverId: event.server.id,
              }
            : {}),
        };
        addPublicProcessMessage(content, metadata);
        input.onUpdate?.(content, metadata);
      }
    };
  }

  async markNotificationsRead() {
    this.storage.markNotificationsRead();
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async markConversationRead(conversationId: string) {
    this.pruneConversationReadPresence();
    this.conversationReadPresence.set(conversationId, Date.now());
    this.storage.resetUnread(conversationId);
    this.emitSnapshot();
    return this.getSnapshot();
  }

  private getAvailableMcpServersForConversation(conversation: ConversationRecord) {
    const pinnedMcp = conversation.meta.pinnedMcp;
    const allowedIds =
      conversation.kind === "agent"
        ? (this.storage.getAgent(conversation.targetId)?.mcpWhitelist ?? [])
        : Array.from(
            new Set(
              (this.storage.getTeam(conversation.targetId)?.memberIds ?? [])
                .flatMap((agentId) => this.storage.getAgent(agentId)?.mcpWhitelist ?? []),
            ),
          );

    const servers = this.storage
      .listMcpConnections()
      .filter(
        (connection) =>
          connection.enabled && connection.status === "connected" && allowedIds.includes(connection.serverId),
      )
      .map((connection) => this.storage.getMcpCatalogEntry(connection.serverId))
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return servers.sort((left, right) => {
      if (left.id === pinnedMcp) return -1;
      if (right.id === pinnedMcp) return 1;
      return left.name.localeCompare(right.name, "en");
    });
  }

  private getAvailableMcpConnectionsForConversation(conversation: ConversationRecord) {
    const serverIds = new Set(this.getAvailableMcpServersForConversation(conversation).map((server) => server.id));
    return this.storage
      .listMcpConnections()
      .filter((connection) => serverIds.has(connection.serverId) && connection.enabled && connection.status === "connected");
  }

  private getAvailableSkillsForConversation(conversation: ConversationRecord) {
    const installedSkills = this.storage.listSkillCatalog().filter((skill) => skill.installed);
    if (conversation.kind === "team") {
      return installedSkills;
    }

    const agent = this.storage.getAgent(conversation.targetId);
    if (!agent) {
      return installedSkills;
    }

    return installedSkills.filter((skill) => agent.skillWhitelist.includes(skill.id));
  }

  private resolveSlashDirectives(conversation: ConversationRecord, input: string): SlashDirectiveContext {
    const aliases = extractSlashAliases(input).filter((alias) => !["skills", "mcp", "clear"].includes(alias));
    const availableSkills = this.getAvailableSkillsForConversation(conversation);
    const promptAliases = this.storage.listPromptAliases().filter((item) => item.enabled);
    let cleanedInput = input.trim();
    let skill: SkillCatalogRecord | null = null;
    let promptAlias: PromptAliasRecord | null = null;

    for (const alias of aliases) {
      if (!skill) {
        const match = availableSkills.find(
          (item) =>
            item.id.toLowerCase() === alias ||
            item.slug.toLowerCase() === alias ||
            item.name.toLowerCase() === alias ||
            item.displayName.toLowerCase() === alias,
        );
        if (match) {
          skill = match;
          cleanedInput = stripSlashAlias(cleanedInput, alias);
          continue;
        }
      }

      if (!promptAlias) {
        const match = promptAliases.find((item) => item.alias === alias);
        if (match) {
          promptAlias = match;
          cleanedInput = stripSlashAlias(cleanedInput, alias);
        }
      }
    }

    return {
      cleanedInput: cleanedInput.trim() || (skill || promptAlias ? "" : input.trim()),
      skill,
      promptAlias,
    };
  }

  private buildSlashEnhancedRuntimeInput(
    conversation: ConversationRecord,
    baseInput: string,
    context: SlashDirectiveContext,
    responseLanguage: RuntimeLanguage,
  ) {
    const snapshot = this.storage.getSnapshot();
    const workspacePath = this.getWorkspaceForConversation(conversation, snapshot.agents, snapshot.teams);
    const target =
      conversation.kind === "agent"
        ? snapshot.agents.find((agent) => agent.id === conversation.targetId)
        : snapshot.teams.find((team) => team.id === conversation.targetId);
    const inputForTemplate =
      baseInput.trim() ||
      byLanguage(responseLanguage, {
        zh: "用户没有补充额外内容，请主动询问需要处理的内容。",
        en: "The user did not provide extra details. Ask a follow-up question proactively.",
      });
    let resolved = inputForTemplate;

    if (context.promptAlias) {
      const replacements: Record<string, string> = {
        "{{input}}": inputForTemplate,
        "{{conversationTitle}}": conversation.title,
        "{{agentName}}": target?.name ?? conversation.title,
        "{{workspacePath}}": workspacePath,
        "$ARGUMENTS": inputForTemplate,
      };
      const template = context.promptAlias.prompt;
      const hasPlaceholder = Object.keys(replacements).some((key) => template.includes(key));
      resolved = Object.entries(replacements).reduce(
        (current, [key, value]) => current.split(key).join(value),
        template,
      );
      if (!hasPlaceholder) {
        resolved = byLanguage(responseLanguage, {
          zh: `${resolved.trim()}\n\n用户输入：\n${inputForTemplate}`,
          en: `${resolved.trim()}\n\nUser input:\n${inputForTemplate}`,
        });
      }
    }

    if (context.skill) {
      const skillLabel = context.skill.displayName || context.skill.name;
      resolved = byLanguage(responseLanguage, {
        zh: `本轮消息临时使用 Skill：${skillLabel}（/${context.skill.slug}）。\n\n${resolved}`,
        en: `Temporary skill for this message: ${skillLabel} (/${context.skill.slug}).\n\n${resolved}`,
      });
    }

    return resolved;
  }

  private async handleSlashCommand(
    conversation: ConversationRecord,
    commandName: string,
    args: string[],
    responseLanguage: RuntimeLanguage,
  ) {
    if (commandName === "clear") {
      const nonTerminalRuns = this.storage
        .listRuns()
        .filter(
          (run) =>
            run.conversationId === conversation.id &&
            !["completed", "failed", "cancelled"].includes(run.status),
        );
      for (const run of nonTerminalRuns) {
        this.stopRunController(run.id);
        this.cancelPendingToolApprovalsForRun(run.id, responseLanguage);
        this.finalizeStreamingMessagesForRun(conversation.id, run.id, "cancelled");
        this.storage.updateRun(run.id, { status: "cancelled" });
        this.storage.cancelPendingRunSteps(run.id);
        this.resetTeamHandoffAfterCancellation(conversation.id, responseLanguage);
      }

      const removed = this.storage.clearConversationHistory(conversation.id);
      this.clearToolApprovalRuntimeStateForConversation(conversation.id);
      this.singleChatSessions.delete(conversation.id);
      this.addSlashFeedbackMessage(conversation, {
        title: byLanguage(responseLanguage, { zh: "会话已清空", en: "Conversation cleared" }),
        body: byLanguage(responseLanguage, {
          zh: "当前会话历史已清空，后续回复会基于新的上下文。",
          en: "Conversation history is cleared. Future replies will use fresh context.",
        }),
        items: [
          byLanguage(responseLanguage, {
            zh: `消息：${removed.removedMessages} 条`,
            en: `Messages: ${removed.removedMessages}`,
          }),
          byLanguage(responseLanguage, {
            zh: `运行记录：${removed.removedRuns} 条`,
            en: `Runs: ${removed.removedRuns}`,
          }),
          byLanguage(responseLanguage, {
            zh: `步骤记录：${removed.removedRunSteps} 条`,
            en: `Run steps: ${removed.removedRunSteps}`,
          }),
          byLanguage(responseLanguage, {
            zh: `工具调用：${removed.removedToolInvocations} 条`,
            en: `Tool invocations: ${removed.removedToolInvocations}`,
          }),
          byLanguage(responseLanguage, {
            zh: `工作区隐藏产物：已清理 ${removed.removedWorkspaceArtifactFiles} 个文件`,
            en: `Workspace internal artifacts: cleared ${removed.removedWorkspaceArtifactFiles} file(s)`,
          }),
          byLanguage(responseLanguage, {
            zh: `工作区记忆文件：已重置 ${removed.resetWorkspaceMemoryFiles} 个`,
            en: `Workspace memory files: reset ${removed.resetWorkspaceMemoryFiles}`,
          }),
          byLanguage(responseLanguage, {
            zh: `会话审批记忆：已清理 ${removed.removedRememberedToolApprovals} 条`,
            en: `Conversation approval memory: cleared ${removed.removedRememberedToolApprovals}`,
          }),
          ...(nonTerminalRuns.length > 0
            ? [
                byLanguage(responseLanguage, {
                  zh: `已同时终止进行中的任务：${nonTerminalRuns.length} 条`,
                  en: `Also cancelled in-progress runs: ${nonTerminalRuns.length}`,
                }),
              ]
            : []),
          ...(args.length > 0
            ? [
                byLanguage(responseLanguage, {
                  zh: `已忽略附加参数：${args.join(" ")}`,
                  en: `Ignored extra arguments: ${args.join(" ")}`,
                }),
              ]
            : []),
        ],
        tone: "success",
      });
      this.storage.resetUnread(conversation.id);
      return;
    }

    if (commandName === "skills") {
      const availableSkills = this.getAvailableSkillsForConversation(conversation);
      const currentMeta = conversation.meta;
      const currentSkillLabel =
        (currentMeta.activeSkill
          ? this.storage.findSkillCatalogEntryByNameOrId(currentMeta.activeSkill)?.displayName
          : null) ?? currentMeta.activeSkill;

      if (args.length === 0) {
        this.addSlashFeedbackMessage(conversation, {
          title: byLanguage(responseLanguage, { zh: "Skill 会话状态", en: "Skill session status" }),
          body: byLanguage(responseLanguage, {
            zh: `当前激活技能：${currentSkillLabel ?? "默认"}`,
            en: `Current active skill: ${currentSkillLabel ?? "default"}`,
          }),
          items: availableSkills.map((skill) => skill.displayName || skill.name),
          emptyText: byLanguage(responseLanguage, {
            zh: "当前会话还没有可用 Skill。",
            en: "No Skill is available for this conversation yet.",
          }),
        });
        return;
      }

      const selectedSkill = args.filter((item) => item !== "use").join(" ");
      const match = availableSkills.find(
        (skill) =>
          skill.name.toLowerCase() === selectedSkill.toLowerCase() ||
          skill.displayName.toLowerCase() === selectedSkill.toLowerCase() ||
          skill.slug.toLowerCase() === selectedSkill.toLowerCase() ||
          skill.id.toLowerCase() === selectedSkill.toLowerCase(),
      );
      if (!match) {
        this.addSlashFeedbackMessage(conversation, {
          title: byLanguage(responseLanguage, { zh: "Skill 不可用", en: "Skill unavailable" }),
          body: byLanguage(responseLanguage, {
            zh: `当前会话不可用 Skill：${selectedSkill || "未指定"}。`,
            en: `Skill unavailable in this conversation: ${selectedSkill || "unspecified"}.`,
          }),
          tone: "error",
        });
        return;
      }
      const meta = { ...currentMeta, activeSkill: match.id };
      this.storage.updateConversationMeta(conversation.id, meta);
      this.addSlashFeedbackMessage(conversation, {
        title: byLanguage(responseLanguage, { zh: "Skill 已切换", en: "Skill switched" }),
        body: byLanguage(responseLanguage, {
          zh: `已为当前会话切换技能：${match.displayName || match.name}。后续回复会优先参考该技能。`,
          en: `Switched skill for this conversation to: ${match.displayName || match.name}. Future replies will prefer this skill.`,
        }),
        tone: "success",
      });
      return;
    }

    if (commandName === "mcp") {
      const availableServers = this.getAvailableMcpServersForConversation(conversation);
      const currentMeta = conversation.meta;
      const currentMcpLabel =
        (currentMeta.pinnedMcp ? this.storage.findMcpCatalogEntryByNameOrId(currentMeta.pinnedMcp)?.name : null) ??
        currentMeta.pinnedMcp;

      if (args.length === 0) {
        this.addSlashFeedbackMessage(conversation, {
          title: byLanguage(responseLanguage, { zh: "MCP 会话状态", en: "MCP session status" }),
          body: byLanguage(responseLanguage, {
            zh: `当前固定 MCP：${currentMcpLabel ?? "未固定"}`,
            en: `Current pinned MCP: ${currentMcpLabel ?? "none"}`,
          }),
          items: availableServers.map((item) => item.name),
          emptyText: byLanguage(responseLanguage, {
            zh: "当前会话还没有可用 MCP。",
            en: "No MCP is available for this conversation yet.",
          }),
        });
        return;
      }

      const [subcommand, ...restArgs] = args;
      if (subcommand === "use") {
        const selected = restArgs.join(" ").trim();
        const match = availableServers.find(
          (item) =>
            item.id.toLowerCase() === selected.toLowerCase() ||
            item.slug.toLowerCase() === selected.toLowerCase() ||
            item.name.toLowerCase() === selected.toLowerCase(),
        );
        const connection = match ? this.storage.getMcpConnection(match.id) : null;
        if (!match || !connection || connection.status !== "connected") {
          this.addSlashFeedbackMessage(conversation, {
            title: byLanguage(responseLanguage, { zh: "MCP 不可用", en: "MCP unavailable" }),
            body: byLanguage(responseLanguage, {
              zh: `当前会话不可用 MCP：${selected || "未指定"}。`,
              en: `MCP unavailable in this conversation: ${selected || "unspecified"}.`,
            }),
            tone: "error",
          });
          return;
        }
        this.storage.updateConversationMeta(conversation.id, {
          ...currentMeta,
          pinnedMcp: match.id,
        });
        this.addSlashFeedbackMessage(conversation, {
          title: byLanguage(responseLanguage, { zh: "MCP 已固定", en: "MCP pinned" }),
          body: byLanguage(responseLanguage, {
            zh: `已为当前会话固定 MCP：${match.name}。`,
            en: `Pinned MCP for this conversation: ${match.name}.`,
          }),
          items: connection.discoveredTools.map((tool) => tool.name),
          emptyText: byLanguage(responseLanguage, {
            zh: "当前没有发现可用工具。",
            en: "No available tools were discovered.",
          }),
          tone: "success",
        });
        return;
      }

      if (subcommand === "tools") {
        const selected = restArgs.join(" ").trim();
        const match = availableServers.find(
          (item) =>
            item.id.toLowerCase() === selected.toLowerCase() ||
            item.slug.toLowerCase() === selected.toLowerCase() ||
            item.name.toLowerCase() === selected.toLowerCase(),
        );
        const connection = match ? this.storage.getMcpConnection(match.id) : null;
        if (!match) {
          this.addSlashFeedbackMessage(conversation, {
            title: byLanguage(responseLanguage, { zh: "未找到 MCP", en: "MCP not found" }),
            body: byLanguage(responseLanguage, {
              zh: `未找到 MCP：${selected || "未指定"}。`,
              en: `MCP not found: ${selected || "unspecified"}.`,
            }),
            tone: "error",
          });
          return;
        }
        this.addSlashFeedbackMessage(conversation, {
          title: byLanguage(responseLanguage, {
            zh: `${match.name} 工具列表`,
            en: `${match.name} tool list`,
          }),
          items:
            connection?.discoveredTools.map((tool) => tool.name) ??
            match.declaredTools,
          emptyText: byLanguage(responseLanguage, {
            zh: "当前没有发现可用工具。",
            en: "No available tools were discovered.",
          }),
        });
        return;
      }

      const selected = args.join(" ").trim();
      const match = availableServers.find(
        (item) =>
          item.id.toLowerCase() === selected.toLowerCase() ||
          item.slug.toLowerCase() === selected.toLowerCase() ||
          item.name.toLowerCase() === selected.toLowerCase(),
      );
      const connection = match ? this.storage.getMcpConnection(match.id) : null;
      if (!match) {
        this.addSlashFeedbackMessage(conversation, {
          title: byLanguage(responseLanguage, { zh: "未找到 MCP", en: "MCP not found" }),
          body: byLanguage(responseLanguage, {
            zh: `未找到 MCP：${selected || "未指定"}。`,
            en: `MCP not found: ${selected || "unspecified"}.`,
          }),
          tone: "error",
        });
        return;
      }

      this.addSlashFeedbackMessage(conversation, {
        title: match.name,
        body: byLanguage(responseLanguage, {
          zh: `连接状态：${connection?.status ?? "disconnected"}\n协议：${match.transport}`,
          en: `Connection: ${connection?.status ?? "disconnected"}\nTransport: ${match.transport}`,
        }),
        items: [
          byLanguage(responseLanguage, {
            zh: `能力：${formatList(match.capabilities, responseLanguage)}`,
            en: `Capabilities: ${formatList(match.capabilities, responseLanguage)}`,
          }),
          byLanguage(responseLanguage, {
            zh: `工具：${
              connection?.discoveredTools.map((tool) => tool.name).join("、") ||
              match.declaredTools.join("、") ||
              "暂无"
            }`,
            en: `Tools: ${
              connection?.discoveredTools.map((tool) => tool.name).join(", ") ||
              match.declaredTools.join(", ") ||
              "none"
            }`,
          }),
        ],
      });
      return;
    }
  }

  private async startAgentRun(
    conversation: ConversationRecord,
    input: string,
    slashContext: SlashDirectiveContext,
    attachments: AttachmentAssetRecord[],
    responseLanguage: RuntimeLanguage,
  ) {
    const snapshot = this.storage.getSnapshot();
    const agent = snapshot.agents.find((item) => item.id === conversation.targetId);
    if (!agent) return;
    const provider = this.resolveActiveProvider(snapshot);
    const providerIssue = validateProviderForSingleChat(provider, responseLanguage);
    if (providerIssue) {
      this.addSystemMessage(conversation.id, providerIssue);
      return;
    }

    const workspacePath = agent.workspacePath;
    const runId = `run-${nanoid(8)}`;
    const activeSkill = slashContext.skill?.id ?? conversation.meta.activeSkill;
    const availableMcpServers = this.getAvailableMcpServersForConversation(conversation);
    const availableMcpConnections = this.getAvailableMcpConnectionsForConversation(conversation);
    const activeSkillRecord = slashContext.skill ?? (activeSkill ? this.storage.findSkillCatalogEntryByNameOrId(activeSkill) : null);
    const availableSkillRecords = this.storage
      .listSkillCatalog()
      .filter((skill) => skill.installed && agent.skillWhitelist.includes(skill.id));
    const allowedActiveSkillRecord =
      activeSkillRecord && agent.skillWhitelist.includes(activeSkillRecord.id) ? activeSkillRecord : null;
    const activeSkillLabel =
      allowedActiveSkillRecord?.displayName || allowedActiveSkillRecord?.name || allowedActiveSkillRecord?.slug || null;
    const transcriptPaths = this.storage.getConversationTranscriptPaths(conversation.id);
    const toolInvocationObserver = this.createAgentToolInvocationObserver({
      conversationId: conversation.id,
      runId,
      agent,
      responseLanguage,
    });
    const approvalInterruptRuntime = this.createToolApprovalInterruptRuntime({
      conversationId: conversation.id,
      runId,
      actorName: agent.name,
      responseLanguage,
      mcpServers: availableMcpServers,
      mcpConnections: availableMcpConnections,
    });
    const approvalPolicy = this.createToolExecutionPolicy({
      conversationId: conversation.id,
      runId,
      actorName: agent.name,
      responseLanguage,
    });
    const runtimeTools = buildRuntimeLangChainTools({
      workspacePath,
      attachmentRoots: this.storage.getConversationAttachmentRoots(conversation.id),
      provider,
      responseLanguage,
      activeSkill: allowedActiveSkillRecord,
      availableSkills: availableSkillRecords,
      onInvocation: toolInvocationObserver,
      approvalPolicy,
    });
    const steps: RunStep[] = [
      {
        label: byLanguage(responseLanguage, { zh: "准备上下文", en: "Prepare context" }),
        delayMs: 300,
        execute: () => {
          this.addRunMessage(
            conversation.id,
            runId,
            byLanguage(responseLanguage, {
              zh: `${agent.name} 正在准备上下文，并将使用 ${provider?.label} / ${provider?.defaultModel} 处理这次请求。`,
              en: `${agent.name} is preparing context and will use ${provider?.label} / ${provider?.defaultModel} for this request.`,
            }),
            "system",
          );
        },
      },
      {
        label: byLanguage(responseLanguage, { zh: "检查技能与上下文", en: "Check skill and context" }),
        delayMs: 300,
        execute: () => {
          const skillText = activeSkillLabel
            ? byLanguage(responseLanguage, {
                zh: `当前会话偏好 Skill：${activeSkillLabel}，模型会在任务相关时加载完整说明。`,
                en: `Preferred Skill in this conversation: ${activeSkillLabel}; the model will load full instructions when relevant.`,
              })
            : byLanguage(responseLanguage, {
                zh:
                  availableSkillRecords.length > 0
                    ? `可用白名单 Skills：${availableSkillRecords.map((skill) => skill.displayName || skill.name).join("、")}，模型会按需加载。`
                    : "当前没有可用的白名单 Skills。",
                en:
                  availableSkillRecords.length > 0
                    ? `Available allowlisted Skills: ${availableSkillRecords.map((skill) => skill.displayName || skill.name).join(", ")}; the model will load them on demand.`
                    : "No allowlisted Skills are available.",
              });
          this.addRunMessage(
            conversation.id,
            runId,
            byLanguage(responseLanguage, {
              zh: `${agent.name} 已读取上下文。\n${skillText}`,
              en: `${agent.name} has read the context.\n${skillText}`,
            }),
            "system",
          );
        },
      },
      {
        label: byLanguage(responseLanguage, { zh: "调用真实模型", en: "Call real model" }),
        execute: async () => {
          let response;
          const modelStartedAt = Date.now();
          let heartbeat: ReturnType<typeof setInterval> | null = null;
          try {
            this.appendRunProgressMetadata(runId, {
              kind: "model",
              phase: "model_start",
              actorId: agent.id,
              actorName: agent.name,
              content: byLanguage(responseLanguage, {
                zh: `${agent.name} 正在调用模型并等待流式回复。`,
                en: `${agent.name} is calling the model and waiting for the streamed reply.`,
              }),
            });
            heartbeat = setInterval(() => {
              const currentRun = this.storage.getRun(runId);
              if (!currentRun || ["completed", "failed", "cancelled"].includes(currentRun.status)) {
                if (heartbeat) clearInterval(heartbeat);
                heartbeat = null;
                return;
              }
              const content = byLanguage(responseLanguage, {
                zh: `${agent.name} 仍在等待模型返回，已用时 ${Math.round((Date.now() - modelStartedAt) / 1000)} 秒。`,
                en: `${agent.name} is still waiting for the model, elapsed ${Math.round((Date.now() - modelStartedAt) / 1000)} seconds.`,
              });
              this.addRunMessage(conversation.id, runId, content, "system", {
                stage: "execution_waiting",
                actorId: agent.id,
                actorName: agent.name,
              });
              this.appendRunProgressMetadata(runId, {
                kind: "heartbeat",
                phase: "execution_waiting",
                actorId: agent.id,
                actorName: agent.name,
                content,
              });
              this.emitSnapshot();
            }, 60_000);
            response = await invokeSingleChatDeepAgent({
              sessions: this.singleChatSessions,
              conversationId: conversation.id,
              provider: provider!,
              agent,
              profile: snapshot.profile,
              activeSkill: activeSkillLabel,
              activeSkillDefinition: null,
              mcpServers: availableMcpServers,
              mcpConnections: availableMcpConnections,
              workspacePath,
              history: this.storage.listMessages(conversation.id),
              latestInput: input,
              attachments,
              onMcpInvocation: toolInvocationObserver,
              onMcpConnectionUpdated: (connection) => this.persistMcpConnectionUpdate(connection),
              onDeepAgentToolInvocation: toolInvocationObserver,
              approvalPolicy,
              interruptOn: approvalInterruptRuntime.interruptOn,
              onToolApprovalInterrupt: approvalInterruptRuntime.handler,
              additionalTools: runtimeTools.tools,
              runtimeToolSummary: runtimeTools.summary,
              responseLanguage,
              onRuntimeError: (source, error, metadata) => {
                this.emitRunRuntimeError(source, error, {
                  conversationId: conversation.id,
                  runId,
                  agentId: agent.id,
                  agentName: agent.name,
                  providerId: provider!.id,
                  model: provider!.defaultModel,
                  ...metadata,
                });
              },
              onReasoningStream: async (aggregatedText) => {
                const currentRun = this.storage.getRun(runId);
                if (!currentRun || currentRun.status === "cancelled") return;
                this.updateRunReasoningMetadata(runId, aggregatedText, {
                  actorId: agent.id,
                  actorName: agent.name,
                  phase: "model_reasoning",
                });
                this.emitSnapshot();
              },
              onTextStream: async (aggregatedText) => {
                const currentRun = this.storage.getRun(runId);
                if (!currentRun || currentRun.status === "cancelled") return;

                const existingMessageId = currentRun.metadata?.streamMessageId;
                const baseMetadata = {
                  skill: allowedActiveSkillRecord?.id ?? null,
                  skillLabel: activeSkillLabel,
                  streaming: true,
                };

                if (typeof existingMessageId === "string") {
                  this.storage.updateMessage(existingMessageId, {
                    content: aggregatedText,
                    metadata: baseMetadata,
                  });
                } else {
                  const message = this.storage.addMessage(
                    {
                      conversationId: conversation.id,
                      senderId: agent.id,
                      senderName: agent.name,
                      senderKind: "agent",
                      messageType: "agent",
                      visibility: "public",
                      content: aggregatedText,
                      mentions: ["user"],
                      runId,
                      metadata: baseMetadata,
                      createdAt: Date.now(),
                    },
                    { skipTranscript: true },
                  );
                  this.storage.updateRun(runId, {
                    metadata: {
                      ...(currentRun.metadata ?? {}),
                      streamMessageId: message.id,
                    },
                  });
                }

                this.emitSnapshot();
              },
            });
            this.appendRunProgressMetadata(runId, {
              kind: "model",
              phase: "model_done",
              actorId: agent.id,
              actorName: agent.name,
              content: byLanguage(responseLanguage, {
                zh: `${agent.name} 已收到模型回复，用时 ${Math.round((Date.now() - modelStartedAt) / 1000)} 秒。`,
                en: `${agent.name} received the model reply in ${Math.round((Date.now() - modelStartedAt) / 1000)} seconds.`,
              }),
            });
          } catch (error) {
            const elapsedMs = Date.now() - modelStartedAt;
            const timeoutMs = getRuntimeTimeouts().singleChatModelMs;
            const normalizedError = normalizeProviderErrorMessage(error, {
              id: provider!.id,
              label: provider!.label,
              baseUrl: provider!.baseUrl,
              defaultModel: provider!.defaultModel,
            }, responseLanguage);
            const timedOut = isProviderTimeoutError(error);
            const content = timedOut
              ? byLanguage(responseLanguage, {
                  zh: `${agent.name} 模型调用超时（已等待 ${Math.round(elapsedMs / 1000)} 秒，当前超时上限 ${Math.round(timeoutMs / 1000)} 秒）。请检查网络、Base URL 或模型服务状态后重试。`,
                  en: `${agent.name} model call timed out after ${Math.round(elapsedMs / 1000)} seconds (limit ${Math.round(timeoutMs / 1000)} seconds). Check network, Base URL, or provider status, then retry.`,
                })
              : byLanguage(responseLanguage, {
                  zh: `${agent.name} 模型调用失败：${normalizedError}`,
                  en: `${agent.name} model call failed: ${normalizedError}`,
                });
            this.emitRunRuntimeError("single-chat:model", error, {
              conversationId: conversation.id,
              runId,
              agentId: agent.id,
              agentName: agent.name,
              providerId: provider!.id,
              model: provider!.defaultModel,
              phase: "model_call",
              timeoutMs,
              elapsedMs,
              timedOut,
            });
            this.appendRunProgressMetadata(runId, {
              kind: "model",
              phase: timedOut ? "model_timeout" : "model_error",
              actorId: agent.id,
              actorName: agent.name,
              content,
            });
            throw new Error(content);
          } finally {
            if (heartbeat) {
              clearInterval(heartbeat);
            }
          }

          if (this.storage.getRun(runId)?.status === "cancelled") {
            return;
          }

          const artifactPath = this.writeAgentArtifact(
            conversation.id,
            workspacePath,
            runId,
            agent,
            input,
            response.text,
            activeSkillLabel,
          );
          const memoryPath = this.appendMemory(
            workspacePath,
            `${workspaceInternalDirName}/memory/MEMORY.md`,
            formatMemoryEntry({
              timestamp: this.formatTimestamp(),
              kind: "agent",
              inputLabel: byLanguage(responseLanguage, { zh: "任务", en: "Task" }),
              input,
              outputLabel: byLanguage(responseLanguage, { zh: "输出", en: "Output" }),
              output: response.text,
            }),
            {
              provider: provider!,
              responseLanguage,
              conversationId: conversation.id,
              runId,
              actorId: agent.id,
              actorName: agent.name,
              phase: "single_chat_memory",
            },
          );
          const currentRun = this.storage.getRun(runId);
          const usage = response.usage;
          const streamMessageId = currentRun?.metadata?.streamMessageId;
          if (typeof streamMessageId === "string") {
            this.storage.updateMessage(
              streamMessageId,
              {
                content: response.text,
                metadata: {
                  skill: allowedActiveSkillRecord?.id ?? null,
                  skillLabel: activeSkillLabel,
                  streaming: false,
                },
              },
              { appendTranscript: true },
            );
          } else {
            this.storage.addMessage({
              conversationId: conversation.id,
              senderId: agent.id,
              senderName: agent.name,
              senderKind: "agent",
              messageType: "agent",
              visibility: "public",
              content: response.text,
              mentions: ["user"],
              runId,
              metadata: { skill: allowedActiveSkillRecord?.id ?? null, skillLabel: activeSkillLabel },
              createdAt: Date.now(),
            });
          }
          this.storage.updateRun(runId, {
            metadata: {
              ...(currentRun?.metadata ?? {}),
              artifactPath,
              memoryPath,
              transcriptPath: transcriptPaths.globalTranscriptPath,
              workspaceTranscriptPath: transcriptPaths.workspaceTranscriptPath,
              ...(usage?.inputTokens !== null && usage?.inputTokens !== undefined
                ? { inputTokens: usage.inputTokens }
                : {}),
              ...(usage?.outputTokens !== null && usage?.outputTokens !== undefined
                ? { outputTokens: usage.outputTokens }
                : {}),
              ...(usage?.totalTokens !== null && usage?.totalTokens !== undefined
                ? { totalTokens: usage.totalTokens }
                : {}),
            },
          });
          this.addRunMessage(
            conversation.id,
            runId,
            byLanguage(responseLanguage, {
              zh: `结果已写入产物：${artifactPath}\n记忆文件已更新：${memoryPath}`,
              en: `Result artifact written: ${artifactPath}\nMemory file updated: ${memoryPath}`,
            }),
            "system",
          );
          this.createAppNotification(
            {
              type: "agent_message",
              title: byLanguage(responseLanguage, {
                zh: `${agent.name} 发来新消息`,
                en: `${agent.name} sent a new message`,
              }),
              body: trimHeadline(
                response.text ||
                  byLanguage(responseLanguage, {
                    zh: "点开查看最新回复。",
                    en: "Open to view the latest reply.",
                  }),
              ),
              relatedConversationId: conversation.id,
              relatedRunId: runId,
            },
            "agent_message",
          );
        },
      },
    ];

    this.beginRun({
      runId,
      conversationId: conversation.id,
      title: byLanguage(responseLanguage, {
        zh: `${agent.name} 处理请求`,
        en: `${agent.name} handling request`,
      }),
      kind: "agent_task",
      actorId: agent.id,
      steps,
      responseLanguage,
    });
  }

  private async startTeamRun(
    conversation: ConversationRecord,
    input: string,
    _slashContext: SlashDirectiveContext,
    inputMentionIds: string[] = [],
    attachments: AttachmentAssetRecord[] = [],
    responseLanguage: RuntimeLanguage,
  ) {
    const snapshot = this.storage.getSnapshot();
    const team = snapshot.teams.find((item) => item.id === conversation.targetId);
    if (!team) return;
    const allMembers = snapshot.agents.filter((agent) => team.memberIds.includes(agent.id));
    const prioritizedMemberIds = Array.from(
      new Set([
        ...inputMentionIds,
        ...(team.context.handoff?.activeAgentId ? [team.context.handoff.activeAgentId] : []),
      ]),
    );
    const prioritizedMembers = prioritizedMemberIds
      .map((id) => allMembers.find((agent) => agent.id === id))
      .filter((agent): agent is AgentRecord => agent !== undefined);
    const members = [...prioritizedMembers, ...allMembers.filter((agent) => !prioritizedMemberIds.includes(agent.id))]
      .slice(0, TEAM_MEMBER_LIMIT);
    if (members.length === 0) {
      this.addSystemMessage(
        conversation.id,
        byLanguage(responseLanguage, {
          zh: "当前群组还没有可参与的 Agent，请先在管理页添加成员。",
          en: "No available agents are in this group yet. Add members from the Manage page first.",
        }),
      );
      return;
    }

    const memberIds = new Set(members.map((agent) => agent.id));
    const explicitMentions =
      inputMentionIds.length > 0
        ? inputMentionIds.filter((id) => memberIds.has(id)).slice(0, TEAM_MEMBER_LIMIT)
        : resolveMentionedMembers(input, members).matchedIds
            .filter((id) => memberIds.has(id))
            .slice(0, TEAM_MEMBER_LIMIT);
    const provider = this.resolveActiveProvider(snapshot);
    const providerIssue = validateProviderForSingleChat(provider, responseLanguage);
    if (providerIssue) {
      this.addSystemMessage(conversation.id, providerIssue);
      return;
    }

    const runId = `run-${nanoid(8)}`;
    const shouldContinueRun = () => !this.isRunTerminal(runId);
    const shouldContinueHandoff = shouldApplyTeamHandoffContinuity(input);
    let updatedContext: TeamContext = {
      ...team.context,
      activeTasks: Array.from(
        new Set([`${input.slice(0, 24)}${input.length > 24 ? "..." : ""}`, ...team.context.activeTasks]),
      ).slice(0, 5),
    };
    let handoffState = normalizeTeamHandoffState(updatedContext, members, responseLanguage);
    updatedContext = {
      ...updatedContext,
      handoff: handoffState,
    };
    this.storage.updateTeamContext(team.id, updatedContext);
    const workspacePath = team.workspacePath;
    const availableMcpServers = this.getAvailableMcpServersForConversation(conversation);
    const availableMcpConnections = this.getAvailableMcpConnectionsForConversation(conversation);
    const attachmentRoots = this.storage.getConversationAttachmentRoots(conversation.id);
    const createTeamApprovalPolicy = (actor: AgentRecord) =>
      this.createToolExecutionPolicy({
        conversationId: conversation.id,
        runId,
        actorName: actor.name,
        responseLanguage,
      });
    const createTeamRuntimeTools = (input: {
      actor: AgentRecord;
      onInvocation?: (event: RuntimeToolInvocationEvent) => void | Promise<void>;
    }) =>
      buildRuntimeLangChainTools({
        workspacePath,
        attachmentRoots,
        provider,
        responseLanguage,
        activeSkill: null,
        availableSkills: this.storage
          .listSkillCatalog()
          .filter((skill) => skill.installed && input.actor.skillWhitelist.includes(skill.id)),
        onInvocation: input.onInvocation,
        approvalPolicy: createTeamApprovalPolicy(input.actor),
      });
    let selection: {
      mode: TeamTurnPlan["mode"];
      speakers: AgentRecord[];
      reason: string;
      activeTask: string;
      nextPhase: string;
      decision: string;
    } | null = null;
    let executionPlan: TeamExecutionPlan | null = null;
    let turnPlan: TeamTurnPlan | null = null;
    const turnMessages: NaturalTeamAgentMessage[] = [];

    const steps: RunStep[] = [
      {
        label: byLanguage(responseLanguage, { zh: "同步群组上下文", en: "Sync group context" }),
        delayMs: 300,
        execute: () => {
          if (!shouldContinueRun()) {
            return;
          }
          const mentionedAgents = explicitMentions
            .map((id) => members.find((agent) => agent.id === id))
            .filter((agent): agent is AgentRecord => agent !== undefined);
          const handoffAgent =
            !mentionedAgents.length && shouldContinueHandoff && handoffState.activeAgentId
              ? members.find((agent) => agent.id === handoffState.activeAgentId) ?? null
              : null;
          const thinkingText = byLanguage(responseLanguage, {
            zh:
              mentionedAgents.length === 1
                ? `${mentionedAgents[0].name} 正在查看你的请求。`
                : mentionedAgents.length > 1
                  ? `${mentionedAgents.map((agent) => agent.name).join("、")} 正在查看你的请求。`
                  : handoffAgent
                    ? `${handoffAgent.name} 正在接着上一轮继续处理。`
                    : "我先看一下这个问题，并叫上合适的成员来回复你。",
            en:
              mentionedAgents.length === 1
                ? `${mentionedAgents[0].name} is reviewing your request.`
                : mentionedAgents.length > 1
                  ? `${mentionedAgents.map((agent) => agent.name).join(", ")} are reviewing your request.`
                  : handoffAgent
                    ? `${handoffAgent.name} is continuing from the previous round.`
                    : "I’ll review this first and bring in the right members to reply.",
          });
          this.addRunMessage(
            conversation.id,
            runId,
            thinkingText,
            "system",
            {
              teamUpdate: true,
              stage: "handoff",
              actorId: handoffAgent?.id ?? mentionedAgents[0]?.id ?? null,
              actorName: handoffAgent?.name ?? mentionedAgents[0]?.name ?? null,
            },
          );
        },
      },
      {
        label: byLanguage(responseLanguage, { zh: "选择发言成员", en: "Select speakers" }),
        execute: async () => {
          if (!shouldContinueRun()) {
            return;
          }
          turnPlan = await orchestrateTeamTurn({
            provider: provider!,
            profile: snapshot.profile,
            team: {
              ...team,
              context: updatedContext,
            },
            members,
            context: updatedContext,
            handoff: handoffState,
            history: this.storage
              .listMessages(conversation.id)
              .filter((message) => message.metadata?.teamProcess !== true)
              .map((message) => ({
                senderName: message.senderName,
                visibility: message.visibility,
                content: message.content,
              })),
            userInput: input,
            explicitMentionIds: explicitMentions,
            mcpServers: availableMcpServers,
            responseLanguage,
          });
          if (!shouldContinueRun()) {
            return;
          }

          selection = {
            mode: turnPlan.mode,
            speakers: turnPlan.speakers,
            reason: turnPlan.reason,
            activeTask: turnPlan.activeTask,
            nextPhase: turnPlan.nextPhase,
            decision: turnPlan.decision,
          };
          executionPlan =
            turnPlan.intent === "execute"
              ? {
                  reason: turnPlan.reason,
                  activeTask: turnPlan.activeTask,
                  nextPhase: turnPlan.nextPhase,
                  decision: turnPlan.decision,
                  workItems: turnPlan.workItems,
                }
              : null;

          if (executionPlan) {
            updatedContext = {
              ...updatedContext,
              phase:
                executionPlan.nextPhase ||
                byLanguage(responseLanguage, { zh: "执行中", en: "Executing" }),
              activeTasks: executionPlan.activeTask
                ? Array.from(new Set([executionPlan.activeTask, ...updatedContext.activeTasks])).slice(0, 5)
                : updatedContext.activeTasks,
              recentDecisions: executionPlan.decision
                ? Array.from(new Set([executionPlan.decision, ...updatedContext.recentDecisions])).slice(0, 5)
                : updatedContext.recentDecisions,
            };
            handoffState = {
              ...handoffState,
              activeAgentId: executionPlan.workItems[0]?.owner.id ?? handoffState.activeAgentId,
              nextAgentIds: executionPlan.workItems.map((item) => item.owner.id).slice(0, TEAM_MEMBER_LIMIT),
              reason:
                executionPlan.reason ||
                byLanguage(responseLanguage, { zh: "进入执行模式", en: "Enter execution mode" }),
              revision: handoffState.revision + 1,
              updatedAt: Date.now(),
            };
            updatedContext = {
              ...updatedContext,
              handoff: handoffState,
            };
            this.storage.updateTeamContext(team.id, updatedContext);
            this.emitTeamUpdate({
              conversationId: conversation.id,
              runId,
              stage: "selection",
              actorId: handoffState.activeAgentId,
              actorName:
                members.find((agent) => agent.id === handoffState.activeAgentId)?.name ?? null,
              content:
                executionPlan.workItems.length > 1
                  ? byLanguage(responseLanguage, {
                      zh: `我已经排好了执行分工，先由 ${executionPlan.workItems.map((item) => item.owner.name).join("、")} 推进。`,
                      en: `Execution is split. ${executionPlan.workItems.map((item) => item.owner.name).join(", ")} will start first.`,
                    })
                  : byLanguage(responseLanguage, {
                      zh: `${executionPlan.workItems[0]?.owner.name ?? "成员"} 会先接手这一轮。`,
                      en: `${executionPlan.workItems[0]?.owner.name ?? "A member"} will take this turn first.`,
                    }),
              metadata: {
                execution: true,
                workItemCount: executionPlan.workItems.length,
              },
            });
            return;
          }
          if (!selection) {
            return;
          }

          updatedContext = {
            ...updatedContext,
            phase: selection.nextPhase || updatedContext.phase,
            activeTasks: selection.activeTask
              ? Array.from(new Set([selection.activeTask, ...updatedContext.activeTasks])).slice(0, 5)
              : updatedContext.activeTasks,
            recentDecisions: selection.decision
              ? Array.from(new Set([selection.decision, ...updatedContext.recentDecisions])).slice(0, 5)
              : updatedContext.recentDecisions,
          };
          handoffState = {
            ...handoffState,
            activeAgentId: selection.speakers[0]?.id ?? handoffState.activeAgentId,
            nextAgentIds: selection.speakers.map((agent) => agent.id).slice(0, TEAM_MEMBER_LIMIT),
            reason:
              selection.reason ||
              byLanguage(responseLanguage, { zh: "语义选择", en: "Semantic selection" }),
            revision: handoffState.revision + 1,
            updatedAt: Date.now(),
          };
          updatedContext = {
            ...updatedContext,
            handoff: handoffState,
          };
          this.storage.updateTeamContext(team.id, updatedContext);
          this.emitTeamUpdate({
            conversationId: conversation.id,
            runId,
            stage: "selection",
            actorId: handoffState.activeAgentId,
            actorName: selection.speakers[0]?.name ?? null,
              content:
                selection.speakers.length > 1
                ? byLanguage(responseLanguage, {
                    zh: `${selection.speakers.map((agent) => agent.name).join("、")} 会先一起回应这一轮。`,
                    en: `${selection.speakers.map((agent) => agent.name).join(", ")} will respond first together.`,
                  })
                : byLanguage(responseLanguage, {
                    zh: `${selection.speakers[0]?.name ?? "成员"} 会先接这条消息。`,
                    en: `${selection.speakers[0]?.name ?? "A member"} will reply first.`,
                  }),
            metadata: {
              mode: selection.mode,
              reason: selection.reason,
            },
          });

        },
      },
      {
        label: byLanguage(responseLanguage, { zh: "Agent 自然发言", en: "Agent natural replies" }),
        execute: async () => {
          if (!shouldContinueRun()) {
            return;
          }
          if (executionPlan && executionPlan.workItems.length > 0) {
            const batches = buildExecutionBatches(executionPlan.workItems);
            const completedOutputs: string[] = [];
            const completedWorkItemIds = new Set<string>();
            const announcedWaitingWorkItems = new Set<string>();

            for (const [batchIndex, batch] of batches.entries()) {
              if (!shouldContinueRun()) {
                return;
              }
              const batchIds = new Set(batch.map((item) => item.id));
              const batchOwnerIds = new Set(batch.map((item) => item.owner.id));
              const waitingItems = executionPlan.workItems.filter(
                (item) =>
                  !completedWorkItemIds.has(item.id) &&
                  !batchIds.has(item.id) &&
                  !announcedWaitingWorkItems.has(item.id) &&
                  item.dependsOnAgentIds.some((id) => batchOwnerIds.has(id)),
              );

              for (const item of waitingItems) {
                if (!shouldContinueRun()) {
                  return;
                }
                const dependencyNames = item.dependsOnAgentIds
                  .map((id) => members.find((agent) => agent.id === id)?.name)
                  .filter((name): name is string => Boolean(name));
                this.storage.addMessage({
                  conversationId: conversation.id,
                  senderId: item.owner.id,
                  senderName: item.owner.name,
                  senderKind: "agent",
                  messageType: "agent",
                  visibility: "public",
                  content: byLanguage(responseLanguage, {
                    zh: `${item.owner.name}：我先等 ${dependencyNames.join("、") || "前置成员"} 完成前置部分，再继续处理 ${item.summary}。`,
                    en: `${item.owner.name}: I’ll wait for ${dependencyNames.join(", ") || "prerequisites"} to finish before continuing ${item.summary}.`,
                  }),
                  mentions: [],
                  runId,
                  metadata: {
                    teamId: team.id,
                    execution: true,
                    workItemId: item.id,
                    waiting: true,
                    dependsOnAgentIds: item.dependsOnAgentIds,
                  },
                  createdAt: Date.now(),
                });
                this.emitTeamUpdate({
                  conversationId: conversation.id,
                  runId,
                  stage: "execution_waiting",
                  actorId: item.owner.id,
                  actorName: item.owner.name,
                  content: byLanguage(responseLanguage, {
                    zh: `${item.owner.name} 正在等待前置步骤：${dependencyNames.join("、") || "前置成员"}。`,
                    en: `${item.owner.name} is waiting on prerequisites: ${dependencyNames.join(", ") || "prerequisites"}.`,
                  }),
                  metadata: {
                    workItemId: item.id,
                    dependsOnAgentIds: item.dependsOnAgentIds,
                  },
                });
                announcedWaitingWorkItems.add(item.id);
              }

              if (batch.length > 1) {
                this.emitTeamUpdate({
                  conversationId: conversation.id,
                  runId,
                  stage: "execution_batch",
                  actorId: team.id,
                  actorName: team.name,
                  content: byLanguage(responseLanguage, {
                    zh: `并行批次开始：${batch.map((item) => item.owner.name).join("、")}。`,
                    en: `Parallel batch started: ${batch.map((item) => item.owner.name).join(", ")}.`,
                  }),
                  metadata: {
                    batchIndex,
                    batchSize: batch.length,
                  },
                });
              }

              for (const item of batch) {
                if (!shouldContinueRun()) {
                  return;
                }
                this.storage.addMessage({
                  conversationId: conversation.id,
                  senderId: item.owner.id,
                  senderName: item.owner.name,
                  senderKind: "agent",
                  messageType: "agent",
                  visibility: "public",
                  content: item.kickoffMessage || `我先处理：${item.summary}`,
                  mentions: [],
                  runId,
                  metadata: {
                    teamId: team.id,
                    execution: true,
                    workItemId: item.id,
                    writeTargets: item.writeTargets,
                    readTargets: item.readTargets,
                    kickoff: true,
                    batchIndex,
                  },
                  createdAt: Date.now(),
                });
                this.emitTeamUpdate({
                  conversationId: conversation.id,
                  runId,
                  stage: "execution_progress",
                  actorId: item.owner.id,
                  actorName: item.owner.name,
                  content: byLanguage(responseLanguage, {
                    zh: `${item.owner.name} 已接手：${item.summary}`,
                    en: `${item.owner.name} has taken ownership: ${item.summary}`,
                  }),
                  metadata: {
                    workItemId: item.id,
                    batchIndex,
                  },
                });
              }

              const results = await Promise.all(
                batch.map(async (item) => {
                  let streamMessageId: string | null = null;
                  let heartbeat: ReturnType<typeof setInterval> | null = null;
                  try {
                    const teamToolObserver = this.createTeamToolInvocationObserver({
                      conversationId: conversation.id,
                      runId,
                      speaker: item.owner,
                      responseLanguage,
                      onUpdate: (content, metadata) => {
                        if (!shouldContinueRun()) {
                          return;
                        }
                        this.emitTeamUpdate({
                          conversationId: conversation.id,
                          runId,
                          stage:
                            metadata?.phase === "tool_error"
                              ? "tool_error"
                              : metadata?.phase === "tool_success"
                                ? "tool_success"
                                : "tool_start",
                          actorId: item.owner.id,
                          actorName: item.owner.name,
                          content,
                          metadata,
                        });
                      },
                    });
                    const runtimeTools = createTeamRuntimeTools({
                      actor: item.owner,
                      onInvocation: teamToolObserver,
                    });
                    const workerStartedAt = Date.now();
                    heartbeat = setInterval(() => {
                      if (!shouldContinueRun()) {
                        if (heartbeat) clearInterval(heartbeat);
                        heartbeat = null;
                        return;
                      }
                      const content = byLanguage(responseLanguage, {
                        zh: `${item.owner.name} 仍在处理：${item.summary}，已用时 ${Math.round((Date.now() - workerStartedAt) / 1000)} 秒。`,
                        en: `${item.owner.name} is still working on ${item.summary}, elapsed ${Math.round((Date.now() - workerStartedAt) / 1000)} seconds.`,
                      });
                      this.emitTeamUpdate({
                        conversationId: conversation.id,
                        runId,
                        stage: "execution_waiting",
                        actorId: item.owner.id,
                        actorName: item.owner.name,
                        content,
                        metadata: {
                          workItemId: item.id,
                          batchIndex,
                        },
                      });
                      this.emitSnapshot();
                    }, 60_000);
                    const approvalInterruptRuntime = this.createToolApprovalInterruptRuntime({
                      conversationId: conversation.id,
                      runId,
                      actorName: item.owner.name,
                      responseLanguage,
                      mcpServers: availableMcpServers,
                      mcpConnections: availableMcpConnections,
                    });
                    const approvalPolicy = createTeamApprovalPolicy(item.owner);
                    const content = await executeNaturalTeamWorkItem({
                      provider: provider!,
                      profile: snapshot.profile,
                      team: {
                        ...team,
                        context: updatedContext,
                      },
                      workItem: item,
                      members,
                      context: updatedContext,
                      userInput: input,
                      attachments,
                      workspacePath,
                      conversationId: conversation.id,
                      runId,
                      previousOutputs: completedOutputs,
                      mcpServers: availableMcpServers,
                      mcpConnections: availableMcpConnections,
                      responseLanguage,
                      onMcpInvocation: teamToolObserver,
                      onMcpConnectionUpdated: (connection) => this.persistMcpConnectionUpdate(connection),
                      onDeepAgentToolInvocation: teamToolObserver,
                      approvalPolicy,
                      interruptOn: approvalInterruptRuntime.interruptOn,
                      onToolApprovalInterrupt: approvalInterruptRuntime.handler,
                      onRuntimeError: (source, error, metadata) => {
                        this.emitRunRuntimeError(source, error, {
                          conversationId: conversation.id,
                          runId,
                          teamId: team.id,
                          teamName: team.name,
                          agentId: item.owner.id,
                          agentName: item.owner.name,
                          providerId: provider!.id,
                          model: provider!.defaultModel,
                          ...metadata,
                        });
                      },
                      onReasoningStream: async (aggregatedText) => {
                        if (!shouldContinueRun()) {
                          return;
                        }
                        this.updateRunReasoningMetadata(runId, aggregatedText, {
                          actorId: item.owner.id,
                          actorName: item.owner.name,
                          phase: "team_worker_reasoning",
                        });
                        this.emitSnapshot();
                      },
                      onUpdate: ({ phase, content }) => {
                        if (!shouldContinueRun()) {
                          return;
                        }
                        this.emitTeamUpdate({
                          conversationId: conversation.id,
                          runId,
                          stage:
                            phase === "failed"
                              ? "execution_result"
                              : phase === "completed"
                                ? "execution_result"
                                : "execution_progress",
                          actorId: item.owner.id,
                          actorName: item.owner.name,
                          content,
                          metadata: {
                            phase,
                            workItemId: item.id,
                          },
                        });
                      },
                      onTextStream: async (aggregatedText) => {
                        if (!shouldContinueRun()) {
                          return;
                        }
                        if (streamMessageId) {
                          this.storage.updateMessage(streamMessageId, {
                            content: aggregatedText,
                            metadata: {
                              execution: true,
                              workItemId: item.id,
                              streaming: true,
                            },
                          });
                        } else {
                          const message = this.storage.addMessage(
                            {
                              conversationId: conversation.id,
                              senderId: item.owner.id,
                              senderName: item.owner.name,
                              senderKind: "agent",
                              messageType: "agent",
                              visibility: "public",
                              content: aggregatedText,
                              mentions: [],
                              runId,
                              metadata: {
                                execution: true,
                                workItemId: item.id,
                                streaming: true,
                              },
                              createdAt: Date.now(),
                            },
                            { skipTranscript: true },
                          );
                          streamMessageId = message.id;
                        }
                        this.emitSnapshot();
                      },
                      additionalTools: runtimeTools.tools,
                      runtimeToolSummary: runtimeTools.summary,
                    });
                    if (heartbeat) {
                      clearInterval(heartbeat);
                      heartbeat = null;
                    }
                    return { item, ok: true as const, content, streamMessageId };
                  } catch (error) {
                    return {
                      item,
                      ok: false as const,
                      streamMessageId,
                      content:
                        error instanceof Error
                          ? byLanguage(responseLanguage, {
                              zh: `${item.owner.name}：我执行这个任务时遇到了问题：${error.message}`,
                              en: `${item.owner.name}: I hit an issue while executing this task: ${error.message}`,
                            })
                          : byLanguage(responseLanguage, {
                              zh: `${item.owner.name}：我执行这个任务时遇到了未知问题。`,
                              en: `${item.owner.name}: I hit an unknown issue while executing this task.`,
                          }),
                    };
                  } finally {
                    if (heartbeat) {
                      clearInterval(heartbeat);
                      heartbeat = null;
                    }
                  }
                }),
              );
              if (!shouldContinueRun()) {
                return;
              }

              for (const result of results) {
                if (!shouldContinueRun()) {
                  return;
                }
                completedOutputs.push(result.content);
                completedWorkItemIds.add(result.item.id);
                if (result.streamMessageId) {
                  this.storage.updateMessage(
                    result.streamMessageId,
                    {
                      content: result.content,
                      metadata: {
                        teamId: team.id,
                        execution: true,
                        workItemId: result.item.id,
                        status: result.ok ? "completed" : "failed",
                        writeTargets: result.item.writeTargets,
                        readTargets: result.item.readTargets,
                        streaming: false,
                      },
                    },
                    { appendTranscript: true },
                  );
                } else {
                  this.storage.addMessage({
                    conversationId: conversation.id,
                    senderId: result.item.owner.id,
                    senderName: result.item.owner.name,
                    senderKind: "agent",
                    messageType: result.ok ? "agent" : "notification",
                    visibility: "public",
                    content: result.content,
                    mentions: result.ok ? [] : ["user"],
                    runId,
                    metadata: {
                      teamId: team.id,
                      execution: true,
                      workItemId: result.item.id,
                      status: result.ok ? "completed" : "failed",
                      writeTargets: result.item.writeTargets,
                      readTargets: result.item.readTargets,
                    },
                    createdAt: Date.now(),
                  });
                }
                handoffState = {
                  ...handoffState,
                  activeAgentId: result.item.owner.id,
                  lastSpeakerId: result.item.owner.id,
                  nextAgentIds: [],
                  reason: byLanguage(responseLanguage, {
                    zh: result.ok ? "执行完成，继续推进" : "执行失败，等待修正",
                    en: result.ok ? "Execution finished, continue next step" : "Execution failed, waiting for fix",
                  }),
                  revision: handoffState.revision + 1,
                  updatedAt: Date.now(),
                };
                updatedContext = {
                  ...updatedContext,
                  handoff: handoffState,
                };
                this.storage.updateTeamContext(team.id, updatedContext);
              }

              if (batchIndex < batches.length - 1) {
                const finishedNames =
                  responseLanguage === "en"
                    ? batch.map((item) => item.owner.name).join(", ")
                    : batch.map((item) => item.owner.name).join("、");
                this.emitTeamUpdate({
                  conversationId: conversation.id,
                  runId,
                  stage: "execution_batch",
                  actorId: team.id,
                  actorName: team.name,
                  content: byLanguage(responseLanguage, {
                    zh: `${finishedNames} 完成当前批次，继续下一步。`,
                    en: `${finishedNames} finished this batch. Continuing to the next step.`,
                  }),
                  metadata: {
                    batchIndex,
                    completed: true,
                  },
                });
              }
            }

            const lastContent =
              completedOutputs.at(-1) ??
              byLanguage(responseLanguage, {
                zh: `${team.name} 已完成本轮执行。`,
                en: `${team.name} finished this execution turn.`,
              });
            if (!shouldContinueRun()) {
              return;
            }
            this.createAppNotification(
              {
                type: "group_message",
                title: byLanguage(responseLanguage, {
                  zh: `${team.name} 有新消息`,
                  en: `${team.name} has a new message`,
                }),
                body: trimHeadline(lastContent),
                relatedConversationId: conversation.id,
                relatedRunId: runId,
              },
              "group_message",
            );
            this.emitTeamUpdate({
              conversationId: conversation.id,
              runId,
              stage: "execution_result",
              actorId: team.id,
              actorName: team.name,
              content: byLanguage(responseLanguage, {
                zh: `${team.name} 本轮执行已完成。`,
                en: `${team.name} finished this execution turn.`,
              }),
            });
            return;
          }

          if (!selection || selection.speakers.length === 0) {
            return;
          }

          const selectedMode = selection.mode;
          const speakerMessageCounts = new Map<string, number>();
          let speakers = selection.speakers;
          for (let roundIndex = 0; roundIndex < MAX_TEAM_SUBROUNDS; roundIndex += 1) {
            if (!shouldContinueRun()) {
              return;
            }
            if (turnMessages.length >= MAX_TEAM_TURN_MESSAGES || speakers.length === 0) {
              break;
            }

            const roundMessages: NaturalTeamAgentMessage[] = [];
            if (roundIndex > 0 && speakers.length > 0) {
              this.emitTeamUpdate({
                conversationId: conversation.id,
                runId,
                stage: "handoff",
                actorId: speakers[0]?.id ?? null,
                actorName: speakers[0]?.name ?? null,
                content: byLanguage(responseLanguage, {
                  zh: `进入第 ${roundIndex + 1} 小轮：${speakers.map((agent) => agent.name).join("、")} 接棒。`,
                  en: `Entering sub-round ${roundIndex + 1}: ${speakers.map((agent) => agent.name).join(", ")} handoff.`,
                }),
                metadata: {
                  roundIndex,
                },
              });
            }
            for (const speaker of speakers) {
              if (!shouldContinueRun()) {
                return;
              }
              if (turnMessages.length >= MAX_TEAM_TURN_MESSAGES) {
                break;
              }
              if ((speakerMessageCounts.get(speaker.id) ?? 0) >= MAX_AGENT_MESSAGES_PER_TURN) {
                continue;
              }
              let streamMessageId: string | null = null;
              this.emitTeamUpdate({
                conversationId: conversation.id,
                runId,
                stage: "execution_progress",
                actorId: speaker.id,
                actorName: speaker.name,
                content: byLanguage(responseLanguage, {
                  zh: `${speaker.name} 正在思考并组织回复。`,
                  en: `${speaker.name} is thinking and preparing a reply.`,
                }),
                metadata: {
                  mode: selectedMode,
                  roundIndex,
                },
              });
              const teamToolObserver = this.createTeamToolInvocationObserver({
                conversationId: conversation.id,
                runId,
                speaker,
                responseLanguage,
                onUpdate: (content, metadata) => {
                  if (!shouldContinueRun()) {
                    return;
                  }
                  this.emitTeamUpdate({
                    conversationId: conversation.id,
                    runId,
                    stage:
                      metadata?.phase === "tool_error"
                        ? "tool_error"
                        : metadata?.phase === "tool_success"
                          ? "tool_success"
                          : "tool_start",
                    actorId: speaker.id,
                    actorName: speaker.name,
                    content,
                    metadata,
                  });
                },
              });
              const runtimeTools = createTeamRuntimeTools({
                actor: speaker,
                onInvocation: teamToolObserver,
              });
              const approvalInterruptRuntime = this.createToolApprovalInterruptRuntime({
                conversationId: conversation.id,
                runId,
                actorName: speaker.name,
                responseLanguage,
                mcpServers: availableMcpServers,
                mcpConnections: availableMcpConnections,
              });
              const approvalPolicy = createTeamApprovalPolicy(speaker);
              const message = await generateNaturalTeamAgentMessage({
                provider: provider!,
                profile: snapshot.profile,
                team: {
                  ...team,
                  context: updatedContext,
                },
                speaker,
                members,
                mode: selection.mode,
                context: updatedContext,
                userInput: input,
                attachments,
                roundIndex,
                previousTurnMessages: turnMessages,
                workspacePath,
                conversationId: conversation.id,
                runId,
                responseLanguage,
                isFinalSpeaker:
                  turnMessages.length >= MAX_TEAM_TURN_MESSAGES - 1 ||
                  speaker.id === speakers.at(-1)?.id,
                mcpServers: availableMcpServers,
                mcpConnections: availableMcpConnections,
                onMcpInvocation: teamToolObserver,
                onMcpConnectionUpdated: (connection) => this.persistMcpConnectionUpdate(connection),
                onDeepAgentToolInvocation: teamToolObserver,
                approvalPolicy,
                interruptOn: approvalInterruptRuntime.interruptOn,
                onToolApprovalInterrupt: approvalInterruptRuntime.handler,
                onRuntimeError: (source, error, metadata) => {
                  this.emitRunRuntimeError(source, error, {
                    conversationId: conversation.id,
                    runId,
                    teamId: team.id,
                    teamName: team.name,
                    agentId: speaker.id,
                    agentName: speaker.name,
                    providerId: provider!.id,
                    model: provider!.defaultModel,
                    ...metadata,
                  });
                },
                onReasoningStream: async (aggregatedText) => {
                  if (!shouldContinueRun()) {
                    return;
                  }
                  this.updateRunReasoningMetadata(runId, aggregatedText, {
                    actorId: speaker.id,
                    actorName: speaker.name,
                    phase: "team_chat_reasoning",
                  });
                  this.emitSnapshot();
                },
                onTextStream: async (aggregatedText) => {
                  if (!shouldContinueRun()) {
                    return;
                  }
                  if (streamMessageId) {
                    this.storage.updateMessage(streamMessageId, {
                      content: aggregatedText,
                      metadata: {
                        teamId: team.id,
                        mode: selectedMode,
                        roundIndex,
                        streaming: true,
                      },
                    });
                  } else {
                    const streamMessage = this.storage.addMessage(
                      {
                        conversationId: conversation.id,
                        senderId: speaker.id,
                        senderName: speaker.name,
                        senderKind: "agent",
                        messageType: "agent",
                        visibility: "public",
                        content: aggregatedText,
                        mentions: [],
                        runId,
                        metadata: {
                          teamId: team.id,
                          mode: selectedMode,
                          roundIndex,
                          streaming: true,
                        },
                        createdAt: Date.now(),
                      },
                      { skipTranscript: true },
                    );
                    streamMessageId = streamMessage.id;
                  }
                  this.emitSnapshot();
                },
                additionalTools: runtimeTools.tools,
                runtimeToolSummary: runtimeTools.summary,
              });
              if (!shouldContinueRun()) {
                return;
              }
              if (!message) {
                if (streamMessageId) {
                  this.storage.removeMessage(streamMessageId);
                }
                continue;
              }
              speakerMessageCounts.set(speaker.id, (speakerMessageCounts.get(speaker.id) ?? 0) + 1);
              turnMessages.push(message);
              roundMessages.push(message);
            if (streamMessageId) {
                this.storage.updateMessage(
                streamMessageId,
                {
                  content: message.content,
                  mentions: message.mentions,
                  messageType: "agent",
                  metadata: {
                    teamId: team.id,
                    mode: selectedMode,
                    roundIndex: message.roundIndex,
                    kind: message.kind,
                    streaming: false,
                  },
                },
                { appendTranscript: true },
                );
                this.emitTeamUpdate({
                  conversationId: conversation.id,
                  runId,
                  stage: "execution_result",
                  actorId: message.speaker.id,
                  actorName: message.speaker.name,
                  content: byLanguage(responseLanguage, {
                    zh: `${message.speaker.name} 完成了这一条回复。`,
                    en: `${message.speaker.name} finished this reply.`,
                  }),
                  metadata: {
                    mode: selectedMode,
                    roundIndex: message.roundIndex,
                  },
                });
              } else {
              this.storage.addMessage({
                conversationId: conversation.id,
                  senderId: message.speaker.id,
                  senderName: message.speaker.name,
                senderKind: "agent",
                  messageType: "agent",
                  visibility: "public",
                  content: message.content,
                  mentions: message.mentions,
                runId,
                metadata: {
                  teamId: team.id,
                    mode: selectedMode,
                    roundIndex: message.roundIndex,
                    kind: message.kind,
                },
                createdAt: Date.now(),
                });
                this.emitTeamUpdate({
                  conversationId: conversation.id,
                  runId,
                  stage: "execution_result",
                  actorId: message.speaker.id,
                  actorName: message.speaker.name,
                  content: byLanguage(responseLanguage, {
                    zh: `${message.speaker.name} 完成了这一条回复。`,
                    en: `${message.speaker.name} finished this reply.`,
                  }),
                  metadata: {
                    mode: selectedMode,
                    roundIndex: message.roundIndex,
                  },
                });
              }
            }

            if (roundIndex >= MAX_TEAM_SUBROUNDS - 1) {
              break;
            }
            const nextIds = Array.from(new Set(roundMessages.flatMap((message) => message.mentions)))
              .filter((id) => memberIds.has(id) && (speakerMessageCounts.get(id) ?? 0) < MAX_AGENT_MESSAGES_PER_TURN)
              .slice(0, TEAM_MEMBER_LIMIT);
            if (nextIds.length === 0) {
              handoffState = buildNextHandoffState({
                current: handoffState,
                members,
                turnMessages: roundMessages,
                defaultSpeakerId: turnMessages.at(-1)?.speaker.id ?? selection.speakers[0]?.id ?? null,
                reason: byLanguage(responseLanguage, {
                  zh: "本轮发言完成",
                  en: "Current round speaking completed",
                }),
              });
              updatedContext = {
                ...updatedContext,
                handoff: handoffState,
              };
              this.storage.updateTeamContext(team.id, updatedContext);
              break;
            }
            handoffState = {
              ...handoffState,
              activeAgentId: nextIds[0] ?? handoffState.activeAgentId,
              lastSpeakerId: roundMessages.at(-1)?.speaker.id ?? handoffState.lastSpeakerId,
              nextAgentIds: nextIds,
              reason: byLanguage(responseLanguage, {
                zh: `${roundMessages.at(-1)?.speaker.name ?? "成员"} @ 了下一位成员`,
                en: `${roundMessages.at(-1)?.speaker.name ?? "A member"} @ mentioned the next member`,
              }),
              revision: handoffState.revision + 1,
              updatedAt: Date.now(),
            };
            updatedContext = {
              ...updatedContext,
              handoff: handoffState,
            };
            this.storage.updateTeamContext(team.id, updatedContext);
            speakers = nextIds
              .map((id) => members.find((agent) => agent.id === id))
              .filter((agent): agent is AgentRecord => agent !== undefined);
          }

          if (turnMessages.length > 0) {
            const nextHandoff = buildNextHandoffState({
              current: handoffState,
              members,
              turnMessages,
              defaultSpeakerId: selection.speakers[0]?.id ?? null,
              reason: byLanguage(responseLanguage, {
                zh: "本轮群聊发言完成",
                en: "Group speaking turn completed",
              }),
            });
            if (
              nextHandoff.activeAgentId !== handoffState.activeAgentId ||
              nextHandoff.lastSpeakerId !== handoffState.lastSpeakerId ||
              nextHandoff.nextAgentIds.join(",") !== handoffState.nextAgentIds.join(",")
            ) {
              handoffState = nextHandoff;
              updatedContext = {
                ...updatedContext,
                handoff: handoffState,
              };
              this.storage.updateTeamContext(team.id, updatedContext);
            }
          }

          if (turnMessages.length === 0) {
            const fallbackSpeaker = selection.speakers[0] ?? members[0];
            const fallbackContent = byLanguage(responseLanguage, {
              zh: `${fallbackSpeaker.name}：我已经收到这条消息，但还需要更多信息才能给出有价值的判断。你可以补充目标、约束或期望输出。`,
              en: `${fallbackSpeaker.name}: I received this message, but I need more detail to provide a useful response. Please add goals, constraints, or expected output.`,
            });
            turnMessages.push({
              speaker: fallbackSpeaker,
              kind: "question",
              content: fallbackContent,
              mentions: ["user"],
              roundIndex: 0,
            });
            this.storage.addMessage({
              conversationId: conversation.id,
              senderId: fallbackSpeaker.id,
              senderName: fallbackSpeaker.name,
              senderKind: "agent",
              messageType: "notification",
              visibility: "public",
              content: fallbackContent,
              mentions: ["user"],
              runId,
              metadata: {
                teamId: team.id,
                mode: selection.mode,
                fallback: true,
              },
              createdAt: Date.now(),
            });
          }

          const lastMessage = turnMessages.at(-1);
          const hasMention = turnMessages.some((message) => message.mentions.includes("user"));
          const notificationBody = trimHeadline(
            lastMessage?.content.replace(/^@(你|you)\s*/i, "") ||
              byLanguage(responseLanguage, {
                zh: `${team.name} 中有新的回复。`,
                en: `There is a new reply in ${team.name}.`,
              }),
          );

          if (!shouldContinueRun()) {
            return;
          }
          this.createAppNotification(
            {
              type: hasMention ? "mention" : "group_message",
              title: hasMention
                ? byLanguage(responseLanguage, {
                    zh: `${lastMessage?.speaker.name ?? team.name} 在 ${team.name} 中 @ 了你`,
                    en: `${lastMessage?.speaker.name ?? team.name} mentioned you in ${team.name}`,
                  })
                : byLanguage(responseLanguage, {
                    zh: `${team.name} 有新消息`,
                    en: `${team.name} has a new message`,
                  }),
              body: notificationBody,
              relatedConversationId: conversation.id,
              relatedRunId: runId,
            },
            hasMention ? "mention" : "group_message",
          );
        },
      },
      {
        label: byLanguage(responseLanguage, { zh: "更新群组记忆", en: "Update group memory" }),
        execute: () => {
          if (!shouldContinueRun()) {
            return;
          }
          const activeSpeakers =
            executionPlan?.workItems.map((item) => item.owner.name) ??
            turnMessages.map((message) => message.speaker.name);
          const finalLine =
            executionPlan && turnMessages.length === 0
              ? executionPlan.workItems.map((item) => item.summary).join("；")
              : turnMessages.at(-1)?.content ?? "";
          const sharedMemoryPath = this.appendMemory(
            workspacePath,
            `${workspaceInternalDirName}/shared-memory.md`,
            formatMemoryEntry({
              timestamp: this.formatTimestamp(),
              kind: "team",
              inputLabel: byLanguage(responseLanguage, { zh: "话题", en: "Topic" }),
              input,
              speakerLabel: byLanguage(responseLanguage, { zh: "发言成员", en: "Speakers" }),
              speakers: activeSpeakers,
              outputLabel: byLanguage(responseLanguage, { zh: "结论", en: "Conclusion" }),
              output: finalLine,
            }),
            {
              provider: provider!,
              responseLanguage,
              conversationId: conversation.id,
              runId,
              actorId: team.id,
              actorName: team.name,
              phase: "team_shared_memory",
            },
          );
          this.addRunMessage(
            conversation.id,
            runId,
            byLanguage(responseLanguage, {
              zh: `共享记忆已更新：${sharedMemoryPath}`,
              en: `Shared memory updated: ${sharedMemoryPath}`,
            }),
            "system",
          );
          const currentRun = this.storage.getRun(runId);
          this.storage.updateRun(runId, {
            metadata: {
              ...(currentRun?.metadata ?? {}),
              memoryPath: sharedMemoryPath,
              mode: executionPlan ? "execution" : selection?.mode,
              speakerIds:
                executionPlan?.workItems.map((item) => item.owner.id) ??
                turnMessages.map((message) => message.speaker.id),
            },
          });
        },
      },
    ];

    this.beginRun({
      runId,
      conversationId: conversation.id,
      title: byLanguage(responseLanguage, {
        zh: `${team.name} 群聊发言`,
        en: `${team.name} group chat reply`,
      }),
      kind: "team_task",
      actorId: members[0]?.id ?? "system",
      steps,
      responseLanguage,
    });
  }

  private async startShellCommandRun(conversation: ConversationRecord, shellCommand: string) {
    const snapshot = this.storage.getSnapshot();
    const responseLanguage = this.resolveResponseLanguage(conversation, shellCommand, snapshot.settings.language);
    const workspacePath = this.getWorkspaceForConversation(conversation, snapshot.agents, snapshot.teams);
    const actorId =
      conversation.kind === "agent"
        ? conversation.targetId
        : chooseTeamRepresentative(snapshot.teams.find((item) => item.id === conversation.targetId)!, snapshot.agents)?.id ??
          "system";

    const runId = `run-${nanoid(8)}`;
    const steps: RunStep[] = [
      {
        label: byLanguage(responseLanguage, { zh: "准备命令", en: "Prepare command" }),
        delayMs: 300,
        execute: () => {
          this.addRunMessage(
            conversation.id,
            runId,
            byLanguage(responseLanguage, {
              zh: `准备在 workspace 执行命令：${shellCommand}`,
              en: `Preparing to run command in workspace: ${shellCommand}`,
            }),
            "system",
          );
        },
      },
      {
        label: byLanguage(responseLanguage, { zh: "执行命令", en: "Run command" }),
        execute: async () => {
          const artifactPath = await this.executeShellCommand(
            runId,
            conversation.id,
            shellCommand,
            workspacePath,
            responseLanguage,
          );
          this.addRunMessage(
            conversation.id,
            runId,
            byLanguage(responseLanguage, {
              zh: `命令结果已写入产物：${artifactPath}`,
              en: `Command result written to artifact: ${artifactPath}`,
            }),
            "system",
          );
        },
      },
      {
        label: byLanguage(responseLanguage, { zh: "整理结果", en: "Finalize result" }),
        delayMs: 300,
        execute: () => {
          this.addRunMessage(
            conversation.id,
            runId,
            byLanguage(responseLanguage, {
              zh: "命令执行完成，结果已经回写到会话中。",
              en: "Command execution completed and result has been written back to the conversation.",
            }),
            "system",
          );
        },
      },
    ];

    this.beginRun({
      runId,
      conversationId: conversation.id,
      title: `/command ${shellCommand}`,
      kind: "shell_command",
      actorId,
      steps,
      responseLanguage,
    });
  }

  private beginRun(input: {
    runId: string;
    conversationId: string;
    title: string;
    kind: RunRecord["kind"];
    actorId: string;
    steps: RunStep[];
    responseLanguage?: RuntimeLanguage;
  }) {
    const transcriptPaths = this.storage.getConversationTranscriptPaths(input.conversationId);
    this.storage.createRun({
      id: input.runId,
      conversationId: input.conversationId,
      title: input.title,
      kind: input.kind,
      status: "running",
      actorId: input.actorId,
      stepIndex: 0,
      totalSteps: input.steps.length,
      metadata: {
        title: input.title,
        transcriptPath: transcriptPaths.globalTranscriptPath,
        workspaceTranscriptPath: transcriptPaths.workspaceTranscriptPath,
        responseLanguage: input.responseLanguage ?? "zh",
        runtimeTimeouts: getRuntimeTimeouts(),
      },
    });
    this.storage.initializeRunSteps({
      runId: input.runId,
      conversationId: input.conversationId,
      labels: input.steps.map((step) => step.label),
    });

    const controller: ActiveRunController = {
      runId: input.runId,
      conversationId: input.conversationId,
      steps: input.steps,
      timer: null,
      busy: false,
      childProcess: null,
    };

    this.activeRuns.set(input.runId, controller);
    this.addRunMessage(
      input.conversationId,
      input.runId,
      byLanguage(input.responseLanguage ?? "zh", {
        zh: `已开始任务：${input.title}`,
        en: `Started task: ${input.title}`,
      }),
      "system",
    );
    this.scheduleNext(controller, 240);
  }

  private scheduleNext(controller: ActiveRunController, delayMs = 800) {
    if (controller.timer) clearTimeout(controller.timer);
    controller.timer = setTimeout(() => {
      void this.advanceRun(controller.runId);
    }, delayMs);
  }

  private async advanceRun(runId: string) {
    const controller = this.activeRuns.get(runId);
    const run = this.storage.getRun(runId);
    if (!controller || !run) return;
    const responseLanguage = this.getRunResponseLanguage(run);

    if (["paused", "cancelled", "completed", "failed"].includes(run.status)) {
      return;
    }

    if (run.status === "resuming") {
      this.storage.updateRun(runId, { status: "running" });
    }

    if (run.status === "pausing") {
      this.storage.updateRun(runId, { status: "paused" });
      this.addRunMessage(
        run.conversationId,
        runId,
        byLanguage(responseLanguage, { zh: "任务已暂停。", en: "Run paused." }),
        "system",
      );
      this.emitSnapshot();
      return;
    }

    const step = controller.steps[run.stepIndex];
    if (!step) {
      this.storage.updateRun(runId, { status: "completed" });
      this.addRunMessage(
        run.conversationId,
        runId,
        byLanguage(responseLanguage, { zh: "任务已完成。", en: "Run completed." }),
        "system",
      );
      this.activeRuns.delete(runId);
      this.emitSnapshot();
      return;
    }

    controller.busy = true;
    this.storage.updateRunStep(runId, run.stepIndex, {
      status: "running",
      startedAt: Date.now(),
      completedAt: null,
      errorText: null,
      metadata: null,
    });
    try {
      await step.execute();
      this.storage.updateRunStep(runId, run.stepIndex, {
        status: "completed",
        completedAt: Date.now(),
      });
      this.storage.updateRun(runId, { stepIndex: run.stepIndex + 1 });
      controller.busy = false;

      const latest = this.storage.getRun(runId);
      if (!latest) return;

      if (["cancelled", "failed", "completed"].includes(latest.status)) {
        this.emitSnapshot();
        return;
      }

      if (latest.status === "pausing") {
        this.storage.updateRun(runId, { status: "paused" });
        this.addRunMessage(
          latest.conversationId,
          runId,
          byLanguage(this.getRunResponseLanguage(latest), { zh: "任务已暂停。", en: "Run paused." }),
          "system",
        );
        this.emitSnapshot();
        return;
      }

      this.scheduleNext(controller, step.delayMs ?? 900);
    } catch (error) {
      controller.busy = false;
      const failedAt = Date.now();
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.storage.updateRunStep(runId, run.stepIndex, {
        status: "failed",
        completedAt: failedAt,
        errorText: errorMessage,
      });
      this.emitRunRuntimeError("runtime:run-step", error, {
        conversationId: run.conversationId,
        runId,
        runKind: run.kind,
        actorId: run.actorId,
        phase: "run_step",
        stepIndex: run.stepIndex,
        stepLabel: controller.steps[run.stepIndex]?.label ?? null,
        elapsedMs: failedAt - (run.createdAt ?? failedAt),
      });
      this.storage.cancelPendingRunSteps(runId);
      this.finalizeStreamingMessagesForRun(run.conversationId, runId, "failed");
      this.storage.updateRun(runId, {
        status: "failed",
        metadata: {
          error: errorMessage,
        },
      });
      this.addRunMessage(
        run.conversationId,
        runId,
        byLanguage(responseLanguage, {
          zh: `任务执行失败：${errorMessage}`,
          en: `Run failed: ${errorMessage}`,
        }),
        "system",
      );
      this.addPublicNotice(
        run.conversationId,
        byLanguage(responseLanguage, {
          zh: `任务执行失败：${errorMessage}`,
          en: `Run failed: ${errorMessage}`,
        }),
      );
      const notificationChannel = this.getConversationNotificationChannel(run.conversationId);
      const conversation = this.storage.getConversation(run.conversationId);
      this.createAppNotification(
        {
          type: "run_failed",
          title:
            conversation?.kind === "agent"
              ? byLanguage(responseLanguage, {
                  zh: `${conversation.title} 回复失败`,
                  en: `${conversation.title} reply failed`,
                })
              : conversation?.kind === "team"
                ? byLanguage(responseLanguage, {
                    zh: `${conversation.title} 协作失败`,
                    en: `${conversation.title} collaboration failed`,
                  })
                : byLanguage(responseLanguage, { zh: "任务执行失败", en: "Run failed" }),
          body: error instanceof Error ? trimHeadline(error.message) : trimHeadline(String(error)),
          relatedConversationId: run.conversationId,
          relatedRunId: runId,
        },
        notificationChannel,
      );
      this.activeRuns.delete(runId);
      this.emitSnapshot();
      return;
    }

    this.emitSnapshot();
  }

  private async executeShellCommand(
    runId: string,
    conversationId: string,
    shellCommand: string,
    workspacePath: string,
    responseLanguage: RuntimeLanguage,
  ): Promise<string> {
    await sleep(300);
    const artifactPath = this.getArtifactPath(workspacePath, `command-${runId}.md`);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(shellCommand, {
        cwd: workspacePath,
        shell: true,
        env: buildChildProcessEnv(),
      });

      const controller = this.activeRuns.get(runId);
      if (controller) {
        controller.childProcess = child;
      }

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        reject(error);
      });

      child.on("close", (code) => {
        const normalizedStdout = trimOutput(
          stdout ||
            byLanguage(responseLanguage, {
              zh: "命令没有输出。",
              en: "Command produced no output.",
            }),
        );
        const normalizedStderr = trimOutput(stderr);
        this.writeTextFile(
          artifactPath,
          byLanguage(responseLanguage, {
            zh: `# 命令执行结果\n\n- 命令：\`${shellCommand}\`\n- 工作目录：\`${workspacePath}\`\n- 退出码：${code ?? 0}\n\n## 标准输出\n\n\`\`\`\n${normalizedStdout}\n\`\`\`\n${normalizedStderr ? `\n## 标准错误\n\n\`\`\`\n${normalizedStderr}\n\`\`\`\n` : ""}`,
            en: `# Command Result\n\n- Command: \`${shellCommand}\`\n- Working Directory: \`${workspacePath}\`\n- Exit Code: ${code ?? 0}\n\n## STDOUT\n\n\`\`\`\n${normalizedStdout}\n\`\`\`\n${normalizedStderr ? `\n## STDERR\n\n\`\`\`\n${normalizedStderr}\n\`\`\`\n` : ""}`,
          }),
        );
        this.storage.recordArtifact({
          conversationId,
          runId,
          artifactKind: "command_output",
          title: byLanguage(responseLanguage, {
            zh: `命令执行结果：${shellCommand}`,
            en: `Command result: ${shellCommand}`,
          }),
          path: artifactPath,
          workspacePath,
          metadata: {
            shellCommand,
            exitCode: code ?? 0,
          },
        });
        const currentRun = this.storage.getRun(runId);
        this.storage.updateRun(runId, {
          metadata: {
            ...(currentRun?.metadata ?? {}),
            artifactPath,
          },
        });

        this.storage.addMessage({
          conversationId,
          senderId: "system",
          senderName: "System",
          senderKind: "system",
          messageType: "run",
          visibility: "system",
          content: byLanguage(responseLanguage, {
            zh: `命令：${shellCommand}\n工作目录：${workspacePath}\n退出码：${code ?? 0}\n\n输出：\n${normalizedStdout}${
              normalizedStderr ? `\n\n错误输出：\n${normalizedStderr}` : ""
            }`,
            en: `Command: ${shellCommand}\nWorking Directory: ${workspacePath}\nExit Code: ${code ?? 0}\n\nOutput:\n${normalizedStdout}${
              normalizedStderr ? `\n\nError Output:\n${normalizedStderr}` : ""
            }`,
          }),
          mentions: [],
          runId,
          metadata: {
            code,
            shellCommand,
            workspacePath,
            artifactPath,
            cardType: "command_result",
          },
          createdAt: Date.now(),
        });

        const runtimeController = this.activeRuns.get(runId);
        if (runtimeController) {
          runtimeController.childProcess = null;
        }

        if (code === 0) {
          resolve();
        } else {
          reject(
            new Error(
              byLanguage(responseLanguage, {
                zh: `命令退出码为 ${code ?? 1}`,
                en: `Command exited with code ${code ?? 1}`,
              }),
            ),
          );
        }
      });
    });

    return artifactPath;
  }
  private addSystemMessage(conversationId: string, content: string) {
    this.storage.addMessage({
      conversationId,
      senderId: "system",
      senderName: "System",
      senderKind: "system",
      messageType: "system",
      visibility: "system",
      content,
      mentions: [],
      runId: null,
      metadata: null,
      createdAt: Date.now(),
    });
  }

  private addPublicNotice(conversationId: string, content: string) {
    this.storage.addMessage({
      conversationId,
      senderId: "system",
      senderName: "System",
      senderKind: "system",
      messageType: "notification",
      visibility: "public",
      content,
      mentions: [],
      runId: null,
      metadata: { notice: true },
      createdAt: Date.now(),
    });
  }

  private addSlashFeedbackMessage(
    conversation: ConversationRecord,
    input: {
      title: string;
      body?: string;
      items?: string[];
      emptyText?: string;
      tone?: "default" | "success" | "warning" | "error";
    },
  ) {
    const agents = this.storage.listAgents();
    const teams = this.storage.listTeams();
    const representative =
      conversation.kind === "team"
        ? (() => {
            const team = teams.find((item) => item.id === conversation.targetId);
            return team ? chooseTeamRepresentative(team, agents) : null;
          })()
        : null;
    const directAgent =
      conversation.kind === "agent"
        ? agents.find((item) => item.id === conversation.targetId) ?? null
        : null;
    const sender = directAgent ?? representative;
    const items = input.items?.filter((item) => item.trim().length > 0) ?? [];
    const contentLines = [
      input.title,
      input.body?.trim() ?? "",
      ...(items.length > 0 ? items.map((item) => `- ${item}`) : input.emptyText ? [input.emptyText] : []),
    ].filter((line) => line.trim().length > 0);

    this.storage.addMessage({
      conversationId: conversation.id,
      senderId: sender?.id ?? "system",
      senderName: sender?.name ?? conversation.title,
      senderKind: sender ? "agent" : "system",
      messageType: sender ? "agent" : "system",
      visibility: "public",
      content: contentLines.join("\n"),
      mentions: [],
      runId: null,
      metadata: { slashFeedbackTone: input.tone ?? "default" },
      createdAt: Date.now(),
    });
  }

  private addRunMessage(
    conversationId: string,
    runId: string,
    content: string,
    visibility: MessageVisibility,
    metadata?: Record<string, unknown> | null,
  ) {
    this.storage.addMessage({
      conversationId,
      senderId: "system",
      senderName: "System",
      senderKind: "system",
      messageType: "run",
      visibility,
      content,
      mentions: [],
      runId,
      metadata: metadata ?? null,
      createdAt: Date.now(),
    });
  }

  private emitTeamUpdate(input: {
    conversationId: string;
    runId: string;
    content: string;
    stage:
      | "handoff"
      | "selection"
      | "execution"
      | "execution_waiting"
      | "execution_batch"
      | "execution_progress"
      | "execution_result"
      | "tool_start"
      | "tool_success"
      | "tool_error";
    actorId?: string | null;
    actorName?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    this.appendRunProgressMetadata(input.runId, {
      kind: "team",
      phase: input.stage,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? null,
      content: input.content,
    });
    this.addRunMessage(input.conversationId, input.runId, input.content, "system", {
      teamUpdate: true,
      stage: input.stage,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? null,
      ...(input.metadata ?? {}),
    });
  }

  private stopRunController(runId: string) {
    const controller = this.activeRuns.get(runId);
    if (!controller) {
      return;
    }
    if (controller.timer) {
      clearTimeout(controller.timer);
      controller.timer = null;
    }
    if (controller.childProcess) {
      controller.childProcess.kill("SIGTERM");
      controller.childProcess = null;
    }
    this.activeRuns.delete(runId);
  }

  private resetTeamHandoffAfterCancellation(
    conversationId: string,
    responseLanguage: RuntimeLanguage,
  ) {
    const conversation = this.storage.getConversation(conversationId);
    if (!conversation || conversation.kind !== "team") {
      return;
    }
    const team = this.storage.listTeams().find((item) => item.id === conversation.targetId);
    if (!team) {
      return;
    }
    this.storage.updateTeamContext(team.id, {
      ...team.context,
      handoff: {
        activeAgentId: null,
        lastSpeakerId: team.context.handoff?.lastSpeakerId ?? null,
        nextAgentIds: [],
        reason: byLanguage(responseLanguage, {
          zh: "上一轮已取消，等待新的指令。",
          en: "Previous turn cancelled, waiting for new instruction.",
        }),
        revision: (team.context.handoff?.revision ?? 0) + 1,
        updatedAt: Date.now(),
      },
    });
  }

  private addTeamCancellationMessage(
    conversationId: string,
    runId: string,
    responseLanguage: RuntimeLanguage,
  ) {
    const conversation = this.storage.getConversation(conversationId);
    if (!conversation || conversation.kind !== "team") {
      return;
    }
    const team = this.storage.listTeams().find((item) => item.id === conversation.targetId);
    if (!team) {
      return;
    }
    this.storage.addMessage({
      conversationId,
      senderId: team.id,
      senderName: team.name,
      senderKind: "agent",
      messageType: "agent",
      visibility: "public",
      content: byLanguage(responseLanguage, {
        zh: "这一轮已经取消，我会等你的下一条指令。",
        en: "This turn has been cancelled. I'll wait for your next instruction.",
      }),
      mentions: [],
      runId,
      metadata: {
        teamProcess: true,
        cancelled: true,
      },
      createdAt: Date.now(),
    });
  }

  private finalizeStreamingMessagesForRun(
    conversationId: string,
    runId: string,
    reason: "failed" | "cancelled",
  ) {
    const messages = this.storage
      .listMessages(conversationId)
      .filter(
        (message) =>
          message.runId === runId &&
          message.visibility === "public" &&
          message.senderKind === "agent" &&
          message.metadata?.streaming === true,
      );
    for (const message of messages) {
      this.storage.updateMessage(message.id, {
        metadata: {
          ...(message.metadata ?? {}),
          streaming: false,
          interrupted: reason,
        },
      });
    }
  }

  private getArtifactDir(workspacePath: string) {
    return join(workspacePath, workspaceInternalDirName, "artifacts");
  }

  private getArtifactPath(workspacePath: string, fileName: string) {
    return join(this.getArtifactDir(workspacePath), fileName);
  }

  private ensureWorkspaceFolders(workspacePath: string) {
    const internalPath = join(workspacePath, workspaceInternalDirName);
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(internalPath, { recursive: true });
    mkdirSync(this.getArtifactDir(workspacePath), { recursive: true });
    mkdirSync(join(internalPath, "memory"), { recursive: true });
    mkdirSync(join(internalPath, "sessions"), { recursive: true });
  }

  private writeTextFile(filePath: string, content: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  }

  private appendMemory(
    workspacePath: string,
    relativePath: string,
    entry: string,
    options: MemoryAppendContext = {},
  ) {
    this.ensureWorkspaceFolders(workspacePath);
    const filePath = join(workspacePath, relativePath);
    const title = relativePath.split("/").at(-1)?.replace(/\.md$/i, "") ?? "memory";
    const header = existsSync(filePath) ? "" : `# ${title}\n\n`;
    if (header) {
      this.writeTextFile(filePath, header);
    }
    appendFileSync(filePath, `${entry.trimEnd()}\n\n`, "utf8");

    if (options.provider) {
      this.scheduleMemoryCompaction(filePath, title, {
        ...options,
        provider: options.provider,
      });
    }

    return filePath;
  }

  private scheduleMemoryCompaction(
    filePath: string,
    title: string,
    options: MemoryAppendContext & { provider: ProviderConfig },
  ) {
    const previous = this.memoryCompactions.get(filePath) ?? Promise.resolve();
    const task = previous
      .catch(() => undefined)
      .then(async () => {
        try {
          const result = await compactMemoryFile(filePath, {
            title,
            summarize: (summaryInput) =>
              this.summarizeMemoryContent(
                options.provider,
                options.responseLanguage ?? "zh",
                summaryInput,
              ),
          });
          if (result.compacted && options.runId) {
            this.appendRunProgressMetadata(options.runId, {
              kind: "memory",
              phase: "memory_compacted",
              actorId: options.actorId,
              actorName: options.actorName,
              content: byLanguage(options.responseLanguage ?? "zh", {
                zh: `长期记忆已压缩：保留最近 ${result.keptEntryCount} 条原始记忆，汇总 ${result.summarizedEntryCount} 条旧记忆。`,
                en: `Long-term memory compacted: kept ${result.keptEntryCount} recent raw entries and summarized ${result.summarizedEntryCount} older entries.`,
              }),
            });
            this.emitSnapshot();
          }
        } catch (error) {
          this.emitRunRuntimeError("runtime:memory-compaction", error, {
            conversationId: options.conversationId,
            runId: options.runId,
            actorId: options.actorId,
            actorName: options.actorName,
            phase: options.phase ?? "memory_compaction",
            memoryPath: filePath,
          });
        }
      });
    const trackedTask = task.finally(() => {
      if (this.memoryCompactions.get(filePath) === trackedTask) {
        this.memoryCompactions.delete(filePath);
      }
    });
    this.memoryCompactions.set(filePath, trackedTask);
  }

  private async summarizeMemoryContent(
    provider: ProviderConfig,
    responseLanguage: RuntimeLanguage,
    input: MemoryCompactionSummaryInput,
  ) {
    const model = createProviderModel(provider);
    const systemPrompt = byLanguage(responseLanguage, {
      zh: [
        "你是 TeamAligned 的长期记忆压缩器。",
        "把旧的 Agent/team memory 压缩为稳定、可复用的长期记忆摘要。",
        "保留用户偏好、长期事实、项目约定、重要决策、反复出现的任务模式和恢复上下文。",
        "删除临时寒暄、重复内容和低价值过程噪音。",
        "不要保存 API Key、OAuth token、密码、secret、header/env 敏感值。",
        "只输出 Markdown 摘要，不要解释你的压缩过程。",
      ].join("\n"),
      en: [
        "You compact TeamAligned long-term memory.",
        "Condense older Agent/team memory into stable, reusable long-term memory.",
        "Preserve user preferences, durable facts, project conventions, key decisions, recurring task patterns, and recovery context.",
        "Drop transient small talk, duplicates, and low-value process noise.",
        "Never preserve API keys, OAuth tokens, passwords, secrets, headers, or env values.",
        "Return only the Markdown summary. Do not explain the compaction process.",
      ].join("\n"),
    });
    const userPrompt = byLanguage(responseLanguage, {
      zh: [
        `目标摘要最大长度：${input.maxSummaryChars} 字符。`,
        input.existingSummary ? `已有摘要：\n${input.existingSummary}` : "暂无已有摘要。",
        "请压缩以下旧记忆内容：",
        input.contentToSummarize,
      ].join("\n\n"),
      en: [
        `Target summary max length: ${input.maxSummaryChars} characters.`,
        input.existingSummary ? `Existing summary:\n${input.existingSummary}` : "No existing summary.",
        "Compact the older memory content below:",
        input.contentToSummarize,
      ].join("\n\n"),
    });
    return extractAgentText(
      await model.invoke([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ]),
    );
  }

  private writeAgentArtifact(
    conversationId: string,
    workspacePath: string,
    runId: string,
    agent: AgentRecord,
    input: string,
    response: string,
    activeSkill: string | null,
  ) {
    this.ensureWorkspaceFolders(workspacePath);
    const artifactPath = this.getArtifactPath(workspacePath, `agent-${runId}.md`);
    this.writeTextFile(
      artifactPath,
      [
        "# Agent 任务产物",
        "",
        `- Agent：${agent.name}`,
        `- 角色：${agent.role}`,
        `- 技能：${activeSkill ?? "默认"}`,
        `- 输入：${input}`,
        "",
        "## 回复",
        "",
        response,
        "",
      ].join("\n"),
    );
    this.storage.recordArtifact({
      conversationId,
      runId,
      artifactKind: "agent_output",
      title: `${agent.name} 任务产物`,
      path: artifactPath,
      workspacePath,
      metadata: {
        agentId: agent.id,
        skill: activeSkill,
      },
    });
    return artifactPath;
  }

  private formatTimestamp() {
    return new Date().toISOString();
  }

  private getWorkspaceForConversation(
    conversation: ConversationRecord,
    agents: AgentRecord[],
    teams: TeamRecord[],
  ) {
    if (conversation.kind === "agent") {
      return agents.find((agent) => agent.id === conversation.targetId)?.workspacePath ?? this.dataDir;
    }

    return teams.find((team) => team.id === conversation.targetId)?.workspacePath ?? this.dataDir;
  }

  private resolveActiveProvider(snapshot: AppSnapshot): ProviderConfig | null {
    return (
      snapshot.providers.find((provider) => provider.id === snapshot.settings.activeProviderId) ??
      snapshot.providers.find((provider) => provider.isActive) ??
      null
    );
  }

  private recoverInterruptedRuns() {
    for (const run of this.storage.listRuns()) {
      if (["running", "pausing", "resuming"].includes(run.status)) {
        this.storage.updateRun(run.id, { status: "paused" as RunStatus });
        this.addRunMessage(
          run.conversationId,
          run.id,
          byLanguage(this.getRunResponseLanguage(run), {
            zh: "应用重新启动后，任务已恢复为暂停状态。",
            en: "After app restart, this run has been restored as paused.",
          }),
          "system",
        );
      }
    }
  }

  private emitSnapshot(snapshot: AppSnapshot = this.getSnapshot()) {
    this.emit("snapshot", snapshot);
  }
}

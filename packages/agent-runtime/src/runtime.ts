import { EventEmitter } from "node:events";
import { appendFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { nanoid } from "nanoid";
import { parseSlashCommand } from "@teamaligned/shared";
import type {
  AgentRecord,
  AttachmentAssetRecord,
  AppSnapshot,
  AvatarAssetScope,
  ConnectMcpInput,
  ConversationRecord,
  McpCatalogRecord,
  MessageVisibility,
  NotificationRecord,
  PromptAliasRecord,
  ProviderConnectionTestInput,
  ProviderConfig,
  RunControlPayload,
  SavePromptAliasInput,
  SaveAttachmentAssetInput,
  RunRecord,
  RunStatus,
  SendInputPayload,
  SkillCatalogRecord,
  TeamContext,
  TeamRecord,
  UpdateAgentInput,
  UpdateAgentSkillsInput,
  UpdateAgentMcpsInput,
  UpdateProfileInput,
  UpdateProviderInput,
  UpdateSettingsInput,
  UpdateTeamMcpsInput,
} from "@teamaligned/shared";
import { AppStorage } from "./storage.ts";
import {
  invokeSingleChatDeepAgent,
  testProviderConnection as runProviderConnectionTest,
  validateProviderForSingleChat,
} from "./deep-agent.ts";
import {
  fetchSkillCatalog,
  installSkillFromRegistry,
  readInstalledSkillDefinition,
} from "./skill-registry.ts";
import {
  buildMcpConnection,
  fetchMcpCatalog,
  validateLocalMcpLauncher,
} from "./mcp-registry.ts";
import { checkMcpConnection as healthCheckMcpConnection } from "./mcp-runtime.ts";
import type { McpInvocationEvent } from "./mcp-tools.ts";
import { buildRuntimeLangChainTools, type RuntimeToolInvocationEvent } from "./agent-tools.ts";
import {
  buildExecutionBatches,
  executeNaturalTeamWorkItem,
  MAX_AGENT_MESSAGES_PER_TURN,
  generateNaturalTeamAgentMessage,
  MAX_TEAM_SUBROUNDS,
  MAX_TEAM_TURN_MESSAGES,
  planTeamExecution,
  selectNaturalTeamSpeakers,
  TEAM_MEMBER_LIMIT,
  type TeamExecutionPlan,
  type TeamExecutionWorkItem,
  type NaturalTeamAgentMessage,
} from "./team-runtime.ts";

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function summarizeAttachments(attachments: AttachmentAssetRecord[]) {
  if (attachments.length === 0) return "";
  return attachments.map((attachment) => attachment.name).join("、");
}

function buildUserMessageContent(input: string, attachments: AttachmentAssetRecord[]) {
  const trimmed = input.trim();
  if (trimmed) {
    return trimmed;
  }
  return `已上传附件：${summarizeAttachments(attachments)}`;
}

function buildRuntimePrompt(input: string, attachments: AttachmentAssetRecord[]) {
  const trimmed = input.trim();
  if (attachments.length === 0) {
    return trimmed;
  }

  const attachmentLines = attachments
    .map(
      (attachment) =>
        `- ${attachment.name}\n  路径：${attachment.path}\n  类型：${attachment.mimeType}\n  大小：${attachment.sizeBytes} bytes`,
    )
    .join("\n");

  const body = trimmed || "我上传了一些附件，请结合附件内容帮助我。";
  return `${body}\n\n附件列表：\n${attachmentLines}`;
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

function getMcpConfiguredHint(server: McpCatalogRecord) {
  if (server.transport === "http") {
    return `${server.name} 已加入本地连接列表。请在扩展页补充远端 URL、请求头或 Token 后，再点击“保存并检测”。`;
  }

  if (server.authType === "env") {
    return `${server.name} 已加入本地连接列表。请在扩展页补充环境变量后，再点击“保存并检测”。`;
  }

  if (server.authType === "header") {
    return `${server.name} 已加入本地连接列表。请在扩展页补充请求头后，再点击“保存并检测”。`;
  }

  return `${server.name} 已加入本地连接列表。请在扩展页确认本地启动命令后，再点击“保存并检测”。`;
}

function extractAgentMentions(input: string, agents: AgentRecord[]) {
  const matches = [...input.matchAll(/@([\w\u4e00-\u9fa5-]+)/g)].map((item) => item[1]);
  const mentioned = agents.filter((agent) =>
    matches.some((match) => agent.name.toLowerCase() === match.toLowerCase()),
  );
  return mentioned;
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
    try {
      const catalog = await fetchSkillCatalog();
      this.storage.replaceSkillCatalog(catalog);
    } catch {
      // Keep local cached catalog when remote sync is not available.
    }
    try {
      const catalog = await fetchMcpCatalog();
      this.storage.replaceMcpCatalog(catalog);
    } catch {
      // Keep local cached catalog when remote sync is not available.
    }
    this.recoverInterruptedRuns();
    this.emitSnapshot();
  }

  getSnapshot(): AppSnapshot {
    return this.storage.getSnapshot();
  }

  private createAppNotification(
    input: Omit<NotificationRecord, "id" | "read" | "createdAt"> & { createdAt?: number },
    channel: SystemNotificationChannel = null,
  ) {
    const notification = this.storage.createNotification(input);
    this.emit("notification", { notification, channel });
    return notification;
  }

  private getConversationNotificationChannel(conversationId: string): SystemNotificationChannel {
    const conversation = this.storage.getConversation(conversationId);
    if (!conversation) {
      return null;
    }

    return conversation.kind === "agent" ? "agent_message" : "group_message";
  }

  async sendInput(payload: SendInputPayload) {
    const snapshot = this.storage.getSnapshot();
    const conversation = snapshot.conversations.find((item) => item.id === payload.conversationId);
    if (!conversation) {
      return this.getSnapshot();
    }

    this.storage.resetUnread(payload.conversationId);

    const attachments = payload.attachments ?? [];
    const command = parseSlashCommand(payload.input);
    if (command) {
      this.storage.addMessage({
        conversationId: payload.conversationId,
        senderId: "user",
        senderName: "你",
        senderKind: "user",
        messageType: "command",
        visibility: "public",
        content: command.raw,
        mentions: [],
        runId: null,
        metadata: { command: command.name, args: command.args },
        createdAt: Date.now(),
      });
      await this.handleSlashCommand(conversation, command.name, command.args);
      this.storage.resetUnread(payload.conversationId);
      this.emitSnapshot();
      return this.getSnapshot();
    }

    const slashDirectives = this.resolveSlashDirectives(conversation, payload.input);

    this.storage.addMessage({
      conversationId: payload.conversationId,
      senderId: "user",
      senderName: "你",
      senderKind: "user",
      messageType: "user",
      visibility: "public",
      content: buildUserMessageContent(payload.input, attachments),
      mentions: extractAgentMentions(payload.input, snapshot.agents).map((agent) => agent.id),
      runId: null,
      metadata: {
        ...(attachments.length > 0 ? { attachments } : {}),
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
      buildRuntimePrompt(slashDirectives.cleanedInput, attachments),
      slashDirectives,
    );

    if (conversation.kind === "agent") {
      await this.startAgentRun(conversation, runtimeInput, slashDirectives, attachments);
    } else {
      await this.startTeamRun(conversation, runtimeInput, slashDirectives);
    }

    this.emitSnapshot();
    return this.getSnapshot();
  }

  async controlRun(payload: RunControlPayload) {
    const latest = this.storage
      .listRuns()
      .find(
        (run) =>
          run.conversationId === payload.conversationId &&
          !["completed", "failed", "cancelled"].includes(run.status),
      );

    if (!latest) {
      this.addSystemMessage(payload.conversationId, "当前会话没有可控制的任务。");
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
        this.addRunMessage(payload.conversationId, latest.id, "任务已暂停，可稍后继续。", "system");
      } else {
        this.storage.updateRun(latest.id, { status: "pausing" });
        this.addRunMessage(
          payload.conversationId,
          latest.id,
          "已收到暂停请求，将在当前步骤结束后暂停。",
          "system",
        );
      }
    }

    if (payload.action === "resume") {
      if (latest.status !== "paused") {
        return this.getSnapshot();
      }

      this.storage.updateRun(latest.id, { status: "resuming" });
      this.addRunMessage(payload.conversationId, latest.id, "任务正在恢复执行。", "system");
      if (controller) {
        this.scheduleNext(controller, 300);
      }
    }

    if (payload.action === "cancel") {
      if (controller?.timer) clearTimeout(controller.timer);
      if (controller?.childProcess) controller.childProcess.kill("SIGTERM");
      this.activeRuns.delete(latest.id);
      this.storage.updateRun(latest.id, { status: "cancelled" });
      this.storage.cancelPendingRunSteps(latest.id);
      this.addRunMessage(payload.conversationId, latest.id, "任务已取消。", "system");
    }

    this.emitSnapshot();
    return this.getSnapshot();
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

  async updateAgent(payload: UpdateAgentInput) {
    this.storage.updateAgent(payload);
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async toggleExtension(extensionId: string) {
    this.storage.toggleExtension(extensionId);
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async refreshSkillCatalog() {
    const catalog = await fetchSkillCatalog();
    this.storage.replaceSkillCatalog(catalog);
    this.createAppNotification({
      type: "extension",
      title: "Skill catalog 已同步",
      body: `已同步 ${catalog.length} 个 Skill 元数据。`,
      relatedConversationId: null,
      relatedRunId: null,
    });
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async installSkill(skillId: string) {
    const skill = this.storage.getSkillCatalogEntry(skillId);
    if (!skill) {
      this.createAppNotification({
        type: "system",
        title: "Skill 安装失败",
        body: `未找到 Skill：${skillId}`,
        relatedConversationId: null,
        relatedRunId: null,
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
      title: "Skill 已安装",
      body: `${skill.displayName || skill.name} 已安装到全局目录。`,
      relatedConversationId: null,
      relatedRunId: null,
    });
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async removeSkill(skillId: string) {
    const skill = this.storage.getSkillCatalogEntry(skillId);
    if (!skill) {
      this.createAppNotification({
        type: "system",
        title: "Skill 移除失败",
        body: `未找到 Skill：${skillId}`,
        relatedConversationId: null,
        relatedRunId: null,
      });
      this.emitSnapshot();
      return this.getSnapshot();
    }

    if (skill.installPath && isSafeChildPath(this.storage.skillInstallRoot, skill.installPath)) {
      rmSync(skill.installPath, { recursive: true, force: true });
    }

    this.storage.markSkillRemoved(skill.id);
    this.createAppNotification({
      type: "extension",
      title: "Skill 已移除",
      body: `${skill.displayName || skill.name} 已从全局目录移除。`,
      relatedConversationId: null,
      relatedRunId: null,
    });
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async savePromptAlias(payload: SavePromptAliasInput) {
    const promptAlias = this.storage.savePromptAlias(payload);
    this.createAppNotification({
      type: "extension",
      title: "Prompt 已保存",
      body: `/${promptAlias.alias} 已可在聊天中使用。`,
      relatedConversationId: null,
      relatedRunId: null,
    });
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async removePromptAlias(promptAliasId: string) {
    const existing = this.storage.listPromptAliases().find((item) => item.id === promptAliasId);
    this.storage.removePromptAlias(promptAliasId);
    this.createAppNotification({
      type: "extension",
      title: "Prompt 已移除",
      body: existing ? `/${existing.alias} 已从自定义命令中移除。` : "自定义 Prompt 已移除。",
      relatedConversationId: null,
      relatedRunId: null,
    });
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async refreshMcpCatalog() {
    const catalog = await fetchMcpCatalog();
    this.storage.replaceMcpCatalog(catalog);
    this.createAppNotification({
      type: "extension",
      title: "MCP catalog 已同步",
      body: `已同步 ${catalog.length} 个 MCP 元数据。`,
      relatedConversationId: null,
      relatedRunId: null,
    });
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async connectMcp(payload: ConnectMcpInput) {
    const server = this.storage.getMcpCatalogEntry(payload.serverId);
    if (!server) {
      this.createAppNotification({
        type: "system",
        title: "MCP 连接失败",
        body: `未找到 MCP：${payload.serverId}`,
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

    const launcherIssue = validateLocalMcpLauncher({
      ...server,
      launcherCommand: connection.command,
    });
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
        });

    this.storage.upsertMcpConnection(checkedConnection);
    this.createAppNotification({
      type: checkedConnection.status === "connected" ? "extension" : "system",
      title:
        checkedConnection.status === "connected"
          ? "MCP 已连接"
          : checkedConnection.status === "configured"
            ? "MCP 已保存待配置"
            : "MCP 连接失败",
      body:
        checkedConnection.status === "connected"
          ? `${server.name} 已连接成功，并发现 ${checkedConnection.discoveredTools.length} 个工具。`
          : checkedConnection.status === "configured"
            ? getMcpConfiguredHint(server)
            : `${server.name} 连接失败：${checkedConnection.lastError ?? "未知错误"}`,
      relatedConversationId: null,
      relatedRunId: null,
    });
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async checkMcpHealth(serverId: string) {
    const server = this.storage.getMcpCatalogEntry(serverId);
    const connection = this.storage.getMcpConnection(serverId);
    if (!server || !connection) {
      this.createAppNotification({
        type: "system",
        title: "MCP 检测失败",
        body: `未找到 MCP 连接：${serverId}`,
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
    });
    this.storage.upsertMcpConnection(checked);
    this.createAppNotification({
      type: checked.status === "connected" ? "extension" : "system",
      title: checked.status === "connected" ? "MCP 检测通过" : "MCP 检测失败",
      body:
        checked.status === "connected"
          ? `${server.name} 当前可用，已发现 ${checked.discoveredTools.length} 个工具。`
          : `${server.name} 检测失败：${checked.lastError ?? "未知错误"}`,
      relatedConversationId: null,
      relatedRunId: null,
    });
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async disconnectMcp(serverId: string) {
    const server = this.storage.getMcpCatalogEntry(serverId);
    this.storage.removeMcpConnection(serverId);
    this.createAppNotification({
      type: "extension",
      title: "MCP 已移除",
      body: `${server?.name ?? serverId} 已从本地连接列表中移除。`,
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

  async updateTeamMcps(payload: UpdateTeamMcpsInput) {
    this.storage.updateTeamMcpWhitelist(payload);
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

  private createToolInvocationObserver(conversationId: string, runId: string) {
    return async (event: McpInvocationEvent | RuntimeToolInvocationEvent) => {
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
    };
  }

  async markNotificationsRead() {
    this.storage.markNotificationsRead();
    this.emitSnapshot();
    return this.getSnapshot();
  }

  async markConversationRead(conversationId: string) {
    this.storage.resetUnread(conversationId);
    this.emitSnapshot();
    return this.getSnapshot();
  }

  private getAvailableMcpServersForConversation(conversation: ConversationRecord) {
    const pinnedMcp = conversation.meta.pinnedMcp;
    const allowedIds =
      conversation.kind === "agent"
        ? (this.storage.getAgent(conversation.targetId)?.mcpWhitelist ?? [])
        : (this.storage.getTeam(conversation.targetId)?.mcpWhitelist ?? []);

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
    const aliases = extractSlashAliases(input).filter((alias) => !["skills", "mcp"].includes(alias));
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
  ) {
    const snapshot = this.storage.getSnapshot();
    const workspacePath = this.getWorkspaceForConversation(conversation, snapshot.agents, snapshot.teams);
    const target =
      conversation.kind === "agent"
        ? snapshot.agents.find((agent) => agent.id === conversation.targetId)
        : snapshot.teams.find((team) => team.id === conversation.targetId);
    const inputForTemplate = baseInput.trim() || "用户没有补充额外内容，请主动询问需要处理的内容。";
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
        resolved = `${resolved.trim()}\n\n用户输入：\n${inputForTemplate}`;
      }
    }

    if (context.skill) {
      const skillLabel = context.skill.displayName || context.skill.name;
      resolved = `本轮消息临时使用 Skill：${skillLabel}（/${context.skill.slug}）。\n\n${resolved}`;
    }

    return resolved;
  }

  private async handleSlashCommand(
    conversation: ConversationRecord,
    commandName: string,
    args: string[],
  ) {
    if (commandName === "skills") {
      const availableSkills = this.getAvailableSkillsForConversation(conversation);
      const currentMeta = conversation.meta;
      const currentSkillLabel =
        (currentMeta.activeSkill
          ? this.storage.findSkillCatalogEntryByNameOrId(currentMeta.activeSkill)?.displayName
          : null) ?? currentMeta.activeSkill;

      if (args.length === 0) {
        this.addSlashFeedbackMessage(conversation, {
          title: "Skill 会话状态",
          body: `当前激活技能：${currentSkillLabel ?? "默认"}`,
          items: availableSkills.map((skill) => skill.displayName || skill.name),
          emptyText: "当前会话还没有可用 Skill。",
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
          title: "Skill 不可用",
          body: `当前会话不可用 Skill：${selectedSkill || "未指定"}。`,
          tone: "error",
        });
        return;
      }
      const meta = { ...currentMeta, activeSkill: match.id };
      this.storage.updateConversationMeta(conversation.id, meta);
      this.addSlashFeedbackMessage(conversation, {
        title: "Skill 已切换",
        body: `已为当前会话切换技能：${match.displayName || match.name}。后续回复会优先参考该技能。`,
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
          title: "MCP 会话状态",
          body: `当前固定 MCP：${currentMcpLabel ?? "未固定"}`,
          items: availableServers.map((item) => item.name),
          emptyText: "当前会话还没有可用 MCP。",
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
            title: "MCP 不可用",
            body: `当前会话不可用 MCP：${selected || "未指定"}。`,
            tone: "error",
          });
          return;
        }
        this.storage.updateConversationMeta(conversation.id, {
          ...currentMeta,
          pinnedMcp: match.id,
        });
        this.addSlashFeedbackMessage(conversation, {
          title: "MCP 已固定",
          body: `已为当前会话固定 MCP：${match.name}。`,
          items: connection.discoveredTools.map((tool) => tool.name),
          emptyText: "当前没有发现可用工具。",
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
            title: "未找到 MCP",
            body: `未找到 MCP：${selected || "未指定"}。`,
            tone: "error",
          });
          return;
        }
        this.addSlashFeedbackMessage(conversation, {
          title: `${match.name} 工具列表`,
          items:
            connection?.discoveredTools.map((tool) => tool.name) ??
            match.declaredTools,
          emptyText: "当前没有发现可用工具。",
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
          title: "未找到 MCP",
          body: `未找到 MCP：${selected || "未指定"}。`,
          tone: "error",
        });
        return;
      }

      this.addSlashFeedbackMessage(conversation, {
        title: match.name,
        body: `连接状态：${connection?.status ?? "disconnected"}\n协议：${match.transport}`,
        items: [
          `能力：${match.capabilities.join("、") || "暂无"}`,
          `工具：${
            connection?.discoveredTools.map((tool) => tool.name).join("、") ||
            match.declaredTools.join("、") ||
            "暂无"
          }`,
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
  ) {
    const snapshot = this.storage.getSnapshot();
    const agent = snapshot.agents.find((item) => item.id === conversation.targetId);
    if (!agent) return;
    const provider = this.resolveActiveProvider(snapshot);
    const providerIssue = validateProviderForSingleChat(provider);
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
    const activeSkillLabel = activeSkillRecord?.displayName || activeSkillRecord?.name || activeSkill;
    const activeSkillDefinition =
      activeSkillRecord && agent.skillWhitelist.includes(activeSkillRecord.id)
        ? readInstalledSkillDefinition(activeSkillRecord)
        : null;
    const transcriptPaths = this.storage.getConversationTranscriptPaths(conversation.id);
    const runtimeTools = buildRuntimeLangChainTools({
      workspacePath,
      attachmentRoots: this.storage.getConversationAttachmentRoots(conversation.id),
      activeSkill: activeSkillRecord && agent.skillWhitelist.includes(activeSkillRecord.id) ? activeSkillRecord : null,
      onInvocation: this.createToolInvocationObserver(conversation.id, runId),
    });
    const steps: RunStep[] = [
      {
        label: "准备上下文",
        delayMs: 300,
        execute: () => {
          this.addRunMessage(
            conversation.id,
            runId,
            `${agent.name} 正在准备上下文，并将使用 ${provider?.label} / ${provider?.defaultModel} 处理这次请求。`,
            "system",
          );
        },
      },
      {
        label: "检查技能与上下文",
        delayMs: 300,
        execute: () => {
          const skillText = activeSkillLabel ? `当前会话激活技能：${activeSkillLabel}。` : "当前使用默认技能栈。";
          this.addRunMessage(
            conversation.id,
            runId,
            `${agent.name} 已读取上下文。\n${skillText}`,
            "system",
          );
        },
      },
      {
        label: "调用真实模型",
        execute: async () => {
          const response = await invokeSingleChatDeepAgent({
            sessions: this.singleChatSessions,
            conversationId: conversation.id,
            provider: provider!,
            agent,
            profile: snapshot.profile,
            activeSkill: activeSkillLabel,
            activeSkillDefinition,
            mcpServers: availableMcpServers,
            mcpConnections: availableMcpConnections,
            workspacePath,
            history: this.storage.listMessages(conversation.id),
            latestInput: input,
            attachments,
            onMcpInvocation: this.createToolInvocationObserver(conversation.id, runId),
            additionalTools: runtimeTools.tools,
            runtimeToolSummary: runtimeTools.summary,
            onTextStream: async (aggregatedText) => {
              const currentRun = this.storage.getRun(runId);
              if (!currentRun || currentRun.status === "cancelled") return;

              const existingMessageId = currentRun.metadata?.streamMessageId;
              const baseMetadata = {
                skill: activeSkillRecord?.id ?? activeSkill,
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
            "memory/MEMORY.md",
            `- ${this.formatTimestamp()} | 任务：${trimHeadline(input)} | 输出：${trimHeadline(response.text)}`,
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
                  skill: activeSkillRecord?.id ?? activeSkill,
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
              metadata: { skill: activeSkillRecord?.id ?? activeSkill, skillLabel: activeSkillLabel },
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
            `结果已写入产物：${artifactPath}\n记忆文件已更新：${memoryPath}`,
            "system",
          );
          this.createAppNotification(
            {
              type: "agent_message",
              title: `${agent.name} 发来新消息`,
              body: trimHeadline(response.text || "点开查看最新回复。"),
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
      title: `${agent.name} 处理请求`,
      kind: "agent_task",
      actorId: agent.id,
      steps,
    });
  }

  private async startTeamRun(
    conversation: ConversationRecord,
    input: string,
    _slashContext: SlashDirectiveContext,
  ) {
    const snapshot = this.storage.getSnapshot();
    const team = snapshot.teams.find((item) => item.id === conversation.targetId);
    if (!team) return;
    const members = snapshot.agents
      .filter((agent) => team.memberIds.includes(agent.id))
      .slice(0, TEAM_MEMBER_LIMIT);
    if (members.length === 0) {
      this.addSystemMessage(conversation.id, "当前群组还没有可参与的 Agent，请先在管理页添加成员。");
      return;
    }

    const memberIds = new Set(members.map((agent) => agent.id));
    const explicitMentions = extractAgentMentions(input, members)
      .map((agent) => agent.id)
      .filter((id) => memberIds.has(id));
    const provider = this.resolveActiveProvider(snapshot);
    const providerIssue = validateProviderForSingleChat(provider);
    if (providerIssue) {
      this.addSystemMessage(conversation.id, providerIssue);
      return;
    }

    const runId = `run-${nanoid(8)}`;
    let updatedContext: TeamContext = {
      ...team.context,
      activeTasks: Array.from(
        new Set([`${input.slice(0, 24)}${input.length > 24 ? "..." : ""}`, ...team.context.activeTasks]),
      ).slice(0, 5),
    };
    this.storage.updateTeamContext(team.id, updatedContext);
    const workspacePath = team.workspacePath;
    const availableMcpServers = this.getAvailableMcpServersForConversation(conversation);
    const availableMcpConnections = this.getAvailableMcpConnectionsForConversation(conversation);
    const runtimeTools = buildRuntimeLangChainTools({
      workspacePath,
      attachmentRoots: this.storage.getConversationAttachmentRoots(conversation.id),
      activeSkill: null,
      onInvocation: this.createToolInvocationObserver(conversation.id, runId),
    });
    let selection: Awaited<ReturnType<typeof selectNaturalTeamSpeakers>> | null = null;
    let executionPlan: TeamExecutionPlan | null = null;
    const turnMessages: NaturalTeamAgentMessage[] = [];

    const steps: RunStep[] = [
      {
        label: "同步群组上下文",
        delayMs: 300,
        execute: () => {
          this.addRunMessage(
            conversation.id,
            runId,
            `我先看一下这个问题，并叫上合适的成员来回复你。`,
            "system",
          );
        },
      },
      {
        label: "选择发言成员",
        execute: async () => {
          executionPlan = await planTeamExecution({
            provider: provider!,
            profile: snapshot.profile,
            team: {
              ...team,
              context: updatedContext,
            },
            members,
            context: updatedContext,
            history: this.storage.listMessages(conversation.id).map((message) => ({
              senderName: message.senderName,
              visibility: message.visibility,
              content: message.content,
            })),
            userInput: input,
            explicitMentionIds: explicitMentions,
            mcpServers: availableMcpServers,
          });

          if (executionPlan) {
            updatedContext = {
              ...updatedContext,
              phase: executionPlan.nextPhase || "执行中",
              activeTasks: executionPlan.activeTask
                ? Array.from(new Set([executionPlan.activeTask, ...updatedContext.activeTasks])).slice(0, 5)
                : updatedContext.activeTasks,
              recentDecisions: executionPlan.decision
                ? Array.from(new Set([executionPlan.decision, ...updatedContext.recentDecisions])).slice(0, 5)
                : updatedContext.recentDecisions,
            };
            this.storage.updateTeamContext(team.id, updatedContext);
            for (const item of executionPlan.workItems) {
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
                },
                createdAt: Date.now(),
              });
            }
            return;
          }

          selection = await selectNaturalTeamSpeakers({
            provider: provider!,
            profile: snapshot.profile,
            team: {
              ...team,
              context: updatedContext,
            },
            members,
            context: updatedContext,
            history: this.storage.listMessages(conversation.id).map((message) => ({
              senderName: message.senderName,
              visibility: message.visibility,
              content: message.content,
            })),
            userInput: input,
            explicitMentionIds: explicitMentions,
            mcpServers: availableMcpServers,
          });

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
          this.storage.updateTeamContext(team.id, updatedContext);

        },
      },
      {
        label: "Agent 自然发言",
        execute: async () => {
          if (executionPlan && executionPlan.workItems.length > 0) {
            const batches = buildExecutionBatches(executionPlan.workItems);
            const completedOutputs: string[] = [];

            for (const batch of batches) {
              if (batch.length > 1) {
                this.storage.addMessage({
                  conversationId: conversation.id,
                  senderId: team.id,
                  senderName: team.name,
                  senderKind: "agent",
                  messageType: "agent",
                  visibility: "public",
                  content: `这一步先由 ${batch.map((item) => item.owner.name).join("、")} 并行处理，完成后我再继续推进。`,
                  mentions: [],
                  runId,
                  metadata: {
                    teamId: team.id,
                    execution: true,
                    batch: true,
                    batchSize: batch.length,
                  },
                  createdAt: Date.now(),
                });
              }

              const results = await Promise.all(
                batch.map(async (item) => {
                  try {
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
                      workspacePath,
                      conversationId: conversation.id,
                      runId,
                      previousOutputs: completedOutputs,
                      mcpServers: availableMcpServers,
                      mcpConnections: availableMcpConnections,
                      onMcpInvocation: this.createToolInvocationObserver(conversation.id, runId),
                      additionalTools: runtimeTools.tools,
                    });
                    return { item, ok: true as const, content };
                  } catch (error) {
                    return {
                      item,
                      ok: false as const,
                      content:
                        error instanceof Error
                          ? `${item.owner.name}：我执行这个任务时遇到了问题：${error.message}`
                          : `${item.owner.name}：我执行这个任务时遇到了未知问题。`,
                    };
                  }
                }),
              );

              for (const result of results) {
                completedOutputs.push(result.content);
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
            }

            const lastContent = completedOutputs.at(-1) ?? `${team.name} 已完成本轮执行。`;
            this.createAppNotification(
              {
                type: "group_message",
                title: `${team.name} 有新消息`,
                body: trimHeadline(lastContent),
                relatedConversationId: conversation.id,
                relatedRunId: runId,
              },
              "group_message",
            );
            return;
          }

          if (!selection || selection.speakers.length === 0) {
            return;
          }

          const speakerMessageCounts = new Map<string, number>();
          let speakers = selection.speakers;
          for (let roundIndex = 0; roundIndex < MAX_TEAM_SUBROUNDS; roundIndex += 1) {
            if (turnMessages.length >= MAX_TEAM_TURN_MESSAGES || speakers.length === 0) {
              break;
            }

            const roundMessages: NaturalTeamAgentMessage[] = [];
            for (const speaker of speakers) {
              if (turnMessages.length >= MAX_TEAM_TURN_MESSAGES) {
                break;
              }
              if ((speakerMessageCounts.get(speaker.id) ?? 0) >= MAX_AGENT_MESSAGES_PER_TURN) {
                continue;
              }
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
                roundIndex,
                previousTurnMessages: turnMessages,
              workspacePath,
              conversationId: conversation.id,
              runId,
                isFinalSpeaker:
                  turnMessages.length >= MAX_TEAM_TURN_MESSAGES - 1 ||
                  speaker.id === speakers.at(-1)?.id,
              mcpServers: availableMcpServers,
              mcpConnections: availableMcpConnections,
              onMcpInvocation: this.createToolInvocationObserver(conversation.id, runId),
              additionalTools: runtimeTools.tools,
            });
              if (!message) {
                continue;
              }
              speakerMessageCounts.set(speaker.id, (speakerMessageCounts.get(speaker.id) ?? 0) + 1);
              turnMessages.push(message);
              roundMessages.push(message);
            this.storage.addMessage({
              conversationId: conversation.id,
                senderId: message.speaker.id,
                senderName: message.speaker.name,
              senderKind: "agent",
                messageType: message.kind === "question" ? "notification" : "agent",
                visibility: "public",
                content: message.content,
                mentions: message.mentions,
              runId,
              metadata: {
                teamId: team.id,
                  mode: selection.mode,
                  roundIndex: message.roundIndex,
                  kind: message.kind,
              },
              createdAt: Date.now(),
            });
          }

            if (roundIndex >= MAX_TEAM_SUBROUNDS - 1) {
              break;
            }
            const nextIds = Array.from(new Set(roundMessages.flatMap((message) => message.mentions)))
              .filter((id) => memberIds.has(id) && (speakerMessageCounts.get(id) ?? 0) < MAX_AGENT_MESSAGES_PER_TURN)
              .slice(0, TEAM_MEMBER_LIMIT);
            if (nextIds.length === 0) {
              break;
            }
            speakers = nextIds
              .map((id) => members.find((agent) => agent.id === id))
              .filter((agent): agent is AgentRecord => agent !== undefined);
          }

          if (turnMessages.length === 0) {
            const fallbackSpeaker = selection.speakers[0] ?? members[0];
            const fallbackContent = `${fallbackSpeaker.name}：我已经收到这条消息，但还需要更多信息才能给出有价值的判断。你可以补充目标、约束或期望输出。`;
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
            lastMessage?.content.replace(/^@你\s*/, "") || `${team.name} 中有新的回复。`,
          );

          this.createAppNotification(
            {
              type: hasMention ? "mention" : "group_message",
              title: hasMention
                ? `${lastMessage?.speaker.name ?? team.name} 在 ${team.name} 中 @ 了你`
                : `${team.name} 有新消息`,
              body: notificationBody,
              relatedConversationId: conversation.id,
              relatedRunId: runId,
            },
            hasMention ? "mention" : "group_message",
          );
        },
      },
      {
        label: "更新群组记忆",
        execute: () => {
          const activeSpeakers =
            executionPlan?.workItems.map((item) => item.owner.name) ??
            turnMessages.map((message) => message.speaker.name);
          const finalLine =
            executionPlan && turnMessages.length === 0
              ? executionPlan.workItems.map((item) => item.summary).join("；")
              : turnMessages.at(-1)?.content ?? "";
          const sharedMemoryPath = this.appendMemory(
            workspacePath,
            "shared-memory.md",
            `- ${this.formatTimestamp()} | 话题：${trimHeadline(input)} | 发言：${activeSpeakers.join("、") || "无"} | 结论：${trimHeadline(finalLine)}`,
          );
          this.addRunMessage(
            conversation.id,
            runId,
            `共享记忆已更新：${sharedMemoryPath}`,
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
      title: `${team.name} 群聊发言`,
      kind: "team_task",
      actorId: members[0]?.id ?? "system",
      steps,
    });
  }

  private async startShellCommandRun(conversation: ConversationRecord, shellCommand: string) {
    const snapshot = this.storage.getSnapshot();
    const workspacePath = this.getWorkspaceForConversation(conversation, snapshot.agents, snapshot.teams);
    const actorId =
      conversation.kind === "agent"
        ? conversation.targetId
        : chooseTeamRepresentative(snapshot.teams.find((item) => item.id === conversation.targetId)!, snapshot.agents)?.id ??
          "system";

    const runId = `run-${nanoid(8)}`;
    const steps: RunStep[] = [
      {
        label: "准备命令",
        delayMs: 300,
        execute: () => {
          this.addRunMessage(
            conversation.id,
            runId,
            `准备在 workspace 执行命令：${shellCommand}`,
            "system",
          );
        },
      },
      {
        label: "执行命令",
        execute: async () => {
          const artifactPath = await this.executeShellCommand(
            runId,
            conversation.id,
            shellCommand,
            workspacePath,
          );
          this.addRunMessage(
            conversation.id,
            runId,
            `命令结果已写入产物：${artifactPath}`,
            "system",
          );
        },
      },
      {
        label: "整理结果",
        delayMs: 300,
        execute: () => {
          this.addRunMessage(
            conversation.id,
            runId,
            "命令执行完成，结果已经回写到会话中。",
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
    });
  }

  private beginRun(input: {
    runId: string;
    conversationId: string;
    title: string;
    kind: RunRecord["kind"];
    actorId: string;
    steps: RunStep[];
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
    this.addRunMessage(input.conversationId, input.runId, `已开始任务：${input.title}`, "system");
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

    if (["paused", "cancelled", "completed", "failed"].includes(run.status)) {
      return;
    }

    if (run.status === "resuming") {
      this.storage.updateRun(runId, { status: "running" });
    }

    if (run.status === "pausing") {
      this.storage.updateRun(runId, { status: "paused" });
      this.addRunMessage(run.conversationId, runId, "任务已暂停。", "system");
      this.emitSnapshot();
      return;
    }

    const step = controller.steps[run.stepIndex];
    if (!step) {
      this.storage.updateRun(runId, { status: "completed" });
      this.addRunMessage(run.conversationId, runId, "任务已完成。", "system");
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
        this.addRunMessage(latest.conversationId, runId, "任务已暂停。", "system");
        this.emitSnapshot();
        return;
      }

      this.scheduleNext(controller, step.delayMs ?? 900);
    } catch (error) {
      controller.busy = false;
      this.storage.updateRunStep(runId, run.stepIndex, {
        status: "failed",
        completedAt: Date.now(),
        errorText: error instanceof Error ? error.message : String(error),
      });
      this.storage.cancelPendingRunSteps(runId);
      this.storage.updateRun(runId, {
        status: "failed",
        metadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      this.addRunMessage(
        run.conversationId,
        runId,
        `任务执行失败：${error instanceof Error ? error.message : String(error)}`,
        "system",
      );
      const notificationChannel = this.getConversationNotificationChannel(run.conversationId);
      const conversation = this.storage.getConversation(run.conversationId);
      this.createAppNotification(
        {
          type: "run_failed",
          title:
            conversation?.kind === "agent"
              ? `${conversation.title} 回复失败`
              : conversation?.kind === "team"
                ? `${conversation.title} 协作失败`
                : "任务执行失败",
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
  ): Promise<string> {
    await sleep(300);
    const artifactPath = this.getArtifactPath(workspacePath, `command-${runId}.md`);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(shellCommand, {
        cwd: workspacePath,
        shell: true,
        env: process.env,
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
        const normalizedStdout = trimOutput(stdout || "命令没有输出。");
        const normalizedStderr = trimOutput(stderr);
        this.writeTextFile(
          artifactPath,
          `# 命令执行结果\n\n- 命令：\`${shellCommand}\`\n- 工作目录：\`${workspacePath}\`\n- 退出码：${code ?? 0}\n\n## 标准输出\n\n\`\`\`\n${normalizedStdout}\n\`\`\`\n${normalizedStderr ? `\n## 标准错误\n\n\`\`\`\n${normalizedStderr}\n\`\`\`\n` : ""}`,
        );
        this.storage.recordArtifact({
          conversationId,
          runId,
          artifactKind: "command_output",
          title: `命令执行结果：${shellCommand}`,
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
          content: `命令：${shellCommand}\n工作目录：${workspacePath}\n退出码：${code ?? 0}\n\n输出：\n${normalizedStdout}${
            normalizedStderr ? `\n\n错误输出：\n${normalizedStderr}` : ""
          }`,
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
          reject(new Error(`命令退出码为 ${code ?? 1}`));
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
      metadata: null,
      createdAt: Date.now(),
    });
  }

  private getArtifactDir(workspacePath: string) {
    return join(workspacePath, "artifacts");
  }

  private getArtifactPath(workspacePath: string, fileName: string) {
    return join(this.getArtifactDir(workspacePath), fileName);
  }

  private ensureWorkspaceFolders(workspacePath: string) {
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(this.getArtifactDir(workspacePath), { recursive: true });
    mkdirSync(join(workspacePath, "memory"), { recursive: true });
    mkdirSync(join(workspacePath, "sessions"), { recursive: true });
  }

  private writeTextFile(filePath: string, content: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  }

  private appendMemory(workspacePath: string, relativePath: string, line: string) {
    this.ensureWorkspaceFolders(workspacePath);
    const filePath = join(workspacePath, relativePath);
    const title = relativePath.split("/").at(-1)?.replace(/\.md$/i, "") ?? "memory";
    const header = existsSync(filePath) ? "" : `# ${title}\n\n`;
    if (header) {
      this.writeTextFile(filePath, header);
    }
    appendFileSync(filePath, `${line}\n`, "utf8");
    return filePath;
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
          "应用重新启动后，任务已恢复为暂停状态。",
          "system",
        );
      }
    }
  }

  private emitSnapshot() {
    this.emit("snapshot", this.getSnapshot());
  }
}

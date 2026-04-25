import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { nanoid } from "nanoid";
import {
  defaultConversationMeta,
  defaultConnectedMcpIds,
  defaultExtensions,
  defaultMcpCatalog,
  defaultProfile,
  defaultProviders,
  defaultSettings,
  defaultSkillCatalog,
  defaultTeamContext,
} from "@teamaligned/shared";
import type {
  AgentRecord,
  AttachmentAssetRecord,
  ArtifactRecord,
  AppSettings,
  AppSnapshot,
  ConversationMeta,
  ConversationRecord,
  CreateAgentInput,
  CreateTeamInput,
  DashboardStats,
  EnsureConversationInput,
  ExtensionRecord,
  McpCatalogRecord,
  McpConnectionRecord,
  MessageRecord,
  NotificationRecord,
  PromptAliasRecord,
  ProviderConfig,
  RunRecord,
  SavePromptAliasInput,
  RunStepRecord,
  SkillCatalogRecord,
  TeamContext,
  TeamRecord,
  ToolInvocationRecord,
  UpdateAgentInput,
  UpdateAgentSkillsInput,
  UpdateTeamInput,
  UpdateProfileInput,
  UpdateProviderInput,
  UpdateSettingsInput,
  UserProfile,
} from "@teamaligned/shared";

type PersistedState = {
  settingsEntries: Record<string, string>;
  providers: ProviderConfig[];
  agents: AgentRecord[];
  teams: TeamRecord[];
  conversations: ConversationRecord[];
  messages: MessageRecord[];
  runs: RunRecord[];
  attachments: StoredAttachmentRecord[];
  artifacts: StoredArtifactRecord[];
  toolInvocations: StoredToolInvocationRecord[];
  runSteps: StoredRunStepRecord[];
  notifications: NotificationRecord[];
  extensions: ExtensionRecord[];
  promptAliases: PromptAliasRecord[];
  skillCatalog: SkillCatalogRecord[];
  mcpCatalog: McpCatalogRecord[];
  mcpConnections: McpConnectionRecord[];
};

type WorkspaceLayout = {
  workspacePath: string;
  artifactsPath: string;
  attachmentsPath: string;
  memoryPath: string;
  sessionsPath: string;
  memoryFilePath: string;
  sharedMemoryPath: string;
};

type SettingsFilePayload = {
  theme?: AppSettings["theme"];
  language?: AppSettings["language"];
  notifications?: {
    agentComplete?: boolean;
    mention?: boolean;
    group?: boolean;
  };
  activeProviderId?: AppSettings["activeProviderId"];
  providers?: ProviderConfig[];
  profile?: Partial<UserProfile>;
};

type StoredAttachmentRecord = AttachmentAssetRecord & {
  id: string;
  conversationId: string;
  messageId: string | null;
  runId: string | null;
  createdAt: number;
};

type StoredArtifactRecord = ArtifactRecord;

type StoredToolInvocationRecord = ToolInvocationRecord;

type StoredRunStepRecord = RunStepRecord;

type ClearConversationHistoryResult = {
  removedMessages: number;
  removedRuns: number;
  removedAttachments: number;
  removedArtifacts: number;
  removedToolInvocations: number;
  removedRunSteps: number;
  removedNotifications: number;
};

function now() {
  return Date.now();
}

function sqliteNullable<T>(value: T | null | undefined) {
  return value ?? null;
}

function normalizePromptAlias(value: string) {
  const normalized = value.trim().replace(/^\/+/, "").toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,47}$/.test(normalized) ? normalized : "";
}

const agentPalette = ["#7c3aed", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#3b82f6"];
const teamPalette = ["#7c3aed", "#0ea5e9", "#14b8a6", "#8b5cf6"];
const teamMemberLimit = 5;
const starterSeedVersionKey = "system.starterSeedVersion";
const starterSeedVersion = "2026-04-starter-v1";

export class AppStorage {
  readonly rootDir: string;
  readonly configPath: string;
  readonly dbPath: string;
  readonly workspaceRoot: string;
  readonly agentWorkspaceRoot: string;
  readonly teamWorkspaceRoot: string;
  readonly skillInstallRoot: string;
  readonly transcriptRoot: string;
  readonly avatarsRoot: string;
  readonly profileAvatarRoot: string;
  readonly agentAvatarRoot: string;
  readonly teamAvatarRoot: string;
  private readonly db: DatabaseSync;
  private state: PersistedState;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.configPath = join(rootDir, "settings.json");
    this.dbPath = join(rootDir, "app.db");
    this.workspaceRoot = join(rootDir, "workspaces");
    this.agentWorkspaceRoot = join(this.workspaceRoot, "agents");
    this.teamWorkspaceRoot = join(this.workspaceRoot, "teams");
    this.skillInstallRoot = join(rootDir, "skills");
    this.transcriptRoot = join(rootDir, "transcripts");
    this.avatarsRoot = join(rootDir, "avatars");
    this.profileAvatarRoot = join(this.avatarsRoot, "profile");
    this.agentAvatarRoot = join(this.avatarsRoot, "agents");
    this.teamAvatarRoot = join(this.avatarsRoot, "teams");

    mkdirSync(rootDir, { recursive: true });
    mkdirSync(this.workspaceRoot, { recursive: true });
    mkdirSync(this.agentWorkspaceRoot, { recursive: true });
    mkdirSync(this.teamWorkspaceRoot, { recursive: true });
    mkdirSync(this.skillInstallRoot, { recursive: true });
    mkdirSync(this.transcriptRoot, { recursive: true });
    mkdirSync(this.avatarsRoot, { recursive: true });
    mkdirSync(this.profileAvatarRoot, { recursive: true });
    mkdirSync(this.agentAvatarRoot, { recursive: true });
    mkdirSync(this.teamAvatarRoot, { recursive: true });

    this.db = new DatabaseSync(this.dbPath);
    this.setupSchema();
    this.state = this.createEmptyState();
  }

  init() {
    if (this.databaseHasData()) {
      this.loadState();
      this.ensureWorkspaceLayouts();
      const seededStarter = this.ensureStarterWorkspaceIfNeeded();
      if (seededStarter) {
        this.persist();
      }
      return;
    }

    this.seedIfEmpty(this.readSettingsFile());
  }

  getSnapshot(): AppSnapshot {
    const agents = this.listAgents();
    const teams = this.listTeams();
    const conversations = this.listConversations();
    const messages = Object.fromEntries(
      conversations.map((conversation) => [conversation.id, this.listMessages(conversation.id)]),
    );

    return {
      profile: this.getProfile(),
      settings: this.getSettings(),
      providers: this.listProviders(),
      agents,
      teams,
      conversations,
      messages,
      runs: this.listRuns(),
      attachments: [...this.state.attachments].sort((a, b) => a.createdAt - b.createdAt),
      artifacts: [...this.state.artifacts].sort((a, b) => b.createdAt - a.createdAt),
      toolInvocations: [...this.state.toolInvocations].sort((a, b) => a.createdAt - b.createdAt),
      runSteps: [...this.state.runSteps].sort((a, b) =>
        a.runId === b.runId ? a.stepIndex - b.stepIndex : a.runId.localeCompare(b.runId, "en")
      ),
      notifications: this.listNotifications(),
      extensions: this.listExtensions(),
      promptAliases: this.listPromptAliases(),
      skillCatalog: this.listSkillCatalog(),
      mcpCatalog: this.listMcpCatalog(),
      mcpConnections: this.listMcpConnections(),
      stats: this.getStats(agents, teams, messages),
    };
  }

  getProfile(): UserProfile {
    return {
      name: this.state.settingsEntries["profile.name"] ?? defaultProfile.name,
      role: this.state.settingsEntries["profile.role"] ?? defaultProfile.role,
      team: this.state.settingsEntries["profile.team"] ?? defaultProfile.team,
      email: this.state.settingsEntries["profile.email"] ?? defaultProfile.email,
      bio: this.state.settingsEntries["profile.bio"] ?? defaultProfile.bio,
      avatarPath:
        this.state.settingsEntries["profile.avatarPath"] === undefined
          ? defaultProfile.avatarPath
          : this.state.settingsEntries["profile.avatarPath"] === "null"
            ? null
            : this.state.settingsEntries["profile.avatarPath"],
    };
  }

  setProfile(input: UpdateProfileInput) {
    const merged = { ...this.getProfile(), ...input };
    this.state.settingsEntries["profile.name"] = merged.name;
    this.state.settingsEntries["profile.role"] = merged.role;
    this.state.settingsEntries["profile.team"] = merged.team;
    this.state.settingsEntries["profile.email"] = merged.email;
    this.state.settingsEntries["profile.bio"] = merged.bio;
    this.state.settingsEntries["profile.avatarPath"] = merged.avatarPath ?? "null";
    this.persist();
  }

  getSettings(): AppSettings {
    return {
      theme: (this.state.settingsEntries["settings.theme"] as AppSettings["theme"]) ?? defaultSettings.theme,
      language:
        (this.state.settingsEntries["settings.language"] as AppSettings["language"]) ??
        defaultSettings.language,
      notifyAgentComplete:
        this.state.settingsEntries["settings.notifyAgentComplete"] === undefined
          ? defaultSettings.notifyAgentComplete
          : this.state.settingsEntries["settings.notifyAgentComplete"] === "true",
      notifyMention:
        this.state.settingsEntries["settings.notifyMention"] === undefined
          ? defaultSettings.notifyMention
          : this.state.settingsEntries["settings.notifyMention"] === "true",
      notifyGroup:
        this.state.settingsEntries["settings.notifyGroup"] === undefined
          ? defaultSettings.notifyGroup
          : this.state.settingsEntries["settings.notifyGroup"] === "true",
      activeProviderId:
        (this.state.settingsEntries["settings.activeProviderId"] as AppSettings["activeProviderId"]) ??
        defaultSettings.activeProviderId,
    };
  }

  setSettings(input: UpdateSettingsInput) {
    const merged = { ...this.getSettings(), ...input };
    this.state.settingsEntries["settings.theme"] = merged.theme;
    this.state.settingsEntries["settings.language"] = merged.language;
    this.state.settingsEntries["settings.notifyAgentComplete"] = String(merged.notifyAgentComplete);
    this.state.settingsEntries["settings.notifyMention"] = String(merged.notifyMention);
    this.state.settingsEntries["settings.notifyGroup"] = String(merged.notifyGroup);
    this.state.settingsEntries["settings.activeProviderId"] = merged.activeProviderId;
    this.persist();
  }

  listProviders(): ProviderConfig[] {
    return [...this.state.providers];
  }

  updateProvider(input: UpdateProviderInput) {
    this.state.providers = this.state.providers.map((provider) => {
      if (provider.id === input.id) {
        return {
          ...provider,
          ...input,
          isActive: input.isActive ?? provider.isActive,
        };
      }

      if (input.isActive) {
        return { ...provider, isActive: false };
      }

      return provider;
    });

    if (input.isActive) {
      this.setSettings({ activeProviderId: input.id });
    } else {
      this.persist();
    }
  }

  listAgents(): AgentRecord[] {
    return [...this.state.agents].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
  }

  getAgent(agentId: string) {
    return this.state.agents.find((agent) => agent.id === agentId) ?? null;
  }

  createAgent(input: CreateAgentInput): AgentRecord {
    const id = `agent-${nanoid(6)}`;
    const workspacePath = input.workspacePath || join(this.agentWorkspaceRoot, id);
    this.ensureWorkspaceLayout(workspacePath, {
      type: "agent",
      title: input.name,
      summary: input.description,
    });

    const agent: AgentRecord = {
      id,
      name: input.name,
      role: input.role,
      avatar: input.name.slice(0, 1).toUpperCase() || "A",
      avatarPath: input.avatarPath ?? null,
      avatarColor: agentPalette[this.state.agents.length % agentPalette.length],
      status: "online",
      description: input.description,
      capabilities: input.capabilities,
      skillWhitelist: this.listSkillCatalog()
        .filter((skill) => skill.installed)
        .map((skill) => skill.id),
      mcpWhitelist: this.listMcpConnections()
        .filter((connection) => connection.enabled && connection.status === "connected")
        .map((connection) => connection.serverId),
      workspacePath,
      modelId: this.getSettings().activeProviderId === "openai" ? "gpt-5" : "qwen-max",
    };

    this.state.agents.push(agent);
    this.state.conversations.push({
      id: `conv-${agent.id}`,
      kind: "agent",
      targetId: agent.id,
      title: agent.name,
      unread: 0,
      lastMessage: "刚创建的 Agent，开始和它对话吧。",
      lastActivityAt: now(),
      meta: { ...defaultConversationMeta },
    });
    this.persist();
    return agent;
  }

  listTeams(): TeamRecord[] {
    return [...this.state.teams].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
  }

  getTeam(teamId: string) {
    return this.state.teams.find((team) => team.id === teamId) ?? null;
  }

  createTeam(input: CreateTeamInput): TeamRecord {
    const id = `team-${nanoid(6)}`;
    const memberIds = Array.from(new Set(input.memberIds)).slice(0, teamMemberLimit);
    const workspacePath = input.workspacePath || join(this.teamWorkspaceRoot, id);
    this.ensureWorkspaceLayout(workspacePath, {
      type: "team",
      title: input.name,
      summary: input.description,
    });

    const team: TeamRecord = {
      id,
      name: input.name,
      description: input.description,
      avatar: input.name.slice(0, 1),
      avatarPath: input.avatarPath ?? null,
      avatarColor: teamPalette[this.state.teams.length % teamPalette.length],
      workspacePath,
      memberIds,
      context: defaultTeamContext(),
    };

    this.state.teams.push(team);
    this.state.conversations.push({
      id: `conv-${team.id}`,
      kind: "team",
      targetId: team.id,
      title: team.name,
      unread: 0,
      lastMessage: "群组已创建，现在可以开始团队协作。",
      lastActivityAt: now(),
      meta: { ...defaultConversationMeta },
    });
    this.persist();
    return team;
  }

  deleteAgent(agentId: string) {
    const agent = this.getAgent(agentId);
    if (!agent) return false;

    const conversationId = `conv-${agent.id}`;
    const teamConversationIds = this.state.teams
      .filter((team) => team.memberIds.includes(agent.id))
      .map((team) => `conv-${team.id}`);
    const blockedConversationIds = new Set([conversationId, ...teamConversationIds]);
    const hasActiveRun = this.state.runs.some(
      (run) =>
        blockedConversationIds.has(run.conversationId) &&
        !["completed", "failed", "cancelled"].includes(run.status),
    );
    if (hasActiveRun) {
      throw new Error("当前 Agent 或所在群组还有运行中的任务，请先取消后再删除。");
    }

    this.clearConversationHistory(conversationId);
    this.state.agents = this.state.agents.filter((item) => item.id !== agent.id);
    this.state.conversations = this.state.conversations.filter((conversation) => conversation.id !== conversationId);

    for (const team of this.state.teams) {
      if (!team.memberIds.includes(agent.id)) continue;
      team.memberIds = team.memberIds.filter((memberId) => memberId !== agent.id);
      if (!team.context.handoff) continue;
      team.context.handoff = {
        ...team.context.handoff,
        activeAgentId: team.context.handoff.activeAgentId === agent.id ? null : team.context.handoff.activeAgentId,
        lastSpeakerId: team.context.handoff.lastSpeakerId === agent.id ? null : team.context.handoff.lastSpeakerId,
        nextAgentIds: team.context.handoff.nextAgentIds.filter((memberId) => memberId !== agent.id),
        revision: team.context.handoff.revision + 1,
        updatedAt: now(),
      };
    }

    this.persist();
    return true;
  }

  deleteTeam(teamId: string) {
    const team = this.getTeam(teamId);
    if (!team) return false;

    const conversationId = `conv-${team.id}`;
    const hasActiveRun = this.state.runs.some(
      (run) =>
        run.conversationId === conversationId &&
        !["completed", "failed", "cancelled"].includes(run.status),
    );
    if (hasActiveRun) {
      throw new Error("当前群组还有运行中的任务，请先取消后再删除。");
    }

    this.clearConversationHistory(conversationId);
    this.state.teams = this.state.teams.filter((item) => item.id !== team.id);
    this.state.conversations = this.state.conversations.filter((conversation) => conversation.id !== conversationId);
    this.persist();
    return true;
  }

  deleteConversation(conversationId: string) {
    const conversation = this.getConversation(conversationId);
    if (!conversation) return false;

    const hasActiveRun = this.state.runs.some(
      (run) =>
        run.conversationId === conversationId &&
        !["completed", "failed", "cancelled"].includes(run.status),
    );
    if (hasActiveRun) {
      throw new Error("当前会话还有运行中的任务，请先取消后再删除。");
    }

    this.clearConversationHistory(conversationId);
    this.state.conversations = this.state.conversations.filter((item) => item.id !== conversationId);
    this.persist();
    return true;
  }

  ensureConversation(input: EnsureConversationInput): ConversationRecord {
    const existing = this.state.conversations.find(
      (conversation) => conversation.kind === input.kind && conversation.targetId === input.targetId,
    );
    if (existing) return existing;

    const target = input.kind === "agent" ? this.getAgent(input.targetId) : this.getTeam(input.targetId);
    if (!target) {
      throw new Error(input.kind === "agent" ? "未找到对应 Agent。" : "未找到对应群组。");
    }

    const language = this.getSettings().language;
    const conversation: ConversationRecord = {
      id: `conv-${target.id}`,
      kind: input.kind,
      targetId: target.id,
      title: target.name,
      unread: 0,
      lastMessage:
        language === "en"
          ? "New conversation. Start chatting when you are ready."
          : "新的会话，准备好就开始对话吧。",
      lastActivityAt: now(),
      meta: { ...defaultConversationMeta },
    };
    this.state.conversations.push(conversation);
    this.persist();
    return conversation;
  }

  updateAgent(input: UpdateAgentInput) {
    const agent = this.getAgent(input.agentId);
    if (!agent) return;

    const nextWorkspacePath = input.workspacePath || agent.workspacePath;
    this.ensureWorkspaceLayout(nextWorkspacePath, {
      type: "agent",
      title: input.name,
      summary: input.description,
    });

    agent.name = input.name;
    agent.role = input.role;
    agent.description = input.description;
    agent.capabilities = input.capabilities;
    agent.workspacePath = nextWorkspacePath;
    agent.avatarPath = input.avatarPath ?? null;
    agent.avatar = input.name.slice(0, 1).toUpperCase() || "A";

    const conversation = this.getConversation(`conv-${agent.id}`);
    if (conversation) {
      conversation.title = agent.name;
      conversation.lastActivityAt = now();
    }

    this.persist();
  }

  updateTeam(input: UpdateTeamInput) {
    const team = this.getTeam(input.teamId);
    if (!team) return;

    const nextWorkspacePath = input.workspacePath || team.workspacePath;
    this.ensureWorkspaceLayout(nextWorkspacePath, {
      type: "team",
      title: input.name,
      summary: input.description,
    });

    team.name = input.name;
    team.description = input.description;
    team.memberIds = Array.from(new Set(input.memberIds)).slice(0, teamMemberLimit);
    team.workspacePath = nextWorkspacePath;
    team.avatarPath = input.avatarPath ?? null;
    team.avatar = input.name.slice(0, 1) || "G";
    team.context = {
      ...team.context,
      handoff: team.context.handoff
        ? {
            ...team.context.handoff,
            activeAgentId: team.memberIds.includes(team.context.handoff.activeAgentId ?? "")
              ? team.context.handoff.activeAgentId
              : null,
            lastSpeakerId: team.memberIds.includes(team.context.handoff.lastSpeakerId ?? "")
              ? team.context.handoff.lastSpeakerId
              : null,
            nextAgentIds: team.context.handoff.nextAgentIds.filter((agentId) => team.memberIds.includes(agentId)),
            revision: team.context.handoff.revision + 1,
            updatedAt: now(),
          }
        : team.context.handoff,
    };

    const conversation = this.getConversation(`conv-${team.id}`);
    if (conversation) {
      conversation.title = team.name;
      conversation.lastActivityAt = now();
    }

    this.persist();
  }

  listConversations(): ConversationRecord[] {
    return [...this.state.conversations].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }

  getConversation(conversationId: string) {
    return this.state.conversations.find((conversation) => conversation.id === conversationId) ?? null;
  }

  updateConversationMeta(conversationId: string, meta: ConversationMeta) {
    const conversation = this.getConversation(conversationId);
    if (!conversation) return;
    conversation.meta = meta;
    this.persist();
  }

  touchConversation(conversationId: string, lastMessage: string, incrementUnread = false) {
    const conversation = this.getConversation(conversationId);
    if (!conversation) return;
    conversation.lastMessage = lastMessage;
    conversation.lastActivityAt = now();
    if (incrementUnread) {
      conversation.unread += 1;
    }
    this.persist();
  }

  listMessages(conversationId: string): MessageRecord[] {
    return this.state.messages
      .filter((message) => message.conversationId === conversationId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  private shouldUseMessageAsConversationPreview(message: MessageRecord) {
    if (message.visibility !== "public") {
      return false;
    }

    if (message.senderKind === "system") {
      return false;
    }

    if (message.messageType === "run") {
      return false;
    }

    return true;
  }

  private summarizeConversationMessage(message: MessageRecord) {
    return message.content.replace(/\n+/g, " ").trim().slice(0, 120);
  }

  private updateConversationPreview(conversationId: string) {
    const conversation = this.getConversation(conversationId);
    if (!conversation) return;

    const previewMessage = [...this.listMessages(conversationId)]
      .reverse()
      .find((message) => this.shouldUseMessageAsConversationPreview(message));

    if (previewMessage) {
      conversation.lastMessage = this.summarizeConversationMessage(previewMessage);
    }
  }

  addMessage(input: Omit<MessageRecord, "id"> & { id?: string }, options?: { skipTranscript?: boolean }) {
    const message: MessageRecord = {
      ...input,
      id: input.id ?? nanoid(),
    };

    this.state.messages.push(message);
    const conversation = this.getConversation(input.conversationId);
    if (conversation) {
      conversation.lastActivityAt = now();
      if (this.shouldUseMessageAsConversationPreview(message)) {
        conversation.lastMessage = this.summarizeConversationMessage(message);
      }
      if (input.senderKind !== "user" && input.visibility === "public") {
        conversation.unread += 1;
      }
    }
    this.recordMessageAttachments(message);
    this.persist();
    if (!options?.skipTranscript) {
      this.appendTranscript(message);
    }
    return message;
  }

  updateMessage(
    messageId: string,
    patch: Partial<Pick<MessageRecord, "content" | "metadata" | "mentions" | "visibility" | "messageType">>,
    options?: { appendTranscript?: boolean },
  ) {
    const message = this.state.messages.find((item) => item.id === messageId);
    if (!message) return null;
    Object.assign(message, patch);
    this.recordMessageAttachments(message);

    const conversation = this.getConversation(message.conversationId);
    if (conversation) {
      const latest = this.listMessages(message.conversationId).at(-1);
      if (latest?.id === message.id) {
        conversation.lastActivityAt = now();
        this.updateConversationPreview(message.conversationId);
      }
    }

    this.persist();
    if (options?.appendTranscript) {
      this.appendTranscript(message);
    }
    return message;
  }

  removeMessage(messageId: string) {
    const index = this.state.messages.findIndex((item) => item.id === messageId);
    if (index === -1) return;
    const [message] = this.state.messages.splice(index, 1);
    const conversation = this.getConversation(message.conversationId);
    if (conversation) {
      const latestPreview = [...this.listMessages(message.conversationId)]
        .reverse()
        .find((item) => this.shouldUseMessageAsConversationPreview(item));
      conversation.lastMessage = latestPreview ? this.summarizeConversationMessage(latestPreview) : "";
      conversation.lastActivityAt = latestPreview?.createdAt ?? conversation.lastActivityAt;
    }
    this.persist();
  }

  clearConversationHistory(conversationId: string): ClearConversationHistoryResult {
    const conversation = this.getConversation(conversationId);
    if (!conversation) {
      return {
        removedMessages: 0,
        removedRuns: 0,
        removedAttachments: 0,
        removedArtifacts: 0,
        removedToolInvocations: 0,
        removedRunSteps: 0,
        removedNotifications: 0,
      };
    }

    const runIds = new Set(
      this.state.runs
        .filter((run) => run.conversationId === conversationId)
        .map((run) => run.id),
    );

    const removedMessages = this.state.messages.filter((message) => message.conversationId === conversationId).length;
    const removedRuns = this.state.runs.filter((run) => run.conversationId === conversationId).length;
    const removedAttachments = this.state.attachments.filter(
      (attachment) => attachment.conversationId === conversationId || (attachment.runId ? runIds.has(attachment.runId) : false),
    ).length;
    const removedArtifacts = this.state.artifacts.filter(
      (artifact) => artifact.conversationId === conversationId || (artifact.runId ? runIds.has(artifact.runId) : false),
    ).length;
    const removedToolInvocations = this.state.toolInvocations.filter(
      (invocation) => invocation.conversationId === conversationId || (invocation.runId ? runIds.has(invocation.runId) : false),
    ).length;
    const removedRunSteps = this.state.runSteps.filter(
      (step) => step.conversationId === conversationId || runIds.has(step.runId),
    ).length;
    const removedNotifications = this.state.notifications.filter(
      (notification) =>
        notification.relatedConversationId === conversationId ||
        (notification.relatedRunId ? runIds.has(notification.relatedRunId) : false),
    ).length;

    this.state.messages = this.state.messages.filter((message) => message.conversationId !== conversationId);
    this.state.runs = this.state.runs.filter((run) => run.conversationId !== conversationId);
    this.state.attachments = this.state.attachments.filter(
      (attachment) =>
        attachment.conversationId !== conversationId &&
        (!attachment.runId || !runIds.has(attachment.runId)),
    );
    this.state.artifacts = this.state.artifacts.filter(
      (artifact) =>
        artifact.conversationId !== conversationId &&
        (!artifact.runId || !runIds.has(artifact.runId)),
    );
    this.state.toolInvocations = this.state.toolInvocations.filter(
      (invocation) =>
        invocation.conversationId !== conversationId &&
        (!invocation.runId || !runIds.has(invocation.runId)),
    );
    this.state.runSteps = this.state.runSteps.filter(
      (step) => step.conversationId !== conversationId && !runIds.has(step.runId),
    );
    this.state.notifications = this.state.notifications.filter(
      (notification) =>
        notification.relatedConversationId !== conversationId &&
        (!notification.relatedRunId || !runIds.has(notification.relatedRunId)),
    );

    conversation.unread = 0;
    conversation.lastMessage = "";
    conversation.lastActivityAt = now();

    const { globalTranscriptPath, workspaceTranscriptPath } = this.getConversationTranscriptPaths(conversationId);
    if (existsSync(globalTranscriptPath)) {
      writeFileSync(globalTranscriptPath, "", "utf8");
    }
    if (workspaceTranscriptPath && existsSync(workspaceTranscriptPath)) {
      writeFileSync(workspaceTranscriptPath, "", "utf8");
    }

    this.persist();

    return {
      removedMessages,
      removedRuns,
      removedAttachments,
      removedArtifacts,
      removedToolInvocations,
      removedRunSteps,
      removedNotifications,
    };
  }

  listRuns(): RunRecord[] {
    return [...this.state.runs].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getRun(runId: string) {
    return this.state.runs.find((run) => run.id === runId) ?? null;
  }

  getLatestConversationRun(conversationId: string) {
    return this.listRuns().find((run) => run.conversationId === conversationId) ?? null;
  }

  createRun(input: Omit<RunRecord, "createdAt" | "updatedAt"> & { createdAt?: number; updatedAt?: number }) {
    const timestamp = now();
    this.state.runs.push({
      ...input,
      createdAt: input.createdAt ?? timestamp,
      updatedAt: input.updatedAt ?? timestamp,
    });
    this.persist();
  }

  updateRun(runId: string, patch: Partial<RunRecord>) {
    const run = this.getRun(runId);
    if (!run) return;
    Object.assign(run, patch, { updatedAt: now() });
    this.persist();
  }

  initializeRunSteps(input: { runId: string; conversationId: string; labels: string[] }) {
    this.state.runSteps = this.state.runSteps.filter((step) => step.runId !== input.runId);
    this.state.runSteps.push(
      ...input.labels.map((label, index) => ({
        id: `${input.runId}:${index}`,
        runId: input.runId,
        conversationId: input.conversationId,
        stepIndex: index,
        label,
        status: "pending" as const,
        startedAt: null,
        completedAt: null,
        errorText: null,
        metadata: null,
      })),
    );
    this.persist();
  }

  updateRunStep(
    runId: string,
    stepIndex: number,
    patch: Partial<Pick<StoredRunStepRecord, "status" | "startedAt" | "completedAt" | "errorText" | "metadata">>,
  ) {
    const step = this.state.runSteps.find((item) => item.runId === runId && item.stepIndex === stepIndex);
    if (!step) return;
    Object.assign(step, patch);
    this.persist();
  }

  cancelPendingRunSteps(runId: string) {
    let changed = false;
    for (const step of this.state.runSteps) {
      if (step.runId !== runId) continue;
      if (step.status === "completed" || step.status === "failed" || step.status === "cancelled") continue;
      step.status = "cancelled";
      step.completedAt ??= now();
      changed = true;
    }
    if (changed) {
      this.persist();
    }
  }

  recordArtifact(input: Omit<StoredArtifactRecord, "id" | "createdAt"> & { createdAt?: number }) {
    this.state.artifacts.push({
      id: nanoid(),
      createdAt: input.createdAt ?? now(),
      ...input,
    });
    this.persist();
  }

  createToolInvocation(
    input: Omit<StoredToolInvocationRecord, "createdAt" | "completedAt" | "outputText" | "errorText"> & {
      createdAt?: number;
      completedAt?: number | null;
      outputText?: string | null;
      errorText?: string | null;
    },
  ) {
    this.state.toolInvocations.push({
      ...input,
      createdAt: input.createdAt ?? now(),
      completedAt: input.completedAt ?? null,
      outputText: input.outputText ?? null,
      errorText: input.errorText ?? null,
    });
    this.persist();
  }

  updateToolInvocation(
    invocationId: string,
    patch: Partial<Pick<StoredToolInvocationRecord, "status" | "outputText" | "errorText" | "completedAt" | "metadata">>,
  ) {
    const invocation = this.state.toolInvocations.find((item) => item.id === invocationId);
    if (!invocation) return;
    Object.assign(invocation, patch);
    this.persist();
  }

  listNotifications(): NotificationRecord[] {
    return [...this.state.notifications].sort((a, b) => b.createdAt - a.createdAt);
  }

  createNotification(input: Omit<NotificationRecord, "id" | "read" | "createdAt"> & { createdAt?: number }) {
    const notification: NotificationRecord = {
      id: nanoid(),
      type: input.type,
      title: input.title,
      body: input.body,
      read: false,
      createdAt: input.createdAt ?? now(),
      relatedConversationId: input.relatedConversationId,
      relatedRunId: input.relatedRunId,
    };
    this.state.notifications.unshift(notification);
    this.persist();
    return notification;
  }

  markNotificationsRead() {
    this.state.notifications = [];
    this.persist();
  }

  listExtensions(): ExtensionRecord[] {
    return [...this.state.extensions].sort((a, b) => a.name.localeCompare(b.name, "en"));
  }

  listPromptAliases(): PromptAliasRecord[] {
    return [...this.state.promptAliases].sort((a, b) => a.alias.localeCompare(b.alias, "en"));
  }

  savePromptAlias(input: SavePromptAliasInput) {
    const alias = normalizePromptAlias(input.alias);
    if (!alias) {
      throw new Error("Prompt 别名不能为空，只能包含字母、数字、中划线和下划线。");
    }
    if (["skills", "mcp", "clear"].includes(alias)) {
      throw new Error(`/${alias} 是内置命令，不能作为自定义 Prompt 别名。`);
    }
    const existingSkill = this.findSkillCatalogEntryByNameOrId(alias);
    if (existingSkill) {
      throw new Error(`/${alias} 已经被 Skill 使用，请换一个别名。`);
    }
    const duplicated = this.state.promptAliases.find(
      (item) => item.alias === alias && item.id !== input.id,
    );
    if (duplicated) {
      throw new Error(`/${alias} 已经存在，请换一个别名。`);
    }

    const timestamp = now();
    const existing = input.id
      ? this.state.promptAliases.find((item) => item.id === input.id)
      : null;
    const record: PromptAliasRecord = {
      id: existing?.id ?? `prompt-${nanoid(8)}`,
      name: input.name.trim() || alias,
      alias,
      description: input.description.trim(),
      prompt: input.prompt.trim(),
      enabled: input.enabled,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

    if (!record.prompt) {
      throw new Error("Prompt 内容不能为空。");
    }

    if (existing) {
      this.state.promptAliases = this.state.promptAliases.map((item) =>
        item.id === existing.id ? record : item,
      );
    } else {
      this.state.promptAliases.push(record);
    }
    this.persist();
    return record;
  }

  removePromptAlias(promptAliasId: string) {
    this.state.promptAliases = this.state.promptAliases.filter((item) => item.id !== promptAliasId);
    this.persist();
  }

  listSkillCatalog(): SkillCatalogRecord[] {
    return [...this.state.skillCatalog].sort((a, b) =>
      (a.displayName || a.name).localeCompare(b.displayName || b.name, "zh-Hans-CN"),
    );
  }

  getSkillCatalogEntry(skillId: string) {
    return this.state.skillCatalog.find((skill) => skill.id === skillId) ?? null;
  }

  findSkillCatalogEntryByNameOrId(value: string) {
    const normalized = value.trim().toLowerCase();
    return (
      this.state.skillCatalog.find(
        (skill) =>
          skill.id.toLowerCase() === normalized ||
          skill.slug.toLowerCase() === normalized ||
          skill.name.toLowerCase() === normalized ||
          skill.displayName.toLowerCase() === normalized,
      ) ?? null
    );
  }

  replaceSkillCatalog(entries: SkillCatalogRecord[]) {
    const previous = new Map(this.state.skillCatalog.map((skill) => [skill.id, skill]));
    const resolvedEntries = entries.map((entry) => {
      const existing = previous.get(entry.id);
      return {
        ...entry,
        installed: existing?.installed ?? entry.installed,
        installedVersion: existing?.installedVersion ?? entry.installedVersion,
        installPath: existing?.installPath ?? entry.installPath,
      };
    });
    const byId = new Map(resolvedEntries.map((skill) => [skill.id, skill]));
    const bySlug = new Map(resolvedEntries.map((skill) => [skill.slug.toLowerCase(), skill]));
    const byName = new Map(
      resolvedEntries.flatMap((skill) => [
        [skill.name.toLowerCase(), skill] as const,
        [skill.displayName.toLowerCase(), skill] as const,
      ]),
    );

    this.state.skillCatalog = resolvedEntries;
    for (const agent of this.state.agents) {
      const normalizedWhitelist = (agent.skillWhitelist ?? [])
        .map((value) => {
          const key = value.trim().toLowerCase();
          return byId.get(value) ?? bySlug.get(key) ?? byName.get(key) ?? null;
        })
        .filter((item): item is SkillCatalogRecord => item !== null)
        .map((item) => item.id);

      agent.skillWhitelist = Array.from(new Set(normalizedWhitelist));
    }
    this.persist();
  }

  markSkillInstalled(input: { skillId: string; installPath: string; version: string }) {
    const skill = this.getSkillCatalogEntry(input.skillId);
    if (!skill) return;
    skill.installed = true;
    skill.installedVersion = input.version;
    skill.installPath = input.installPath;
    for (const agent of this.state.agents) {
      if (!agent.skillWhitelist.includes(skill.id)) {
        agent.skillWhitelist.push(skill.id);
      }
    }
    this.persist();
  }

  markSkillRemoved(skillId: string) {
    const skill = this.getSkillCatalogEntry(skillId);
    if (!skill) return;

    skill.installed = false;
    skill.installedVersion = null;
    skill.installPath = null;

    for (const agent of this.state.agents) {
      agent.skillWhitelist = agent.skillWhitelist.filter((item) => item !== skill.id);
    }

    for (const conversation of this.state.conversations) {
      if (conversation.meta.activeSkill === skill.id) {
        conversation.meta.activeSkill = null;
      }
    }

    this.persist();
  }

  updateAgentSkillWhitelist(input: UpdateAgentSkillsInput) {
    const agent = this.getAgent(input.agentId);
    if (!agent) return;
    agent.skillWhitelist = Array.from(new Set(input.skillIds));
    this.persist();
  }

  listMcpCatalog(): McpCatalogRecord[] {
    return [...this.state.mcpCatalog].sort((a, b) => a.name.localeCompare(b.name, "en"));
  }

  getMcpCatalogEntry(serverId: string) {
    return this.state.mcpCatalog.find((item) => item.id === serverId) ?? null;
  }

  findMcpCatalogEntryByNameOrId(value: string) {
    const normalized = value.trim().toLowerCase();
    return (
      this.state.mcpCatalog.find(
        (item) =>
          item.id.toLowerCase() === normalized ||
          item.slug.toLowerCase() === normalized ||
          item.name.toLowerCase() === normalized,
      ) ?? null
    );
  }

  replaceMcpCatalog(entries: McpCatalogRecord[]) {
    const previous = new Map(this.state.mcpCatalog.map((item) => [item.id, item]));
    this.state.mcpCatalog = entries.map((entry) => ({
      ...entry,
      metadata: {
        ...(previous.get(entry.id)?.metadata ?? {}),
        ...(entry.metadata ?? {}),
      },
    }));
    const validIds = new Set(this.state.mcpCatalog.map((item) => item.id));
    for (const agent of this.state.agents) {
      agent.mcpWhitelist = agent.mcpWhitelist.filter((serverId) => validIds.has(serverId));
    }
    this.state.mcpConnections = this.state.mcpConnections.filter((item) => validIds.has(item.serverId));
    this.persist();
  }

  listMcpConnections(): McpConnectionRecord[] {
    return [...this.state.mcpConnections].sort((a, b) => a.serverId.localeCompare(b.serverId, "en"));
  }

  getMcpConnection(serverId: string) {
    return this.state.mcpConnections.find((item) => item.serverId === serverId) ?? null;
  }

  upsertMcpConnection(connection: McpConnectionRecord) {
    const index = this.state.mcpConnections.findIndex((item) => item.serverId === connection.serverId);
    if (index >= 0) {
      this.state.mcpConnections[index] = connection;
    } else {
      this.state.mcpConnections.push(connection);
    }

    if (connection.enabled && connection.status === "connected") {
      for (const agent of this.state.agents) {
        if (!agent.mcpWhitelist.includes(connection.serverId)) {
          agent.mcpWhitelist.push(connection.serverId);
        }
      }
    }
    this.persist();
  }

  removeMcpConnection(serverId: string) {
    this.state.mcpConnections = this.state.mcpConnections.filter((item) => item.serverId !== serverId);
    this.persist();
  }

  updateAgentMcpWhitelist(input: { agentId: string; serverIds: string[] }) {
    const agent = this.getAgent(input.agentId);
    if (!agent) return;
    agent.mcpWhitelist = Array.from(new Set(input.serverIds));
    this.persist();
  }

  toggleExtension(extensionId: string) {
    const extension = this.state.extensions.find((item) => item.id === extensionId);
    if (!extension) return;
    extension.installed = !extension.installed;
    extension.enabled = extension.installed;
    this.createNotification({
      type: "extension",
      title: extension.installed ? "扩展已安装" : "扩展已移除",
      body: `${extension.name} ${extension.installed ? "已安装并启用" : "已从当前应用中移除"}`,
      relatedConversationId: null,
      relatedRunId: null,
    });
    this.persist();
  }

  resetUnread(conversationId: string) {
    const conversation = this.getConversation(conversationId);
    if (!conversation) return;
    conversation.unread = 0;
    this.persist();
  }

  updateTeamContext(teamId: string, context: TeamContext) {
    const team = this.getTeam(teamId);
    if (!team) return;
    team.context = context;
    this.persist();
  }

  private setupSchema() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS settings_entries (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS providers (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        base_url TEXT NOT NULL,
        default_model TEXT NOT NULL,
        supports_tool_calling INTEGER DEFAULT 1 NOT NULL,
        supports_streaming INTEGER DEFAULT 1 NOT NULL,
        is_active INTEGER DEFAULT 0 NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        avatar_path TEXT,
        model_id TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        avatar_path TEXT,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        target_id TEXT NOT NULL,
        title TEXT NOT NULL,
        unread INTEGER DEFAULT 0 NOT NULL,
        last_message TEXT NOT NULL,
        last_activity_at INTEGER NOT NULL,
        active_skill TEXT,
        pinned_mcp TEXT,
        show_internal_messages INTEGER DEFAULT 0 NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        sender_kind TEXT NOT NULL,
        message_type TEXT NOT NULL,
        visibility TEXT NOT NULL,
        content TEXT NOT NULL,
        mentions_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        run_id TEXT,
        has_attachments INTEGER DEFAULT 0 NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        step_index INTEGER DEFAULT 0 NOT NULL,
        total_steps INTEGER DEFAULT 0 NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_error TEXT,
        artifact_path TEXT,
        transcript_path TEXT,
        workspace_transcript_path TEXT,
        memory_path TEXT,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        read INTEGER DEFAULT 0 NOT NULL,
        created_at INTEGER NOT NULL,
        related_conversation_id TEXT,
        related_run_id TEXT,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS extensions (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS prompt_aliases (
        id TEXT PRIMARY KEY,
        alias TEXT NOT NULL,
        enabled INTEGER DEFAULT 1 NOT NULL,
        updated_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS skill_catalog (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mcp_catalog (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS mcp_connections (
        server_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attachments (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        message_id TEXT,
        run_id TEXT,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        run_id TEXT,
        artifact_kind TEXT NOT NULL,
        title TEXT NOT NULL,
        path TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tool_invocations (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        run_id TEXT,
        server_id TEXT NOT NULL,
        server_name TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        status TEXT NOT NULL,
        input_json TEXT NOT NULL,
        output_text TEXT,
        error_text TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS run_steps (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        step_index INTEGER NOT NULL,
        label TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        error_text TEXT,
        payload TEXT NOT NULL
      );
    `);
    this.dropTeamObjectiveColumnIfPresent();
    this.assertStructuredSchema();
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_providers_active ON providers(is_active);
      CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);
      CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
      CREATE INDEX IF NOT EXISTS idx_agents_workspace_path ON agents(workspace_path);
      CREATE INDEX IF NOT EXISTS idx_teams_name ON teams(name);
      CREATE INDEX IF NOT EXISTS idx_teams_workspace_path ON teams(workspace_path);
      CREATE INDEX IF NOT EXISTS idx_notifications_read_created_at ON notifications(read, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_related_run ON notifications(related_run_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notifications_related_conversation ON notifications(related_conversation_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_prompt_aliases_alias ON prompt_aliases(alias);
      CREATE INDEX IF NOT EXISTS idx_prompt_aliases_enabled ON prompt_aliases(enabled, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversations_last_activity_at ON conversations(last_activity_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conversations_target ON conversations(kind, target_id);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at ON messages(conversation_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_messages_run_id ON messages(run_id);
      CREATE INDEX IF NOT EXISTS idx_messages_sender_kind ON messages(sender_kind, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_runs_conversation_updated_at ON runs(conversation_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_attachments_conversation_created_at ON attachments(conversation_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON attachments(message_id);
      CREATE INDEX IF NOT EXISTS idx_attachments_run_id ON attachments(run_id);
      CREATE INDEX IF NOT EXISTS idx_artifacts_conversation_created_at ON artifacts(conversation_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_artifacts_run_id ON artifacts(run_id);
      CREATE INDEX IF NOT EXISTS idx_tool_invocations_run_id ON tool_invocations(run_id, created_at ASC);
      CREATE INDEX IF NOT EXISTS idx_tool_invocations_server_tool ON tool_invocations(server_id, tool_name, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_run_steps_run_id ON run_steps(run_id, step_index ASC);
    `);
  }

  private databaseHasData() {
    const tables = [
      "settings_entries",
      "providers",
      "agents",
      "teams",
      "conversations",
      "messages",
      "runs",
      "notifications",
      "extensions",
      "prompt_aliases",
      "skill_catalog",
      "mcp_catalog",
      "mcp_connections",
      "attachments",
      "artifacts",
      "tool_invocations",
      "run_steps",
    ];

    return tables.some((table) => {
      const row = this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
      return row.count > 0;
    });
  }

  private persist() {
    this.persistSettingsFile();
    const insertSetting = this.db.prepare(
      "INSERT INTO settings_entries (key, value) VALUES (?, ?)",
    );
    const insertProvider = this.db.prepare(
      "INSERT INTO providers (id, label, base_url, default_model, supports_tool_calling, supports_streaming, is_active, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertAgent = this.db.prepare(
      "INSERT INTO agents (id, name, role, status, workspace_path, avatar_path, model_id, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertTeam = this.db.prepare(
      "INSERT INTO teams (id, name, workspace_path, avatar_path, payload) VALUES (?, ?, ?, ?, ?)",
    );
    const insertConversation = this.db.prepare(
      "INSERT INTO conversations (id, kind, target_id, title, unread, last_message, last_activity_at, active_skill, pinned_mcp, show_internal_messages, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertMessage = this.db.prepare(
      "INSERT INTO messages (id, conversation_id, sender_id, sender_name, sender_kind, message_type, visibility, content, mentions_json, created_at, run_id, has_attachments, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertRun = this.db.prepare(
      "INSERT INTO runs (id, conversation_id, title, kind, status, actor_id, step_index, total_steps, created_at, updated_at, last_error, artifact_path, transcript_path, workspace_transcript_path, memory_path, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertNotification = this.db.prepare(
      "INSERT INTO notifications (id, type, title, body, read, created_at, related_conversation_id, related_run_id, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertExtension = this.db.prepare("INSERT INTO extensions (id, payload) VALUES (?, ?)");
    const insertPromptAlias = this.db.prepare(
      "INSERT INTO prompt_aliases (id, alias, enabled, updated_at, payload) VALUES (?, ?, ?, ?, ?)",
    );
    const insertSkillCatalog = this.db.prepare("INSERT INTO skill_catalog (id, payload) VALUES (?, ?)");
    const insertMcpCatalog = this.db.prepare("INSERT INTO mcp_catalog (id, payload) VALUES (?, ?)");
    const insertMcpConnection = this.db.prepare(
      "INSERT INTO mcp_connections (server_id, payload) VALUES (?, ?)",
    );
    const insertAttachment = this.db.prepare(
      "INSERT INTO attachments (id, conversation_id, message_id, run_id, name, path, mime_type, size_bytes, created_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertArtifact = this.db.prepare(
      "INSERT INTO artifacts (id, conversation_id, run_id, artifact_kind, title, path, workspace_path, created_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertToolInvocation = this.db.prepare(
      "INSERT INTO tool_invocations (id, conversation_id, run_id, server_id, server_name, tool_name, status, input_json, output_text, error_text, created_at, completed_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertRunStep = this.db.prepare(
      "INSERT INTO run_steps (id, run_id, conversation_id, step_index, label, status, started_at, completed_at, error_text, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(`
        DELETE FROM settings_entries;
        DELETE FROM providers;
        DELETE FROM agents;
        DELETE FROM teams;
        DELETE FROM conversations;
        DELETE FROM messages;
        DELETE FROM runs;
        DELETE FROM notifications;
        DELETE FROM extensions;
        DELETE FROM prompt_aliases;
        DELETE FROM skill_catalog;
        DELETE FROM mcp_catalog;
        DELETE FROM mcp_connections;
        DELETE FROM attachments;
        DELETE FROM artifacts;
        DELETE FROM tool_invocations;
        DELETE FROM run_steps;
      `);

      for (const [key, value] of Object.entries(this.state.settingsEntries)) {
        insertSetting.run(key, value);
      }
      for (const provider of this.state.providers) {
        insertProvider.run(
          provider.id,
          provider.label,
          provider.baseUrl,
          provider.defaultModel,
          provider.supportsToolCalling ? 1 : 0,
          provider.supportsStreaming ? 1 : 0,
          provider.isActive ? 1 : 0,
          JSON.stringify(provider),
        );
      }
      for (const agent of this.state.agents) {
        insertAgent.run(
          agent.id,
          agent.name,
          agent.role,
          agent.status,
          agent.workspacePath,
          sqliteNullable(agent.avatarPath),
          agent.modelId ?? defaultProviders[0]?.defaultModel ?? "qwen-max",
          JSON.stringify(agent),
        );
      }
      for (const team of this.state.teams) {
        insertTeam.run(
          team.id,
          team.name,
          team.workspacePath,
          sqliteNullable(team.avatarPath),
          JSON.stringify(team),
        );
      }
      for (const conversation of this.state.conversations) {
        insertConversation.run(
          conversation.id,
          conversation.kind,
          conversation.targetId,
          conversation.title,
          conversation.unread,
          conversation.lastMessage,
          conversation.lastActivityAt,
          sqliteNullable(conversation.meta.activeSkill),
          sqliteNullable(conversation.meta.pinnedMcp),
          conversation.meta.showInternalMessages ? 1 : 0,
          JSON.stringify(conversation),
        );
      }
      for (const message of this.state.messages) {
        insertMessage.run(
          message.id,
          message.conversationId,
          message.senderId,
          message.senderName,
          message.senderKind,
          message.messageType,
          message.visibility,
          message.content,
          JSON.stringify(message.mentions),
          message.createdAt,
          sqliteNullable(message.runId),
          this.extractAttachmentsFromMessage(message).length > 0 ? 1 : 0,
          JSON.stringify(message),
        );
      }
      for (const run of this.state.runs) {
        const runMetadata = run.metadata ?? {};
        insertRun.run(
          run.id,
          run.conversationId,
          run.title,
          run.kind,
          run.status,
          run.actorId,
          run.stepIndex,
          run.totalSteps,
          run.createdAt,
          run.updatedAt,
          typeof run.metadata?.error === "string" ? run.metadata.error : null,
          typeof runMetadata.artifactPath === "string" ? runMetadata.artifactPath : null,
          typeof runMetadata.transcriptPath === "string" ? runMetadata.transcriptPath : null,
          typeof runMetadata.workspaceTranscriptPath === "string"
            ? runMetadata.workspaceTranscriptPath
            : null,
          typeof runMetadata.memoryPath === "string" ? runMetadata.memoryPath : null,
          JSON.stringify(run),
        );
      }
      for (const notification of this.state.notifications) {
        insertNotification.run(
          notification.id,
          notification.type,
          notification.title,
          notification.body,
          notification.read ? 1 : 0,
          notification.createdAt,
          sqliteNullable(notification.relatedConversationId),
          sqliteNullable(notification.relatedRunId),
          JSON.stringify(notification),
        );
      }
      for (const extension of this.state.extensions) {
        insertExtension.run(extension.id, JSON.stringify(extension));
      }
      for (const promptAlias of this.state.promptAliases) {
        insertPromptAlias.run(
          promptAlias.id,
          promptAlias.alias,
          promptAlias.enabled ? 1 : 0,
          promptAlias.updatedAt,
          JSON.stringify(promptAlias),
        );
      }
      for (const skill of this.state.skillCatalog) {
        insertSkillCatalog.run(skill.id, JSON.stringify(skill));
      }
      for (const server of this.state.mcpCatalog) {
        insertMcpCatalog.run(server.id, JSON.stringify(server));
      }
      for (const connection of this.state.mcpConnections) {
        insertMcpConnection.run(connection.serverId, JSON.stringify(connection));
      }
      for (const attachment of this.state.attachments) {
        insertAttachment.run(
          attachment.id,
          attachment.conversationId,
          attachment.messageId,
          attachment.runId,
          attachment.name,
          attachment.path,
          attachment.mimeType,
          attachment.sizeBytes,
          attachment.createdAt,
          JSON.stringify(attachment),
        );
      }
      for (const artifact of this.state.artifacts) {
        insertArtifact.run(
          artifact.id,
          artifact.conversationId,
          artifact.runId,
          artifact.artifactKind,
          artifact.title,
          artifact.path,
          artifact.workspacePath,
          artifact.createdAt,
          JSON.stringify(artifact),
        );
      }
      for (const invocation of this.state.toolInvocations) {
        insertToolInvocation.run(
          invocation.id,
          invocation.conversationId,
          invocation.runId,
          invocation.serverId,
          invocation.serverName,
          invocation.toolName,
          invocation.status,
          invocation.inputJson,
          invocation.outputText,
          invocation.errorText,
          invocation.createdAt,
          invocation.completedAt,
          JSON.stringify(invocation),
        );
      }
      for (const step of this.state.runSteps) {
        insertRunStep.run(
          step.id,
          step.runId,
          step.conversationId,
          step.stepIndex,
          step.label,
          step.status,
          step.startedAt,
          step.completedAt,
          step.errorText,
          JSON.stringify(step),
        );
      }

      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private loadState() {
    const settingsEntries = Object.fromEntries(
      (
        this.db
          .prepare("SELECT key, value FROM settings_entries ORDER BY key")
          .all() as Array<{ key: string; value: string }>
      ).map((row) => [row.key, row.value]),
    );
    const skillCatalog = this.readCollection<SkillCatalogRecord>("skill_catalog");
    const mcpCatalog = this.readCollection<McpCatalogRecord>("mcp_catalog");
    const fileConfig = this.readSettingsFile();
    const configState =
      fileConfig ??
      this.createConfigStateFromDb({
        settingsEntries,
        providers: this.readProviders(),
      });

    this.state = {
      settingsEntries: configState.settingsEntries,
      providers: configState.providers,
      agents: this.readAgents().map((agent) => ({
        ...agent,
        skillWhitelist: Array.isArray(agent.skillWhitelist)
          ? agent.skillWhitelist
          : defaultSkillCatalog.map((skill) => skill.id),
        mcpWhitelist: Array.isArray(agent.mcpWhitelist) ? agent.mcpWhitelist : defaultConnectedMcpIds,
      })),
      teams: this.readTeams(),
      conversations: this.readConversations(),
      messages: this.readMessages(),
      runs: this.readRuns(),
      attachments: this.readCollection<StoredAttachmentRecord>(
        "attachments",
        "ORDER BY created_at ASC",
      ),
      artifacts: this.readCollection<StoredArtifactRecord>(
        "artifacts",
        "ORDER BY created_at DESC",
      ),
      toolInvocations: this.readCollection<StoredToolInvocationRecord>(
        "tool_invocations",
        "ORDER BY created_at ASC",
      ),
      runSteps: this.readCollection<StoredRunStepRecord>(
        "run_steps",
        "ORDER BY run_id ASC, step_index ASC",
      ),
      notifications: this.readNotifications(),
      extensions: this.readCollection<ExtensionRecord>("extensions"),
      promptAliases: this.readCollection<PromptAliasRecord>(
        "prompt_aliases",
        "ORDER BY alias ASC",
      ),
      skillCatalog: skillCatalog.length > 0 ? skillCatalog : defaultSkillCatalog,
      mcpCatalog: mcpCatalog.length > 0 ? mcpCatalog : defaultMcpCatalog,
      mcpConnections: this.readCollection<McpConnectionRecord>("mcp_connections"),
    };
    this.persistSettingsFile();
  }

  private readCollection<T>(tableName: string, orderClause = "") {
    const rows = this.db
      .prepare(`SELECT payload FROM ${tableName} ${orderClause}`.trim())
      .all() as Array<{ payload: string }>;
    return rows.map((row) => this.parseStoredPayload<T>(row.payload));
  }

  private parseStoredPayload<T>(payload: string): T {
    return JSON.parse(payload) as T;
  }

  private mergeRunMetadataPaths(
    metadata: RunRecord["metadata"],
    row: {
      artifact_path: string | null;
      transcript_path: string | null;
      workspace_transcript_path: string | null;
      memory_path: string | null;
    },
  ): RunRecord["metadata"] {
    return {
      ...(metadata ?? {}),
      ...(row.artifact_path ? { artifactPath: row.artifact_path } : {}),
      ...(row.transcript_path ? { transcriptPath: row.transcript_path } : {}),
      ...(row.workspace_transcript_path
        ? { workspaceTranscriptPath: row.workspace_transcript_path }
        : {}),
      ...(row.memory_path ? { memoryPath: row.memory_path } : {}),
    };
  }

  private readProviders() {
    const rows = this.db
      .prepare(
        `SELECT id, label, base_url, default_model, supports_tool_calling, supports_streaming, is_active, payload
         FROM providers
         ORDER BY is_active DESC, id ASC`,
      )
      .all() as Array<{
      id: string;
      label: string;
      base_url: string;
      default_model: string;
      supports_tool_calling: number;
      supports_streaming: number;
      is_active: number;
      payload: string;
    }>;

    return rows.map((row) => {
      const payload = this.parseStoredPayload<ProviderConfig>(row.payload);
      return {
        ...payload,
        id: row.id as ProviderConfig["id"],
        label: row.label,
        baseUrl: row.base_url,
        defaultModel: row.default_model,
        supportsToolCalling: row.supports_tool_calling === 1,
        supportsStreaming: row.supports_streaming === 1,
        isActive: row.is_active === 1,
      } satisfies ProviderConfig;
    });
  }

  private readAgents() {
    const rows = this.db
      .prepare(
        `SELECT id, name, role, status, workspace_path, avatar_path, model_id, payload
         FROM agents
         ORDER BY name COLLATE NOCASE ASC`,
      )
      .all() as Array<{
      id: string;
      name: string;
      role: string;
      status: AgentRecord["status"];
      workspace_path: string;
      avatar_path: string | null;
      model_id: string;
      payload: string;
    }>;

    return rows.map((row) => {
      const payload = this.parseStoredPayload<AgentRecord>(row.payload);
      return {
        ...payload,
        id: row.id,
        name: row.name,
        role: row.role,
        status: row.status,
        workspacePath: row.workspace_path,
        avatarPath: row.avatar_path,
        modelId: row.model_id,
      } satisfies AgentRecord;
    });
  }

  private readTeams() {
    const rows = this.db
      .prepare(
        `SELECT id, name, workspace_path, avatar_path, payload
         FROM teams
         ORDER BY name COLLATE NOCASE ASC`,
      )
      .all() as Array<{
      id: string;
      name: string;
      workspace_path: string;
      avatar_path: string | null;
      payload: string;
    }>;

    return rows.map((row) => {
      const payload = this.parseStoredPayload<
        TeamRecord & {
          objective?: unknown;
          mcpWhitelist?: unknown;
          context?: TeamContext & { objective?: unknown };
        }
      >(row.payload);
      const { context: storedContext, ...teamPayload } = payload;
      const context = { ...(storedContext ?? defaultTeamContext()) };
      delete (teamPayload as { objective?: unknown }).objective;
      delete (teamPayload as { mcpWhitelist?: unknown }).mcpWhitelist;
      delete (context as { objective?: unknown }).objective;
      return {
        ...teamPayload,
        id: row.id,
        name: row.name,
        workspacePath: row.workspace_path,
        avatarPath: row.avatar_path,
        memberIds: Array.from(new Set(payload.memberIds)).slice(0, teamMemberLimit),
        context: {
          ...defaultTeamContext(),
          ...context,
        },
      } satisfies TeamRecord;
    });
  }

  private readNotifications() {
    const rows = this.db
      .prepare(
        `SELECT id, type, title, body, read, created_at, related_conversation_id, related_run_id
         FROM notifications
         ORDER BY created_at DESC`,
      )
      .all() as Array<{
      id: string;
      type: NotificationRecord["type"];
      title: string;
      body: string;
      read: number;
      created_at: number;
      related_conversation_id: string | null;
      related_run_id: string | null;
    }>;

    return rows.map((row) => {
      return {
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        read: row.read === 1,
        createdAt: row.created_at,
        relatedConversationId: row.related_conversation_id,
        relatedRunId: row.related_run_id,
      } satisfies NotificationRecord;
    });
  }

  private readConversations() {
    const rows = this.db
      .prepare(
        `SELECT id, kind, target_id, title, unread, last_message, last_activity_at, active_skill, pinned_mcp, show_internal_messages
         FROM conversations
         ORDER BY last_activity_at DESC`,
      )
      .all() as Array<{
      id: string;
      kind: ConversationRecord["kind"];
      target_id: string;
      title: string;
      unread: number;
      last_message: string;
      last_activity_at: number;
      active_skill: string | null;
      pinned_mcp: string | null;
      show_internal_messages: number;
    }>;

    return rows.map((row) => {
      return {
        id: row.id,
        kind: row.kind,
        targetId: row.target_id,
        title: row.title,
        unread: row.unread,
        lastMessage: row.last_message,
        lastActivityAt: row.last_activity_at,
        meta: {
          activeSkill: row.active_skill,
          pinnedMcp: row.pinned_mcp,
          showInternalMessages: row.show_internal_messages === 1,
        },
      } satisfies ConversationRecord;
    });
  }

  private readMessages() {
    const rows = this.db
      .prepare(
        `SELECT id, conversation_id, sender_id, sender_name, sender_kind, message_type, visibility, content, mentions_json, created_at, run_id, payload
         FROM messages
         ORDER BY created_at ASC`,
      )
      .all() as Array<{
      id: string;
      conversation_id: string;
      sender_id: string;
      sender_name: string;
      sender_kind: MessageRecord["senderKind"];
      message_type: MessageRecord["messageType"];
      visibility: MessageRecord["visibility"];
      content: string;
      mentions_json: string;
      created_at: number;
      run_id: string | null;
      payload: string;
    }>;

    return rows.map((row) => {
      const payload = this.parseStoredPayload<MessageRecord>(row.payload);
      return {
        ...payload,
        id: row.id,
        conversationId: row.conversation_id,
        senderId: row.sender_id,
        senderName: row.sender_name,
        senderKind: row.sender_kind,
        messageType: row.message_type,
        visibility: row.visibility,
        content: row.content,
        mentions: JSON.parse(row.mentions_json) as string[],
        createdAt: row.created_at,
        runId: row.run_id,
      } satisfies MessageRecord;
    });
  }

  private readRuns() {
    const rows = this.db
      .prepare(
        `SELECT id, conversation_id, title, kind, status, actor_id, step_index, total_steps, created_at, updated_at, last_error, artifact_path, transcript_path, workspace_transcript_path, memory_path, payload
         FROM runs
         ORDER BY updated_at DESC`,
      )
      .all() as Array<{
      id: string;
      conversation_id: string;
      title: string;
      kind: RunRecord["kind"];
      status: RunRecord["status"];
      actor_id: string;
      step_index: number;
      total_steps: number;
      created_at: number;
      updated_at: number;
      last_error: string | null;
      artifact_path: string | null;
      transcript_path: string | null;
      workspace_transcript_path: string | null;
      memory_path: string | null;
      payload: string;
    }>;

    return rows.map((row) => {
      const payload = this.parseStoredPayload<RunRecord>(row.payload);
      const metadata =
        row.last_error && !payload.metadata?.error
          ? { ...(payload.metadata ?? {}), error: row.last_error }
          : payload.metadata;
      const normalizedMetadata = this.mergeRunMetadataPaths(metadata, row);
      return {
        ...payload,
        id: row.id,
        conversationId: row.conversation_id,
        title: row.title,
        kind: row.kind,
        status: row.status,
        actorId: row.actor_id,
        stepIndex: row.step_index,
        totalSteps: row.total_steps,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        metadata: normalizedMetadata,
      } satisfies RunRecord;
    });
  }

  private assertStructuredSchema() {
    this.assertTableColumns("providers", [
      "label",
      "base_url",
      "default_model",
      "supports_tool_calling",
      "supports_streaming",
      "is_active",
    ]);
    this.assertTableColumns("agents", [
      "name",
      "role",
      "status",
      "workspace_path",
      "avatar_path",
      "model_id",
    ]);
    this.assertTableColumns("teams", ["name", "workspace_path", "avatar_path"]);
    this.assertTableColumns("conversations", [
      "kind",
      "target_id",
      "title",
      "unread",
      "last_message",
      "active_skill",
      "pinned_mcp",
      "show_internal_messages",
    ]);
    this.assertTableColumns("messages", [
      "sender_id",
      "sender_name",
      "sender_kind",
      "message_type",
      "visibility",
      "content",
      "mentions_json",
      "run_id",
      "has_attachments",
    ]);
    this.assertTableColumns("runs", [
      "title",
      "kind",
      "status",
      "actor_id",
      "step_index",
      "total_steps",
      "created_at",
      "last_error",
      "artifact_path",
      "transcript_path",
      "workspace_transcript_path",
      "memory_path",
    ]);
    this.assertTableColumns("notifications", [
      "type",
      "title",
      "body",
      "read",
      "related_conversation_id",
      "related_run_id",
    ]);
  }

  private dropTeamObjectiveColumnIfPresent() {
    const columns = this.getTableColumnNames("teams");
    if (!columns.has("objective")) {
      return;
    }

    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.exec(`
        CREATE TABLE teams_next (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          workspace_path TEXT NOT NULL,
          avatar_path TEXT,
          payload TEXT NOT NULL
        );
        INSERT INTO teams_next (id, name, workspace_path, avatar_path, payload)
        SELECT id, name, workspace_path, avatar_path, payload FROM teams;
        DROP TABLE teams;
        ALTER TABLE teams_next RENAME TO teams;
      `);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private assertTableColumns(tableName: string, requiredColumns: string[]) {
    const existingColumns = this.getTableColumnNames(tableName);
    const missing = requiredColumns.filter((column) => !existingColumns.has(column));
    if (missing.length === 0) {
      return;
    }
    throw new Error(
      `检测到不兼容数据库 schema：${tableName} 缺少字段 ${missing.join(", ")}。请备份并删除 ~/.teamaligned/app.db 后重启应用。`,
    );
  }

  private getTableColumnNames(tableName: string) {
    const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    return new Set(rows.map((row) => row.name));
  }

  private extractAttachmentsFromMessage(message: MessageRecord): AttachmentAssetRecord[] {
    const attachments = message.metadata?.attachments;
    return Array.isArray(attachments) ? (attachments as AttachmentAssetRecord[]) : [];
  }

  private recordMessageAttachments(message: MessageRecord) {
    const attachments = this.extractAttachmentsFromMessage(message);
    if (attachments.length === 0) {
      return;
    }

    for (const attachment of attachments) {
      const alreadyRecorded = this.state.attachments.some(
        (item) =>
          item.messageId === message.id &&
          item.path === attachment.path &&
          item.conversationId === message.conversationId,
      );
      if (alreadyRecorded) {
        continue;
      }
      this.state.attachments.push({
        id: nanoid(),
        conversationId: message.conversationId,
        messageId: message.id,
        runId: message.runId,
        name: attachment.name,
        path: attachment.path,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        createdAt: message.createdAt,
      });
    }
  }

  private createEmptyState(): PersistedState {
    return {
      settingsEntries: this.createSettingsEntries(defaultSettings, defaultProfile),
      providers: [...defaultProviders],
      agents: [],
      teams: [],
      conversations: [],
      messages: [],
      runs: [],
      attachments: [],
      artifacts: [],
      toolInvocations: [],
      runSteps: [],
      notifications: [],
      extensions: [],
      promptAliases: [],
      skillCatalog: [],
      mcpCatalog: [],
      mcpConnections: [],
    };
  }

  ensureWorkspaceLayout(workspacePath: string, options: { type: "agent" | "team"; title: string; summary: string }) {
    return this.createWorkspaceLayout(workspacePath, options);
  }

  private ensureWorkspaceLayouts() {
    for (const agent of this.state.agents) {
      this.createWorkspaceLayout(agent.workspacePath, {
        type: "agent",
        title: agent.name,
        summary: agent.description,
      });
    }

    for (const team of this.state.teams) {
      this.createWorkspaceLayout(team.workspacePath, {
        type: "team",
        title: team.name,
        summary: team.description,
      });
    }
  }

  private createWorkspaceLayout(
    workspacePath: string,
    options: { type: "agent" | "team"; title: string; summary: string },
  ): WorkspaceLayout {
    const artifactsPath = join(workspacePath, "artifacts");
    const attachmentsPath = join(artifactsPath, "attachments");
    const memoryPath = join(workspacePath, "memory");
    const sessionsPath = join(workspacePath, "sessions");
    const memoryFilePath = join(memoryPath, "MEMORY.md");
    const sharedMemoryPath = join(workspacePath, "shared-memory.md");

    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(artifactsPath, { recursive: true });
    mkdirSync(attachmentsPath, { recursive: true });
    mkdirSync(memoryPath, { recursive: true });
    mkdirSync(sessionsPath, { recursive: true });

    if (!existsSync(memoryFilePath)) {
      writeFileSync(
        memoryFilePath,
        `# ${options.title} 记忆\n\n- 类型：${options.type === "agent" ? "Agent" : "团队"}\n- 说明：${options.summary}\n- 最近更新：初始化完成\n`,
        "utf8",
      );
    }

    if (options.type === "team" && !existsSync(sharedMemoryPath)) {
      writeFileSync(
        sharedMemoryPath,
        `# ${options.title} 共享记忆\n\n- 说明：${options.summary}\n- 最近更新：初始化完成\n`,
        "utf8",
      );
    }

    return {
      workspacePath,
      artifactsPath,
      attachmentsPath,
      memoryPath,
      sessionsPath,
      memoryFilePath,
      sharedMemoryPath,
    };
  }

  saveAvatarAsset(input: { scope: "profile" | "agents" | "teams"; dataUrl: string; fileNameHint?: string }) {
    const parsed = input.dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!parsed) {
      throw new Error("头像格式无效，当前仅支持 data URL 图片。");
    }

    const [, mimeType, base64Payload] = parsed;
    const extension =
      mimeType === "image/jpeg"
        ? "jpg"
        : mimeType === "image/png"
          ? "png"
          : mimeType === "image/webp"
            ? "webp"
            : mimeType === "image/gif"
              ? "gif"
              : "png";

    const root =
      input.scope === "profile"
        ? this.profileAvatarRoot
        : input.scope === "agents"
          ? this.agentAvatarRoot
          : this.teamAvatarRoot;

    const safeHint = (input.fileNameHint || input.scope)
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
    const fileName = `${safeHint || input.scope}-${nanoid(8)}.${extension}`;
    const filePath = join(root, fileName);
    writeFileSync(filePath, Buffer.from(base64Payload, "base64"));
    return filePath;
  }

  saveAttachmentAsset(input: { conversationId: string; dataUrl: string; fileName: string }): AttachmentAssetRecord {
    const parsed = input.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!parsed) {
      throw new Error("附件格式无效，当前仅支持 data URL 文件。");
    }

    const [, mimeType, base64Payload] = parsed;
    const sourceName = input.fileName.trim() || "attachment";
    const extensionMatch = sourceName.match(/\.([a-zA-Z0-9]+)$/);
    const inferredExtension =
      extensionMatch?.[1]?.toLowerCase() ??
      (mimeType === "image/jpeg"
        ? "jpg"
        : mimeType === "image/png"
          ? "png"
          : mimeType === "image/webp"
            ? "webp"
            : mimeType === "application/pdf"
              ? "pdf"
              : mimeType === "text/plain"
                ? "txt"
                : "bin");

    const safeBaseName = sourceName
      .replace(/\.[^.]+$/, "")
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
    const safeConversation = input.conversationId
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
    const fileName = `${safeConversation || "conversation"}-${safeBaseName || "attachment"}-${nanoid(8)}.${inferredExtension}`;
    const attachmentsPath = this.getConversationAttachmentsPath(input.conversationId);
    const filePath = join(attachmentsPath, fileName);
    const buffer = Buffer.from(base64Payload, "base64");

    writeFileSync(filePath, buffer);

    return {
      name: sourceName,
      path: filePath,
      mimeType,
      sizeBytes: buffer.byteLength,
    };
  }

  getConversationAttachmentRoots(conversationId: string) {
    const roots = new Set<string>();
    roots.add(this.getConversationAttachmentsPath(conversationId));

    for (const attachment of this.state.attachments) {
      if (attachment.conversationId !== conversationId) continue;
      roots.add(dirname(attachment.path));
    }

    return Array.from(roots);
  }

  getConversationTranscriptPaths(conversationId: string) {
    return {
      globalTranscriptPath: join(this.transcriptRoot, `${conversationId}.jsonl`),
      workspaceTranscriptPath: this.getWorkspaceSessionPath(conversationId),
    };
  }

  private appendTranscript(message: MessageRecord) {
    const transcriptPath = join(this.transcriptRoot, `${message.conversationId}.jsonl`);
    const payload = `${JSON.stringify(message)}\n`;
    appendFileSync(transcriptPath, payload, "utf8");

    const sessionPath = this.getWorkspaceSessionPath(message.conversationId);
    if (sessionPath) {
      appendFileSync(sessionPath, payload, "utf8");
    }
  }

  private getWorkspaceSessionPath(conversationId: string) {
    const layout = this.getConversationWorkspaceLayout(conversationId);
    if (!layout) return null;
    return join(layout.sessionsPath, `${conversationId}.jsonl`);
  }

  private getConversationAttachmentsPath(conversationId: string) {
    const layout = this.getConversationWorkspaceLayout(conversationId);
    if (!layout) {
      throw new Error(`未找到会话 ${conversationId} 对应的 workspace。`);
    }
    return layout.attachmentsPath;
  }

  private getConversationWorkspaceLayout(conversationId: string) {
    const conversation = this.getConversation(conversationId);
    if (!conversation) return null;

    if (conversation.kind === "agent") {
      const agent = this.getAgent(conversation.targetId);
      if (!agent) return null;
      return this.ensureWorkspaceLayout(agent.workspacePath, {
        type: "agent",
        title: agent.name,
        summary: agent.description,
      });
    }

    const team = this.getTeam(conversation.targetId);
    if (!team) return null;
    return this.ensureWorkspaceLayout(team.workspacePath, {
      type: "team",
      title: team.name,
      summary: team.description,
    });
  }

  private seedIfEmpty(
    configState: { settingsEntries: Record<string, string>; providers: ProviderConfig[] } | null = null,
  ) {
    this.state = this.createEmptyState();
    if (configState) {
      this.state.settingsEntries = configState.settingsEntries;
      this.state.providers = configState.providers;
    }
    this.seedStarterWorkspace(now());
    this.persist();
  }

  private ensureStarterWorkspaceIfNeeded() {
    const hasChatEntities =
      this.state.agents.length > 0 ||
      this.state.teams.length > 0 ||
      this.state.conversations.length > 0 ||
      this.state.messages.length > 0;

    const seededVersion = this.state.settingsEntries[starterSeedVersionKey];
    if (hasChatEntities) {
      if (seededVersion === starterSeedVersion) {
        return false;
      }
      this.state.settingsEntries[starterSeedVersionKey] = starterSeedVersion;
      return true;
    }

    if (seededVersion === starterSeedVersion) {
      return false;
    }

    this.seedStarterWorkspace(now());
    return true;
  }

  private seedStarterWorkspace(timestamp: number) {
    const language = this.state.settingsEntries["settings.language"] === "en" ? "en" : "zh";

    const agentSeeds = [
      {
        id: "agent-nova",
        name: "Nova",
        role: language === "en" ? "Data Analyst" : "数据分析师",
        avatar: "N",
        color: agentPalette[0],
        status: "online" as const,
        description:
          language === "en"
            ? "Great at data analysis, metric breakdown, and concise conclusions."
            : "擅长数据分析、指标拆解与结论总结。",
        capabilities:
          language === "en"
            ? ["Data cleaning", "Statistical analysis", "Reporting", "Retrospectives"]
            : ["数据清洗", "统计分析", "图表报告", "复盘总结"],
      },
      {
        id: "agent-coder",
        name: "Coder",
        role: language === "en" ? "Full-stack Engineer" : "全栈开发",
        avatar: "C",
        color: agentPalette[1],
        status: "online" as const,
        description:
          language === "en"
            ? "Builds frontend, backend, and local toolchain implementation."
            : "负责前端、后端与本地工具链实现。",
        capabilities: ["React", "Electron", "Node.js", "TypeScript"],
      },
      {
        id: "agent-designer",
        name: "Designer",
        role: language === "en" ? "UI/UX Designer" : "UI/UX 设计师",
        avatar: "D",
        color: agentPalette[2],
        status: "online" as const,
        description:
          language === "en"
            ? "Turns complex workflows into clear and shippable interactions."
            : "把复杂系统整理成清晰、可落地的交互。",
        capabilities:
          language === "en"
            ? ["Information architecture", "Wireframing", "Visual system", "Interaction design"]
            : ["信息架构", "原型设计", "视觉系统", "交互梳理"],
      },
      {
        id: "agent-planner",
        name: "Planner",
        role: language === "en" ? "Project Manager" : "项目经理",
        avatar: "P",
        color: agentPalette[3],
        status: "online" as const,
        description:
          language === "en"
            ? "Strong at scoping, prioritization, and multi-agent coordination."
            : "擅长拆任务、排优先级和组织多人协作。",
        capabilities:
          language === "en"
            ? ["Task breakdown", "Milestones", "Risk alerts", "Collaboration rhythm"]
            : ["任务拆解", "里程碑规划", "风险提示", "协作节奏"],
      },
      {
        id: "agent-researcher",
        name: "Researcher",
        role: language === "en" ? "Researcher" : "研究员",
        avatar: "R",
        color: agentPalette[4],
        status: "online" as const,
        description:
          language === "en"
            ? "Good at searching, synthesizing, and turning background into insights."
            : "擅长检索、归纳与形成背景信息。",
        capabilities:
          language === "en"
            ? ["Research search", "Trend analysis", "Competitive scan", "Long-form synthesis"]
            : ["资料检索", "趋势分析", "竞品研究", "长文提炼"],
      },
    ];

    for (const [index, seed] of agentSeeds.entries()) {
      const workspacePath = join(this.agentWorkspaceRoot, seed.id);
      this.ensureWorkspaceLayout(workspacePath, {
        type: "agent",
        title: seed.name,
        summary: seed.description,
      });
      this.state.agents.push({
        id: seed.id,
        name: seed.name,
        role: seed.role,
        avatar: seed.avatar,
        avatarPath: null,
        avatarColor: seed.color,
        status: seed.status,
        description: seed.description,
        capabilities: [...seed.capabilities],
        skillWhitelist: defaultSkillCatalog.map((skill) => skill.id),
        mcpWhitelist: [...defaultConnectedMcpIds],
        workspacePath,
        modelId: index % 2 === 0 ? "qwen-max" : "gpt-5",
      });
    }

    const teamSeeds = [
      {
        id: "team-product",
        name: language === "en" ? "Product Squad" : "产品开发组",
        description:
          language === "en"
            ? "A starter squad to quickly collaborate on TeamAligned beta tasks."
            : "围绕 teamaligned 的 MVP 体验快速协作。",
        avatar: language === "en" ? "P" : "产",
        avatarColor: teamPalette[0],
        members: ["agent-planner", "agent-designer", "agent-coder"],
      },
      {
        id: "team-research",
        name: language === "en" ? "Research Squad" : "市场研究组",
        description:
          language === "en"
            ? "Collects context and user feedback, then feeds insights to product delivery."
            : "负责背景研究、用户反馈与方案补充。",
        avatar: language === "en" ? "R" : "研",
        avatarColor: teamPalette[1],
        members: ["agent-nova", "agent-researcher", "agent-planner"],
      },
    ];

    for (const seed of teamSeeds) {
      const workspacePath = join(this.teamWorkspaceRoot, seed.id);
      this.ensureWorkspaceLayout(workspacePath, {
        type: "team",
        title: seed.name,
        summary: seed.description,
      });
      this.state.teams.push({
        id: seed.id,
        name: seed.name,
        description: seed.description,
        avatar: seed.avatar,
        avatarPath: null,
        avatarColor: seed.avatarColor,
        workspacePath,
        memberIds: [...seed.members],
        context: defaultTeamContext(),
      });
    }

    this.state.conversations = [
      {
        id: "conv-agent-nova",
        kind: "agent",
        targetId: "agent-nova",
        title: "Nova",
        unread: 1,
        lastMessage:
          language === "en"
            ? "I’ve prepared an overview. Want me to continue with a chart?"
            : "数据摘要已经整理好了，你要我继续出图表吗？",
        lastActivityAt: timestamp,
        meta: { ...defaultConversationMeta },
      },
      {
        id: "conv-team-product",
        kind: "team",
        targetId: "team-product",
        title: language === "en" ? "Product Squad" : "产品开发组",
        unread: 1,
        lastMessage:
          language === "en"
            ? "Planner: Let’s align on the first beta milestone."
            : "Planner: 现在优先把单聊命令和群聊编排体验打通。",
        lastActivityAt: timestamp - 1000 * 60 * 4,
        meta: { ...defaultConversationMeta },
      },
    ];

    const seedMessages: Array<Omit<MessageRecord, "id">> =
      language === "en"
        ? [
            {
              conversationId: "conv-agent-nova",
              senderId: "user",
              senderName: "You",
              senderKind: "user",
              messageType: "user",
              visibility: "public",
              content: "Nova, what should we focus on first for this project?",
              mentions: [],
              createdAt: timestamp - 1000 * 60 * 14,
              runId: null,
              metadata: null,
            },
            {
              conversationId: "conv-agent-nova",
              senderId: "agent-nova",
              senderName: "Nova",
              senderKind: "agent",
              messageType: "agent",
              visibility: "public",
              content:
                "The top priority is to make TeamAligned clearly usable in single chat and group collaboration flows.",
              mentions: [],
              createdAt: timestamp - 1000 * 60 * 12,
              runId: null,
              metadata: null,
            },
            {
              conversationId: "conv-team-product",
              senderId: "agent-planner",
              senderName: "Planner",
              senderKind: "agent",
              messageType: "agent",
              visibility: "public",
              content: "Team, let's align on the first beta milestone and split responsibilities.",
              mentions: [],
              createdAt: timestamp - 1000 * 60 * 10,
              runId: null,
              metadata: null,
            },
          ]
        : [
            {
              conversationId: "conv-agent-nova",
              senderId: "user",
              senderName: "你",
              senderKind: "user",
              messageType: "user",
              visibility: "public",
              content: "Nova，帮我总结一下这个项目现在最重要的目标。",
              mentions: [],
              createdAt: timestamp - 1000 * 60 * 14,
              runId: null,
              metadata: null,
            },
            {
              conversationId: "conv-agent-nova",
              senderId: "agent-nova",
              senderName: "Nova",
              senderKind: "agent",
              messageType: "agent",
              visibility: "public",
              content:
                "当前最重要的目标是先把 teamaligned 做成一个可体验的桌面原型，优先验证单聊命令、群聊协作和本地运行时。",
              mentions: [],
              createdAt: timestamp - 1000 * 60 * 12,
              runId: null,
              metadata: null,
            },
            {
              conversationId: "conv-team-product",
              senderId: "agent-planner",
              senderName: "Planner",
              senderKind: "agent",
              messageType: "agent",
              visibility: "public",
              content: "大家今天先集中做 MVP 的 0.1 核心交互。",
              mentions: [],
              createdAt: timestamp - 1000 * 60 * 10,
              runId: null,
              metadata: null,
            },
          ];

    this.state.messages = seedMessages.map((message) => ({
      ...message,
      id: nanoid(),
    }));

    this.state.extensions = this.state.extensions.length > 0 ? this.state.extensions : [...defaultExtensions];
    this.state.skillCatalog = this.state.skillCatalog.length > 0 ? this.state.skillCatalog : [...defaultSkillCatalog];
    this.state.mcpCatalog = this.state.mcpCatalog.length > 0 ? this.state.mcpCatalog : [...defaultMcpCatalog];
    this.state.mcpConnections = this.state.mcpConnections.length > 0 ? this.state.mcpConnections : [];
    this.state.providers = this.state.providers.length > 0 ? this.state.providers : [...defaultProviders];
    this.state.settingsEntries =
      Object.keys(this.state.settingsEntries).length > 0
        ? this.state.settingsEntries
        : this.createSettingsEntries(defaultSettings, defaultProfile);
    this.state.settingsEntries[starterSeedVersionKey] = starterSeedVersion;

    this.createNotification({
      type: "system",
      title: language === "en" ? "Welcome to TeamAligned" : "欢迎来到 teamaligned",
      body:
        language === "en"
          ? "Starter Agents and a group are ready. You can start chatting right away."
          : "已为你准备好默认 Agent 和群组，你现在可以直接开始聊天。",
      relatedConversationId: "conv-team-product",
      relatedRunId: null,
      createdAt: timestamp,
    });

    for (const message of this.state.messages) {
      this.appendTranscript(message);
    }
  }

  private createSettingsEntries(settings: AppSettings, profile: UserProfile) {
    return {
      "settings.theme": settings.theme,
      "settings.language": settings.language,
      "settings.notifyAgentComplete": String(settings.notifyAgentComplete),
      "settings.notifyMention": String(settings.notifyMention),
      "settings.notifyGroup": String(settings.notifyGroup),
      "settings.activeProviderId": settings.activeProviderId,
      "profile.name": profile.name,
      "profile.role": profile.role,
      "profile.team": profile.team,
      "profile.email": profile.email,
      "profile.bio": profile.bio,
      "profile.avatarPath": profile.avatarPath ?? "null",
    };
  }

  private createConfigStateFromDb(input: {
    settingsEntries: Record<string, string>;
    providers: ProviderConfig[];
  }) {
    const settingsEntries =
      Object.keys(input.settingsEntries).length > 0
        ? input.settingsEntries
        : this.createSettingsEntries(defaultSettings, defaultProfile);
    const providers = input.providers.length > 0 ? input.providers : [...defaultProviders];
    const activeProviderId =
      (settingsEntries["settings.activeProviderId"] as AppSettings["activeProviderId"] | undefined) ??
      defaultSettings.activeProviderId;

    return {
      settingsEntries,
      providers: providers.map((provider) => ({
        ...provider,
        isActive: provider.id === activeProviderId,
      })),
    };
  }

  private readSettingsFile() {
    if (!existsSync(this.configPath)) {
      return null;
    }

    try {
      const payload = JSON.parse(readFileSync(this.configPath, "utf8")) as SettingsFilePayload;
      const settings: AppSettings = {
        theme: payload.theme ?? defaultSettings.theme,
        language: payload.language ?? defaultSettings.language,
        notifyAgentComplete: payload.notifications?.agentComplete ?? defaultSettings.notifyAgentComplete,
        notifyMention: payload.notifications?.mention ?? defaultSettings.notifyMention,
        notifyGroup: payload.notifications?.group ?? defaultSettings.notifyGroup,
        activeProviderId: payload.activeProviderId ?? defaultSettings.activeProviderId,
      };
      const profile: UserProfile = {
        name: payload.profile?.name ?? defaultProfile.name,
        role: payload.profile?.role ?? defaultProfile.role,
        team: payload.profile?.team ?? defaultProfile.team,
        email: payload.profile?.email ?? defaultProfile.email,
        bio: payload.profile?.bio ?? defaultProfile.bio,
        avatarPath:
          payload.profile?.avatarPath === undefined ? defaultProfile.avatarPath : payload.profile.avatarPath,
      };
      const providers =
        Array.isArray(payload.providers) && payload.providers.length > 0
          ? payload.providers
          : [...defaultProviders];

      return {
        settingsEntries: this.createSettingsEntries(settings, profile),
        providers: providers.map((provider) => ({
          ...provider,
          isActive: provider.id === settings.activeProviderId,
        })),
      };
    } catch {
      return null;
    }
  }

  private persistSettingsFile() {
    const settings = this.getSettings();
    const profile = this.getProfile();
    const payload: SettingsFilePayload = {
      theme: settings.theme,
      language: settings.language,
      notifications: {
        agentComplete: settings.notifyAgentComplete,
        mention: settings.notifyMention,
        group: settings.notifyGroup,
      },
      activeProviderId: settings.activeProviderId,
      providers: this.state.providers.map((provider) => ({
        ...provider,
        isActive: provider.id === settings.activeProviderId,
      })),
      profile,
    };

    writeFileSync(this.configPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  }

  private getStats(
    agents: AgentRecord[],
    teams: TeamRecord[],
    messagesByConversation: Record<string, MessageRecord[]>,
  ): DashboardStats {
    const runs = this.listRuns();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const totalMessages = Object.values(messagesByConversation).reduce(
      (sum, items) => sum + items.length,
      0,
    );

    return {
      activeAgents: agents.filter((agent) => agent.status === "online").length,
      totalAgents: agents.length,
      totalTeams: teams.length,
      runningRuns: runs.filter((run) => ["running", "pausing", "resuming"].includes(run.status)).length,
      completedToday: runs.filter(
        (run) => run.status === "completed" && run.updatedAt >= startOfDay.getTime(),
      ).length,
      totalMessages,
      tokenEstimate: totalMessages * 128,
    };
  }
}

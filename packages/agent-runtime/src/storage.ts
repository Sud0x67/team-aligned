import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
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
  AppSettings,
  AppSnapshot,
  ConversationMeta,
  ConversationRecord,
  CreateAgentInput,
  CreateTeamInput,
  DashboardStats,
  ExtensionRecord,
  McpCatalogRecord,
  McpConnectionRecord,
  MessageRecord,
  NotificationRecord,
  ProviderConfig,
  RunRecord,
  SkillCatalogRecord,
  TeamContext,
  TeamRecord,
  UpdateAgentSkillsInput,
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
  skillCatalog: SkillCatalogRecord[];
  mcpCatalog: McpCatalogRecord[];
  mcpConnections: McpConnectionRecord[];
};

type WorkspaceLayout = {
  workspacePath: string;
  artifactsPath: string;
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

type StoredArtifactRecord = {
  id: string;
  conversationId: string;
  runId: string | null;
  artifactKind: "agent_output" | "team_output" | "command_output";
  title: string;
  path: string;
  workspacePath: string;
  createdAt: number;
  metadata: Record<string, unknown> | null;
};

type StoredToolInvocationRecord = {
  id: string;
  conversationId: string;
  runId: string | null;
  serverId: string;
  serverName: string;
  toolName: string;
  status: "running" | "completed" | "failed";
  inputJson: string;
  outputText: string | null;
  errorText: string | null;
  createdAt: number;
  completedAt: number | null;
  metadata: Record<string, unknown> | null;
};

type StoredRunStepRecord = {
  id: string;
  runId: string;
  conversationId: string;
  stepIndex: number;
  label: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  startedAt: number | null;
  completedAt: number | null;
  errorText: string | null;
  metadata: Record<string, unknown> | null;
};

function now() {
  return Date.now();
}

const agentPalette = ["#7c3aed", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#3b82f6"];
const teamPalette = ["#7c3aed", "#0ea5e9", "#14b8a6", "#8b5cf6"];

export class AppStorage {
  readonly rootDir: string;
  readonly filePath: string;
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
  readonly attachmentsRoot: string;
  private readonly db: DatabaseSync;
  private state: PersistedState;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.filePath = join(rootDir, "app-state.json");
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
    this.attachmentsRoot = join(rootDir, "artifacts", "attachments");

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
    mkdirSync(this.attachmentsRoot, { recursive: true });

    this.db = new DatabaseSync(this.dbPath);
    this.setupSchema();
    this.state = this.createEmptyState();
  }

  init() {
    if (this.databaseHasData()) {
      this.loadState();
      this.ensureWorkspaceLayouts();
      return;
    }

    if (existsSync(this.filePath)) {
      this.loadLegacyState();
      this.ensureWorkspaceLayouts();
      this.persist();
      this.backupLegacyState();
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
      notifications: this.listNotifications(),
      extensions: this.listExtensions(),
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
    const workspacePath = input.workspacePath || join(this.teamWorkspaceRoot, id);
    this.ensureWorkspaceLayout(workspacePath, {
      type: "team",
      title: input.name,
      summary: input.objective,
    });

    const team: TeamRecord = {
      id,
      name: input.name,
      description: input.description,
      avatar: input.name.slice(0, 1),
      avatarPath: input.avatarPath ?? null,
      avatarColor: teamPalette[this.state.teams.length % teamPalette.length],
      objective: input.objective,
      workspacePath,
      memberIds: input.memberIds,
      mcpWhitelist: this.listMcpConnections()
        .filter((connection) => connection.enabled && connection.status === "connected")
        .map((connection) => connection.serverId),
      context: defaultTeamContext(input.objective),
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

  addMessage(input: Omit<MessageRecord, "id"> & { id?: string }) {
    const message: MessageRecord = {
      ...input,
      id: input.id ?? nanoid(),
    };

    this.state.messages.push(message);
    const conversation = this.getConversation(input.conversationId);
    if (conversation) {
      conversation.lastMessage = input.content.replace(/\n+/g, " ").slice(0, 120);
      conversation.lastActivityAt = now();
      if (input.senderKind !== "user") {
        conversation.unread += 1;
      }
    }
    this.recordMessageAttachments(message);
    this.persist();
    this.appendTranscript(message);
    return message;
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
    this.state.notifications.unshift({
      id: nanoid(),
      type: input.type,
      title: input.title,
      body: input.body,
      read: false,
      createdAt: input.createdAt ?? now(),
      relatedConversationId: input.relatedConversationId,
      relatedRunId: input.relatedRunId,
    });
    this.persist();
  }

  markNotificationsRead() {
    for (const item of this.state.notifications) {
      item.read = true;
    }
    this.persist();
  }

  listExtensions(): ExtensionRecord[] {
    return [...this.state.extensions].sort((a, b) => a.name.localeCompare(b.name, "en"));
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
    for (const team of this.state.teams) {
      team.mcpWhitelist = team.mcpWhitelist.filter((serverId) => validIds.has(serverId));
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
      for (const team of this.state.teams) {
        if (!team.mcpWhitelist.includes(connection.serverId)) {
          team.mcpWhitelist.push(connection.serverId);
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

  updateTeamMcpWhitelist(input: { teamId: string; serverIds: string[] }) {
    const team = this.getTeam(input.teamId);
    if (!team) return;
    team.mcpWhitelist = Array.from(new Set(input.serverIds));
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
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        last_activity_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS extensions (
        id TEXT PRIMARY KEY,
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
    this.ensureColumn("conversations", "kind", "TEXT");
    this.ensureColumn("conversations", "target_id", "TEXT");
    this.ensureColumn("conversations", "title", "TEXT");
    this.ensureColumn("conversations", "unread", "INTEGER DEFAULT 0");
    this.ensureColumn("conversations", "last_message", "TEXT");
    this.ensureColumn("conversations", "active_skill", "TEXT");
    this.ensureColumn("conversations", "pinned_mcp", "TEXT");
    this.ensureColumn("conversations", "show_internal_messages", "INTEGER DEFAULT 0");

    this.ensureColumn("messages", "sender_id", "TEXT");
    this.ensureColumn("messages", "sender_name", "TEXT");
    this.ensureColumn("messages", "sender_kind", "TEXT");
    this.ensureColumn("messages", "message_type", "TEXT");
    this.ensureColumn("messages", "visibility", "TEXT");
    this.ensureColumn("messages", "content", "TEXT");
    this.ensureColumn("messages", "mentions_json", "TEXT");
    this.ensureColumn("messages", "run_id", "TEXT");
    this.ensureColumn("messages", "has_attachments", "INTEGER DEFAULT 0");

    this.ensureColumn("runs", "title", "TEXT");
    this.ensureColumn("runs", "kind", "TEXT");
    this.ensureColumn("runs", "status", "TEXT");
    this.ensureColumn("runs", "actor_id", "TEXT");
    this.ensureColumn("runs", "step_index", "INTEGER DEFAULT 0");
    this.ensureColumn("runs", "total_steps", "INTEGER DEFAULT 0");
    this.ensureColumn("runs", "created_at", "INTEGER");
    this.ensureColumn("runs", "last_error", "TEXT");

    this.db.exec(`
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
    const insertProvider = this.db.prepare("INSERT INTO providers (id, payload) VALUES (?, ?)");
    const insertAgent = this.db.prepare("INSERT INTO agents (id, payload) VALUES (?, ?)");
    const insertTeam = this.db.prepare("INSERT INTO teams (id, payload) VALUES (?, ?)");
    const insertConversation = this.db.prepare(
      "INSERT INTO conversations (id, kind, target_id, title, unread, last_message, last_activity_at, active_skill, pinned_mcp, show_internal_messages, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertMessage = this.db.prepare(
      "INSERT INTO messages (id, conversation_id, sender_id, sender_name, sender_kind, message_type, visibility, content, mentions_json, created_at, run_id, has_attachments, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertRun = this.db.prepare(
      "INSERT INTO runs (id, conversation_id, title, kind, status, actor_id, step_index, total_steps, created_at, updated_at, last_error, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    const insertNotification = this.db.prepare(
      "INSERT INTO notifications (id, created_at, payload) VALUES (?, ?, ?)",
    );
    const insertExtension = this.db.prepare("INSERT INTO extensions (id, payload) VALUES (?, ?)");
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
        insertProvider.run(provider.id, JSON.stringify(provider));
      }
      for (const agent of this.state.agents) {
        insertAgent.run(agent.id, JSON.stringify(agent));
      }
      for (const team of this.state.teams) {
        insertTeam.run(team.id, JSON.stringify(team));
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
          conversation.meta.activeSkill,
          conversation.meta.pinnedMcp,
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
          message.runId,
          this.extractAttachmentsFromMessage(message).length > 0 ? 1 : 0,
          JSON.stringify(message),
        );
      }
      for (const run of this.state.runs) {
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
          JSON.stringify(run),
        );
      }
      for (const notification of this.state.notifications) {
        insertNotification.run(notification.id, notification.createdAt, JSON.stringify(notification));
      }
      for (const extension of this.state.extensions) {
        insertExtension.run(extension.id, JSON.stringify(extension));
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
        providers: this.readCollection<ProviderConfig>("providers"),
      });

    this.state = {
      settingsEntries: configState.settingsEntries,
      providers: configState.providers,
      agents: this.readCollection<AgentRecord>("agents").map((agent) => ({
        ...agent,
        skillWhitelist: Array.isArray(agent.skillWhitelist)
          ? agent.skillWhitelist
          : defaultSkillCatalog.map((skill) => skill.id),
        mcpWhitelist: Array.isArray(agent.mcpWhitelist) ? agent.mcpWhitelist : defaultConnectedMcpIds,
      })),
      teams: this.readCollection<TeamRecord>("teams").map((team) => ({
        ...team,
        mcpWhitelist: Array.isArray(team.mcpWhitelist) ? team.mcpWhitelist : defaultConnectedMcpIds,
      })),
      conversations: this.readConversations(),
      messages: this.readMessages(),
      runs: this.readRuns(),
      attachments: this.readStructuredCollection<StoredAttachmentRecord>(
        "attachments",
        "ORDER BY created_at ASC",
      ),
      artifacts: this.readStructuredCollection<StoredArtifactRecord>(
        "artifacts",
        "ORDER BY created_at DESC",
      ),
      toolInvocations: this.readStructuredCollection<StoredToolInvocationRecord>(
        "tool_invocations",
        "ORDER BY created_at ASC",
      ),
      runSteps: this.readStructuredCollection<StoredRunStepRecord>(
        "run_steps",
        "ORDER BY run_id ASC, step_index ASC",
      ),
      notifications: this.readCollection<NotificationRecord>("notifications", "ORDER BY created_at DESC"),
      extensions: this.readCollection<ExtensionRecord>("extensions"),
      skillCatalog: skillCatalog.length > 0 ? skillCatalog : defaultSkillCatalog,
      mcpCatalog: mcpCatalog.length > 0 ? mcpCatalog : defaultMcpCatalog,
      mcpConnections: this.readCollection<McpConnectionRecord>("mcp_connections"),
    };
    this.persistSettingsFile();
  }

  private loadLegacyState() {
    const legacy = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<PersistedState>;
    const fileConfig = this.readSettingsFile();
    const configState =
      fileConfig ??
      this.createConfigStateFromDb({
        settingsEntries: legacy.settingsEntries ?? {},
        providers: legacy.providers ?? defaultProviders,
      });
    this.state = {
      ...this.createEmptyState(),
      ...legacy,
      settingsEntries: configState.settingsEntries,
      providers: configState.providers,
      agents: (legacy.agents ?? []).map((agent) => ({
        ...agent,
        skillWhitelist: Array.isArray(agent.skillWhitelist)
          ? agent.skillWhitelist
          : defaultSkillCatalog.map((skill) => skill.id),
        mcpWhitelist: Array.isArray((agent as AgentRecord).mcpWhitelist)
          ? (agent as AgentRecord).mcpWhitelist
          : defaultConnectedMcpIds,
      })),
      teams: (legacy.teams ?? []).map((team) => ({
        ...team,
        mcpWhitelist: Array.isArray((team as TeamRecord).mcpWhitelist)
          ? (team as TeamRecord).mcpWhitelist
          : defaultConnectedMcpIds,
      })),
      attachments: [],
      artifacts: [],
      toolInvocations: [],
      runSteps: [],
      skillCatalog: legacy.skillCatalog ?? defaultSkillCatalog,
      mcpCatalog: (legacy as Partial<PersistedState>).mcpCatalog ?? defaultMcpCatalog,
      mcpConnections: (legacy as Partial<PersistedState>).mcpConnections ?? [],
    };
    this.persistSettingsFile();
  }

  private backupLegacyState() {
    if (!existsSync(this.filePath)) return;
    try {
      renameSync(this.filePath, `${this.filePath}.migrated`);
    } catch {
      // Best effort backup only.
    }
  }

  private readCollection<T>(tableName: string, orderClause = "") {
    const rows = this.db
      .prepare(`SELECT payload FROM ${tableName} ${orderClause}`.trim())
      .all() as Array<{ payload: string }>;
    return rows.map((row) => JSON.parse(row.payload) as T);
  }

  private readStructuredCollection<T>(tableName: string, orderClause = "") {
    return this.readCollection<T>(tableName, orderClause);
  }

  private readConversations() {
    const rows = this.db
      .prepare(
        `SELECT id, kind, target_id, title, unread, last_message, last_activity_at, active_skill, pinned_mcp, show_internal_messages, payload
         FROM conversations
         ORDER BY last_activity_at DESC`,
      )
      .all() as Array<{
      id: string;
      kind: ConversationRecord["kind"] | null;
      target_id: string | null;
      title: string | null;
      unread: number | null;
      last_message: string | null;
      last_activity_at: number;
      active_skill: string | null;
      pinned_mcp: string | null;
      show_internal_messages: number | null;
      payload: string;
    }>;

    return rows.map((row) => {
      const payload = JSON.parse(row.payload) as ConversationRecord;
      return {
        ...payload,
        id: row.id || payload.id,
        kind: row.kind ?? payload.kind,
        targetId: row.target_id ?? payload.targetId,
        title: row.title ?? payload.title,
        unread: row.unread ?? payload.unread,
        lastMessage: row.last_message ?? payload.lastMessage,
        lastActivityAt: row.last_activity_at ?? payload.lastActivityAt,
        meta: {
          ...payload.meta,
          activeSkill: row.active_skill ?? payload.meta.activeSkill,
          pinnedMcp: row.pinned_mcp ?? payload.meta.pinnedMcp,
          showInternalMessages:
            row.show_internal_messages === null
              ? payload.meta.showInternalMessages
              : row.show_internal_messages === 1,
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
      sender_id: string | null;
      sender_name: string | null;
      sender_kind: MessageRecord["senderKind"] | null;
      message_type: MessageRecord["messageType"] | null;
      visibility: MessageRecord["visibility"] | null;
      content: string | null;
      mentions_json: string | null;
      created_at: number;
      run_id: string | null;
      payload: string;
    }>;

    return rows.map((row) => {
      const payload = JSON.parse(row.payload) as MessageRecord;
      return {
        ...payload,
        id: row.id || payload.id,
        conversationId: row.conversation_id ?? payload.conversationId,
        senderId: row.sender_id ?? payload.senderId,
        senderName: row.sender_name ?? payload.senderName,
        senderKind: row.sender_kind ?? payload.senderKind,
        messageType: row.message_type ?? payload.messageType,
        visibility: row.visibility ?? payload.visibility,
        content: row.content ?? payload.content,
        mentions: row.mentions_json ? (JSON.parse(row.mentions_json) as string[]) : payload.mentions,
        createdAt: row.created_at ?? payload.createdAt,
        runId: row.run_id ?? payload.runId,
      } satisfies MessageRecord;
    });
  }

  private readRuns() {
    const rows = this.db
      .prepare(
        `SELECT id, conversation_id, title, kind, status, actor_id, step_index, total_steps, created_at, updated_at, last_error, payload
         FROM runs
         ORDER BY updated_at DESC`,
      )
      .all() as Array<{
      id: string;
      conversation_id: string;
      title: string | null;
      kind: RunRecord["kind"] | null;
      status: RunRecord["status"] | null;
      actor_id: string | null;
      step_index: number | null;
      total_steps: number | null;
      created_at: number | null;
      updated_at: number;
      last_error: string | null;
      payload: string;
    }>;

    return rows.map((row) => {
      const payload = JSON.parse(row.payload) as RunRecord;
      const metadata =
        row.last_error && !payload.metadata?.error
          ? { ...(payload.metadata ?? {}), error: row.last_error }
          : payload.metadata;
      return {
        ...payload,
        id: row.id || payload.id,
        conversationId: row.conversation_id ?? payload.conversationId,
        title: row.title ?? payload.title,
        kind: row.kind ?? payload.kind,
        status: row.status ?? payload.status,
        actorId: row.actor_id ?? payload.actorId,
        stepIndex: row.step_index ?? payload.stepIndex,
        totalSteps: row.total_steps ?? payload.totalSteps,
        createdAt: row.created_at ?? payload.createdAt,
        updatedAt: row.updated_at ?? payload.updatedAt,
        metadata,
      } satisfies RunRecord;
    });
  }

  private ensureColumn(tableName: string, columnName: string, definition: string) {
    const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    if (rows.some((row) => row.name === columnName)) {
      return;
    }
    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
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
        summary: team.objective,
      });
    }
  }

  private createWorkspaceLayout(
    workspacePath: string,
    options: { type: "agent" | "team"; title: string; summary: string },
  ): WorkspaceLayout {
    const artifactsPath = join(workspacePath, "artifacts");
    const memoryPath = join(workspacePath, "memory");
    const sessionsPath = join(workspacePath, "sessions");
    const memoryFilePath = join(memoryPath, "MEMORY.md");
    const sharedMemoryPath = join(workspacePath, "shared-memory.md");

    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(artifactsPath, { recursive: true });
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
        `# ${options.title} 共享记忆\n\n- 目标：${options.summary}\n- 最近更新：初始化完成\n`,
        "utf8",
      );
    }

    return {
      workspacePath,
      artifactsPath,
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
    const filePath = join(this.attachmentsRoot, fileName);
    const buffer = Buffer.from(base64Payload, "base64");

    writeFileSync(filePath, buffer);

    return {
      name: sourceName,
      path: filePath,
      mimeType,
      sizeBytes: buffer.byteLength,
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
    const conversation = this.getConversation(conversationId);
    if (!conversation) return null;

    if (conversation.kind === "agent") {
      const agent = this.getAgent(conversation.targetId);
      if (!agent) return null;
      const layout = this.ensureWorkspaceLayout(agent.workspacePath, {
        type: "agent",
        title: agent.name,
        summary: agent.description,
      });
      return join(layout.sessionsPath, `${conversationId}.jsonl`);
    }

    const team = this.getTeam(conversation.targetId);
    if (!team) return null;
    const layout = this.ensureWorkspaceLayout(team.workspacePath, {
      type: "team",
      title: team.name,
      summary: team.objective,
    });
    return join(layout.sessionsPath, `${conversationId}.jsonl`);
  }

  private seedIfEmpty(
    configState: { settingsEntries: Record<string, string>; providers: ProviderConfig[] } | null = null,
  ) {
    this.state = this.createEmptyState();
    if (configState) {
      this.state.settingsEntries = configState.settingsEntries;
      this.state.providers = configState.providers;
    }
    const timestamp = now();

    const agentSeeds = [
      {
        id: "agent-nova",
        name: "Nova",
        role: "数据分析师",
        avatar: "N",
        color: agentPalette[0],
        status: "online" as const,
        description: "擅长数据分析、指标拆解与结论总结。",
        capabilities: ["数据清洗", "统计分析", "图表报告", "复盘总结"],
      },
      {
        id: "agent-coder",
        name: "Coder",
        role: "全栈开发",
        avatar: "C",
        color: agentPalette[1],
        status: "online" as const,
        description: "负责前端、后端与本地工具链实现。",
        capabilities: ["React", "Electron", "Node.js", "TypeScript"],
      },
      {
        id: "agent-designer",
        name: "Designer",
        role: "UI/UX 设计师",
        avatar: "D",
        color: agentPalette[2],
        status: "busy" as const,
        description: "把复杂系统整理成清晰、可落地的交互。",
        capabilities: ["信息架构", "原型设计", "视觉系统", "交互梳理"],
      },
      {
        id: "agent-planner",
        name: "Planner",
        role: "项目经理",
        avatar: "P",
        color: agentPalette[3],
        status: "online" as const,
        description: "擅长拆任务、排优先级和组织多人协作。",
        capabilities: ["任务拆解", "里程碑规划", "风险提示", "协作节奏"],
      },
      {
        id: "agent-researcher",
        name: "Researcher",
        role: "研究员",
        avatar: "R",
        color: agentPalette[4],
        status: "offline" as const,
        description: "擅长检索、归纳与形成背景信息。",
        capabilities: ["资料检索", "趋势分析", "竞品研究", "长文提炼"],
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
        name: "产品开发组",
        description: "围绕 teamaligned 的 MVP 体验快速协作。",
        avatar: "产",
        avatarColor: teamPalette[0],
        objective: "完成一个可体验的 teamaligned 桌面原型。",
        members: ["agent-planner", "agent-designer", "agent-coder"],
      },
      {
        id: "team-research",
        name: "市场研究组",
        description: "负责背景研究、用户反馈与方案补充。",
        avatar: "研",
        avatarColor: teamPalette[1],
        objective: "收集需求背景并把结论反馈给产品开发组。",
        members: ["agent-nova", "agent-researcher", "agent-planner"],
      },
    ];

    for (const seed of teamSeeds) {
      const workspacePath = join(this.teamWorkspaceRoot, seed.id);
      this.ensureWorkspaceLayout(workspacePath, {
        type: "team",
        title: seed.name,
        summary: seed.objective,
      });
      this.state.teams.push({
        id: seed.id,
        name: seed.name,
        description: seed.description,
        avatar: seed.avatar,
        avatarPath: null,
        avatarColor: seed.avatarColor,
        objective: seed.objective,
        workspacePath,
        memberIds: [...seed.members],
        mcpWhitelist: [...defaultConnectedMcpIds],
        context: defaultTeamContext(seed.objective),
      });
    }

    this.state.conversations = [
      {
        id: "conv-agent-nova",
        kind: "agent",
        targetId: "agent-nova",
        title: "Nova",
        unread: 2,
        lastMessage: "数据摘要已经整理好了，你要我继续出图表吗？",
        lastActivityAt: timestamp,
        meta: { ...defaultConversationMeta },
      },
      {
        id: "conv-agent-coder",
        kind: "agent",
        targetId: "agent-coder",
        title: "Coder",
        unread: 0,
        lastMessage: "我已经把 Electron 壳和命令输入流整理好了。",
        lastActivityAt: timestamp - 1000 * 60 * 8,
        meta: { ...defaultConversationMeta },
      },
      {
        id: "conv-team-product",
        kind: "team",
        targetId: "team-product",
        title: "产品开发组",
        unread: 4,
        lastMessage: "Planner: 现在优先把单聊命令和群聊编排体验打通。",
        lastActivityAt: timestamp - 1000 * 60 * 4,
        meta: { ...defaultConversationMeta },
      },
      {
        id: "conv-team-research",
        kind: "team",
        targetId: "team-research",
        title: "市场研究组",
        unread: 1,
        lastMessage: "Researcher: 我整理了 3 条可参考的产品定位方向。",
        lastActivityAt: timestamp - 1000 * 60 * 20,
        meta: { ...defaultConversationMeta },
      },
    ];

    const seedMessages: Array<Omit<MessageRecord, "id">> = [
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
        createdAt: timestamp - 1000 * 60 * 18,
        runId: null,
        metadata: null,
      },
      {
        conversationId: "conv-team-product",
        senderId: "agent-designer",
        senderName: "Designer",
        senderKind: "agent",
        messageType: "agent",
        visibility: "public",
        content: "@Coder 我建议把 slash command 提示做成输入框下方浮层。",
        mentions: ["agent-coder"],
        createdAt: timestamp - 1000 * 60 * 16,
        runId: null,
        metadata: null,
      },
      {
        conversationId: "conv-team-product",
        senderId: "agent-coder",
        senderName: "Coder",
        senderKind: "agent",
        messageType: "agent",
        visibility: "public",
        content: "@Designer 收到，我会把命令建议和运行控制条一起做进去。",
        mentions: ["agent-designer"],
        createdAt: timestamp - 1000 * 60 * 14,
        runId: null,
        metadata: null,
      },
    ];

    this.state.messages = seedMessages.map((message) => ({
      ...message,
      id: nanoid(),
    }));

    this.state.extensions = [...defaultExtensions];
    this.state.skillCatalog = [...defaultSkillCatalog];
    this.state.mcpCatalog = [...defaultMcpCatalog];
    this.state.mcpConnections = [];
    this.state.providers = this.state.providers.length > 0 ? this.state.providers : [...defaultProviders];
    this.state.settingsEntries =
      Object.keys(this.state.settingsEntries).length > 0
        ? this.state.settingsEntries
        : this.createSettingsEntries(defaultSettings, defaultProfile);
    this.createNotification({
      type: "system",
      title: "欢迎来到 teamaligned",
      body: "项目已完成初始化，你现在可以开始体验单聊命令和群聊协作。",
      relatedConversationId: "conv-team-product",
      relatedRunId: null,
      createdAt: timestamp,
    });

    for (const message of this.state.messages) {
      this.appendTranscript(message);
    }

    this.persist();
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

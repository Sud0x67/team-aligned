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
  defaultExtensions,
  defaultProfile,
  defaultProviders,
  defaultSettings,
  defaultTeamContext,
} from "@teamaligned/shared";
import type {
  AgentRecord,
  AppSettings,
  AppSnapshot,
  ConversationMeta,
  ConversationRecord,
  CreateAgentInput,
  CreateTeamInput,
  DashboardStats,
  ExtensionRecord,
  MessageRecord,
  NotificationRecord,
  ProviderConfig,
  RunRecord,
  TeamContext,
  TeamRecord,
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
  notifications: NotificationRecord[];
  extensions: ExtensionRecord[];
};

type WorkspaceLayout = {
  workspacePath: string;
  artifactsPath: string;
  memoryPath: string;
  sessionsPath: string;
  memoryFilePath: string;
  sharedMemoryPath: string;
};

function now() {
  return Date.now();
}

const agentPalette = ["#7c3aed", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#3b82f6"];
const teamPalette = ["#7c3aed", "#0ea5e9", "#14b8a6", "#8b5cf6"];

export class AppStorage {
  readonly rootDir: string;
  readonly filePath: string;
  readonly dbPath: string;
  readonly workspaceRoot: string;
  readonly agentWorkspaceRoot: string;
  readonly teamWorkspaceRoot: string;
  readonly transcriptRoot: string;
  private readonly db: DatabaseSync;
  private state: PersistedState;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.filePath = join(rootDir, "app-state.json");
    this.dbPath = join(rootDir, "app.db");
    this.workspaceRoot = join(rootDir, "workspaces");
    this.agentWorkspaceRoot = join(this.workspaceRoot, "agents");
    this.teamWorkspaceRoot = join(this.workspaceRoot, "teams");
    this.transcriptRoot = join(rootDir, "transcripts");

    mkdirSync(rootDir, { recursive: true });
    mkdirSync(this.workspaceRoot, { recursive: true });
    mkdirSync(this.agentWorkspaceRoot, { recursive: true });
    mkdirSync(this.teamWorkspaceRoot, { recursive: true });
    mkdirSync(this.transcriptRoot, { recursive: true });

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

    this.seedIfEmpty();
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
    this.persist();
    this.appendTranscript(message);
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
    ];

    return tables.some((table) => {
      const row = this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
      return row.count > 0;
    });
  }

  private persist() {
    const insertSetting = this.db.prepare(
      "INSERT INTO settings_entries (key, value) VALUES (?, ?)",
    );
    const insertProvider = this.db.prepare("INSERT INTO providers (id, payload) VALUES (?, ?)");
    const insertAgent = this.db.prepare("INSERT INTO agents (id, payload) VALUES (?, ?)");
    const insertTeam = this.db.prepare("INSERT INTO teams (id, payload) VALUES (?, ?)");
    const insertConversation = this.db.prepare(
      "INSERT INTO conversations (id, last_activity_at, payload) VALUES (?, ?, ?)",
    );
    const insertMessage = this.db.prepare(
      "INSERT INTO messages (id, conversation_id, created_at, payload) VALUES (?, ?, ?, ?)",
    );
    const insertRun = this.db.prepare(
      "INSERT INTO runs (id, conversation_id, updated_at, payload) VALUES (?, ?, ?, ?)",
    );
    const insertNotification = this.db.prepare(
      "INSERT INTO notifications (id, created_at, payload) VALUES (?, ?, ?)",
    );
    const insertExtension = this.db.prepare("INSERT INTO extensions (id, payload) VALUES (?, ?)");

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
          conversation.lastActivityAt,
          JSON.stringify(conversation),
        );
      }
      for (const message of this.state.messages) {
        insertMessage.run(
          message.id,
          message.conversationId,
          message.createdAt,
          JSON.stringify(message),
        );
      }
      for (const run of this.state.runs) {
        insertRun.run(run.id, run.conversationId, run.updatedAt, JSON.stringify(run));
      }
      for (const notification of this.state.notifications) {
        insertNotification.run(notification.id, notification.createdAt, JSON.stringify(notification));
      }
      for (const extension of this.state.extensions) {
        insertExtension.run(extension.id, JSON.stringify(extension));
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

    this.state = {
      settingsEntries,
      providers: this.readCollection<ProviderConfig>("providers"),
      agents: this.readCollection<AgentRecord>("agents"),
      teams: this.readCollection<TeamRecord>("teams"),
      conversations: this.readCollection<ConversationRecord>("conversations"),
      messages: this.readCollection<MessageRecord>("messages", "ORDER BY created_at ASC"),
      runs: this.readCollection<RunRecord>("runs", "ORDER BY updated_at DESC"),
      notifications: this.readCollection<NotificationRecord>("notifications", "ORDER BY created_at DESC"),
      extensions: this.readCollection<ExtensionRecord>("extensions"),
    };
  }

  private loadLegacyState() {
    this.state = JSON.parse(readFileSync(this.filePath, "utf8")) as PersistedState;
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

  private createEmptyState(): PersistedState {
    return {
      settingsEntries: {},
      providers: [],
      agents: [],
      teams: [],
      conversations: [],
      messages: [],
      runs: [],
      notifications: [],
      extensions: [],
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

  private seedIfEmpty() {
    this.state = this.createEmptyState();
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
    this.state.providers = [...defaultProviders];

    this.setProfile(defaultProfile);
    this.setSettings(defaultSettings);
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

import { app, ipcMain, shell, BrowserWindow } from "electron";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { mkdirSync, existsSync, readFileSync, renameSync, writeFileSync, appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { webcrypto } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
let urlAlphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
const POOL_SIZE_MULTIPLIER = 128;
let pool, poolOffset;
function fillPool(bytes) {
  if (!pool || pool.length < bytes) {
    pool = Buffer.allocUnsafe(bytes * POOL_SIZE_MULTIPLIER);
    webcrypto.getRandomValues(pool);
    poolOffset = 0;
  } else if (poolOffset + bytes > pool.length) {
    webcrypto.getRandomValues(pool);
    poolOffset = 0;
  }
  poolOffset += bytes;
}
function nanoid(size = 21) {
  fillPool(size |= 0);
  let id = "";
  for (let i = poolOffset - size; i < poolOffset; i++) {
    id += urlAlphabet[pool[i] & 63];
  }
  return id;
}
const defaultProfile = {
  name: "Alex Chen",
  role: "产品经理",
  team: "AI 平台组",
  email: "alex.chen@teamaligned.local",
  bio: "专注于把 Agent 协作产品做成真正能用的本地桌面工具。",
  avatarPath: null
};
const defaultSettings = {
  theme: "light",
  language: "zh",
  notifyAgentComplete: true,
  notifyMention: true,
  notifyGroup: true,
  activeProviderId: "qwen"
};
const defaultProviders = [
  {
    id: "qwen",
    label: "Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "sk-qwen-demo-key",
    defaultModel: "qwen-max",
    supportsToolCalling: true,
    supportsStreaming: true,
    isActive: true
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-openai-demo-key",
    defaultModel: "gpt-5",
    supportsToolCalling: true,
    supportsStreaming: true,
    isActive: false
  }
];
const defaultConversationMeta = {
  activeSkill: null,
  pinnedMcp: null,
  showInternalMessages: false
};
const defaultExtensions = [
  {
    id: "skill-planner",
    type: "skill",
    name: "Planner",
    description: "帮助 Agent 拆解任务、整理优先级并规划执行步骤。",
    installed: true,
    enabled: true,
    source: "builtin",
    metadata: { category: "planning" }
  },
  {
    id: "skill-summarize",
    type: "skill",
    name: "Summarize",
    description: "将长内容压缩为重点摘要或阶段总结。",
    installed: true,
    enabled: true,
    source: "builtin",
    metadata: { category: "writing" }
  },
  {
    id: "skill-web-search",
    type: "skill",
    name: "Web Search",
    description: "允许 Agent 调用搜索工具获取互联网上的最新信息。",
    installed: true,
    enabled: true,
    source: "builtin",
    metadata: { category: "research" }
  },
  {
    id: "mcp-github",
    type: "mcp",
    name: "GitHub MCP",
    description: "访问仓库内容，浏览 Issues 和 Pull Requests。",
    installed: true,
    enabled: true,
    source: "stdio",
    metadata: { tools: ["list_issues", "search_code", "list_prs"] }
  },
  {
    id: "mcp-notion",
    type: "mcp",
    name: "Notion MCP",
    description: "访问 Notion 页面和数据库，用于同步知识库。",
    installed: false,
    enabled: false,
    source: "http",
    metadata: { tools: ["search_pages", "update_page"] }
  }
];
const defaultTeamContext = (objective) => ({
  objective,
  phase: "执行中",
  constraints: [
    "保持聊天优先，不做成复杂后台",
    "优先实现可体验的 MVP 版本"
  ],
  activeTasks: [
    "对齐 Figma 原型交互",
    "实现单聊命令式交互",
    "跑通群聊中的 Agent 协作"
  ],
  recentDecisions: [
    "默认首页为对话页",
    "Qwen 通过 DashScope OpenAI-compatible 接口接入"
  ],
  pinnedArtifacts: ["docs/mvp-plan.md", "docs/roadmap.md"],
  workspaceSummary: "当前工作目录为 team-aligned，聚焦 Electron 桌面原型。"
});
const supportedCommands = /* @__PURE__ */ new Set([
  "skills",
  "command",
  "mcp",
  "pause",
  "resume",
  "cancel"
]);
function parseSlashCommand(input) {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const [rawName, ...args] = trimmed.slice(1).split(/\s+/);
  const name = rawName.toLowerCase();
  if (!supportedCommands.has(name)) {
    return null;
  }
  return {
    raw: trimmed,
    name,
    args
  };
}
function now() {
  return Date.now();
}
const agentPalette = ["#7c3aed", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#3b82f6"];
const teamPalette = ["#7c3aed", "#0ea5e9", "#14b8a6", "#8b5cf6"];
class AppStorage {
  constructor(rootDir) {
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
  getSnapshot() {
    const agents = this.listAgents();
    const teams = this.listTeams();
    const conversations = this.listConversations();
    const messages = Object.fromEntries(
      conversations.map((conversation) => [conversation.id, this.listMessages(conversation.id)])
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
      stats: this.getStats(agents, teams, messages)
    };
  }
  getProfile() {
    return {
      name: this.state.settingsEntries["profile.name"] ?? defaultProfile.name,
      role: this.state.settingsEntries["profile.role"] ?? defaultProfile.role,
      team: this.state.settingsEntries["profile.team"] ?? defaultProfile.team,
      email: this.state.settingsEntries["profile.email"] ?? defaultProfile.email,
      bio: this.state.settingsEntries["profile.bio"] ?? defaultProfile.bio,
      avatarPath: this.state.settingsEntries["profile.avatarPath"] === void 0 ? defaultProfile.avatarPath : this.state.settingsEntries["profile.avatarPath"] === "null" ? null : this.state.settingsEntries["profile.avatarPath"]
    };
  }
  setProfile(input) {
    const merged = { ...this.getProfile(), ...input };
    this.state.settingsEntries["profile.name"] = merged.name;
    this.state.settingsEntries["profile.role"] = merged.role;
    this.state.settingsEntries["profile.team"] = merged.team;
    this.state.settingsEntries["profile.email"] = merged.email;
    this.state.settingsEntries["profile.bio"] = merged.bio;
    this.state.settingsEntries["profile.avatarPath"] = merged.avatarPath ?? "null";
    this.persist();
  }
  getSettings() {
    return {
      theme: this.state.settingsEntries["settings.theme"] ?? defaultSettings.theme,
      language: this.state.settingsEntries["settings.language"] ?? defaultSettings.language,
      notifyAgentComplete: this.state.settingsEntries["settings.notifyAgentComplete"] === void 0 ? defaultSettings.notifyAgentComplete : this.state.settingsEntries["settings.notifyAgentComplete"] === "true",
      notifyMention: this.state.settingsEntries["settings.notifyMention"] === void 0 ? defaultSettings.notifyMention : this.state.settingsEntries["settings.notifyMention"] === "true",
      notifyGroup: this.state.settingsEntries["settings.notifyGroup"] === void 0 ? defaultSettings.notifyGroup : this.state.settingsEntries["settings.notifyGroup"] === "true",
      activeProviderId: this.state.settingsEntries["settings.activeProviderId"] ?? defaultSettings.activeProviderId
    };
  }
  setSettings(input) {
    const merged = { ...this.getSettings(), ...input };
    this.state.settingsEntries["settings.theme"] = merged.theme;
    this.state.settingsEntries["settings.language"] = merged.language;
    this.state.settingsEntries["settings.notifyAgentComplete"] = String(merged.notifyAgentComplete);
    this.state.settingsEntries["settings.notifyMention"] = String(merged.notifyMention);
    this.state.settingsEntries["settings.notifyGroup"] = String(merged.notifyGroup);
    this.state.settingsEntries["settings.activeProviderId"] = merged.activeProviderId;
    this.persist();
  }
  listProviders() {
    return [...this.state.providers];
  }
  updateProvider(input) {
    this.state.providers = this.state.providers.map((provider) => {
      if (provider.id === input.id) {
        return {
          ...provider,
          ...input,
          isActive: input.isActive ?? provider.isActive
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
  listAgents() {
    return [...this.state.agents].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
  }
  getAgent(agentId) {
    return this.state.agents.find((agent) => agent.id === agentId) ?? null;
  }
  createAgent(input) {
    const id = `agent-${nanoid(6)}`;
    const workspacePath = input.workspacePath || join(this.agentWorkspaceRoot, id);
    this.ensureWorkspaceLayout(workspacePath, {
      type: "agent",
      title: input.name,
      summary: input.description
    });
    const agent = {
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
      modelId: this.getSettings().activeProviderId === "openai" ? "gpt-5" : "qwen-max"
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
      meta: { ...defaultConversationMeta }
    });
    this.persist();
    return agent;
  }
  listTeams() {
    return [...this.state.teams].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
  }
  getTeam(teamId) {
    return this.state.teams.find((team) => team.id === teamId) ?? null;
  }
  createTeam(input) {
    const id = `team-${nanoid(6)}`;
    const workspacePath = input.workspacePath || join(this.teamWorkspaceRoot, id);
    this.ensureWorkspaceLayout(workspacePath, {
      type: "team",
      title: input.name,
      summary: input.objective
    });
    const team = {
      id,
      name: input.name,
      description: input.description,
      avatar: input.name.slice(0, 1),
      avatarPath: input.avatarPath ?? null,
      avatarColor: teamPalette[this.state.teams.length % teamPalette.length],
      objective: input.objective,
      workspacePath,
      memberIds: input.memberIds,
      context: defaultTeamContext(input.objective)
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
      meta: { ...defaultConversationMeta }
    });
    this.persist();
    return team;
  }
  listConversations() {
    return [...this.state.conversations].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }
  getConversation(conversationId) {
    return this.state.conversations.find((conversation) => conversation.id === conversationId) ?? null;
  }
  updateConversationMeta(conversationId, meta) {
    const conversation = this.getConversation(conversationId);
    if (!conversation) return;
    conversation.meta = meta;
    this.persist();
  }
  touchConversation(conversationId, lastMessage, incrementUnread = false) {
    const conversation = this.getConversation(conversationId);
    if (!conversation) return;
    conversation.lastMessage = lastMessage;
    conversation.lastActivityAt = now();
    if (incrementUnread) {
      conversation.unread += 1;
    }
    this.persist();
  }
  listMessages(conversationId) {
    return this.state.messages.filter((message) => message.conversationId === conversationId).sort((a, b) => a.createdAt - b.createdAt);
  }
  addMessage(input) {
    const message = {
      ...input,
      id: input.id ?? nanoid()
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
  listRuns() {
    return [...this.state.runs].sort((a, b) => b.updatedAt - a.updatedAt);
  }
  getRun(runId) {
    return this.state.runs.find((run) => run.id === runId) ?? null;
  }
  getLatestConversationRun(conversationId) {
    return this.listRuns().find((run) => run.conversationId === conversationId) ?? null;
  }
  createRun(input) {
    const timestamp = now();
    this.state.runs.push({
      ...input,
      createdAt: input.createdAt ?? timestamp,
      updatedAt: input.updatedAt ?? timestamp
    });
    this.persist();
  }
  updateRun(runId, patch) {
    const run = this.getRun(runId);
    if (!run) return;
    Object.assign(run, patch, { updatedAt: now() });
    this.persist();
  }
  listNotifications() {
    return [...this.state.notifications].sort((a, b) => b.createdAt - a.createdAt);
  }
  createNotification(input) {
    this.state.notifications.unshift({
      id: nanoid(),
      type: input.type,
      title: input.title,
      body: input.body,
      read: false,
      createdAt: input.createdAt ?? now(),
      relatedConversationId: input.relatedConversationId,
      relatedRunId: input.relatedRunId
    });
    this.persist();
  }
  markNotificationsRead() {
    for (const item of this.state.notifications) {
      item.read = true;
    }
    this.persist();
  }
  listExtensions() {
    return [...this.state.extensions].sort((a, b) => a.name.localeCompare(b.name, "en"));
  }
  toggleExtension(extensionId) {
    const extension = this.state.extensions.find((item) => item.id === extensionId);
    if (!extension) return;
    extension.installed = !extension.installed;
    extension.enabled = extension.installed;
    this.createNotification({
      type: "extension",
      title: extension.installed ? "扩展已安装" : "扩展已移除",
      body: `${extension.name} ${extension.installed ? "已安装并启用" : "已从当前应用中移除"}`,
      relatedConversationId: null,
      relatedRunId: null
    });
    this.persist();
  }
  resetUnread(conversationId) {
    const conversation = this.getConversation(conversationId);
    if (!conversation) return;
    conversation.unread = 0;
    this.persist();
  }
  updateTeamContext(teamId, context) {
    const team = this.getTeam(teamId);
    if (!team) return;
    team.context = context;
    this.persist();
  }
  setupSchema() {
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
  databaseHasData() {
    const tables = [
      "settings_entries",
      "providers",
      "agents",
      "teams",
      "conversations",
      "messages",
      "runs",
      "notifications",
      "extensions"
    ];
    return tables.some((table) => {
      const row = this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get();
      return row.count > 0;
    });
  }
  persist() {
    const insertSetting = this.db.prepare(
      "INSERT INTO settings_entries (key, value) VALUES (?, ?)"
    );
    const insertProvider = this.db.prepare("INSERT INTO providers (id, payload) VALUES (?, ?)");
    const insertAgent = this.db.prepare("INSERT INTO agents (id, payload) VALUES (?, ?)");
    const insertTeam = this.db.prepare("INSERT INTO teams (id, payload) VALUES (?, ?)");
    const insertConversation = this.db.prepare(
      "INSERT INTO conversations (id, last_activity_at, payload) VALUES (?, ?, ?)"
    );
    const insertMessage = this.db.prepare(
      "INSERT INTO messages (id, conversation_id, created_at, payload) VALUES (?, ?, ?, ?)"
    );
    const insertRun = this.db.prepare(
      "INSERT INTO runs (id, conversation_id, updated_at, payload) VALUES (?, ?, ?, ?)"
    );
    const insertNotification = this.db.prepare(
      "INSERT INTO notifications (id, created_at, payload) VALUES (?, ?, ?)"
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
          JSON.stringify(conversation)
        );
      }
      for (const message of this.state.messages) {
        insertMessage.run(
          message.id,
          message.conversationId,
          message.createdAt,
          JSON.stringify(message)
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
  loadState() {
    const settingsEntries = Object.fromEntries(
      this.db.prepare("SELECT key, value FROM settings_entries ORDER BY key").all().map((row) => [row.key, row.value])
    );
    this.state = {
      settingsEntries,
      providers: this.readCollection("providers"),
      agents: this.readCollection("agents"),
      teams: this.readCollection("teams"),
      conversations: this.readCollection("conversations"),
      messages: this.readCollection("messages", "ORDER BY created_at ASC"),
      runs: this.readCollection("runs", "ORDER BY updated_at DESC"),
      notifications: this.readCollection("notifications", "ORDER BY created_at DESC"),
      extensions: this.readCollection("extensions")
    };
  }
  loadLegacyState() {
    this.state = JSON.parse(readFileSync(this.filePath, "utf8"));
  }
  backupLegacyState() {
    if (!existsSync(this.filePath)) return;
    try {
      renameSync(this.filePath, `${this.filePath}.migrated`);
    } catch {
    }
  }
  readCollection(tableName, orderClause = "") {
    const rows = this.db.prepare(`SELECT payload FROM ${tableName} ${orderClause}`.trim()).all();
    return rows.map((row) => JSON.parse(row.payload));
  }
  createEmptyState() {
    return {
      settingsEntries: {},
      providers: [],
      agents: [],
      teams: [],
      conversations: [],
      messages: [],
      runs: [],
      notifications: [],
      extensions: []
    };
  }
  ensureWorkspaceLayout(workspacePath, options) {
    return this.createWorkspaceLayout(workspacePath, options);
  }
  ensureWorkspaceLayouts() {
    for (const agent of this.state.agents) {
      this.createWorkspaceLayout(agent.workspacePath, {
        type: "agent",
        title: agent.name,
        summary: agent.description
      });
    }
    for (const team of this.state.teams) {
      this.createWorkspaceLayout(team.workspacePath, {
        type: "team",
        title: team.name,
        summary: team.objective
      });
    }
  }
  createWorkspaceLayout(workspacePath, options) {
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
        `# ${options.title} 记忆

- 类型：${options.type === "agent" ? "Agent" : "团队"}
- 说明：${options.summary}
- 最近更新：初始化完成
`,
        "utf8"
      );
    }
    if (options.type === "team" && !existsSync(sharedMemoryPath)) {
      writeFileSync(
        sharedMemoryPath,
        `# ${options.title} 共享记忆

- 目标：${options.summary}
- 最近更新：初始化完成
`,
        "utf8"
      );
    }
    return {
      workspacePath,
      artifactsPath,
      memoryPath,
      sessionsPath,
      memoryFilePath,
      sharedMemoryPath
    };
  }
  appendTranscript(message) {
    const transcriptPath = join(this.transcriptRoot, `${message.conversationId}.jsonl`);
    const payload = `${JSON.stringify(message)}
`;
    appendFileSync(transcriptPath, payload, "utf8");
    const sessionPath = this.getWorkspaceSessionPath(message.conversationId);
    if (sessionPath) {
      appendFileSync(sessionPath, payload, "utf8");
    }
  }
  getWorkspaceSessionPath(conversationId) {
    const conversation = this.getConversation(conversationId);
    if (!conversation) return null;
    if (conversation.kind === "agent") {
      const agent = this.getAgent(conversation.targetId);
      if (!agent) return null;
      const layout2 = this.ensureWorkspaceLayout(agent.workspacePath, {
        type: "agent",
        title: agent.name,
        summary: agent.description
      });
      return join(layout2.sessionsPath, `${conversationId}.jsonl`);
    }
    const team = this.getTeam(conversation.targetId);
    if (!team) return null;
    const layout = this.ensureWorkspaceLayout(team.workspacePath, {
      type: "team",
      title: team.name,
      summary: team.objective
    });
    return join(layout.sessionsPath, `${conversationId}.jsonl`);
  }
  seedIfEmpty() {
    this.state = this.createEmptyState();
    const timestamp = now();
    const agentSeeds = [
      {
        id: "agent-nova",
        name: "Nova",
        role: "数据分析师",
        avatar: "N",
        color: agentPalette[0],
        status: "online",
        description: "擅长数据分析、指标拆解与结论总结。",
        capabilities: ["数据清洗", "统计分析", "图表报告", "复盘总结"]
      },
      {
        id: "agent-coder",
        name: "Coder",
        role: "全栈开发",
        avatar: "C",
        color: agentPalette[1],
        status: "online",
        description: "负责前端、后端与本地工具链实现。",
        capabilities: ["React", "Electron", "Node.js", "TypeScript"]
      },
      {
        id: "agent-designer",
        name: "Designer",
        role: "UI/UX 设计师",
        avatar: "D",
        color: agentPalette[2],
        status: "busy",
        description: "把复杂系统整理成清晰、可落地的交互。",
        capabilities: ["信息架构", "原型设计", "视觉系统", "交互梳理"]
      },
      {
        id: "agent-planner",
        name: "Planner",
        role: "项目经理",
        avatar: "P",
        color: agentPalette[3],
        status: "online",
        description: "擅长拆任务、排优先级和组织多人协作。",
        capabilities: ["任务拆解", "里程碑规划", "风险提示", "协作节奏"]
      },
      {
        id: "agent-researcher",
        name: "Researcher",
        role: "研究员",
        avatar: "R",
        color: agentPalette[4],
        status: "offline",
        description: "擅长检索、归纳与形成背景信息。",
        capabilities: ["资料检索", "趋势分析", "竞品研究", "长文提炼"]
      }
    ];
    for (const [index, seed] of agentSeeds.entries()) {
      const workspacePath = join(this.agentWorkspaceRoot, seed.id);
      this.ensureWorkspaceLayout(workspacePath, {
        type: "agent",
        title: seed.name,
        summary: seed.description
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
        modelId: index % 2 === 0 ? "qwen-max" : "gpt-5"
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
        members: ["agent-planner", "agent-designer", "agent-coder"]
      },
      {
        id: "team-research",
        name: "市场研究组",
        description: "负责背景研究、用户反馈与方案补充。",
        avatar: "研",
        avatarColor: teamPalette[1],
        objective: "收集需求背景并把结论反馈给产品开发组。",
        members: ["agent-nova", "agent-researcher", "agent-planner"]
      }
    ];
    for (const seed of teamSeeds) {
      const workspacePath = join(this.teamWorkspaceRoot, seed.id);
      this.ensureWorkspaceLayout(workspacePath, {
        type: "team",
        title: seed.name,
        summary: seed.objective
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
        context: defaultTeamContext(seed.objective)
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
        meta: { ...defaultConversationMeta }
      },
      {
        id: "conv-agent-coder",
        kind: "agent",
        targetId: "agent-coder",
        title: "Coder",
        unread: 0,
        lastMessage: "我已经把 Electron 壳和命令输入流整理好了。",
        lastActivityAt: timestamp - 1e3 * 60 * 8,
        meta: { ...defaultConversationMeta }
      },
      {
        id: "conv-team-product",
        kind: "team",
        targetId: "team-product",
        title: "产品开发组",
        unread: 4,
        lastMessage: "Planner: 现在优先把单聊命令和群聊编排体验打通。",
        lastActivityAt: timestamp - 1e3 * 60 * 4,
        meta: { ...defaultConversationMeta }
      },
      {
        id: "conv-team-research",
        kind: "team",
        targetId: "team-research",
        title: "市场研究组",
        unread: 1,
        lastMessage: "Researcher: 我整理了 3 条可参考的产品定位方向。",
        lastActivityAt: timestamp - 1e3 * 60 * 20,
        meta: { ...defaultConversationMeta }
      }
    ];
    const seedMessages = [
      {
        conversationId: "conv-agent-nova",
        senderId: "user",
        senderName: "你",
        senderKind: "user",
        messageType: "user",
        visibility: "public",
        content: "Nova，帮我总结一下这个项目现在最重要的目标。",
        mentions: [],
        createdAt: timestamp - 1e3 * 60 * 14,
        runId: null,
        metadata: null
      },
      {
        conversationId: "conv-agent-nova",
        senderId: "agent-nova",
        senderName: "Nova",
        senderKind: "agent",
        messageType: "agent",
        visibility: "public",
        content: "当前最重要的目标是先把 teamaligned 做成一个可体验的桌面原型，优先验证单聊命令、群聊协作和本地运行时。",
        mentions: [],
        createdAt: timestamp - 1e3 * 60 * 12,
        runId: null,
        metadata: null
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
        createdAt: timestamp - 1e3 * 60 * 18,
        runId: null,
        metadata: null
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
        createdAt: timestamp - 1e3 * 60 * 16,
        runId: null,
        metadata: null
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
        createdAt: timestamp - 1e3 * 60 * 14,
        runId: null,
        metadata: null
      }
    ];
    this.state.messages = seedMessages.map((message) => ({
      ...message,
      id: nanoid()
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
      createdAt: timestamp
    });
    for (const message of this.state.messages) {
      this.appendTranscript(message);
    }
    this.persist();
  }
  getStats(agents, teams, messagesByConversation) {
    const runs = this.listRuns();
    const startOfDay = /* @__PURE__ */ new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const totalMessages = Object.values(messagesByConversation).reduce(
      (sum, items) => sum + items.length,
      0
    );
    return {
      activeAgents: agents.filter((agent) => agent.status === "online").length,
      totalAgents: agents.length,
      totalTeams: teams.length,
      runningRuns: runs.filter((run) => ["running", "pausing", "resuming"].includes(run.status)).length,
      completedToday: runs.filter(
        (run) => run.status === "completed" && run.updatedAt >= startOfDay.getTime()
      ).length,
      totalMessages,
      tokenEstimate: totalMessages * 128
    };
  }
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function trimOutput(text, max = 2400) {
  const value = text.trim();
  return value.length <= max ? value : `${value.slice(0, max)}
...`;
}
function trimHeadline(text, max = 120) {
  const value = text.trim().replace(/\s+/g, " ");
  return value.length <= max ? value : `${value.slice(0, max)}...`;
}
function extractAgentMentions(input, agents) {
  const matches = [...input.matchAll(/@([\w\u4e00-\u9fa5-]+)/g)].map((item) => item[1]);
  const mentioned = agents.filter(
    (agent) => matches.some((match) => agent.name.toLowerCase() === match.toLowerCase())
  );
  return mentioned;
}
function chooseManager(team, agents) {
  const members = agents.filter((agent) => team.memberIds.includes(agent.id));
  return members.find((agent) => agent.role.includes("经理") || agent.name === "Planner") ?? members[0];
}
function chooseSpecialists(team, agents, input) {
  const members = agents.filter((agent) => team.memberIds.includes(agent.id));
  const manager = chooseManager(team, agents);
  const explicit = extractAgentMentions(input, members).filter((agent) => agent.id !== manager?.id);
  if (explicit.length > 0) {
    return explicit;
  }
  return members.filter((agent) => agent.id !== manager?.id).slice(0, 2);
}
class TeamalignedRuntime extends EventEmitter {
  constructor(dataDir) {
    super();
    this.dataDir = dataDir;
    this.activeRuns = /* @__PURE__ */ new Map();
    mkdirSync(dataDir, { recursive: true });
    this.storage = new AppStorage(dataDir);
  }
  async init() {
    this.storage.init();
    this.recoverInterruptedRuns();
    this.emitSnapshot();
  }
  getSnapshot() {
    return this.storage.getSnapshot();
  }
  async sendInput(payload) {
    const snapshot = this.storage.getSnapshot();
    const conversation = snapshot.conversations.find((item) => item.id === payload.conversationId);
    if (!conversation) {
      return this.getSnapshot();
    }
    this.storage.resetUnread(payload.conversationId);
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
        createdAt: Date.now()
      });
      await this.handleSlashCommand(conversation, command.name, command.args);
      this.emitSnapshot();
      return this.getSnapshot();
    }
    this.storage.addMessage({
      conversationId: payload.conversationId,
      senderId: "user",
      senderName: "你",
      senderKind: "user",
      messageType: "user",
      visibility: "public",
      content: payload.input,
      mentions: extractAgentMentions(payload.input, snapshot.agents).map((agent) => agent.id),
      runId: null,
      metadata: null,
      createdAt: Date.now()
    });
    if (conversation.kind === "agent") {
      await this.startAgentRun(conversation, payload.input);
    } else {
      await this.startTeamRun(conversation, payload.input);
    }
    this.emitSnapshot();
    return this.getSnapshot();
  }
  async controlRun(payload) {
    const latest = this.storage.listRuns().find(
      (run) => run.conversationId === payload.conversationId && !["completed", "failed", "cancelled"].includes(run.status)
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
          "system"
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
      this.addRunMessage(payload.conversationId, latest.id, "任务已取消。", "system");
    }
    this.emitSnapshot();
    return this.getSnapshot();
  }
  async createAgent(payload) {
    this.storage.createAgent(payload);
    this.emitSnapshot();
    return this.getSnapshot();
  }
  async createTeam(payload) {
    this.storage.createTeam(payload);
    this.emitSnapshot();
    return this.getSnapshot();
  }
  async toggleExtension(extensionId) {
    this.storage.toggleExtension(extensionId);
    this.emitSnapshot();
    return this.getSnapshot();
  }
  async updateSettings(payload) {
    this.storage.setSettings(payload);
    this.emitSnapshot();
    return this.getSnapshot();
  }
  async updateProfile(payload) {
    this.storage.setProfile(payload);
    this.emitSnapshot();
    return this.getSnapshot();
  }
  async updateProvider(payload) {
    this.storage.updateProvider(payload);
    this.emitSnapshot();
    return this.getSnapshot();
  }
  async markNotificationsRead() {
    this.storage.markNotificationsRead();
    this.emitSnapshot();
    return this.getSnapshot();
  }
  async handleSlashCommand(conversation, commandName, args) {
    if (commandName === "skills") {
      const skills = this.storage.listExtensions().filter((extension) => extension.type === "skill" && extension.installed);
      const currentMeta = conversation.meta;
      if (args.length === 0) {
        this.addSystemMessage(
          conversation.id,
          `当前可用技能：${skills.map((skill) => skill.name).join("、")}
当前激活技能：${currentMeta.activeSkill ?? "默认"}`
        );
        return;
      }
      const selectedSkill = args.filter((item) => item !== "use").join(" ");
      const match = skills.find((skill) => skill.name.toLowerCase() === selectedSkill.toLowerCase());
      const meta = { ...currentMeta, activeSkill: match?.name ?? selectedSkill };
      this.storage.updateConversationMeta(conversation.id, meta);
      this.addSystemMessage(
        conversation.id,
        `已为当前会话切换技能：${meta.activeSkill ?? "默认"}。后续回复会优先参考该技能。`
      );
      return;
    }
    if (commandName === "mcp") {
      const installed = this.storage.listExtensions().filter((extension) => extension.type === "mcp" && extension.installed);
      if (args.length === 0) {
        this.addSystemMessage(
          conversation.id,
          `当前可用 MCP：${installed.map((item) => item.name).join("、") || "暂无"}。`
        );
        return;
      }
      const selected = args.join(" ");
      this.addSystemMessage(
        conversation.id,
        `已模拟调用 MCP：${selected}。
在完整版本中，这里会进入真实 MCP tool 调用链路。`
      );
      return;
    }
    if (commandName === "command") {
      const shellCommand = args.join(" ").trim();
      if (!shellCommand) {
        this.addSystemMessage(conversation.id, "用法：/command <你要执行的命令>");
        return;
      }
      await this.startShellCommandRun(conversation, shellCommand);
      return;
    }
    if (commandName === "pause" || commandName === "resume" || commandName === "cancel") {
      await this.controlRun({
        conversationId: conversation.id,
        action: commandName
      });
    }
  }
  async startAgentRun(conversation, input) {
    const snapshot = this.storage.getSnapshot();
    const agent = snapshot.agents.find((item) => item.id === conversation.targetId);
    if (!agent) return;
    const workspacePath = agent.workspacePath;
    const runId = `run-${nanoid(8)}`;
    const activeSkill = conversation.meta.activeSkill;
    const steps = [
      {
        label: "理解需求",
        delayMs: 800,
        execute: () => {
          this.addRunMessage(
            conversation.id,
            runId,
            `${agent.name} 正在理解你的需求，并结合当前 workspace 组织执行步骤。`,
            "system"
          );
        }
      },
      {
        label: "检查技能与上下文",
        delayMs: 1200,
        execute: () => {
          const skillText = activeSkill ? `当前会话激活技能：${activeSkill}。` : "当前使用默认技能栈。";
          this.addRunMessage(
            conversation.id,
            runId,
            `${agent.name} 已读取上下文。
${skillText}`,
            "system"
          );
        }
      },
      {
        label: "生成回复",
        delayMs: 600,
        execute: () => {
          const response = this.composeAgentReply(agent, input, activeSkill);
          const artifactPath = this.writeAgentArtifact(workspacePath, runId, agent, input, response, activeSkill);
          const memoryPath = this.appendMemory(
            workspacePath,
            "memory/MEMORY.md",
            `- ${this.formatTimestamp()} | 任务：${trimHeadline(input)} | 输出：${trimHeadline(response)}`
          );
          this.storage.addMessage({
            conversationId: conversation.id,
            senderId: agent.id,
            senderName: agent.name,
            senderKind: "agent",
            messageType: "agent",
            visibility: "public",
            content: response,
            mentions: ["user"],
            runId,
            metadata: { skill: activeSkill },
            createdAt: Date.now()
          });
          this.addRunMessage(
            conversation.id,
            runId,
            `结果已写入产物：${artifactPath}
记忆文件已更新：${memoryPath}`,
            "system"
          );
          this.storage.createNotification({
            type: "run_complete",
            title: `${agent.name} 已完成当前任务`,
            body: "可以在消息线程中查看结果。",
            relatedConversationId: conversation.id,
            relatedRunId: runId
          });
        }
      }
    ];
    this.beginRun({
      runId,
      conversationId: conversation.id,
      title: `${agent.name} 处理请求`,
      kind: "agent_task",
      actorId: agent.id,
      steps
    });
  }
  async startTeamRun(conversation, input) {
    const snapshot = this.storage.getSnapshot();
    const team = snapshot.teams.find((item) => item.id === conversation.targetId);
    if (!team) return;
    const manager = chooseManager(team, snapshot.agents);
    const specialists = chooseSpecialists(team, snapshot.agents, input);
    if (!manager) return;
    const runId = `run-${nanoid(8)}`;
    const updatedContext = {
      ...team.context,
      activeTasks: Array.from(
        /* @__PURE__ */ new Set([`${input.slice(0, 24)}${input.length > 24 ? "..." : ""}`, ...team.context.activeTasks])
      ).slice(0, 5)
    };
    this.storage.updateTeamContext(team.id, updatedContext);
    const workspacePath = team.workspacePath;
    const steps = [
      {
        label: "同步群组上下文",
        delayMs: 600,
        execute: () => {
          this.storage.addMessage({
            conversationId: conversation.id,
            senderId: manager.id,
            senderName: manager.name,
            senderKind: "agent",
            messageType: "agent",
            visibility: "public",
            content: `${manager.name}：我已读取群组上下文，当前目标是“${team.objective}”。接下来我会协调成员处理这个请求。`,
            mentions: ["user"],
            runId,
            metadata: { phase: updatedContext.phase },
            createdAt: Date.now()
          });
        }
      },
      {
        label: "分派协作",
        delayMs: 1e3,
        execute: () => {
          for (const specialist of specialists) {
            this.storage.addMessage({
              conversationId: conversation.id,
              senderId: manager.id,
              senderName: manager.name,
              senderKind: "agent",
              messageType: "agent",
              visibility: "internal",
              content: `@${specialist.name} 我把这个子任务交给你，请基于群组上下文先给出执行建议。`,
              mentions: [specialist.id],
              runId,
              metadata: { internal: true, fromManager: true },
              createdAt: Date.now()
            });
          }
          if (specialists.length >= 2) {
            this.storage.addMessage({
              conversationId: conversation.id,
              senderId: specialists[0].id,
              senderName: specialists[0].name,
              senderKind: "agent",
              messageType: "agent",
              visibility: "public",
              content: `@${specialists[1].name} 我先处理结构和方案，你帮我准备实现细节，我们统一在群里同步结果。`,
              mentions: [specialists[1].id],
              runId,
              metadata: { collaboration: true },
              createdAt: Date.now()
            });
          }
        }
      },
      {
        label: "专家协作输出",
        delayMs: 1200,
        execute: () => {
          for (const specialist of specialists) {
            this.storage.addMessage({
              conversationId: conversation.id,
              senderId: specialist.id,
              senderName: specialist.name,
              senderKind: "agent",
              messageType: "agent",
              visibility: "public",
              content: this.composeSpecialistReply(specialist, updatedContext, input),
              mentions: [],
              runId,
              metadata: { teamId: team.id },
              createdAt: Date.now()
            });
          }
        }
      },
      {
        label: "经理汇总",
        delayMs: 500,
        execute: () => {
          const specialistSummary = specialists.map((agent) => agent.name).join("、");
          const artifactPath = this.writeTeamArtifact(
            workspacePath,
            runId,
            team,
            manager,
            specialists,
            input,
            updatedContext
          );
          const sharedMemoryPath = this.appendMemory(
            workspacePath,
            "shared-memory.md",
            `- ${this.formatTimestamp()} | 任务：${trimHeadline(input)} | 协作：${specialistSummary} | 阶段：${updatedContext.phase}`
          );
          this.storage.addMessage({
            conversationId: conversation.id,
            senderId: manager.id,
            senderName: manager.name,
            senderKind: "agent",
            messageType: "notification",
            visibility: "public",
            content: `@你 我已经综合 ${specialistSummary} 的反馈，当前建议是：
1. 先完成核心交互闭环
2. 保持群组上下文持续更新
3. 对复杂任务保留暂停/恢复控制

如果你同意，我会继续推动下一步执行。`,
            mentions: ["user"],
            runId,
            metadata: { summary: true },
            createdAt: Date.now()
          });
          this.addRunMessage(
            conversation.id,
            runId,
            `群组协作产物已写入：${artifactPath}
共享记忆已更新：${sharedMemoryPath}`,
            "system"
          );
          this.storage.createNotification({
            type: "mention",
            title: `${manager.name} 在群组中 @ 了你`,
            body: `${team.name} 中有新的阶段总结。`,
            relatedConversationId: conversation.id,
            relatedRunId: runId
          });
        }
      }
    ];
    this.beginRun({
      runId,
      conversationId: conversation.id,
      title: `${team.name} 群组协作`,
      kind: "team_task",
      actorId: manager.id,
      steps
    });
  }
  async startShellCommandRun(conversation, shellCommand) {
    const snapshot = this.storage.getSnapshot();
    const workspacePath = this.getWorkspaceForConversation(conversation, snapshot.agents, snapshot.teams);
    const actorId = conversation.kind === "agent" ? conversation.targetId : chooseManager(snapshot.teams.find((item) => item.id === conversation.targetId), snapshot.agents)?.id ?? "system";
    const runId = `run-${nanoid(8)}`;
    const steps = [
      {
        label: "准备命令",
        delayMs: 300,
        execute: () => {
          this.addRunMessage(
            conversation.id,
            runId,
            `准备在 workspace 执行命令：${shellCommand}`,
            "system"
          );
        }
      },
      {
        label: "执行命令",
        execute: async () => {
          const artifactPath = await this.executeShellCommand(
            runId,
            conversation.id,
            shellCommand,
            workspacePath
          );
          this.addRunMessage(
            conversation.id,
            runId,
            `命令结果已写入产物：${artifactPath}`,
            "system"
          );
        }
      },
      {
        label: "整理结果",
        delayMs: 300,
        execute: () => {
          this.addRunMessage(
            conversation.id,
            runId,
            "命令执行完成，结果已经回写到会话中。",
            "system"
          );
        }
      }
    ];
    this.beginRun({
      runId,
      conversationId: conversation.id,
      title: `/command ${shellCommand}`,
      kind: "shell_command",
      actorId,
      steps
    });
  }
  beginRun(input) {
    this.storage.createRun({
      id: input.runId,
      conversationId: input.conversationId,
      title: input.title,
      kind: input.kind,
      status: "running",
      actorId: input.actorId,
      stepIndex: 0,
      totalSteps: input.steps.length,
      metadata: { title: input.title }
    });
    const controller = {
      runId: input.runId,
      conversationId: input.conversationId,
      steps: input.steps,
      timer: null,
      busy: false,
      childProcess: null
    };
    this.activeRuns.set(input.runId, controller);
    this.addRunMessage(input.conversationId, input.runId, `已开始任务：${input.title}`, "system");
    this.scheduleNext(controller, 240);
  }
  scheduleNext(controller, delayMs = 800) {
    if (controller.timer) clearTimeout(controller.timer);
    controller.timer = setTimeout(() => {
      void this.advanceRun(controller.runId);
    }, delayMs);
  }
  async advanceRun(runId) {
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
      this.storage.createNotification({
        type: "run_complete",
        title: "任务已完成",
        body: run.title,
        relatedConversationId: run.conversationId,
        relatedRunId: runId
      });
      this.activeRuns.delete(runId);
      this.emitSnapshot();
      return;
    }
    controller.busy = true;
    try {
      await step.execute();
      this.storage.updateRun(runId, { stepIndex: run.stepIndex + 1 });
      controller.busy = false;
      const latest = this.storage.getRun(runId);
      if (!latest) return;
      if (latest.status === "pausing") {
        this.storage.updateRun(runId, { status: "paused" });
        this.addRunMessage(latest.conversationId, runId, "任务已暂停。", "system");
        this.emitSnapshot();
        return;
      }
      this.scheduleNext(controller, step.delayMs ?? 900);
    } catch (error) {
      controller.busy = false;
      this.storage.updateRun(runId, {
        status: "failed",
        metadata: {
          error: error instanceof Error ? error.message : String(error)
        }
      });
      this.addRunMessage(
        run.conversationId,
        runId,
        `任务执行失败：${error instanceof Error ? error.message : String(error)}`,
        "system"
      );
      this.storage.createNotification({
        type: "run_failed",
        title: "任务执行失败",
        body: run.title,
        relatedConversationId: run.conversationId,
        relatedRunId: runId
      });
      this.activeRuns.delete(runId);
      this.emitSnapshot();
      return;
    }
    this.emitSnapshot();
  }
  async executeShellCommand(runId, conversationId, shellCommand, workspacePath) {
    await sleep(300);
    const artifactPath = this.getArtifactPath(workspacePath, `command-${runId}.md`);
    await new Promise((resolve, reject) => {
      const child = spawn(shellCommand, {
        cwd: workspacePath,
        shell: true,
        env: process.env
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
          `# 命令执行结果

- 命令：\`${shellCommand}\`
- 工作目录：\`${workspacePath}\`
- 退出码：${code ?? 0}

## 标准输出

\`\`\`
${normalizedStdout}
\`\`\`
${normalizedStderr ? `
## 标准错误

\`\`\`
${normalizedStderr}
\`\`\`
` : ""}`
        );
        this.storage.addMessage({
          conversationId,
          senderId: "system",
          senderName: "System",
          senderKind: "system",
          messageType: "run",
          visibility: "system",
          content: `命令：${shellCommand}
工作目录：${workspacePath}
退出码：${code ?? 0}

输出：
${normalizedStdout}${normalizedStderr ? `

错误输出：
${normalizedStderr}` : ""}`,
          mentions: [],
          runId,
          metadata: { code, shellCommand, workspacePath },
          createdAt: Date.now()
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
  composeAgentReply(agent, input, activeSkill) {
    const skillPrefix = activeSkill ? `我会优先按 ${activeSkill} 的方式来组织这次输出。` : "";
    const capabilityHint = agent.capabilities.slice(0, 3).join("、");
    return `${skillPrefix}${agent.name} 已处理你的请求：${input}

基于我的职责（${agent.role}）和当前能力栈（${capabilityHint}），我建议先完成核心闭环，再继续细化扩展。需要的话我可以继续帮你拆步骤、整理执行计划，或者直接用 /command 在 workspace 中执行命令。`;
  }
  composeSpecialistReply(agent, context, input) {
    const contextHint = context.activeTasks.slice(0, 2).join("、");
    return `${agent.name}：我已经结合群组上下文开始处理“${input}”。
当前重点会参考：${contextHint}。
接下来我会从 ${agent.role} 的角度给出可落地方案，并在需要时 @ 其他成员协作。`;
  }
  addSystemMessage(conversationId, content) {
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
      createdAt: Date.now()
    });
  }
  addRunMessage(conversationId, runId, content, visibility) {
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
      createdAt: Date.now()
    });
  }
  getArtifactDir(workspacePath) {
    return join(workspacePath, "artifacts");
  }
  getArtifactPath(workspacePath, fileName) {
    return join(this.getArtifactDir(workspacePath), fileName);
  }
  ensureWorkspaceFolders(workspacePath) {
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(this.getArtifactDir(workspacePath), { recursive: true });
    mkdirSync(join(workspacePath, "memory"), { recursive: true });
    mkdirSync(join(workspacePath, "sessions"), { recursive: true });
  }
  writeTextFile(filePath, content) {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content.endsWith("\n") ? content : `${content}
`, "utf8");
  }
  appendMemory(workspacePath, relativePath, line) {
    this.ensureWorkspaceFolders(workspacePath);
    const filePath = join(workspacePath, relativePath);
    const title = relativePath.split("/").at(-1)?.replace(/\.md$/i, "") ?? "memory";
    const header = existsSync(filePath) ? "" : `# ${title}

`;
    if (header) {
      this.writeTextFile(filePath, header);
    }
    appendFileSync(filePath, `${line}
`, "utf8");
    return filePath;
  }
  writeAgentArtifact(workspacePath, runId, agent, input, response, activeSkill) {
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
        ""
      ].join("\n")
    );
    return artifactPath;
  }
  writeTeamArtifact(workspacePath, runId, team, manager, specialists, input, context) {
    this.ensureWorkspaceFolders(workspacePath);
    const artifactPath = this.getArtifactPath(workspacePath, `team-${runId}.md`);
    this.writeTextFile(
      artifactPath,
      [
        "# Team 协作产物",
        "",
        `- 群组：${team.name}`,
        `- 经理：${manager.name}`,
        `- 协作者：${specialists.map((agent) => agent.name).join("、") || "无"}`,
        `- 输入：${input}`,
        `- 阶段：${context.phase}`,
        "",
        "## 群组上下文",
        "",
        `- 目标：${team.objective}`,
        `- 当前任务：${context.activeTasks.join("、") || "暂无"}`,
        ""
      ].join("\n")
    );
    return artifactPath;
  }
  formatTimestamp() {
    return (/* @__PURE__ */ new Date()).toISOString();
  }
  getWorkspaceForConversation(conversation, agents, teams) {
    if (conversation.kind === "agent") {
      return agents.find((agent) => agent.id === conversation.targetId)?.workspacePath ?? this.dataDir;
    }
    return teams.find((team) => team.id === conversation.targetId)?.workspacePath ?? this.dataDir;
  }
  recoverInterruptedRuns() {
    for (const run of this.storage.listRuns()) {
      if (["running", "pausing", "resuming"].includes(run.status)) {
        this.storage.updateRun(run.id, { status: "paused" });
        this.addRunMessage(
          run.conversationId,
          run.id,
          "应用重新启动后，任务已恢复为暂停状态。",
          "system"
        );
      }
    }
  }
  emitSnapshot() {
    this.emit("snapshot", this.getSnapshot());
  }
}
const __dirname$1 = dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;
let mainWindow = null;
let runtime = null;
async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1180,
    minHeight: 780,
    title: "teamaligned",
    backgroundColor: "#f6f7fb",
    webPreferences: {
      preload: join(__dirname$1, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(join(__dirname$1, "../renderer/index.html"));
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
  runtime = new TeamalignedRuntime(join(app.getPath("userData"), "teamaligned"));
  await runtime.init();
  runtime.on("snapshot", broadcastSnapshot);
  ipcMain.handle("teamaligned:bootstrap", async () => runtime?.getSnapshot());
  ipcMain.handle(
    "teamaligned:send-input",
    async (_event, payload) => runtime?.sendInput(payload)
  );
  ipcMain.handle(
    "teamaligned:control-run",
    async (_event, payload) => runtime?.controlRun(payload)
  );
  ipcMain.handle(
    "teamaligned:create-agent",
    async (_event, payload) => runtime?.createAgent(payload)
  );
  ipcMain.handle(
    "teamaligned:create-team",
    async (_event, payload) => runtime?.createTeam(payload)
  );
  ipcMain.handle(
    "teamaligned:toggle-extension",
    async (_event, extensionId) => runtime?.toggleExtension(extensionId)
  );
  ipcMain.handle(
    "teamaligned:update-settings",
    async (_event, payload) => runtime?.updateSettings(payload)
  );
  ipcMain.handle(
    "teamaligned:update-profile",
    async (_event, payload) => runtime?.updateProfile(payload)
  );
  ipcMain.handle(
    "teamaligned:update-provider",
    async (_event, payload) => runtime?.updateProvider(payload)
  );
  ipcMain.handle("teamaligned:mark-notifications-read", async () => runtime?.markNotificationsRead());
  ipcMain.handle("teamaligned:open-workspace", async (_event, workspacePath) => {
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

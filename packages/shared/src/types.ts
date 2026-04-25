export type AppTheme = "light" | "dark";
export type AppLanguage = "zh" | "en";
export type ProviderId = "openai" | "qwen";
export type AgentStatus = "online" | "busy" | "offline";
export type ConversationKind = "agent" | "team";
export type McpTransport = "stdio" | "http";
export type McpConnectionStatus = "disconnected" | "configured" | "connected" | "error";
export type AvatarAssetScope = "profile" | "agents" | "teams";
export type SenderKind = "user" | "agent" | "system";
export type MessageType =
  | "user"
  | "agent"
  | "system"
  | "command"
  | "run"
  | "notification";
export type MessageVisibility = "public" | "internal" | "system";
export type RunKind = "agent_task" | "team_task" | "shell_command" | "mcp_call";
export type RunStatus =
  | "queued"
  | "running"
  | "pausing"
  | "paused"
  | "resuming"
  | "completed"
  | "failed"
  | "cancelled";
export type ExtensionType = "skill" | "mcp";
export type NotificationType =
  | "agent_message"
  | "group_message"
  | "run_complete"
  | "mention"
  | "system"
  | "run_failed"
  | "extension";

export interface AttachmentAssetRecord {
  name: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
}

export interface StoredAttachmentRecord extends AttachmentAssetRecord {
  id: string;
  conversationId: string;
  messageId: string | null;
  runId: string | null;
  createdAt: number;
}

export interface ArtifactRecord {
  id: string;
  conversationId: string;
  runId: string | null;
  artifactKind: "agent_output" | "team_output" | "command_output";
  title: string;
  path: string;
  workspacePath: string;
  createdAt: number;
  metadata: Record<string, unknown> | null;
}

export interface ToolInvocationRecord {
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
}

export interface RunStepRecord {
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
}

export interface UserProfile {
  name: string;
  role: string;
  team: string;
  email: string;
  bio: string;
  avatarPath: string | null;
}

export interface AppSettings {
  theme: AppTheme;
  language: AppLanguage;
  notifyAgentComplete: boolean;
  notifyMention: boolean;
  notifyGroup: boolean;
  activeProviderId: ProviderId;
}

export interface ProviderConfig {
  id: ProviderId;
  label: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  supportsToolCalling: boolean;
  supportsStreaming: boolean;
  isActive: boolean;
}

export interface ProviderConnectionTestInput {
  id: ProviderId;
  label?: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  supportsToolCalling: boolean;
  supportsStreaming: boolean;
}

export interface ProviderConnectionTestResult {
  ok: boolean;
  message: string;
  latencyMs: number | null;
}

export interface AgentRecord {
  id: string;
  name: string;
  role: string;
  avatar: string;
  avatarPath: string | null;
  avatarColor: string;
  status: AgentStatus;
  description: string;
  capabilities: string[];
  skillWhitelist: string[];
  mcpWhitelist: string[];
  workspacePath: string;
  modelId: string;
}

export interface TeamRecord {
  id: string;
  name: string;
  description: string;
  avatar: string;
  avatarPath: string | null;
  avatarColor: string;
  workspacePath: string;
  memberIds: string[];
  context: TeamContext;
}

export interface TeamContext {
  phase: string;
  constraints: string[];
  activeTasks: string[];
  recentDecisions: string[];
  pinnedArtifacts: string[];
  workspaceSummary: string;
  handoff?: {
    activeAgentId: string | null;
    lastSpeakerId: string | null;
    nextAgentIds: string[];
    reason: string;
    revision: number;
    updatedAt: number;
  };
}

export interface ConversationMeta {
  activeSkill: string | null;
  pinnedMcp: string | null;
  showInternalMessages: boolean;
}

export interface ConversationRecord {
  id: string;
  kind: ConversationKind;
  targetId: string;
  title: string;
  unread: number;
  lastMessage: string;
  lastActivityAt: number;
  meta: ConversationMeta;
}

export interface MessageRecord {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  senderKind: SenderKind;
  messageType: MessageType;
  visibility: MessageVisibility;
  content: string;
  mentions: string[];
  createdAt: number;
  runId: string | null;
  metadata: Record<string, unknown> | null;
}

export interface RunRecord {
  id: string;
  conversationId: string;
  title: string;
  kind: RunKind;
  status: RunStatus;
  actorId: string;
  stepIndex: number;
  totalSteps: number;
  createdAt: number;
  updatedAt: number;
  metadata: Record<string, unknown> | null;
}

export interface NotificationRecord {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  read: boolean;
  createdAt: number;
  relatedConversationId: string | null;
  relatedRunId: string | null;
}

export interface OpenConversationEvent {
  conversationId: string;
  relatedRunId?: string | null;
}

export interface ExtensionRecord {
  id: string;
  type: ExtensionType;
  name: string;
  description: string;
  installed: boolean;
  enabled: boolean;
  source: string;
  metadata: Record<string, unknown> | null;
}

export interface PromptAliasRecord {
  id: string;
  name: string;
  alias: string;
  description: string;
  prompt: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SkillCatalogRecord {
  id: string;
  slug: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  sourceRepo: string;
  sourceBranch: string;
  sourcePath: string;
  entryFile: string;
  installed: boolean;
  installedVersion: string | null;
  installPath: string | null;
  author: string;
  recommendedTools: string[];
  metadata: Record<string, unknown> | null;
}

export interface McpAuthFieldRecord {
  key: string;
  label: string;
  required: boolean;
  secret: boolean;
  placeholder?: string;
}

export interface McpToolRecord {
  name: string;
  title: string | null;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown> | null;
  annotations: Record<string, unknown> | null;
}

export interface McpCatalogRecord {
  id: string;
  slug: string;
  name: string;
  description: string;
  version: string;
  author: string;
  transport: McpTransport;
  sourceRepo: string;
  sourceBranch: string;
  sourcePath: string;
  launcherCommand: string | null;
  launcherArgs: string[];
  remoteUrl: string | null;
  authType: "none" | "env" | "header";
  authFields: McpAuthFieldRecord[];
  capabilities: string[];
  declaredTools: string[];
  recommendedFor: string[];
  riskLevel: "low" | "medium" | "high";
  docsUrl: string | null;
  homepage: string | null;
  metadata: Record<string, unknown> | null;
}

export interface McpConnectionRecord {
  serverId: string;
  enabled: boolean;
  transport: McpTransport;
  command: string | null;
  args: string[];
  url: string | null;
  envEntries: Record<string, string>;
  headers: Record<string, string>;
  cwd: string | null;
  discoveredTools: McpToolRecord[];
  status: McpConnectionStatus;
  lastCheckedAt: number | null;
  lastError: string | null;
}

export interface DashboardStats {
  activeAgents: number;
  totalAgents: number;
  totalTeams: number;
  runningRuns: number;
  completedToday: number;
  totalMessages: number;
  tokenEstimate: number;
}

export interface AppSnapshot {
  profile: UserProfile;
  settings: AppSettings;
  providers: ProviderConfig[];
  agents: AgentRecord[];
  teams: TeamRecord[];
  conversations: ConversationRecord[];
  messages: Record<string, MessageRecord[]>;
  runs: RunRecord[];
  attachments: StoredAttachmentRecord[];
  artifacts: ArtifactRecord[];
  toolInvocations: ToolInvocationRecord[];
  runSteps: RunStepRecord[];
  notifications: NotificationRecord[];
  extensions: ExtensionRecord[];
  promptAliases: PromptAliasRecord[];
  skillCatalog: SkillCatalogRecord[];
  mcpCatalog: McpCatalogRecord[];
  mcpConnections: McpConnectionRecord[];
  stats: DashboardStats;
}

export interface SlashCommand {
  raw: string;
  name: "skills" | "mcp" | "clear";
  args: string[];
}

export interface CreateAgentInput {
  name: string;
  role: string;
  description: string;
  capabilities: string[];
  workspacePath?: string;
  avatarPath?: string | null;
}

export interface CreateTeamInput {
  name: string;
  description: string;
  memberIds: string[];
  workspacePath?: string;
  avatarPath?: string | null;
}

export interface UpdateTeamInput {
  teamId: string;
  name: string;
  description: string;
  memberIds: string[];
  workspacePath?: string;
  avatarPath?: string | null;
}

export interface UpdateAgentInput {
  agentId: string;
  name: string;
  role: string;
  description: string;
  capabilities: string[];
  workspacePath?: string;
  avatarPath?: string | null;
}

export interface SendInputPayload {
  conversationId: string;
  input: string;
  attachments?: AttachmentAssetRecord[];
}

export interface RunControlPayload {
  conversationId: string;
  action: "pause" | "resume" | "cancel";
}

export interface UpdateSettingsInput extends Partial<AppSettings> {}

export interface UpdateProfileInput extends Partial<UserProfile> {}

export interface UpdateProviderInput extends Partial<ProviderConfig> {
  id: ProviderId;
}

export interface UpdateAgentSkillsInput {
  agentId: string;
  skillIds: string[];
}

export interface UpdateAgentMcpsInput {
  agentId: string;
  serverIds: string[];
}

export interface EnsureConversationInput {
  kind: ConversationKind;
  targetId: string;
}

export interface EnsureConversationResult {
  snapshot: AppSnapshot;
  conversationId: string;
}

export interface SavePromptAliasInput {
  id?: string;
  name: string;
  alias: string;
  description: string;
  prompt: string;
  enabled: boolean;
}

export interface ConnectMcpInput {
  serverId: string;
  command?: string | null;
  args?: string[];
  url?: string | null;
  envEntries?: Record<string, string>;
  headers?: Record<string, string>;
  cwd?: string | null;
  enabled?: boolean;
}

export interface SaveAvatarAssetInput {
  scope: AvatarAssetScope;
  dataUrl: string;
  fileNameHint?: string;
}

export interface SaveAttachmentAssetInput {
  conversationId: string;
  dataUrl: string;
  fileName: string;
}

export interface ConversationExportResult {
  conversationId: string;
  filePath: string;
  exportedAt: number;
  messageCount: number;
  runCount: number;
  runStepCount: number;
  artifactCount: number;
  attachmentCount: number;
  toolInvocationCount: number;
}

export interface TeamalignedApi {
  bootstrap: () => Promise<AppSnapshot>;
  sendInput: (payload: SendInputPayload) => Promise<AppSnapshot>;
  controlRun: (payload: RunControlPayload) => Promise<AppSnapshot>;
  createAgent: (payload: CreateAgentInput) => Promise<AppSnapshot>;
  createTeam: (payload: CreateTeamInput) => Promise<AppSnapshot>;
  deleteAgent: (agentId: string) => Promise<AppSnapshot>;
  deleteTeam: (teamId: string) => Promise<AppSnapshot>;
  deleteConversation: (conversationId: string) => Promise<AppSnapshot>;
  ensureConversation: (payload: EnsureConversationInput) => Promise<EnsureConversationResult>;
  updateAgent: (payload: UpdateAgentInput) => Promise<AppSnapshot>;
  updateTeam: (payload: UpdateTeamInput) => Promise<AppSnapshot>;
  refreshSkillCatalog: () => Promise<AppSnapshot>;
  installSkill: (skillId: string) => Promise<AppSnapshot>;
  removeSkill: (skillId: string) => Promise<AppSnapshot>;
  savePromptAlias: (payload: SavePromptAliasInput) => Promise<AppSnapshot>;
  removePromptAlias: (promptAliasId: string) => Promise<AppSnapshot>;
  refreshMcpCatalog: () => Promise<AppSnapshot>;
  connectMcp: (payload: ConnectMcpInput) => Promise<AppSnapshot>;
  checkMcpHealth: (serverId: string) => Promise<AppSnapshot>;
  disconnectMcp: (serverId: string) => Promise<AppSnapshot>;
  toggleExtension: (extensionId: string) => Promise<AppSnapshot>;
  updateAgentSkills: (payload: UpdateAgentSkillsInput) => Promise<AppSnapshot>;
  updateAgentMcps: (payload: UpdateAgentMcpsInput) => Promise<AppSnapshot>;
  updateSettings: (payload: UpdateSettingsInput) => Promise<AppSnapshot>;
  updateProfile: (payload: UpdateProfileInput) => Promise<AppSnapshot>;
  updateProvider: (payload: UpdateProviderInput) => Promise<AppSnapshot>;
  testProviderConnection: (
    payload: ProviderConnectionTestInput,
  ) => Promise<ProviderConnectionTestResult>;
  saveAvatarAsset: (payload: SaveAvatarAssetInput) => Promise<string>;
  saveAttachmentAsset: (payload: SaveAttachmentAssetInput) => Promise<AttachmentAssetRecord>;
  exportConversationData: (conversationId: string) => Promise<ConversationExportResult>;
  markNotificationsRead: () => Promise<AppSnapshot>;
  markConversationRead: (conversationId: string) => Promise<AppSnapshot>;
  openNotificationSettings: () => Promise<boolean>;
  selectDirectory: () => Promise<string | null>;
  openWorkspace: (path: string) => Promise<void>;
  subscribeOpenConversation: (listener: (payload: OpenConversationEvent) => void) => () => void;
  subscribe: (listener: (snapshot: AppSnapshot) => void) => () => void;
}

declare global {
  interface Window {
    teamaligned: TeamalignedApi;
  }
}

export type AppTheme = "light" | "dark";
export type AppLanguage = "zh" | "en";
export type ProviderId = "openai" | "qwen";
export type AgentStatus = "online" | "busy" | "offline";
export type ConversationKind = "agent" | "team";
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
  | "run_complete"
  | "mention"
  | "system"
  | "run_failed"
  | "extension";

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
  objective: string;
  workspacePath: string;
  memberIds: string[];
  context: TeamContext;
}

export interface TeamContext {
  objective: string;
  phase: string;
  constraints: string[];
  activeTasks: string[];
  recentDecisions: string[];
  pinnedArtifacts: string[];
  workspaceSummary: string;
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
  notifications: NotificationRecord[];
  extensions: ExtensionRecord[];
  stats: DashboardStats;
}

export interface SlashCommand {
  raw: string;
  name: "skills" | "command" | "mcp" | "pause" | "resume" | "cancel";
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
  objective: string;
  memberIds: string[];
  workspacePath?: string;
  avatarPath?: string | null;
}

export interface SendInputPayload {
  conversationId: string;
  input: string;
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

export interface TeamalignedApi {
  bootstrap: () => Promise<AppSnapshot>;
  sendInput: (payload: SendInputPayload) => Promise<AppSnapshot>;
  controlRun: (payload: RunControlPayload) => Promise<AppSnapshot>;
  createAgent: (payload: CreateAgentInput) => Promise<AppSnapshot>;
  createTeam: (payload: CreateTeamInput) => Promise<AppSnapshot>;
  toggleExtension: (extensionId: string) => Promise<AppSnapshot>;
  updateSettings: (payload: UpdateSettingsInput) => Promise<AppSnapshot>;
  updateProfile: (payload: UpdateProfileInput) => Promise<AppSnapshot>;
  updateProvider: (payload: UpdateProviderInput) => Promise<AppSnapshot>;
  markNotificationsRead: () => Promise<AppSnapshot>;
  openWorkspace: (path: string) => Promise<void>;
  subscribe: (listener: (snapshot: AppSnapshot) => void) => () => void;
}

declare global {
  interface Window {
    teamaligned: TeamalignedApi;
  }
}

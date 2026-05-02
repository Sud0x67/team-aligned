import { contextBridge, ipcRenderer } from "electron";
import type {
  AttachmentAssetRecord,
  AppSnapshot,
  ConnectMcpInput,
  ConversationExportResult,
  CreateAgentInput,
  CreateTeamInput,
  DiagnosticsExportResult,
  FeedbackChannel,
  EnsureConversationInput,
  EnsureConversationResult,
  OpenConversationEvent,
  ProviderId,
  RendererErrorReport,
  RunControlPayload,
  SearchWorkspaceFilesInput,
  SaveAttachmentAssetInput,
  SaveAvatarAssetInput,
  SavePromptAliasInput,
  SendInputPayload,
  TeamalignedApi,
  ProviderConnectionTestInput,
  ProviderConnectionTestResult,
  PreviewWorkspaceReferencesInput,
  SelectDirectoryInput,
  UpdateAgentInput,
  UpdateAgentSkillsInput,
  UpdateAgentMcpsInput,
  UpdateTeamInput,
  UpdateProfileInput,
  UpdateProviderInput,
  UpdateSettingsInput,
} from "@shared";

const api: TeamalignedApi = {
  bootstrap: () => ipcRenderer.invoke("teamaligned:bootstrap"),
  loadConversationData: (conversationId: string) =>
    ipcRenderer.invoke("teamaligned:load-conversation-data", conversationId),
  reportRendererError: (payload: RendererErrorReport) =>
    ipcRenderer.invoke("teamaligned:report-renderer-error", payload),
  sendInput: (payload: SendInputPayload) => ipcRenderer.invoke("teamaligned:send-input", payload),
  searchWorkspaceFiles: (payload: SearchWorkspaceFilesInput) =>
    ipcRenderer.invoke("teamaligned:search-workspace-files", payload),
  previewWorkspaceReferences: (payload: PreviewWorkspaceReferencesInput) =>
    ipcRenderer.invoke("teamaligned:preview-workspace-references", payload),
  controlRun: (payload: RunControlPayload) => ipcRenderer.invoke("teamaligned:control-run", payload),
  createAgent: (payload: CreateAgentInput) => ipcRenderer.invoke("teamaligned:create-agent", payload),
  createTeam: (payload: CreateTeamInput) => ipcRenderer.invoke("teamaligned:create-team", payload),
  deleteAgent: (agentId: string) => ipcRenderer.invoke("teamaligned:delete-agent", agentId),
  deleteTeam: (teamId: string) => ipcRenderer.invoke("teamaligned:delete-team", teamId),
  deleteConversation: (conversationId: string) =>
    ipcRenderer.invoke("teamaligned:delete-conversation", conversationId),
  ensureConversation: (payload: EnsureConversationInput): Promise<EnsureConversationResult> =>
    ipcRenderer.invoke("teamaligned:ensure-conversation", payload),
  updateAgent: (payload: UpdateAgentInput) => ipcRenderer.invoke("teamaligned:update-agent", payload),
  updateTeam: (payload: UpdateTeamInput) => ipcRenderer.invoke("teamaligned:update-team", payload),
  refreshSkillCatalog: () => ipcRenderer.invoke("teamaligned:refresh-skill-catalog"),
  installSkill: (skillId: string) => ipcRenderer.invoke("teamaligned:install-skill", skillId),
  removeSkill: (skillId: string) => ipcRenderer.invoke("teamaligned:remove-skill", skillId),
  savePromptAlias: (payload: SavePromptAliasInput) =>
    ipcRenderer.invoke("teamaligned:save-prompt-alias", payload),
  removePromptAlias: (promptAliasId: string) =>
    ipcRenderer.invoke("teamaligned:remove-prompt-alias", promptAliasId),
  refreshMcpCatalog: () => ipcRenderer.invoke("teamaligned:refresh-mcp-catalog"),
  connectMcp: (payload: ConnectMcpInput) => ipcRenderer.invoke("teamaligned:connect-mcp", payload),
  checkMcpHealth: (serverId: string) => ipcRenderer.invoke("teamaligned:check-mcp-health", serverId),
  disconnectMcp: (serverId: string) => ipcRenderer.invoke("teamaligned:disconnect-mcp", serverId),
  toggleExtension: (extensionId: string) =>
    ipcRenderer.invoke("teamaligned:toggle-extension", extensionId),
  updateAgentSkills: (payload: UpdateAgentSkillsInput) =>
    ipcRenderer.invoke("teamaligned:update-agent-skills", payload),
  updateAgentMcps: (payload: UpdateAgentMcpsInput) =>
    ipcRenderer.invoke("teamaligned:update-agent-mcps", payload),
  updateSettings: (payload: UpdateSettingsInput) =>
    ipcRenderer.invoke("teamaligned:update-settings", payload),
  updateProfile: (payload: UpdateProfileInput) =>
    ipcRenderer.invoke("teamaligned:update-profile", payload),
  updateProvider: (payload: UpdateProviderInput) =>
    ipcRenderer.invoke("teamaligned:update-provider", payload),
  testProviderConnection: (
    payload: ProviderConnectionTestInput,
  ): Promise<ProviderConnectionTestResult> =>
    ipcRenderer.invoke("teamaligned:test-provider-connection", payload),
  saveAvatarAsset: (payload: SaveAvatarAssetInput) =>
    ipcRenderer.invoke("teamaligned:save-avatar-asset", payload),
  saveAttachmentAsset: (payload: SaveAttachmentAssetInput): Promise<AttachmentAssetRecord> =>
    ipcRenderer.invoke("teamaligned:save-attachment-asset", payload),
  exportConversationData: (conversationId: string): Promise<ConversationExportResult> =>
    ipcRenderer.invoke("teamaligned:export-conversation-data", conversationId),
  exportDiagnostics: (): Promise<DiagnosticsExportResult> =>
    ipcRenderer.invoke("teamaligned:export-diagnostics"),
  openDiagnosticsFolder: () => ipcRenderer.invoke("teamaligned:open-diagnostics-folder"),
  openFeedbackChannel: (channel: FeedbackChannel) =>
    ipcRenderer.invoke("teamaligned:open-feedback-channel", channel),
  openProviderKeyHelp: (providerId: ProviderId) =>
    ipcRenderer.invoke("teamaligned:open-provider-key-help", providerId),
  markNotificationsRead: () => ipcRenderer.invoke("teamaligned:mark-notifications-read"),
  markConversationRead: (conversationId: string) =>
    ipcRenderer.invoke("teamaligned:mark-conversation-read", conversationId),
  openNotificationSettings: () => ipcRenderer.invoke("teamaligned:open-notification-settings"),
  selectDirectory: (payload?: SelectDirectoryInput) =>
    ipcRenderer.invoke("teamaligned:select-directory", payload),
  openWorkspace: (path: string) => ipcRenderer.invoke("teamaligned:open-workspace", path),
  subscribeOpenConversation: (listener: (payload: OpenConversationEvent) => void) => {
    const wrapped = (_event: unknown, payload: OpenConversationEvent) => listener(payload);
    ipcRenderer.on("teamaligned:open-conversation", wrapped);
    return () => {
      ipcRenderer.removeListener("teamaligned:open-conversation", wrapped);
    };
  },
  subscribe: (listener: (snapshot: AppSnapshot) => void) => {
    const wrapped = (_event: unknown, snapshot: AppSnapshot) => listener(snapshot);
    ipcRenderer.on("teamaligned:snapshot", wrapped);
    return () => {
      ipcRenderer.removeListener("teamaligned:snapshot", wrapped);
    };
  },
};

contextBridge.exposeInMainWorld("teamaligned", api);

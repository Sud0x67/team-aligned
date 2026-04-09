import { contextBridge, ipcRenderer } from "electron";
import type {
  AttachmentAssetRecord,
  AppSnapshot,
  ConnectMcpInput,
  CreateAgentInput,
  CreateTeamInput,
  RunControlPayload,
  SaveAttachmentAssetInput,
  SaveAvatarAssetInput,
  SendInputPayload,
  TeamalignedApi,
  ProviderConnectionTestInput,
  ProviderConnectionTestResult,
  UpdateAgentInput,
  UpdateAgentSkillsInput,
  UpdateAgentMcpsInput,
  UpdateProfileInput,
  UpdateProviderInput,
  UpdateSettingsInput,
  UpdateTeamMcpsInput,
} from "@shared";

const api: TeamalignedApi = {
  bootstrap: () => ipcRenderer.invoke("teamaligned:bootstrap"),
  sendInput: (payload: SendInputPayload) => ipcRenderer.invoke("teamaligned:send-input", payload),
  controlRun: (payload: RunControlPayload) => ipcRenderer.invoke("teamaligned:control-run", payload),
  createAgent: (payload: CreateAgentInput) => ipcRenderer.invoke("teamaligned:create-agent", payload),
  createTeam: (payload: CreateTeamInput) => ipcRenderer.invoke("teamaligned:create-team", payload),
  updateAgent: (payload: UpdateAgentInput) => ipcRenderer.invoke("teamaligned:update-agent", payload),
  refreshSkillCatalog: () => ipcRenderer.invoke("teamaligned:refresh-skill-catalog"),
  installSkill: (skillId: string) => ipcRenderer.invoke("teamaligned:install-skill", skillId),
  removeSkill: (skillId: string) => ipcRenderer.invoke("teamaligned:remove-skill", skillId),
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
  updateTeamMcps: (payload: UpdateTeamMcpsInput) =>
    ipcRenderer.invoke("teamaligned:update-team-mcps", payload),
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
  markNotificationsRead: () => ipcRenderer.invoke("teamaligned:mark-notifications-read"),
  markConversationRead: (conversationId: string) =>
    ipcRenderer.invoke("teamaligned:mark-conversation-read", conversationId),
  selectDirectory: () => ipcRenderer.invoke("teamaligned:select-directory"),
  openWorkspace: (path: string) => ipcRenderer.invoke("teamaligned:open-workspace", path),
  subscribe: (listener: (snapshot: AppSnapshot) => void) => {
    const wrapped = (_event: unknown, snapshot: AppSnapshot) => listener(snapshot);
    ipcRenderer.on("teamaligned:snapshot", wrapped);
    return () => {
      ipcRenderer.removeListener("teamaligned:snapshot", wrapped);
    };
  },
};

contextBridge.exposeInMainWorld("teamaligned", api);

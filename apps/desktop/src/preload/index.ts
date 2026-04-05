import { contextBridge, ipcRenderer } from "electron";
import type {
  AppSnapshot,
  CreateAgentInput,
  CreateTeamInput,
  RunControlPayload,
  SendInputPayload,
  TeamalignedApi,
  UpdateProfileInput,
  UpdateProviderInput,
  UpdateSettingsInput,
} from "@shared";

const api: TeamalignedApi = {
  bootstrap: () => ipcRenderer.invoke("teamaligned:bootstrap"),
  sendInput: (payload: SendInputPayload) => ipcRenderer.invoke("teamaligned:send-input", payload),
  controlRun: (payload: RunControlPayload) => ipcRenderer.invoke("teamaligned:control-run", payload),
  createAgent: (payload: CreateAgentInput) => ipcRenderer.invoke("teamaligned:create-agent", payload),
  createTeam: (payload: CreateTeamInput) => ipcRenderer.invoke("teamaligned:create-team", payload),
  toggleExtension: (extensionId: string) =>
    ipcRenderer.invoke("teamaligned:toggle-extension", extensionId),
  updateSettings: (payload: UpdateSettingsInput) =>
    ipcRenderer.invoke("teamaligned:update-settings", payload),
  updateProfile: (payload: UpdateProfileInput) =>
    ipcRenderer.invoke("teamaligned:update-profile", payload),
  updateProvider: (payload: UpdateProviderInput) =>
    ipcRenderer.invoke("teamaligned:update-provider", payload),
  markNotificationsRead: () => ipcRenderer.invoke("teamaligned:mark-notifications-read"),
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


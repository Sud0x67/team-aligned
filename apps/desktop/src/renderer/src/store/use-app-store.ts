import { create } from "zustand";
import { commandSuggestions } from "@shared";
import type {
  AppSnapshot,
  ConnectMcpInput,
  CreateAgentInput,
  CreateTeamInput,
  ProviderConnectionTestInput,
  ProviderConnectionTestResult,
  RunControlPayload,
  SendInputPayload,
  UpdateAgentSkillsInput,
  UpdateAgentMcpsInput,
  UpdateProfileInput,
  UpdateProviderInput,
  UpdateSettingsInput,
  UpdateTeamMcpsInput,
} from "@shared";

type AppStore = AppSnapshot & {
  bootstrapped: boolean;
  loading: boolean;
  commandSuggestions: typeof commandSuggestions;
  bootstrap: () => Promise<void>;
  sendInput: (payload: SendInputPayload) => Promise<void>;
  controlRun: (payload: RunControlPayload) => Promise<void>;
  createAgent: (payload: CreateAgentInput) => Promise<void>;
  createTeam: (payload: CreateTeamInput) => Promise<void>;
  refreshSkillCatalog: () => Promise<void>;
  installSkill: (skillId: string) => Promise<void>;
  refreshMcpCatalog: () => Promise<void>;
  connectMcp: (payload: ConnectMcpInput) => Promise<void>;
  checkMcpHealth: (serverId: string) => Promise<void>;
  disconnectMcp: (serverId: string) => Promise<void>;
  toggleExtension: (extensionId: string) => Promise<void>;
  updateAgentSkills: (payload: UpdateAgentSkillsInput) => Promise<void>;
  updateAgentMcps: (payload: UpdateAgentMcpsInput) => Promise<void>;
  updateTeamMcps: (payload: UpdateTeamMcpsInput) => Promise<void>;
  updateSettings: (payload: UpdateSettingsInput) => Promise<void>;
  updateProfile: (payload: UpdateProfileInput) => Promise<void>;
  updateProvider: (payload: UpdateProviderInput) => Promise<void>;
  testProviderConnection: (payload: ProviderConnectionTestInput) => Promise<ProviderConnectionTestResult>;
  markNotificationsRead: () => Promise<void>;
  openWorkspace: (path: string) => Promise<void>;
  applySnapshot: (snapshot: AppSnapshot) => void;
};

const emptySnapshot: AppSnapshot = {
  profile: {
    name: "",
    role: "",
    team: "",
    email: "",
    bio: "",
    avatarPath: null,
  },
  settings: {
    theme: "light",
    language: "zh",
    notifyAgentComplete: true,
    notifyMention: true,
    notifyGroup: true,
    activeProviderId: "qwen",
  },
  providers: [],
  agents: [],
  teams: [],
  conversations: [],
  messages: {},
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
  stats: {
    activeAgents: 0,
    totalAgents: 0,
    totalTeams: 0,
    runningRuns: 0,
    completedToday: 0,
    totalMessages: 0,
    tokenEstimate: 0,
  },
};

export const useAppStore = create<AppStore>((set) => ({
  ...emptySnapshot,
  bootstrapped: false,
  loading: false,
  commandSuggestions,
  applySnapshot: (snapshot) => set({ ...snapshot, bootstrapped: true, loading: false }),
  bootstrap: async () => {
    set({ loading: true });
    const snapshot = await window.teamaligned.bootstrap();
    set({ ...snapshot, bootstrapped: true, loading: false });
  },
  sendInput: async (payload) => {
    set({ loading: true });
    const snapshot = await window.teamaligned.sendInput(payload);
    set({ ...snapshot, bootstrapped: true, loading: false });
  },
  controlRun: async (payload) => {
    const snapshot = await window.teamaligned.controlRun(payload);
    set({ ...snapshot, bootstrapped: true, loading: false });
  },
  createAgent: async (payload) => {
    const snapshot = await window.teamaligned.createAgent(payload);
    set({ ...snapshot, bootstrapped: true, loading: false });
  },
  createTeam: async (payload) => {
    const snapshot = await window.teamaligned.createTeam(payload);
    set({ ...snapshot, bootstrapped: true, loading: false });
  },
  refreshSkillCatalog: async () => {
    set({ loading: true });
    const snapshot = await window.teamaligned.refreshSkillCatalog();
    set({ ...snapshot, bootstrapped: true, loading: false });
  },
  installSkill: async (skillId) => {
    set({ loading: true });
    const snapshot = await window.teamaligned.installSkill(skillId);
    set({ ...snapshot, bootstrapped: true, loading: false });
  },
  refreshMcpCatalog: async () => {
    set({ loading: true });
    const snapshot = await window.teamaligned.refreshMcpCatalog();
    set({ ...snapshot, bootstrapped: true, loading: false });
  },
  connectMcp: async (payload) => {
    set({ loading: true });
    const snapshot = await window.teamaligned.connectMcp(payload);
    set({ ...snapshot, bootstrapped: true, loading: false });
  },
  checkMcpHealth: async (serverId) => {
    set({ loading: true });
    const snapshot = await window.teamaligned.checkMcpHealth(serverId);
    set({ ...snapshot, bootstrapped: true, loading: false });
  },
  disconnectMcp: async (serverId) => {
    set({ loading: true });
    const snapshot = await window.teamaligned.disconnectMcp(serverId);
    set({ ...snapshot, bootstrapped: true, loading: false });
  },
  toggleExtension: async (extensionId) => {
    const snapshot = await window.teamaligned.toggleExtension(extensionId);
    set({ ...snapshot, bootstrapped: true, loading: false });
  },
  updateAgentSkills: async (payload) => {
    const snapshot = await window.teamaligned.updateAgentSkills(payload);
    set({ ...snapshot, bootstrapped: true, loading: false });
  },
  updateAgentMcps: async (payload) => {
    const snapshot = await window.teamaligned.updateAgentMcps(payload);
    set({ ...snapshot, bootstrapped: true, loading: false });
  },
  updateTeamMcps: async (payload) => {
    const snapshot = await window.teamaligned.updateTeamMcps(payload);
    set({ ...snapshot, bootstrapped: true, loading: false });
  },
  updateSettings: async (payload) => {
    const snapshot = await window.teamaligned.updateSettings(payload);
    set({ ...snapshot, bootstrapped: true, loading: false });
  },
  updateProfile: async (payload) => {
    const snapshot = await window.teamaligned.updateProfile(payload);
    set({ ...snapshot, bootstrapped: true, loading: false });
  },
  updateProvider: async (payload) => {
    const snapshot = await window.teamaligned.updateProvider(payload);
    set({ ...snapshot, bootstrapped: true, loading: false });
  },
  testProviderConnection: (payload) => window.teamaligned.testProviderConnection(payload),
  markNotificationsRead: async () => {
    const snapshot = await window.teamaligned.markNotificationsRead();
    set({ ...snapshot, bootstrapped: true, loading: false });
  },
  openWorkspace: async (path) => {
    await window.teamaligned.openWorkspace(path);
  },
}));

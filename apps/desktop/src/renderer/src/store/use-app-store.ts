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
  SavePromptAliasInput,
  SendInputPayload,
  UpdateAgentInput,
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
  updateAgent: (payload: UpdateAgentInput) => Promise<void>;
  refreshSkillCatalog: () => Promise<void>;
  installSkill: (skillId: string) => Promise<void>;
  removeSkill: (skillId: string) => Promise<void>;
  savePromptAlias: (payload: SavePromptAliasInput) => Promise<void>;
  removePromptAlias: (promptAliasId: string) => Promise<void>;
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
  markConversationRead: (conversationId: string) => Promise<void>;
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
  promptAliases: [],
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

export const useAppStore = create<AppStore>((set) => {
  const applySnapshot = (snapshot: AppSnapshot) =>
    set({ ...snapshot, bootstrapped: true, loading: false });

  const runSnapshotAction = async (action: () => Promise<AppSnapshot | undefined>) => {
    const snapshot = await action();
    if (snapshot) {
      applySnapshot(snapshot);
    } else {
      set({ loading: false });
    }
  };

  const runLoadingSnapshotAction = async (action: () => Promise<AppSnapshot | undefined>) => {
    set({ loading: true });
    await runSnapshotAction(action);
  };

  return {
    ...emptySnapshot,
    bootstrapped: false,
    loading: false,
    commandSuggestions,
    applySnapshot,
    bootstrap: async () => runLoadingSnapshotAction(() => window.teamaligned.bootstrap()),
    sendInput: async (payload) =>
      runLoadingSnapshotAction(() => window.teamaligned.sendInput(payload)),
    controlRun: async (payload) =>
      runSnapshotAction(() => window.teamaligned.controlRun(payload)),
    createAgent: async (payload) =>
      runSnapshotAction(() => window.teamaligned.createAgent(payload)),
    createTeam: async (payload) =>
      runSnapshotAction(() => window.teamaligned.createTeam(payload)),
    updateAgent: async (payload) =>
      runSnapshotAction(() => window.teamaligned.updateAgent(payload)),
    refreshSkillCatalog: async () =>
      runLoadingSnapshotAction(() => window.teamaligned.refreshSkillCatalog()),
    installSkill: async (skillId) =>
      runLoadingSnapshotAction(() => window.teamaligned.installSkill(skillId)),
    removeSkill: async (skillId) => {
      if (typeof window.teamaligned.removeSkill !== "function") {
        throw new Error("当前窗口还没有加载新版 preload，请重启应用后再移除 Skill。");
      }
      await runLoadingSnapshotAction(() => window.teamaligned.removeSkill(skillId));
    },
    savePromptAlias: async (payload) =>
      runLoadingSnapshotAction(() => window.teamaligned.savePromptAlias(payload)),
    removePromptAlias: async (promptAliasId) =>
      runLoadingSnapshotAction(() => window.teamaligned.removePromptAlias(promptAliasId)),
    refreshMcpCatalog: async () =>
      runLoadingSnapshotAction(() => window.teamaligned.refreshMcpCatalog()),
    connectMcp: async (payload) =>
      runLoadingSnapshotAction(() => window.teamaligned.connectMcp(payload)),
    checkMcpHealth: async (serverId) =>
      runLoadingSnapshotAction(() => window.teamaligned.checkMcpHealth(serverId)),
    disconnectMcp: async (serverId) =>
      runLoadingSnapshotAction(() => window.teamaligned.disconnectMcp(serverId)),
    toggleExtension: async (extensionId) =>
      runSnapshotAction(() => window.teamaligned.toggleExtension(extensionId)),
    updateAgentSkills: async (payload) =>
      runSnapshotAction(() => window.teamaligned.updateAgentSkills(payload)),
    updateAgentMcps: async (payload) =>
      runSnapshotAction(() => window.teamaligned.updateAgentMcps(payload)),
    updateTeamMcps: async (payload) =>
      runSnapshotAction(() => window.teamaligned.updateTeamMcps(payload)),
    updateSettings: async (payload) =>
      runSnapshotAction(() => window.teamaligned.updateSettings(payload)),
    updateProfile: async (payload) =>
      runSnapshotAction(() => window.teamaligned.updateProfile(payload)),
    updateProvider: async (payload) =>
      runSnapshotAction(() => window.teamaligned.updateProvider(payload)),
    testProviderConnection: (payload) => window.teamaligned.testProviderConnection(payload),
    markNotificationsRead: async () => {
      set({ notifications: [] });
      await runSnapshotAction(() => window.teamaligned.markNotificationsRead());
    },
    markConversationRead: async (conversationId) => {
      set((state) => ({
        conversations: state.conversations.map((conversation) =>
          conversation.id === conversationId ? { ...conversation, unread: 0 } : conversation,
        ),
      }));
      await runSnapshotAction(() => window.teamaligned.markConversationRead(conversationId));
    },
    openWorkspace: async (path) => {
      await window.teamaligned.openWorkspace(path);
    },
  };
});

import { create } from "zustand";
import { commandSuggestions } from "@shared";
import type {
  AppSnapshot,
  CreateAgentInput,
  CreateTeamInput,
  RunControlPayload,
  SendInputPayload,
  UpdateProfileInput,
  UpdateProviderInput,
  UpdateSettingsInput,
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
  toggleExtension: (extensionId: string) => Promise<void>;
  updateSettings: (payload: UpdateSettingsInput) => Promise<void>;
  updateProfile: (payload: UpdateProfileInput) => Promise<void>;
  updateProvider: (payload: UpdateProviderInput) => Promise<void>;
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
  notifications: [],
  extensions: [],
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
  toggleExtension: async (extensionId) => {
    const snapshot = await window.teamaligned.toggleExtension(extensionId);
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
  markNotificationsRead: async () => {
    const snapshot = await window.teamaligned.markNotificationsRead();
    set({ ...snapshot, bootstrapped: true, loading: false });
  },
  openWorkspace: async (path) => {
    await window.teamaligned.openWorkspace(path);
  },
}));

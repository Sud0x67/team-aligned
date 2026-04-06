import { app, BrowserWindow, ipcMain, shell } from "electron";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TeamalignedRuntime } from "@runtime";
import type {
  AvatarAssetScope,
  ConnectMcpInput,
  CreateAgentInput,
  CreateTeamInput,
  RunControlPayload,
  SaveAttachmentAssetInput,
  SendInputPayload,
  ProviderConnectionTestInput,
  UpdateAgentSkillsInput,
  UpdateAgentMcpsInput,
  UpdateProfileInput,
  UpdateProviderInput,
  UpdateSettingsInput,
  UpdateTeamMcpsInput,
} from "@shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let runtime: TeamalignedRuntime | null = null;

function hasRuntimeData(rootDir: string) {
  return [
    "settings.json",
    "app.db",
    "transcripts",
    "workspaces",
    "skills",
  ].some((entry) => existsSync(join(rootDir, entry)));
}

function resolveRuntimeRoot() {
  return join(homedir(), "teamaligned");
}

function migrateLegacyRuntimeRoot(targetRoot: string) {
  mkdirSync(targetRoot, { recursive: true });
  if (hasRuntimeData(targetRoot)) {
    return;
  }

  const legacyRoots = [
    join(homedir(), ".teamaligned"),
    join(app.getPath("userData"), "teamaligned"),
  ];

  for (const legacyRoot of legacyRoots) {
    if (legacyRoot === targetRoot) {
      continue;
    }
    if (!hasRuntimeData(legacyRoot)) {
      continue;
    }
    cpSync(legacyRoot, targetRoot, { recursive: true });
    break;
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 1180,
    minHeight: 780,
    title: "teamaligned",
    backgroundColor: "#f6f7fb",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
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
  const runtimeRoot = resolveRuntimeRoot();
  migrateLegacyRuntimeRoot(runtimeRoot);
  runtime = new TeamalignedRuntime(runtimeRoot);
  await runtime.init();
  runtime.on("snapshot", broadcastSnapshot);

  ipcMain.handle("teamaligned:bootstrap", async () => runtime?.getSnapshot());
  ipcMain.handle("teamaligned:send-input", async (_event, payload: SendInputPayload) =>
    runtime?.sendInput(payload),
  );
  ipcMain.handle("teamaligned:control-run", async (_event, payload: RunControlPayload) =>
    runtime?.controlRun(payload),
  );
  ipcMain.handle("teamaligned:create-agent", async (_event, payload: CreateAgentInput) =>
    runtime?.createAgent(payload),
  );
  ipcMain.handle("teamaligned:create-team", async (_event, payload: CreateTeamInput) =>
    runtime?.createTeam(payload),
  );
  ipcMain.handle("teamaligned:refresh-skill-catalog", async () => runtime?.refreshSkillCatalog());
  ipcMain.handle("teamaligned:install-skill", async (_event, skillId: string) =>
    runtime?.installSkill(skillId),
  );
  ipcMain.handle("teamaligned:refresh-mcp-catalog", async () => runtime?.refreshMcpCatalog());
  ipcMain.handle("teamaligned:connect-mcp", async (_event, payload: ConnectMcpInput) =>
    runtime?.connectMcp(payload),
  );
  ipcMain.handle("teamaligned:check-mcp-health", async (_event, serverId: string) =>
    runtime?.checkMcpHealth(serverId),
  );
  ipcMain.handle("teamaligned:disconnect-mcp", async (_event, serverId: string) =>
    runtime?.disconnectMcp(serverId),
  );
  ipcMain.handle("teamaligned:toggle-extension", async (_event, extensionId: string) =>
    runtime?.toggleExtension(extensionId),
  );
  ipcMain.handle("teamaligned:update-agent-skills", async (_event, payload: UpdateAgentSkillsInput) =>
    runtime?.updateAgentSkills(payload),
  );
  ipcMain.handle("teamaligned:update-agent-mcps", async (_event, payload: UpdateAgentMcpsInput) =>
    runtime?.updateAgentMcps(payload),
  );
  ipcMain.handle("teamaligned:update-team-mcps", async (_event, payload: UpdateTeamMcpsInput) =>
    runtime?.updateTeamMcps(payload),
  );
  ipcMain.handle("teamaligned:update-settings", async (_event, payload: UpdateSettingsInput) =>
    runtime?.updateSettings(payload),
  );
  ipcMain.handle("teamaligned:update-profile", async (_event, payload: UpdateProfileInput) =>
    runtime?.updateProfile(payload),
  );
  ipcMain.handle("teamaligned:update-provider", async (_event, payload: UpdateProviderInput) =>
    runtime?.updateProvider(payload),
  );
  ipcMain.handle(
    "teamaligned:test-provider-connection",
    async (_event, payload: ProviderConnectionTestInput) => runtime?.testProviderConnection(payload),
  );
  ipcMain.handle(
    "teamaligned:save-avatar-asset",
    async (
      _event,
      payload: {
        scope: AvatarAssetScope;
        dataUrl: string;
        fileNameHint?: string;
      },
    ) => runtime?.saveAvatarAsset(payload),
  );
  ipcMain.handle(
    "teamaligned:save-attachment-asset",
    async (_event, payload: SaveAttachmentAssetInput) => runtime?.saveAttachmentAsset(payload),
  );
  ipcMain.handle("teamaligned:mark-notifications-read", async () => runtime?.markNotificationsRead());
  ipcMain.handle("teamaligned:open-workspace", async (_event, workspacePath: string) => {
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

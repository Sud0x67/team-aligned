import { app, BrowserWindow, ipcMain, shell } from "electron";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TeamalignedRuntime } from "@runtime";
import type {
  CreateAgentInput,
  CreateTeamInput,
  RunControlPayload,
  SendInputPayload,
  UpdateProfileInput,
  UpdateProviderInput,
  UpdateSettingsInput,
} from "@shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;
let runtime: TeamalignedRuntime | null = null;

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
  runtime = new TeamalignedRuntime(join(app.getPath("userData"), "teamaligned"));
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
  ipcMain.handle("teamaligned:toggle-extension", async (_event, extensionId: string) =>
    runtime?.toggleExtension(extensionId),
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

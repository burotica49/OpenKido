import { app, BrowserWindow, shell, dialog, utilityProcess } from "electron";
import type { UtilityProcess } from "electron";
import path from "path";
import fs from "fs";
import http from "http";

const PORT = 3001;
const DEV = !app.isPackaged;

// ─── Single instance lock ─────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
let nextServer: UtilityProcess | null = null;

// ─── DB path in userData ──────────────────────────────────────────────────────

function getUserDataDb(): string {
  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "openkido.db");
}

// ─── Wait for Next.js ─────────────────────────────────────────────────────────

function waitForServer(url: string, timeout = 60_000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function attempt() {
      http
        .get(url, (res) => {
          if (res.statusCode && res.statusCode < 500) resolve();
          else retry();
        })
        .on("error", retry);
    }
    function retry() {
      if (Date.now() - start > timeout) {
        reject(new Error("Next.js server did not start in time"));
      } else {
        setTimeout(attempt, 500);
      }
    }
    attempt();
  });
}

// ─── Start bundled Next.js server ─────────────────────────────────────────────

async function startNextServer(): Promise<void> {
  if (DEV) return;

  const base = path.join(process.resourcesPath, "nextjs");
  const serverJs = path.join(base, "server.js");
  const dbPath = getUserDataDb();

  if (!fs.existsSync(serverJs)) {
    throw new Error(`server.js introuvable : ${serverJs}`);
  }

  // First launch: seed the user DB from the pre-migrated template bundled
  // at build time (running the Prisma CLI at runtime is too fragile).
  if (!fs.existsSync(dbPath)) {
    const template = path.join(base, "prisma", "template.db");
    if (fs.existsSync(template)) fs.cpSync(template, dbPath);
  }

  const env = {
    ...process.env,
    PORT: String(PORT),
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
    DATABASE_URL: `file:${dbPath}`,
    NEXTAUTH_URL: `http://localhost:${PORT}`,
  };

  // utilityProcess.fork() runs server.js with Electron's embedded Node.js
  // without spawning a new app instance.
  nextServer = utilityProcess.fork(serverJs, [], { env, stdio: "pipe", cwd: base });

  nextServer.stdout?.on("data", (d: Buffer) => process.stdout.write(d));
  nextServer.stderr?.on("data", (d: Buffer) => process.stderr.write(d));

  nextServer.on("exit", (code) => {
    console.log(`[electron] Next.js server exited with code ${code}`);
  });
}

// ─── Create window ────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: "#0f1117",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  const url = DEV ? "http://localhost:3000" : `http://localhost:${PORT}`;
  mainWindow.loadURL(url);

  // The title bar is hidden (hiddenInset): make the top bar and the sidebar
  // header draggable so the window can be moved, while keeping interactive
  // elements clickable.
  mainWindow.webContents.on("dom-ready", () => {
    mainWindow?.webContents.insertCSS(`
      .sticky.top-0 { -webkit-app-region: drag; }
      aside > div:first-child { -webkit-app-region: drag; }
      button, a, input, select, textarea, [role="button"] { -webkit-app-region: no-drag; }
    `);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => { mainWindow = null; });
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  try {
    await startNextServer();
    if (!DEV) await waitForServer(`http://localhost:${PORT}`);
    createWindow();
  } catch (err) {
    dialog.showErrorBox(
      "Erreur au démarrage",
      `Impossible de démarrer le serveur.\n\n${err}`
    );
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  nextServer?.kill();
});

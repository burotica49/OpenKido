import { app, BrowserWindow, shell, dialog, utilityProcess, session, ipcMain } from "electron";
import type { IpcMainInvokeEvent, UtilityProcess } from "electron";
import path from "path";
import fs from "fs";
import http from "http";
import net from "net";
import { pathToFileURL } from "url";

const DEV = !app.isPackaged;
const PREFERRED_PORT = 3000;

// ─── Single instance lock ─────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
let nextServer: UtilityProcess | null = null;
let appOrigin = `http://localhost:${PREFERRED_PORT}`;

function isGithubCookieDomain(domain: string | undefined): boolean {
  if (!domain) return false;
  const host = domain.replace(/^\./, "").toLowerCase();
  return host === "github.com" || host.endsWith(".github.com");
}

async function clearGithubSessionCookies(): Promise<void> {
  const ses = session.defaultSession;
  const cookies = await ses.cookies.get({});
  for (const cookie of cookies) {
    if (!cookie.name || !cookie.domain || !isGithubCookieDomain(cookie.domain)) continue;
    const domain = cookie.domain.replace(/^\./, "");
    const url = `${cookie.secure ? "https" : "http"}://${domain}${cookie.path || "/"}`;
    try {
      await ses.cookies.remove(url, cookie.name);
    } catch (err) {
      console.warn("[electron] cookie GitHub non supprimé:", cookie.name, err);
    }
  }
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  try {
    return new URL(event.senderFrame?.url ?? "").origin === appOrigin;
  } catch {
    return false;
  }
}

ipcMain.handle("clear-github-session", (event) => {
  if (!isTrustedSender(event)) throw new Error("Appelant non autorisé");
  return clearGithubSessionCookies();
});

ipcMain.handle("export-pdf", async (event) => {
  if (!isTrustedSender(event)) throw new Error("Appelant non autorisé");
  // Réservé à la page de rapport.
  let pathname = "";
  try {
    pathname = new URL(event.senderFrame?.url ?? "").pathname;
  } catch {
    /* URL invalide */
  }
  if (pathname !== "/report") throw new Error("Export disponible uniquement depuis la page Rapport");

  const win = BrowserWindow.fromWebContents(event.sender);
  const stamp = new Date().toISOString().slice(0, 10);
  const options = { defaultPath: path.join(app.getPath("documents"), `openkido-rapport-${stamp}.pdf`), filters: [{ name: "PDF", extensions: ["pdf"] }] };
  const { canceled, filePath } = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
  if (canceled || !filePath) return { saved: false };

  const pdf = await event.sender.printToPDF({ printBackground: true, pageSize: "A4", margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 } });
  await fs.promises.writeFile(filePath, pdf);
  return { saved: true };
});

// ─── Navigation et liens externes ─────────────────────────────────────────────

/** La fenêtre ne peut afficher que l'application et le parcours de connexion GitHub. */
function isAllowedNavigation(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.origin === appOrigin) return true;
    return u.protocol === "https:" && u.hostname === "github.com";
  } catch {
    return false;
  }
}

/** Ouvre dans le navigateur système uniquement des liens https (jamais file:, smb:, schémas d'apps…). */
function openExternalSafe(url: string): void {
  try {
    if (new URL(url).protocol === "https:") void shell.openExternal(url);
  } catch {
    // URL invalide : ignorée
  }
}

// ─── DB path in userData ──────────────────────────────────────────────────────

function getUserDataDb(): string {
  const dir = app.getPath("userData");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "openkido.db");
}

function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  try {
    process.loadEnvFile(file);
  } catch (err) {
    console.warn(`[electron] Impossible de charger ${file}:`, err);
  }
}

function portAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function pickPort(): Promise<number> {
  if (await portAvailable(PREFERRED_PORT)) return PREFERRED_PORT;
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : PREFERRED_PORT;
      server.close(() => resolve(port));
    });
  });
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

  loadEnvFile(path.join(base, ".env"));
  loadEnvFile(path.join(base, ".env.local"));

  if (!process.env.AUTH_SECRET && !process.env.NEXTAUTH_SECRET) {
    throw new Error(
      "AUTH_SECRET manquant. Vérifiez que .env.local est bien inclus dans le build desktop."
    );
  }

  if (!fs.existsSync(dbPath)) {
    const template = path.join(base, "prisma", "template.db");
    if (fs.existsSync(template)) fs.cpSync(template, dbPath);
  }

  const port = await pickPort();
  appOrigin = `http://localhost:${port}`;

  const env = {
    ...process.env,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    NODE_ENV: "production",
    DATABASE_URL: pathToFileURL(dbPath).href,
    AUTH_URL: appOrigin,
    NEXTAUTH_URL: appOrigin,
    AUTH_TRUST_HOST: "true",
    OPENKIDO_DESKTOP: "1",
  };

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
      sandbox: true,
      webSecurity: true,
    },
    show: false,
  });

  mainWindow.loadURL(appOrigin);

  mainWindow.webContents.on("dom-ready", () => {
    mainWindow?.webContents.insertCSS(`
      .sticky.top-0 { -webkit-app-region: drag; }
      aside > div:first-child { -webkit-app-region: drag; }
      button, a, input, select, textarea, [role="button"] { -webkit-app-region: no-drag; }
    `);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (isAllowedNavigation(url)) return;
    event.preventDefault();
    openExternalSafe(url);
  });
  mainWindow.webContents.on("will-redirect", (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault();
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

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-attach-webview", (event) => event.preventDefault());
});

app.whenReady().then(async () => {
  // Aucune permission (caméra, micro, géolocalisation, notifications…) n'est jamais nécessaire.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  try {
    await startNextServer();
    if (!DEV) await waitForServer(appOrigin);
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

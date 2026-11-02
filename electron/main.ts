import { app, BrowserWindow, shell, dialog, utilityProcess, session, ipcMain } from "electron";
import type { IpcMainInvokeEvent, UtilityProcess } from "electron";
import path from "path";
import fs from "fs";
import http from "http";
import net from "net";
import { randomUUID } from "crypto";
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

/**
 * Vrai si le port est libre sur TOUTES les interfaces. Tester seulement 127.0.0.1 ne suffit pas : sous macOS,
 * une autre application à l'écoute sur « * » ou sur [::] n'empêche pas de se lier à 127.0.0.1, et la page
 * « localhost » finirait par afficher cette autre application.
 */
function portAvailable(port: number): Promise<boolean> {
  const tryBind = (host: string) =>
    new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once("error", (err: NodeJS.ErrnoException) => resolve(err.code === "EAFNOSUPPORT" || err.code === "EADDRNOTAVAIL"));
      server.once("listening", () => server.close(() => resolve(true)));
      server.listen({ port, host, exclusive: true });
    });
  // [::1] aussi : « localhost » peut pointer vers IPv6, une autre application y serait servie à la place de la nôtre.
  return Promise.all([tryBind("0.0.0.0"), tryBind("::"), tryBind("127.0.0.1"), tryBind("::1")]).then((r) => r.every(Boolean));
}

async function pickPort(): Promise<number> {
  for (let port = PREFERRED_PORT; port < PREFERRED_PORT + 20; port++) {
    if (await portAvailable(port)) return port;
  }
  // Plage occupée : port libre quelconque attribué par le système.
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

// ─── Journal du serveur local ─────────────────────────────────────────────────

const LOG_TAIL_LINES = 40;
const serverLogTail: string[] = [];
let serverLogStream: fs.WriteStream | null = null;
let serverLogPath = "";
let serverExit: { code: number | null } | null = null;

function openServerLog() {
  try {
    const dir = app.getPath("logs");
    fs.mkdirSync(dir, { recursive: true });
    serverLogPath = path.join(dir, "server.log");
    serverLogStream = fs.createWriteStream(serverLogPath, { flags: "w", mode: 0o600 });
  } catch (err) {
    console.warn("[electron] journal du serveur indisponible :", err);
  }
}

function recordServerOutput(chunk: Buffer, to: NodeJS.WriteStream) {
  to.write(chunk);
  serverLogStream?.write(chunk);
  for (const line of chunk.toString("utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    serverLogTail.push(line.slice(0, 300));
    if (serverLogTail.length > LOG_TAIL_LINES) serverLogTail.shift();
  }
}

// ─── Wait for Next.js ─────────────────────────────────────────────────────────

/** Interroge /api/health jusqu'à obtenir la réponse de NOTRE serveur ; échoue tôt si le processus s'arrête. */
function waitForServer(port: number, instance: string, timeout = 90_000): Promise<void> {
  const start = Date.now();
  let lastProblem = "aucune réponse";
  return new Promise((resolve, reject) => {
    function fail(reason: string) {
      const tail = serverLogTail.slice(-12).join("\n");
      const hints: string[] = [];
      if (process.arch === "x64" && (app as { runningUnderARM64Translation?: boolean }).runningUnderARM64Translation) {
        hints.push("Cette version Intel (x64) tourne sous Rosetta sur un Mac Apple Silicon : installez la version arm64.");
      }
      reject(new Error(`${reason} (port ${port})${hints.length ? `\n\n${hints.join("\n")}` : ""}${tail ? `\n\nDernières lignes du serveur :\n${tail}` : ""}${serverLogPath ? `\n\nJournal complet : ${serverLogPath}` : ""}`));
    }
    function attempt() {
      if (serverExit) return fail(`Le serveur s'est arrêté (code ${serverExit.code})`);
      const req = http.get({ host: "127.0.0.1", port, path: "/api/health", timeout: 3000 }, (res) => {
        let body = "";
        res.on("data", (c: Buffer) => { if (body.length < 2000) body += c.toString("utf8"); });
        res.on("end", () => {
          try {
            const json = JSON.parse(body) as { ok?: boolean; instance?: string };
            if (res.statusCode === 200 && json.ok && json.instance === instance) return resolve();
            lastProblem = res.statusCode === 200 ? "le port répond mais ce n'est pas le serveur OpenKido (autre application ?)" : `santé du serveur : HTTP ${res.statusCode}`;
          } catch {
            lastProblem = `réponse inattendue (HTTP ${res.statusCode}) : le port est peut-être utilisé par une autre application`;
          }
          retry();
        });
      });
      req.on("timeout", () => req.destroy());
      req.on("error", () => { lastProblem = "le serveur ne répond pas"; retry(); });
    }
    function retry() {
      if (Date.now() - start > timeout) fail(`Le serveur n'a pas démarré à temps : ${lastProblem}`);
      else setTimeout(attempt, 400);
    }
    attempt();
  });
}

// ─── Start bundled Next.js server ─────────────────────────────────────────────

async function startNextServer(): Promise<{ port: number; instance: string } | null> {
  if (DEV) return null;

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
  const instance = randomUUID();
  appOrigin = `http://localhost:${port}`;
  openServerLog();
  if (port !== PREFERRED_PORT) console.log(`[electron] port ${PREFERRED_PORT} occupé, utilisation du port ${port}`);

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
    OPENKIDO_INSTANCE: instance,
  };

  nextServer = utilityProcess.fork(serverJs, [], { env, stdio: "pipe", cwd: base });

  nextServer.stdout?.on("data", (d: Buffer) => recordServerOutput(d, process.stdout));
  nextServer.stderr?.on("data", (d: Buffer) => recordServerOutput(d, process.stderr));

  nextServer.on("exit", (code) => {
    serverExit = { code };
    console.log(`[electron] Next.js server exited with code ${code}`);
  });
  return { port, instance };
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
    const started = await startNextServer();
    if (started) await waitForServer(started.port, started.instance);
    createWindow();
  } catch (err) {
    dialog.showErrorBox(
      "Erreur au démarrage",
      `Impossible de démarrer le serveur.\n\n${err instanceof Error ? err.message : err}`
    );
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Fermer la fenêtre quitte l'application (y compris sous macOS) : sinon l'icône reste dans le Dock
// et le serveur local continue de tourner pour rien.
app.on("window-all-closed", () => {
  app.quit();
});

function stopServer() {
  nextServer?.kill();
  nextServer = null;
}
app.on("before-quit", stopServer);
app.on("will-quit", stopServer);

// Génère les captures d'écran de la documentation à partir de données FICTIVES (mode démo).
//   npm run build && npm run demo:screenshots
// Étapes : base fictive → serveur en mode démo → Chrome headless piloté par le protocole DevTools → docs/screenshots/*.png.
// Aucun appel à GitHub, aucun jeton : la session est forgée avec un secret jetable propre à cette exécution.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { encode } from "@auth/core/jwt";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "docs", "screenshots");
const dbPath = path.join(root, "demo", "demo.db");
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WIDTH = 1440, HEIGHT = 900;

if (!fs.existsSync(path.join(root, ".next", "BUILD_ID"))) throw new Error("Lancez d'abord `npm run build`.");
if (!fs.existsSync(CHROME)) throw new Error(`Chrome introuvable (${CHROME}) : définissez CHROME_PATH.`);
fs.mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => { const c = spawn(cmd, args, { stdio: "inherit", ...opts }); c.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} a échoué (${code})`)))); });

// 1. Données fictives
await run(process.execPath, ["--no-warnings", "scripts/seed-demo.ts", dbPath], { cwd: root });

// 2. Serveur en mode démo
const port = await freePort();
const origin = `http://localhost:${port}`;
const secret = randomBytes(32).toString("base64");
const server = spawn(path.join(root, "node_modules", ".bin", "next"), ["start", "-p", String(port), "-H", "127.0.0.1"], {
  cwd: root,
  env: { ...process.env, OPENKIDO_DEMO: "1", DATABASE_URL: pathToFileURL(dbPath).href, AUTH_SECRET: secret, AUTH_URL: origin, AUTH_TRUST_HOST: "true", NODE_ENV: "production", GITHUB_CLIENT_ID: "demo", GITHUB_CLIENT_SECRET: "demo" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));
const chromeDir = fs.mkdtempSync(path.join(os.tmpdir(), "openkido-chrome-"));
let chrome;
let cleaned = false;
const cleanup = () => {
  if (cleaned) return;
  cleaned = true;
  server.kill();
  chrome?.kill();
  // Chrome peut encore écrire quelques instants : le nettoyage ne doit jamais faire échouer la génération.
  try { fs.rmSync(chromeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* dossier temporaire du système */ }
};
process.on("exit", cleanup);

try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${origin}/api/health`)).ok) break; } catch { /* démarrage */ }
    if (i === 59) throw new Error(`Le serveur de démonstration n'a pas démarré :\n${serverLog.slice(-1500)}`);
    await sleep(500);
  }

  // 3. Session forgée (jeton fictif : en mode démo, GitHub n'est jamais interrogé)
  const cookie = await encode({ token: { name: "Alex Martin", email: "alex@acme-corp.example", sub: "1", accessToken: "demo-token", githubLogin: "alex-martin" }, secret, salt: "authjs.session-token", maxAge: 3600 });

  // 4. Chrome headless
  const debugPort = await freePort();
  chrome = spawn(CHROME, [`--headless=new`, `--remote-debugging-port=${debugPort}`, `--user-data-dir=${chromeDir}`, "--hide-scrollbars", "--no-first-run", "--disable-gpu", `--window-size=${WIDTH},${HEIGHT}`, "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    try { target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* démarrage */ }
    if (!target) await sleep(250);
  }
  if (!target) throw new Error("Chrome n'a pas démarré");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  let loaded = null;
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(msg.error.message)) : res(msg.result); }
    else if (msg.method === "Page.loadEventFired" && loaded) loaded();
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Page.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });

  const goto = async (url) => { const done = new Promise((r) => (loaded = r)); await send("Page.navigate", { url: origin + url }); await Promise.race([done, sleep(20000)]); await sleep(1800); };
  const evaluate = (expression) => send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  // Clique sur le premier élément (ligne de liste, de tableau ou bouton) dont le texte contient tous les fragments.
  const click = async (selector, ...texts) => {
    const r = await evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => ${JSON.stringify(texts)}.every((t) => e.textContent.includes(t))); if (!el) return false; el.click(); return true; })()`);
    if (!r.result.value) throw new Error(`Élément introuvable : ${selector} ${texts.join(" + ")}`);
    await sleep(900);
  };
  const shot = async (name) => {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(data, "base64"));
    console.log(`  ✓ ${name}.png`);
  };

  // Connexion (sans session)
  await goto("/");
  await shot("login");

  // Session fictive
  await send("Network.setCookie", { name: "authjs.session-token", value: cookie, url: origin });

  // Premier passage sur le Feed : enregistre le suivi, puis on y injecte « nouvelles » et « résolues » plausibles.
  await goto("/issues");
  await sleep(2500);
  const db = createClient({ url: pathToFileURL(dbPath).href });
  const L = "alex-martin";
  for (const like of ["dep|acme-corp/auth-service|npm:jsonwebtoken%", "dep|acme-corp/billing-service|pip:django@%", "dep|acme-corp/legacy-intranet|composer:phpmailer%", "secret|acme-corp/legacy-intranet|aws-access-key%", "dep|acme-corp/api-gateway|go:%jwt-go%"]) {
    await db.execute({ sql: "UPDATE IssueHistory SET baseline = 0, firstSeen = ? WHERE githubLogin = ? AND key LIKE ?", args: [new Date(Date.now() - 86_400_000 * 1.5).toISOString(), L, like] });
  }
  const resolved = [
    ["dep|acme-corp/web-store|npm:express@4.17.1", "dependency", "high", "express 4.17.1", "acme-corp/web-store", 1],
    ["dep|acme-corp/auth-service|npm:bcrypt@5.0.1", "dependency", "medium", "bcrypt 5.0.1", "acme-corp/auth-service", 2],
    ["posture|acme-corp/docs-site|BP-02", "posture", "high", "Relecture obligatoire avant fusion", "acme-corp/docs-site", 3],
    ["domain|shop.acme-corp.example|ssl-expiry", "domain", "medium", "Certificat SSL expire dans 12 jour(s)", "shop.acme-corp.example", 4],
  ];
  for (const [key, kind, severity, title, target, d] of resolved) {
    await db.execute({ sql: "INSERT OR REPLACE INTO IssueHistory (githubLogin, key, kind, severity, target, title, firstSeen, resolvedAt, baseline) VALUES (?,?,?,?,?,?,?,?,1)", args: [L, key, kind, severity, target, title, new Date(Date.now() - 86_400_000 * 20).toISOString(), new Date(Date.now() - 86_400_000 * d).toISOString()] });
  }
  await db.close();

  console.log("Captures :");
  await goto("/issues"); await shot("issues");
  await click("li", "jsonwebtoken"); await shot("issue-detail");
  await goto("/issues"); await click("li", "lodash", "dépôts"); await shot("issue-group");

  await goto("/repos"); await shot("repos");
  await goto("/repos/acme-corp/web-store"); await shot("repo-overview");
  await goto("/repos/acme-corp/web-store/issues"); await shot("repo-issues");
  await goto("/repos/acme-corp/web-store/inventory"); await click("tr", "lodash"); await shot("repo-inventory-detail");

  await goto("/code-audit"); await shot("code-audit");
  await goto("/code-audit/acme-corp/legacy-intranet"); await click("li", "Clé d'accès AWS"); await shot("code-audit-detail");
  await goto("/posture"); await shot("posture");
  await goto("/posture/acme-corp/api-gateway"); await click("li", "BP-02"); await shot("posture-detail");
  await goto("/code-quality"); await shot("code-quality");
  await goto("/compliance"); await shot("compliance");
  await goto("/domains"); await shot("domains");
  await click("tr", "intranet.acme-corp.example"); await shot("domains-detail");
  await goto("/report"); await shot("report");
  await goto("/settings"); await shot("settings");
  ws.close();
  await sleep(300);
} finally {
  cleanup();
}

// Remplit une base SQLite avec des données FICTIVES pour le mode démo (OPENKIDO_DEMO=1) et les captures d'écran.
// Usage : node scripts/seed-demo.ts [chemin/de/la/base.db]
// Exécuté directement par Node (suppression des types) : pas de dépendance à Next ni à Prisma.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { applyMigrations } from "../src/lib/migrate.ts";
import { scoreResults } from "../src/lib/controls/types.ts";

const dbPath = path.resolve(process.argv[2] ?? "demo/demo.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
fs.rmSync(dbPath, { force: true });
const url = pathToFileURL(dbPath).href;

await applyMigrations({ databaseUrl: url, migrationsDir: path.resolve("prisma/migrations") });
const db = createClient({ url });

const DAY = 86_400_000;
const now = Date.now();
const ago = (days: number) => new Date(now - days * DAY).toISOString();
const inDays = (days: number) => new Date(now + days * DAY).toISOString();

// Générateur pseudo-aléatoire déterministe : mêmes données à chaque exécution.
let seed = 20261101;
const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join("");

type Sev = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
interface Vuln { id: string; summary: string; severity: Sev; cvssScore: number; fixedVersion: string | null }
interface Dep { name: string; version: string; eco?: string; scope?: "prod" | "dev"; direct?: boolean; license?: string; vulns?: Vuln[]; source?: string }

// Failles réelles et publiques, associées à des paquets et versions réellement concernés.
const V = {
  lodashProto: { id: "CVE-2020-8203", summary: "Prototype pollution dans lodash (zipObjectDeep)", severity: "HIGH", cvssScore: 7.4, fixedVersion: "4.17.19" },
  lodashCmd: { id: "CVE-2021-23337", summary: "Injection de commande via lodash.template", severity: "HIGH", cvssScore: 7.2, fixedVersion: "4.17.21" },
  axios: { id: "CVE-2021-3749", summary: "Déni de service par expression régulière (ReDoS) dans axios", severity: "HIGH", cvssScore: 7.5, fixedVersion: "0.21.2" },
  minimist: { id: "CVE-2021-44906", summary: "Prototype pollution dans minimist", severity: "CRITICAL", cvssScore: 9.8, fixedVersion: "1.2.6" },
  jwt: { id: "CVE-2022-23529", summary: "Exécution de code via une clé secrète malveillante dans jsonwebtoken", severity: "HIGH", cvssScore: 7.6, fixedVersion: "9.0.0" },
  nodeFetch: { id: "CVE-2022-0235", summary: "Exposition d'en-têtes sensibles lors d'une redirection (node-fetch)", severity: "HIGH", cvssScore: 8.8, fixedVersion: "2.6.7" },
  moment: { id: "CVE-2022-24785", summary: "Traversée de répertoire dans moment (locale)", severity: "HIGH", cvssScore: 7.5, fixedVersion: "2.29.2" },
  django: { id: "CVE-2021-31542", summary: "Traversée de répertoire lors du téléversement de fichiers (Django)", severity: "HIGH", cvssScore: 7.3, fixedVersion: "3.2.1" },
  requests: { id: "CVE-2023-32681", summary: "Fuite de l'en-tête Proxy-Authorization vers un serveur de destination (requests)", severity: "MEDIUM", cvssScore: 6.1, fixedVersion: "2.31.0" },
  pyyaml: { id: "CVE-2020-14343", summary: "Exécution de code arbitraire lors du chargement YAML (PyYAML)", severity: "CRITICAL", cvssScore: 9.8, fixedVersion: "5.4" },
  jinja: { id: "CVE-2020-28493", summary: "Déni de service par expression régulière dans Jinja2", severity: "MEDIUM", cvssScore: 5.3, fixedVersion: "2.11.3" },
  jwtGo: { id: "CVE-2020-26160", summary: "Contournement de la vérification de l'audience dans jwt-go", severity: "HIGH", cvssScore: 7.5, fixedVersion: null },
  phpmailer: { id: "CVE-2016-10033", summary: "Exécution de commande à distance via l'en-tête From (PHPMailer)", severity: "CRITICAL", cvssScore: 9.8, fixedVersion: "5.2.18" },
  ejs: { id: "CVE-2022-29078", summary: "Injection de template côté serveur dans ejs", severity: "CRITICAL", cvssScore: 9.8, fixedVersion: "3.1.7" },
  semver: { id: "CVE-2022-25883", summary: "ReDoS dans semver", severity: "LOW", cvssScore: 3.7, fixedVersion: "7.5.2" },
} satisfies Record<string, Vuln>;

const npmHealthy = (names: [string, string][], dev = false): Dep[] => names.map(([name, version]) => ({ name, version, scope: dev ? "dev" : "prod", direct: true, license: "MIT" }));

interface RepoSeed { owner: string; repo: string; isPrivate: boolean; scan: null | { deps: Dep[]; partial?: string }; }

const REPOS: RepoSeed[] = [
  { owner: "acme-corp", repo: "web-store", isPrivate: true, scan: { deps: [
    ...npmHealthy([["next", "15.0.3"], ["react", "19.0.0"], ["react-dom", "19.0.0"], ["zod", "3.23.8"], ["stripe", "16.2.0"], ["swr", "2.2.5"], ["tailwindcss", "4.0.0"]]),
    { name: "lodash", version: "4.17.15", direct: true, license: "MIT", vulns: [V.lodashProto, V.lodashCmd] },
    { name: "axios", version: "0.21.1", direct: true, license: "MIT", vulns: [V.axios] },
    { name: "moment", version: "2.29.1", direct: true, license: "MIT", vulns: [V.moment] },
    { name: "minimist", version: "1.2.5", direct: false, license: "MIT", vulns: [V.minimist] },
    { name: "acme-gpl-parser", version: "2.4.0", direct: true, license: "GPL-3.0" },
    { name: "left-padder", version: "1.0.2", direct: false, license: "NONE" },
    { name: "ejs", version: "2.7.4", scope: "dev", direct: false, license: "Apache-2.0", vulns: [V.ejs] },
    ...npmHealthy([["jest", "29.7.0"], ["typescript", "5.6.3"], ["eslint", "9.14.0"]], true),
  ] } },
  { owner: "acme-corp", repo: "api-gateway", isPrivate: true, scan: { deps: [
    { name: "github.com/gin-gonic/gin", version: "1.10.0", eco: "go", direct: true, license: "MIT" },
    { name: "github.com/rs/zerolog", version: "1.33.0", eco: "go", direct: true, license: "MIT" },
    { name: "go.uber.org/zap", version: "1.27.0", eco: "go", direct: true, license: "MIT" },
    { name: "github.com/dgrijalva/jwt-go", version: "3.2.0", eco: "go", direct: true, license: "MIT", vulns: [V.jwtGo] },
  ] } },
  { owner: "acme-corp", repo: "billing-service", isPrivate: true, scan: { deps: [
    { name: "django", version: "3.2.0", eco: "pip", direct: true, license: "BSD-3-Clause", vulns: [V.django] },
    { name: "requests", version: "2.25.0", eco: "pip", direct: true, license: "Apache-2.0", vulns: [V.requests] },
    { name: "pyyaml", version: "5.3", eco: "pip", direct: true, license: "MIT", vulns: [V.pyyaml] },
    { name: "jinja2", version: "2.11.2", eco: "pip", direct: false, license: "BSD-3-Clause", vulns: [V.jinja] },
    { name: "stripe", version: "10.1.0", eco: "pip", direct: true, license: "MIT" },
    { name: "psycopg2-binary", version: "2.9.9", eco: "pip", direct: true, license: "LGPL-3.0" },
    { name: "celery", version: "5.4.0", eco: "pip", direct: true, license: "BSD-3-Clause" },
  ] } },
  { owner: "acme-corp", repo: "mobile-app", isPrivate: true, scan: { partial: "Registre OSV injoignable pour 14 composants : analyse partielle.", deps: [
    ...npmHealthy([["react-native", "0.76.1"], ["expo", "52.0.0"], ["react", "18.3.1"], ["zustand", "5.0.0"]]),
    { name: "node-fetch", version: "2.6.0", direct: true, license: "MIT", vulns: [V.nodeFetch] },
    { name: "minimist", version: "1.2.5", direct: false, license: "MIT", vulns: [V.minimist] },
    { name: "semver", version: "7.3.5", direct: false, license: "ISC", vulns: [V.semver] },
  ] } },
  { owner: "acme-corp", repo: "auth-service", isPrivate: true, scan: { deps: [
    ...npmHealthy([["express", "4.21.1"], ["bcrypt", "5.1.1"], ["zod", "3.23.8"], ["pino", "9.5.0"], ["helmet", "8.0.0"]]),
    { name: "jsonwebtoken", version: "8.5.1", direct: true, license: "MIT", vulns: [V.jwt] },
  ] } },
  { owner: "acme-corp", repo: "data-pipeline", isPrivate: true, scan: { deps: [
    { name: "pandas", version: "2.2.3", eco: "pip", direct: true, license: "BSD-3-Clause" },
    { name: "numpy", version: "2.1.2", eco: "pip", direct: true, license: "BSD-3-Clause" },
    { name: "requests", version: "2.25.0", eco: "pip", direct: true, license: "Apache-2.0", vulns: [V.requests] },
    { name: "pyyaml", version: "5.3", eco: "pip", direct: true, license: "MIT", vulns: [V.pyyaml] },
    { name: "apache-airflow", version: "2.10.2", eco: "pip", direct: true, license: "Apache-2.0" },
  ] } },
  { owner: "acme-corp", repo: "admin-dashboard", isPrivate: true, scan: { deps: [
    ...npmHealthy([["react", "18.2.0"], ["react-router-dom", "6.26.0"], ["recharts", "2.12.7"], ["@mui/material", "6.1.0"]]),
    { name: "lodash", version: "4.17.15", direct: true, license: "MIT", vulns: [V.lodashProto, V.lodashCmd] },
    { name: "axios", version: "0.21.1", direct: true, license: "MIT", vulns: [V.axios] },
    { name: "moment", version: "2.29.1", direct: true, license: "MIT", vulns: [V.moment] },
    { name: "minimist", version: "1.2.5", direct: false, license: "MIT", vulns: [V.minimist] },
    { name: "acme-gpl-parser", version: "2.4.0", direct: true, license: "AGPL-3.0" },
  ] } },
  { owner: "acme-corp", repo: "legacy-intranet", isPrivate: true, scan: { deps: [
    { name: "phpmailer/phpmailer", version: "5.2.16", eco: "composer", direct: true, license: "LGPL-2.1", vulns: [V.phpmailer] },
    { name: "monolog/monolog", version: "1.25.0", eco: "composer", direct: true, license: "MIT" },
    { name: "symfony/http-foundation", version: "3.4.0", eco: "composer", direct: true, license: "MIT" },
  ] } },
  { owner: "acme-corp", repo: "infra-terraform", isPrivate: true, scan: { deps: [] } },
  { owner: "acme-corp", repo: "docs-site", isPrivate: false, scan: { deps: npmHealthy([["next", "15.0.3"], ["react", "19.0.0"], ["mdx-bundler", "10.0.3"], ["rehype-slug", "6.0.0"]]) } },
  { owner: "alex-martin", repo: "portfolio", isPrivate: false, scan: { deps: [
    ...npmHealthy([["astro", "4.16.0"], ["tailwindcss", "3.4.14"], ["sharp", "0.33.5"]]),
    { name: "semver", version: "7.3.5", direct: false, license: "ISC", vulns: [V.semver] },
  ] } },
  { owner: "alex-martin", repo: "dotfiles", isPrivate: false, scan: null },
];

const SEV_ORDER: Sev[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

async function insert(table: string, row: Record<string, unknown>) {
  const cols = Object.keys(row);
  await db.execute({ sql: `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`, args: cols.map((c) => (typeof row[c] === "boolean" ? Number(row[c]) : (row[c] as never))) });
}

// ─── Scans de dépendances ─────────────────────────────────────────────────────
for (const r of REPOS) {
  if (!r.scan) continue;
  const lock = r.owner === "acme-corp" && r.repo === "legacy-intranet" ? "composer.lock" : r.repo === "api-gateway" ? "go.mod" : ["billing-service", "data-pipeline"].includes(r.repo) ? "requirements.txt" : "package-lock.json";
  const comps = r.scan.deps.map((d) => {
    const vulns = d.vulns ?? [];
    const top = SEV_ORDER.find((s) => vulns.some((v) => v.severity === s)) ?? "UNKNOWN";
    return {
      name: d.name, version: d.version, ecosystem: d.eco ?? "npm", source: d.source ?? lock, scope: d.scope ?? "prod", direct: d.direct ?? true,
      license: d.license, resolved: true, status: vulns.length ? "vulnerable" : "sain", topSeverity: top, vulnCount: vulns.length,
      ...(vulns.length ? { vulns } : {}),
    };
  });
  const count = (s: Sev) => comps.reduce((n, c) => n + (c.vulns ?? []).filter((v) => v.severity === s).length, 0);
  const vulnerable = comps.filter((c) => c.status === "vulnerable").length;
  await insert("RepoScan", {
    owner: r.owner, repo: r.repo, branch: "main", scannedAt: ago(0.1), total: comps.length, vulnerable,
    critical: count("CRITICAL"), high: count("HIGH"), medium: count("MEDIUM"), low: count("LOW"),
    components: JSON.stringify(comps), status: r.scan.partial ? "partial" : "complete", note: r.scan.partial ?? null,
  });
  // Historique (30 jours) : la situation se dégrade puis se stabilise.
  const final = { critical: count("CRITICAL"), high: count("HIGH"), medium: count("MEDIUM"), low: count("LOW") };
  for (let i = 0; i < 9; i++) {
    const f = Math.min(1, 0.45 + i * 0.07 + rand() * 0.05);
    const k = (n: number) => Math.max(0, Math.round(n * f));
    await insert("ScanHistory", { owner: r.owner, repo: r.repo, scannedAt: ago(30 - i * 3.4), total: comps.length, vulnerable, critical: k(final.critical), high: k(final.high), medium: k(final.medium), low: k(final.low) });
  }
}

// ─── Qualité du code ──────────────────────────────────────────────────────────
const QUALITY: Record<string, string[]> = {
  "web-store": ["ci", "tests", "lint", "format", "types", "readme", "editorconfig"],
  "api-gateway": ["ci", "tests", "lint", "readme", "changelog"],
  "billing-service": ["ci", "tests", "lint", "format", "readme"],
  "mobile-app": ["ci", "lint", "format", "types", "readme"],
  "auth-service": ["ci", "tests", "lint", "format", "types", "readme", "changelog"],
  "data-pipeline": ["tests", "readme"],
  "admin-dashboard": ["ci", "lint", "readme"],
  "legacy-intranet": ["readme"],
  "infra-terraform": ["ci", "readme"],
  "docs-site": ["ci", "lint", "format", "types", "readme", "changelog", "editorconfig"],
  "portfolio": ["ci", "lint", "format", "types", "readme"],
  "dotfiles": ["readme"],
};
const WEIGHT: Record<string, number> = { ci: 25, tests: 25, lint: 15, format: 10, types: 10, readme: 10, changelog: 3, editorconfig: 2 };
for (const r of REPOS) {
  const has = new Set(QUALITY[r.repo] ?? []);
  const score = [...has].reduce((n, k) => n + (WEIGHT[k] ?? 0), 0);
  await insert("RepoQuality", {
    owner: r.owner, repo: r.repo, checkedAt: ago(0.2 + rand()), score,
    hasCi: has.has("ci"), hasTests: has.has("tests"), hasLint: has.has("lint"), hasFormat: has.has("format"), hasTypes: has.has("types"),
    hasReadme: has.has("readme"), hasChangelog: has.has("changelog"), hasEditorconfig: has.has("editorconfig"),
    ciFiles: JSON.stringify(has.has("ci") ? [".github/workflows/ci.yml"] : []), testFiles: JSON.stringify(has.has("tests") ? ["tests/", "src/__tests__/"] : []),
    lintFiles: JSON.stringify(has.has("lint") ? ["eslint.config.mjs"] : []), defaultBranch: "main",
  });
}

// ─── Posture (26 contrôles) ───────────────────────────────────────────────────
type Fam = "branches" | "security" | "ci" | "secrets" | "governance" | "access";
const CONTROLS: [string, Fam, "critical" | "high" | "medium" | "low", string][] = [
  ["BP-01", "branches", "high", "Branche par défaut protégée"], ["BP-02", "branches", "high", "Relecture obligatoire avant fusion"],
  ["BP-03", "branches", "medium", "Force-push et suppression de branche interdits"], ["BP-04", "branches", "medium", "Contrôles de statut (CI) requis avant fusion"],
  ["BP-05", "branches", "low", "Règles appliquées aussi aux administrateurs"], ["REV-01", "branches", "medium", "Relectures effectives des PR fusionnées"],
  ["SIG-01", "branches", "low", "Commits signés (Verified)"], ["SF-01", "security", "high", "Alertes Dependabot activées"],
  ["SF-02", "security", "high", "Secret Scanning actif"], ["SF-03", "security", "medium", "Push protection (blocage des secrets au push)"],
  ["SF-04", "security", "medium", "Analyse de code statique (CodeQL) active"], ["SF-05", "security", "low", "Signalement privé des vulnérabilités activé"],
  ["SF-06", "security", "medium", "Mises à jour automatiques des dépendances"], ["CI-01", "ci", "medium", "Actions tierces épinglées par SHA"],
  ["CI-02", "ci", "high", "Permissions minimales du GITHUB_TOKEN"], ["CI-03", "ci", "critical", "Pas de pull_request_target exécutant du code de PR"],
  ["CI-04", "ci", "high", "Pas d'injection de script dans les workflows"], ["CI-05", "ci", "medium", "Runners auto-hébergés maîtrisés"],
  ["SEC-01", "secrets", "high", "Aucun fichier sensible versionné"], ["SEC-02", "secrets", "low", "Aucun binaire ni dépendance versionnés"],
  ["GOV-01", "governance", "medium", "Politique de sécurité (SECURITY.md)"], ["GOV-02", "governance", "low", "Propriétaires du code (CODEOWNERS)"],
  ["GOV-03", "governance", "low", "Licence déclarée"], ["GOV-04", "governance", "medium", "Lockfiles présents (versions reproductibles)"],
  ["ACC-01", "access", "medium", "Clés de déploiement en lecture seule"], ["ACC-02", "access", "medium", "Webhooks sécurisés (HTTPS + secret)"],
  ["ACC-03", "access", "medium", "Pas de collaborateur externe administrateur"],
];
const FAIL_TEXT: Record<string, [string, string]> = {
  "BP-01": ["Aucune protection de branche ni ruleset sur main : push direct, force-push et suppression possibles.", "Activer une règle de protection sur main : https://github.com/{r}/settings/branches."],
  "BP-02": ["Aucune relecture obligatoire avant fusion.", "Exiger au moins 1 approbation : https://github.com/{r}/settings/branches."],
  "BP-05": ["Les administrateurs peuvent contourner la protection.", "Activer « Do not allow bypassing the above settings » : https://github.com/{r}/settings/branches."],
  "SIG-01": ["0/30 commits récents sont signés.", "Activer la signature des commits (GPG ou SSH) et exiger « Require signed commits »."],
  "SF-01": ["Les alertes Dependabot sont désactivées.", "Activer Dependabot alerts : https://github.com/{r}/settings/security_analysis."],
  "SF-02": ["Secret Scanning n'est pas activé.", "Activer Secret Scanning : https://github.com/{r}/settings/security_analysis."],
  "SF-03": ["La push protection est désactivée : un secret peut être poussé.", "Activer la push protection : https://github.com/{r}/settings/security_analysis."],
  "SF-04": ["Aucune analyse CodeQL détectée.", "Activer le « code scanning » (CodeQL) : https://github.com/{r}/settings/security_analysis."],
  "SF-06": ["Aucun fichier dependabot.yml ni renovate.json.", "Ajouter .github/dependabot.yml pour mettre à jour automatiquement les dépendances."],
  "CI-01": ["3 action(s) tierce(s) référencée(s) par tag mobile au lieu d'un SHA.", "Épingler chaque action sur son SHA de commit complet."],
  "CI-02": ["Aucun bloc « permissions » dans 2 workflow(s) : le GITHUB_TOKEN a les droits par défaut.", "Ajouter « permissions: contents: read » au niveau du workflow."],
  "SEC-01": ["Fichier sensible versionné : config/.env.production", "Retirer le fichier du dépôt, purger l'historique et révoquer les secrets qu'il contient."],
  "GOV-01": ["Aucun fichier SECURITY.md.", "Ajouter un SECURITY.md indiquant comment signaler une vulnérabilité."],
  "GOV-02": ["Aucun fichier CODEOWNERS.", "Ajouter .github/CODEOWNERS pour désigner les relecteurs des zones sensibles."],
  "GOV-04": ["Aucun lockfile trouvé : les versions installées ne sont pas reproductibles.", "Versionner le lockfile (package-lock.json, poetry.lock…)."],
};
const POSTURE: Record<string, { fail?: string[]; warn?: string[]; unknown?: string[]; na?: string[] }> = {
  "web-store": { fail: ["BP-05", "SIG-01", "SF-03", "CI-01"], warn: ["REV-01"] },
  "api-gateway": { fail: ["BP-02", "SF-04", "CI-01", "CI-02", "GOV-02"], unknown: ["ACC-03"] },
  "billing-service": { fail: ["SF-03", "SIG-01", "GOV-01", "CI-02"], warn: ["REV-01"] },
  "mobile-app": { fail: ["BP-05", "SF-04", "SF-06", "GOV-01"] },
  "auth-service": { fail: ["SIG-01", "SF-06"] },
  "data-pipeline": { fail: ["BP-02", "SF-01", "SF-02", "SF-04", "CI-01", "GOV-01", "GOV-04"], unknown: ["ACC-01"] },
  "admin-dashboard": { fail: ["BP-02", "SF-04", "SF-06", "CI-02", "GOV-01", "GOV-02"] },
  "legacy-intranet": { fail: ["BP-01", "SF-01", "SF-02", "SEC-01", "GOV-01", "GOV-04", "CI-02"], na: ["BP-02", "BP-03", "BP-04", "BP-05"], unknown: ["ACC-01", "ACC-02"] },
  "infra-terraform": { fail: ["SF-04", "SIG-01"], na: ["GOV-04"] },
  "docs-site": { fail: ["SIG-01"] },
  "portfolio": { fail: ["BP-02", "SIG-01", "GOV-02"], warn: ["REV-01"] },
};
for (const r of REPOS) {
  const p = POSTURE[r.repo];
  if (!p) continue; // dotfiles : pas encore audité
  const full = `${r.owner}/${r.repo}`;
  const results = CONTROLS.map(([id, family, severity, title]) => {
    const state = p.na?.includes(id) ? "na" : p.fail?.includes(id) ? "fail" : p.warn?.includes(id) ? "warning" : p.unknown?.includes(id) ? "unknown" : "pass";
    const [failEvidence, remediation] = FAIL_TEXT[id] ?? ["Point non conforme.", "Voir les réglages du dépôt."];
    const evidence =
      state === "pass" ? "Conforme (donnée de démonstration)."
      : state === "fail" ? failEvidence
      : state === "warning" ? "Seules 6/10 PR fusionnées récentes ont reçu une approbation d'un autre utilisateur."
      : state === "unknown" ? "Droits administrateur requis : lecture impossible."
      : "Dépend de BP-01 : aucune protection de branche à évaluer.";
    return { id, family, severity, title, state, evidence, ...(state === "fail" || state === "warning" ? { remediation: remediation.replaceAll("{r}", full) } : {}) };
  });
  const s = scoreResults(results as never);
  await insert("RepoPosture", {
    owner: r.owner, repo: r.repo, checkedAt: ago(0.3 + rand()), score: s.score, total: s.total, evaluated: s.evaluated, passed: s.passed, failed: s.failed,
    warning: s.warning, unknown: s.unknown, failCritical: s.failedBySeverity.critical, failHigh: s.failedBySeverity.high, failMedium: s.failedBySeverity.medium,
    failLow: s.failedBySeverity.low, isPrivate: r.isPrivate, defaultBranch: "main", results: JSON.stringify(results),
  });
}

// ─── Code Audit (alertes GitHub) ──────────────────────────────────────────────
interface Alert { id: string; source: "code_scanning" | "dependabot" | "secret_scanning"; severity: string; title: string; description: string; state: "open"; url: string; path?: string; createdAt: string }
const alert = (repo: string, a: Omit<Alert, "state" | "url" | "createdAt"> & { days: number }): Alert => ({
  id: a.id, source: a.source, severity: a.severity, title: a.title, description: a.description, path: a.path, state: "open", createdAt: ago(a.days),
  url: `https://github.com/${repo}/security`,
});
const AUDIT: Record<string, { cs: string; db: string; ss: string; alerts: Alert[] }> = {
  "acme-corp/docs-site": { cs: "ok", db: "ok", ss: "ok", alerts: [alert("acme-corp/docs-site", { id: "cs-3", source: "code_scanning", severity: "medium", title: "Client-side cross-site scripting", description: "Le contenu de `location.hash` est inséré dans le DOM sans échappement.", path: "src/components/Search.tsx", days: 12 })] },
  "alex-martin/portfolio": { cs: "ok", db: "ok", ss: "ok", alerts: [] },
  "acme-corp/web-store": { cs: "disabled", db: "ok", ss: "disabled", alerts: [alert("acme-corp/web-store", { id: "db-41", source: "dependabot", severity: "high", title: "Prototype Pollution in lodash", description: "Versions de lodash antérieures à 4.17.19 : pollution de prototype via zipObjectDeep.", path: "package-lock.json", days: 31 })] },
  "acme-corp/billing-service": { cs: "disabled", db: "ok", ss: "disabled", alerts: [alert("acme-corp/billing-service", { id: "db-12", source: "dependabot", severity: "critical", title: "Arbitrary code execution in PyYAML", description: "PyYAML avant 5.4 permet l'exécution de code via yaml.load sans loader sûr.", path: "requirements.txt", days: 44 })] },
};
for (const r of REPOS) {
  const full = `${r.owner}/${r.repo}`;
  const a = AUDIT[full] ?? { cs: "disabled", db: "disabled", ss: "disabled", alerts: [] };
  if (r.repo === "dotfiles") continue;
  const of = (src: string) => a.alerts.filter((x) => x.source === src);
  const sev = (list: Alert[], s: string) => list.filter((x) => x.severity === s).length;
  const cs = of("code_scanning"), dp = of("dependabot");
  await insert("RepoAudit", {
    owner: r.owner, repo: r.repo, checkedAt: ago(0.2),
    csTotal: cs.length, csCritical: sev(cs, "critical"), csHigh: sev(cs, "high"), csMedium: sev(cs, "medium"), csLow: sev(cs, "low"),
    dbTotal: dp.length, dbCritical: sev(dp, "critical"), dbHigh: sev(dp, "high"), dbMedium: sev(dp, "medium"), dbLow: sev(dp, "low"),
    ssTotal: 0, ssActive: 0, alerts: JSON.stringify(a.alerts), csState: a.cs, dbState: a.db, ssState: a.ss,
  });
}

// ─── Secrets dans le code (analyse OpenKido) ──────────────────────────────────
const finding = (ruleId: string, name: string, severity: string, p: string, line: number, preview: string) => ({ ruleId, name, severity, path: p, line, preview, fingerprint: hex(12) });
const SECRETS: Record<string, { files: number; findings: ReturnType<typeof finding>[] }> = {
  "legacy-intranet": { files: 412, findings: [
    finding("aws-access-key", "Clé d'accès AWS", "critical", "config/aws.php", 14, "AKIA••••••••"),
    finding("db-connection", "Identifiants dans une URL de base de données", "high", "config/database.php", 8, "mysql://intranet:••••@db.internal:3306/intranet"),
    finding("generic-secret", "Secret potentiel (mot de passe, clé ou jeton en clair)", "medium", "includes/mail.php", 22, "k7Gx••••••••"),
  ] },
  "billing-service": { files: 288, findings: [finding("stripe-live-key", "Clé Stripe (production)", "high", "tests/fixtures/payments.py", 5, "sk_l••••••••")] },
  "web-store": { files: 531, findings: [] }, "api-gateway": { files: 174, findings: [] }, "mobile-app": { files: 466, findings: [] },
  "auth-service": { files: 143, findings: [] }, "data-pipeline": { files: 209, findings: [] }, "admin-dashboard": { files: 357, findings: [] },
  "infra-terraform": { files: 96, findings: [] }, "docs-site": { files: 188, findings: [] }, "portfolio": { files: 64, findings: [] },
};
for (const r of REPOS) {
  const s = SECRETS[r.repo];
  if (!s) continue;
  const c = (sv: string) => s.findings.filter((f) => f.severity === sv).length;
  await insert("RepoSecrets", {
    owner: r.owner, repo: r.repo, checkedAt: ago(0.2), status: "complete", filesScanned: s.files, filesSkipped: 0, total: s.findings.length,
    critical: c("critical"), high: c("high"), medium: c("medium"), low: c("low"), findings: JSON.stringify(s.findings), note: null,
  });
}

// ─── Domaines (noms réservés .example) ────────────────────────────────────────
const sucuri = (rating: Record<string, string>, extra: Record<string, unknown>) => JSON.stringify({
  scannedAt: ago(1), ratings: rating, passed: { security: "5/6", domain: "1/1", tls: "6/6" },
  site: { ips: ["203.0.113.10"], hosting: ["Demo Hosting"], server: ["nginx"], poweredBy: [] }, cms: [], language: [], outdated: [],
  recommendations: [], alerts: [], tls: { issuer: "Let's Encrypt", expires: "12 Jan 2027" }, ...extra,
});
const domains = [
  { domain: "acme-corp.example", ip: "203.0.113.10", days: 71, redirect: true, h: [1, 1, 1, 1, 1], sucuri: null as string | null },
  { domain: "shop.acme-corp.example", ip: "203.0.113.24", days: 33, redirect: true, h: [1, 0, 1, 0, 0], sucuri: sucuri({ total: "B", security: "B", domain: "A", tls: "A" }, {
    site: { ips: ["203.0.113.24"], hosting: ["Demo Hosting"], server: ["nginx"], poweredBy: ["PHP/8.1"] }, cms: [{ name: "WordPress", version: "6.5.2" }],
    recommendations: [{ id: "csp", area: "headers", level: "minor", title: "Directives CSP manquantes", details: "script-src, object-src, base-uri" }, { id: "needs_waf", area: "security", level: "minor", title: "Aucun pare-feu applicatif (WAF) détecté" }],
  }) },
  { domain: "intranet.acme-corp.example", ip: "203.0.113.57", days: 9, redirect: false, h: [0, 0, 0, 0, 0], sucuri: sucuri({ total: "D", security: "D", domain: "A", tls: "C" }, {
    site: { ips: ["203.0.113.57"], hosting: ["Demo Hosting"], server: ["Apache"], poweredBy: ["PHP/7.4"] }, cms: [{ name: "Joomla", version: "3.9.19-3.9.21" }],
    language: [{ name: "PHP", version: "7.4" }], outdated: [{ name: "PHP", version: "7.4", safeVersion: "7.4.33", url: "https://www.php.net/ChangeLog-7.php#7.4.33" }],
    recommendations: [{ id: "no_redirect_to_https", area: "tls", level: "major", title: "Pas de redirection automatique vers HTTPS" }, { id: "leaked_php_version", area: "headers", level: "minor", title: "Version de PHP divulguée dans les en-têtes HTTP (désactiver expose_php)" }, { id: "needs_waf", area: "security", level: "minor", title: "Aucun pare-feu applicatif (WAF) détecté" }],
  }) },
];
for (const d of domains) {
  await insert("Domain", {
    domain: d.domain, addedAt: ago(40), checkedAt: ago(0.1), httpStatus: 200, httpsRedirect: d.redirect, ipAddress: d.ip, sslValid: true,
    sslExpiry: inDays(d.days), sslIssuer: "Let's Encrypt", sslDaysLeft: d.days, hasHsts: !!d.h[0], hasCsp: !!d.h[1], hasXFrame: !!d.h[2], hasXContent: !!d.h[3], hasRp: !!d.h[4],
    sucuri: d.sucuri, sucuriAt: d.sucuri ? ago(1) : null,
  });
}

// ─── États d'alertes (ignorée, reportée, assignée) ────────────────────────────
const LOGIN = "alex-martin";
await insert("IssueState", { githubLogin: LOGIN, key: "dep|acme-corp/web-store|npm:minimist@1.2.5", status: "ignored", reason: "not-used", note: "Dépendance transitive d'un outil de build, jamais exécutée en production", updatedAt: ago(3), createdAt: ago(3) });
await insert("IssueState", { githubLogin: LOGIN, key: "dep|acme-corp/mobile-app|npm:node-fetch@2.6.0", status: "snoozed", reason: "", note: "Migration vers fetch natif prévue au prochain sprint", until: inDays(21), updatedAt: ago(1), createdAt: ago(1) });
await insert("IssueState", { githubLogin: LOGIN, key: "dep|acme-corp/web-store|npm:lodash@4.17.15", status: "open", reason: "", note: "", assignee: "alex-martin", updatedAt: ago(1), createdAt: ago(1) });

console.log(`[demo] base créée : ${dbPath}`);
await db.close();

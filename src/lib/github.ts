import "server-only";
import { DEMO_LOGIN, DEMO_ORGS, DEMO_PRS, DEMO_REPOS, isDemo } from "./demo";
import { Octokit } from "@octokit/rest";
import {
  dedupeDeps, parseCargoLock, parseComposerLock, parseGemfileLock, parseGoMod, parsePackageJson,
  parsePackageLock, parsePipfileLock, parsePnpmLock, parsePoetryLock, parseRequirements, parseSbom,
  parseYarnLock, type ParsedDependencies, type SpdxDocument,
} from "./lockfiles";

export type { ParsedDependencies } from "./lockfiles";

const silentLog = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_RETRIES = 3;

export function isGithubUnauthorized(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  return status === 401;
}

function withRetry(octokit: Octokit): Octokit {
  octokit.hook.wrap("request", async (request, options) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await request(options);
      } catch (error) {
        lastError = error;
        const status = (error as { status?: number })?.status;
        if (!status || !RETRYABLE_STATUS.has(status) || attempt === MAX_RETRIES - 1) {
          throw error;
        }
        const retryAfter = Number(
          (error as { response?: { headers?: Record<string, string> } }).response?.headers?.["retry-after"]
        );
        const delayMs =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 400 * 2 ** attempt;
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    throw lastError;
  });
  return octokit;
}

export function getOctokit(token: string) {
  return withRetry(new Octokit({ auth: token }));
}

export function getSilentOctokit(token: string) {
  return withRetry(new Octokit({ auth: token, log: silentLog }));
}

/**
 * Vérifie que le jeton a bien accès au dépôt et renvoie sa branche par défaut réelle.
 * `null` = dépôt introuvable ou inaccessible (404/403). Les autres erreurs (réseau, 5xx,
 * limite de débit) sont relancées pour ne jamais confondre « inaccessible » et « panne ».
 */
export async function getRepoAccess(
  token: string,
  owner: string,
  repo: string
): Promise<{ defaultBranch: string; private: boolean } | null> {
  if (isDemo()) {
    const r = DEMO_REPOS.find((x) => x.owner === owner && x.name === repo);
    return r ? { defaultBranch: r.default_branch, private: r.private } : null;
  }
  try {
    const { data } = await getOctokit(token).repos.get({ owner, repo });
    return { defaultBranch: data.default_branch ?? "main", private: data.private };
  } catch (error) {
    const status = (error as { status?: number })?.status;
    if (status === 404 || status === 403) return null;
    throw error;
  }
}

export async function getGithubLogin(token: string): Promise<string> {
  if (isDemo()) return DEMO_LOGIN;
  const octokit = getOctokit(token);
  const { data } = await octokit.users.getAuthenticated();
  return data.login;
}

/** Révoque l’autorisation OAuth de l’app sur le compte GitHub. */
export async function revokeGithubGrant(accessToken: string): Promise<void> {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret || !accessToken) return;

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  try {
    await fetch(`https://api.github.com/applications/${clientId}/grant`, {
      method: "DELETE",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Basic ${credentials}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ access_token: accessToken }),
    });
  } catch (err) {
    console.warn("[github] révocation OAuth échouée:", err);
  }
}

export interface GithubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: string;
  private: boolean;
  default_branch: string;
  language: string | null;
  updated_at: string;
  pushed_at: string;
}

export interface GithubOrg {
  id: number;
  login: string;
  avatar_url: string;
}

function mapGithubRepo(r: {
  id: number;
  name: string;
  full_name: string;
  owner?: { login?: string | null } | null;
  private?: boolean;
  default_branch?: string | null;
  language?: string | null;
  updated_at?: string | null;
  pushed_at?: string | null;
}): GithubRepo {
  return {
    id: r.id,
    name: r.name,
    full_name: r.full_name,
    owner: r.owner?.login ?? "",
    private: r.private ?? false,
    default_branch: r.default_branch ?? "main",
    language: r.language ?? null,
    updated_at: r.updated_at ?? "",
    pushed_at: r.pushed_at ?? "",
  };
}

export async function listOrgs(token: string): Promise<GithubOrg[]> {
  if (isDemo()) return DEMO_ORGS;
  const octokit = getOctokit(token);
  const orgs = await octokit.paginate(octokit.orgs.listForAuthenticatedUser, { per_page: 100 });
  return orgs.map((o) => ({ id: o.id, login: o.login, avatar_url: o.avatar_url }));
}

export async function listRepos(token: string): Promise<GithubRepo[]> {
  if (isDemo()) return DEMO_REPOS;
  const octokit = getOctokit(token);
  const byId = new Map<number, GithubRepo>();
  const add = (r: Parameters<typeof mapGithubRepo>[0]) => byId.set(r.id, mapGithubRepo(r));

  const userRepos = await octokit.paginate(octokit.repos.listForAuthenticatedUser, {
    affiliation: "owner,collaborator,organization_member",
    per_page: 100,
  });
  for (const r of userRepos) add(r);

  try {
    const orgs = await octokit.paginate(octokit.orgs.listForAuthenticatedUser, { per_page: 100 });
    const CONCURRENCY = 4;
    for (let i = 0; i < orgs.length; i += CONCURRENCY) {
      const batch = orgs.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((org) =>
          octokit.paginate(octokit.repos.listForOrg, {
            org: org.login,
            type: "all",
            per_page: 100,
          })
        )
      );
      for (const result of results) {
        if (result.status === "fulfilled") {
          for (const r of result.value) add(r);
        }
      }
    }
  } catch {
    // read:org manquant ou org protégée — on garde la liste utilisateur
  }

  return [...byId.values()].sort((a, b) => (b.pushed_at || "").localeCompare(a.pushed_at || ""));
}

export interface GithubPR {
  id: number;
  number: number;
  title: string;
  state: "open" | "closed";
  draft: boolean;
  repoFullName: string;
  repoOwner: string;
  repoName: string;
  author: string;
  authorAvatar: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  additions: number;
  deletions: number;
  labels: string[];
}

export async function listPullRequests(token: string, username: string): Promise<GithubPR[]> {
  if (isDemo()) return DEMO_PRS;
  const octokit = getOctokit(token);
  try {
    const { data } = await octokit.search.issuesAndPullRequests({
      q: `is:pr is:open author:${username}`,
      sort: "updated",
      order: "desc",
      per_page: 50,
    });
    return data.items.map((item) => {
      const parts = item.repository_url.split("/");
      const repoName = parts[parts.length - 1];
      const repoOwner = parts[parts.length - 2];
      return {
        id: item.id,
        number: item.number,
        title: item.title,
        state: item.state as "open" | "closed",
        draft: (item as { draft?: boolean }).draft ?? false,
        repoFullName: `${repoOwner}/${repoName}`,
        repoOwner,
        repoName,
        author: item.user?.login ?? "",
        authorAvatar: item.user?.avatar_url ?? "",
        createdAt: item.created_at,
        updatedAt: item.updated_at,
        url: item.html_url,
        additions: 0,
        deletions: 0,
        labels: item.labels.map((l) => (typeof l === "string" ? l : l.name ?? "")),
      };
    });
  } catch {
    return [];
  }
}

export interface DependencyCollection {
  deps: ParsedDependencies[];
  status: "complete" | "partial" | "failed";
  /** Problèmes rencontrés (fichier illisible, arbre tronqué, quota…). Vide si `complete`. */
  warnings: string[];
  /** Fichiers réellement exploités (lockfiles et manifestes). */
  sources: string[];
}

const SKIP_PATH_SEGMENTS = new Set([
  "node_modules", "vendor", "dist", "build", ".next", ".nuxt", "coverage",
  ".git", ".turbo", ".yarn", "out", "target", "__pycache__", ".venv", "venv",
  "Pods", ".cache", ".output", "bower_components", "site-packages",
]);

const MAX_FILES = 60;
const MAX_BLOB_BYTES = 15 * 1024 * 1024;
const FETCH_CONCURRENCY = 6;

interface TreeFile {
  path: string;
  sha: string;
  size: number;
}

type Kind =
  | "package-lock" | "yarn" | "pnpm" | "package-json"
  | "requirements" | "pipfile-lock" | "poetry" | "cargo" | "gomod" | "composer" | "gemfile";

const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const baseOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);

function isSkippedPath(path: string): boolean {
  return path.split("/").some((seg) => SKIP_PATH_SEGMENTS.has(seg));
}

/** Manifestes d'écosystèmes dont on ne sait pas lire le lockfile : le SBOM GitHub les couvre (si le graphe est actif). */
const SBOM_ONLY_MANIFEST_RE = /(^|\/)(pom\.xml|build\.gradle(\.kts)?|packages\.config|[^/]+\.csproj|Directory\.Packages\.props)$/;

export function describeGithubError(error: unknown): string {
  const e = error as { status?: number; message?: string; response?: { headers?: Record<string, string> } };
  if ((e?.status === 403 || e?.status === 429) && e.response?.headers?.["x-ratelimit-remaining"] === "0") {
    return "quota de l'API GitHub épuisé";
  }
  return e?.status ? `GitHub HTTP ${e.status}` : (e?.message ?? "erreur inconnue");
}

/** Choisit, pour chaque dossier, la meilleure source de dépendances (lockfile avant manifeste). */
function selectSources(files: TreeFile[]): { file: TreeFile; kind: Kind; fallbacks: { file: TreeFile; kind: Kind }[]; companion?: TreeFile }[] {
  const byDir = new Map<string, Map<string, TreeFile>>();
  const requirements: TreeFile[] = [];
  for (const f of files) {
    const dir = dirOf(f.path);
    const base = baseOf(f.path);
    if (!byDir.has(dir)) byDir.set(dir, new Map());
    byDir.get(dir)!.set(base, f);
    if (/^requirements.*\.txt$/i.test(base) || (baseOf(dir) === "requirements" && base.endsWith(".txt"))) requirements.push(f);
  }

  const picked: { file: TreeFile; kind: Kind; fallbacks: { file: TreeFile; kind: Kind }[]; companion?: TreeFile }[] = [];
  const npmLockDirs = new Set<string>();
  const NPM_LOCKS: [string, Kind][] = [["package-lock.json", "package-lock"], ["npm-shrinkwrap.json", "package-lock"], ["yarn.lock", "yarn"], ["pnpm-lock.yaml", "pnpm"]];

  for (const [dir, entries] of byDir) {
    const lock = NPM_LOCKS.find(([name]) => entries.has(name));
    const manifest = entries.get("package.json");
    if (lock) {
      npmLockDirs.add(dir);
      picked.push({
        file: entries.get(lock[0])!,
        kind: lock[1],
        fallbacks: manifest ? [{ file: manifest, kind: "package-json" }] : [],
        // yarn/pnpm n'indiquent ni « direct » ni « dev » : package.json sert à les enrichir.
        companion: lock[1] !== "package-lock" ? manifest : undefined,
      });
    }
  }
  for (const [dir, entries] of byDir) {
    const manifest = entries.get("package.json");
    if (!manifest || npmLockDirs.has(dir)) continue;
    // Espace de travail (workspace) couvert par le lockfile d'un dossier parent.
    const covered = [...npmLockDirs].some((d) => d === "" || dir === d || dir.startsWith(d + "/"));
    if (!covered) picked.push({ file: manifest, kind: "package-json", fallbacks: [] });
  }

  const pyLockDirs = new Set<string>();
  for (const [dir, entries] of byDir) {
    const lock: [string, Kind] | undefined = entries.has("Pipfile.lock") ? ["Pipfile.lock", "pipfile-lock"] : entries.has("poetry.lock") ? ["poetry.lock", "poetry"] : undefined;
    if (lock) {
      pyLockDirs.add(dir);
      picked.push({ file: entries.get(lock[0])!, kind: lock[1], fallbacks: [] });
    }
    for (const [name, kind] of [["Cargo.lock", "cargo"], ["go.mod", "gomod"], ["composer.lock", "composer"], ["Gemfile.lock", "gemfile"]] as [string, Kind][]) {
      if (entries.has(name)) picked.push({ file: entries.get(name)!, kind, fallbacks: [] });
    }
  }
  for (const f of requirements) {
    const dir = dirOf(f.path);
    const projectDir = baseOf(dir) === "requirements" ? dirOf(dir) : dir;
    if (!pyLockDirs.has(dir) && !pyLockDirs.has(projectDir)) picked.push({ file: f, kind: "requirements", fallbacks: [] });
  }

  // Lockfiles avant manifestes, dossiers les plus proches de la racine d'abord.
  const rank = (k: Kind) => (k === "package-json" || k === "requirements" ? 1 : 0);
  return picked.sort((x, y) => rank(x.kind) - rank(y.kind) || x.file.path.split("/").length - y.file.path.split("/").length || x.file.path.localeCompare(y.file.path));
}

function parseByKind(kind: Kind, text: string, source: string): ParsedDependencies[] {
  switch (kind) {
    case "package-lock": return parsePackageLock(text, source);
    case "yarn": return parseYarnLock(text, source);
    case "pnpm": return parsePnpmLock(text, source);
    case "package-json": return parsePackageJson(text, source);
    case "requirements": return parseRequirements(text, source);
    case "pipfile-lock": return parsePipfileLock(text, source);
    case "poetry": return parsePoetryLock(text, source);
    case "cargo": return parseCargoLock(text, source);
    case "gomod": return parseGoMod(text, source);
    case "composer": return parseComposerLock(text, source);
    case "gemfile": return parseGemfileLock(text, source);
  }
}

/** yarn.lock / pnpm-lock.yaml ne disent pas quelles dépendances sont directes ou de dev : package.json le dit. */
function enrichFromManifest(deps: ParsedDependencies[], manifestText: string): void {
  try {
    const json = JSON.parse(manifestText) as { dependencies?: object; optionalDependencies?: object; devDependencies?: object };
    const prod = new Set([...Object.keys(json.dependencies ?? {}), ...Object.keys(json.optionalDependencies ?? {})]);
    const dev = new Set(Object.keys(json.devDependencies ?? {}));
    for (const d of deps) {
      d.direct = prod.has(d.name) || dev.has(d.name);
      if (!d.scope && d.direct) d.scope = prod.has(d.name) ? "prod" : "dev";
    }
  } catch {
    // package.json illisible : on garde les valeurs inconnues
  }
}

const SBOM_API_VERSION = "2026-03-10";
// L'API SBOM synchrone est supprimée par GitHub le 13 novembre 2026.
const SYNC_SBOM_REMOVAL = Date.UTC(2026, 10, 13);

/**
 * Récupère le SBOM du dependency graph : API asynchrone (generate-report puis fetch-report),
 * avec repli sur l'ancienne API synchrone tant qu'elle existe.
 */
async function fetchSbomDocument(octokit: ReturnType<typeof getSilentOctokit>, owner: string, repo: string): Promise<SpdxDocument> {
  const toDocument = (data: unknown): SpdxDocument => {
    if (data instanceof ArrayBuffer) return JSON.parse(Buffer.from(data).toString("utf8"));
    if (typeof data === "string") return JSON.parse(data);
    return data as SpdxDocument;
  };
  try {
    const headers = { "X-GitHub-Api-Version": SBOM_API_VERSION };
    const gen = await octokit.request("GET /repos/{owner}/{repo}/dependency-graph/sbom/generate-report", { owner, repo, headers });
    const uuid = String((gen.data as { sbom_url?: string })?.sbom_url ?? "").match(/[0-9a-fA-F-]{36}$/)?.[0];
    if (!uuid) throw new Error("réponse generate-report inattendue");
    for (let attempt = 0; attempt < 20; attempt++) {
      const res = await octokit.request("GET /repos/{owner}/{repo}/dependency-graph/sbom/fetch-report/{sbom_uuid}", { owner, repo, sbom_uuid: uuid, headers });
      if (res.status !== 202) return toDocument(res.data);
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error("génération du SBOM trop longue");
  } catch (error) {
    if (Date.now() >= SYNC_SBOM_REMOVAL) throw error;
    try {
      const { data } = await octokit.request("GET /repos/{owner}/{repo}/dependency-graph/sbom", { owner, repo });
      return toDocument(data);
    } catch {
      throw error;
    }
  }
}

async function readBlob(octokit: ReturnType<typeof getSilentOctokit>, owner: string, repo: string, file: TreeFile): Promise<string> {
  if (file.size > MAX_BLOB_BYTES) throw new Error(`fichier trop volumineux (${Math.round(file.size / 1048576)} Mo)`);
  const { data } = await octokit.git.getBlob({ owner, repo, file_sha: file.sha });
  return Buffer.from(data.content, data.encoding === "base64" ? "base64" : "utf8").toString("utf8");
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

/**
 * Collecte les dépendances d'un dépôt. Les versions exactes viennent des lockfiles (transitifs inclus) ;
 * à défaut, des plages déclarées dans les manifestes (`resolved: false`). Toute lecture impossible est
 * signalée dans `warnings` : le résultat n'est alors plus `complete`.
 */
export async function getDependencies(token: string, owner: string, repo: string, branch: string): Promise<DependencyCollection> {
  const octokit = getSilentOctokit(token);
  const warnings: string[] = [];

  let tree: { path?: string; type?: string; sha?: string; size?: number }[] = [];
  try {
    const { data } = await octokit.git.getTree({ owner, repo, tree_sha: branch, recursive: "true" });
    tree = data.tree ?? [];
    if (data.truncated) warnings.push("arborescence du dépôt tronquée par GitHub : certains fichiers n'ont pas été vus");
  } catch (error) {
    if ((error as { status?: number })?.status === 409) return { deps: [], status: "complete", warnings: [], sources: [] }; // dépôt vide
    return { deps: [], status: "failed", warnings: [`lecture de l'arborescence impossible (${describeGithubError(error)})`], sources: [] };
  }

  const files: TreeFile[] = tree
    .filter((t) => t.type === "blob" && t.path && t.sha && !isSkippedPath(t.path))
    .map((t) => ({ path: t.path!, sha: t.sha!, size: t.size ?? 0 }));

  const selected = selectSources(files);
  const needsSbom = files.some((f) => SBOM_ONLY_MANIFEST_RE.test(f.path));
  if (selected.length > MAX_FILES) warnings.push(`${selected.length} fichiers de dépendances détectés : les ${MAX_FILES} plus proches de la racine sont analysés`);
  const work = selected.slice(0, MAX_FILES);

  const results = await mapLimit(work, FETCH_CONCURRENCY, async (item) => {
    const candidates = [{ file: item.file, kind: item.kind }, ...item.fallbacks];
    let lastError = "";
    for (const c of candidates) {
      try {
        const text = await readBlob(octokit, owner, repo, c.file);
        const deps = parseByKind(c.kind, text, c.file.path);
        if (item.companion && c === candidates[0]) {
          try {
            enrichFromManifest(deps, await readBlob(octokit, owner, repo, item.companion));
          } catch {
            // enrichissement facultatif
          }
        }
        if (c !== candidates[0]) warnings.push(`${item.file.path} illisible (${lastError}) — repli sur ${c.file.path} (versions déclarées, non résolues)`);
        return { ok: true as const, deps, source: c.file.path };
      } catch (error) {
        lastError = error instanceof Error && !(error as { status?: number }).status ? error.message : describeGithubError(error);
      }
    }
    warnings.push(`${item.file.path} illisible (${lastError})`);
    return { ok: false as const };
  });

  const deps: ParsedDependencies[] = [];
  const sources: string[] = [];
  for (const r of results) if (r.ok) { deps.push(...r.deps); sources.push(r.source); }

  if (needsSbom) {
    try {
      const sbomDeps = parseSbom(await fetchSbomDocument(octokit, owner, repo)).filter((d) => d.ecosystem === "maven" || d.ecosystem === "nuget");
      if (sbomDeps.length > 0) { deps.push(...sbomDeps); sources.push("SBOM GitHub"); }
    } catch (error) {
      warnings.push(`dépendances Maven/Gradle/NuGet non analysées : SBOM GitHub indisponible (${describeGithubError(error)} — activez le « dependency graph » du dépôt)`);
    }
  }

  const failedAll = work.length > 0 && results.every((r) => !r.ok) && deps.length === 0;
  return {
    deps: dedupeDeps(deps),
    status: failedAll ? "failed" : warnings.length > 0 ? "partial" : "complete",
    warnings,
    sources,
  };
}

import { Octokit } from "@octokit/rest";

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

function getSilentOctokit(token: string) {
  return withRetry(new Octokit({ auth: token, log: silentLog }));
}

export async function getGithubLogin(token: string): Promise<string> {
  const octokit = getOctokit(token);
  const { data } = await octokit.users.getAuthenticated();
  return data.login;
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

export async function listOrgs(token: string): Promise<GithubOrg[]> {
  const octokit = getOctokit(token);
  const { data } = await octokit.orgs.listForAuthenticatedUser({ per_page: 100 });
  return data.map((o) => ({ id: o.id, login: o.login, avatar_url: o.avatar_url }));
}

export async function listRepos(token: string): Promise<GithubRepo[]> {
  const octokit = getOctokit(token);
  const repos = await octokit.paginate(octokit.repos.listForAuthenticatedUser, {
    visibility: "all",
    sort: "pushed",
    per_page: 100,
  });
  return repos.map((r) => ({
    id: r.id,
    name: r.name,
    full_name: r.full_name,
    owner: r.owner?.login ?? "",
    private: r.private,
    default_branch: r.default_branch ?? "main",
    language: r.language ?? null,
    updated_at: r.updated_at ?? "",
    pushed_at: r.pushed_at ?? "",
  }));
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

export interface ParsedDependencies {
  name: string;
  version: string;
  ecosystem: "npm" | "pip" | "maven" | "cargo";
  source?: string;
}

const SKIP_PATH_SEGMENTS = new Set([
  "node_modules", "vendor", "dist", "build", ".next", ".nuxt", "coverage",
  ".git", ".turbo", ".yarn", "out", "target", "__pycache__", ".venv", "venv",
  "Pods", ".cache", ".output",
]);

const MONOREPO_DIRS = ["apps", "packages", "services", "libs", "src"];
const MAX_MANIFESTS = 40;
const FETCH_CONCURRENCY = 8;

function isSkippedPath(path: string): boolean {
  return path.split("/").some((seg) => SKIP_PATH_SEGMENTS.has(seg));
}

function npmVersion(raw: unknown): string | null {
  const s = String(raw).trim();
  if (!s) return null;
  if (/^(workspace:|file:|link:|portal:|catalog:|git\+|github:|http:|https:|npm:)/i.test(s)) return null;
  const version = s.replace(/^[^0-9]*/, "").split(" ")[0];
  return version || null;
}

async function getFileText(
  octokit: ReturnType<typeof getSilentOctokit>,
  owner: string,
  repo: string,
  path: string,
  branch: string
): Promise<string | null> {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path, ref: branch });
    if ("content" in data && data.content) {
      return Buffer.from(data.content, "base64").toString();
    }
  } catch {}
  return null;
}

async function listDirNames(
  octokit: ReturnType<typeof getSilentOctokit>,
  owner: string,
  repo: string,
  path: string,
  branch: string
): Promise<string[]> {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path, ref: branch });
    if (!Array.isArray(data)) return [];
    return data.filter((f) => f.type === "dir").map((f) => f.name);
  } catch {
    return [];
  }
}

async function discoverManifests(
  octokit: ReturnType<typeof getSilentOctokit>,
  owner: string,
  repo: string,
  branch: string
): Promise<{ packageJson: string[]; requirements: string[] }> {
  const packageJson = new Set<string>();
  const requirements = new Set<string>();

  const addPath = (path: string) => {
    if (isSkippedPath(path)) return;
    const base = path.split("/").pop();
    if (base === "package.json") packageJson.add(path);
    if (base === "requirements.txt") requirements.add(path);
  };

  let treeOk = false;
  try {
    const { data } = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: branch,
      recursive: "true",
    });
    treeOk = true;
    for (const item of data.tree ?? []) {
      if (item.type !== "blob" || !item.path) continue;
      addPath(item.path);
    }

    if (data.truncated) {
      const extraDirs = await Promise.all(
        MONOREPO_DIRS.map((dir) => listDirNames(octokit, owner, repo, dir, branch).then((names) => ({ dir, names })))
      );
      for (const { dir, names } of extraDirs) {
        for (const name of names) {
          addPath(`${dir}/${name}/package.json`);
          addPath(`${dir}/${name}/requirements.txt`);
        }
      }
    }
  } catch {}

  if (!treeOk) {
    packageJson.add("package.json");
    requirements.add("requirements.txt");
    const extraDirs = await Promise.all(
      MONOREPO_DIRS.map((dir) => listDirNames(octokit, owner, repo, dir, branch).then((names) => ({ dir, names })))
    );
    for (const { dir, names } of extraDirs) {
      for (const name of names) {
        addPath(`${dir}/${name}/package.json`);
        addPath(`${dir}/${name}/requirements.txt`);
      }
    }
  }

  const sortManifests = (paths: string[]) =>
    [...paths].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b)).slice(0, MAX_MANIFESTS);

  return {
    packageJson: sortManifests([...packageJson]),
    requirements: sortManifests([...requirements]),
  };
}

function parsePackageJson(text: string, source: string): ParsedDependencies[] {
  try {
    const json = JSON.parse(text) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeps = { ...json.dependencies, ...json.devDependencies };
    const results: ParsedDependencies[] = [];
    for (const [name, raw] of Object.entries(allDeps)) {
      const version = npmVersion(raw);
      if (version) results.push({ name, version, ecosystem: "npm", source });
    }
    return results;
  } catch {
    return [];
  }
}

function parseRequirements(text: string, source: string): ParsedDependencies[] {
  const results: ParsedDependencies[] = [];
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_.-]+)[>=<!\s]+([0-9][0-9.]*)/);
    if (match) results.push({ name: match[1], version: match[2], ecosystem: "pip", source });
  }
  return results;
}

function dedupeDeps(deps: ParsedDependencies[]): ParsedDependencies[] {
  const map = new Map<string, ParsedDependencies>();
  for (const dep of deps) {
    const key = `${dep.ecosystem}:${dep.name}@${dep.version}`;
    const existing = map.get(key);
    if (existing) {
      const sources = new Set([existing.source, dep.source].filter(Boolean));
      existing.source = [...sources].join(", ") || existing.source;
    } else {
      map.set(key, { ...dep });
    }
  }
  return [...map.values()];
}

async function fetchTexts(
  octokit: ReturnType<typeof getSilentOctokit>,
  owner: string,
  repo: string,
  branch: string,
  paths: string[]
): Promise<{ path: string; text: string }[]> {
  const out: { path: string; text: string }[] = [];
  for (let i = 0; i < paths.length; i += FETCH_CONCURRENCY) {
    const batch = paths.slice(i, i + FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (path) => {
        const text = await getFileText(octokit, owner, repo, path, branch);
        return text ? { path, text } : null;
      })
    );
    for (const r of results) if (r) out.push(r);
  }
  return out;
}

export async function getDependencies(
  token: string,
  owner: string,
  repo: string,
  branch: string
): Promise<ParsedDependencies[]> {
  const octokit = getSilentOctokit(token);
  const manifests = await discoverManifests(octokit, owner, repo, branch);

  const [pkgFiles, reqFiles] = await Promise.all([
    fetchTexts(octokit, owner, repo, branch, manifests.packageJson),
    fetchTexts(octokit, owner, repo, branch, manifests.requirements),
  ]);

  const results: ParsedDependencies[] = [];
  for (const file of pkgFiles) results.push(...parsePackageJson(file.text, file.path));
  for (const file of reqFiles) results.push(...parseRequirements(file.text, file.path));

  return dedupeDeps(results);
}

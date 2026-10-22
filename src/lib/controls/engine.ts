import "server-only";
import { db } from "../db";
import { getSilentOctokit, describeGithubError } from "../github";
import { analyzeTree, analyzeWorkflow, type WorkflowAnalysis } from "./analyzers";
import { evaluateControls } from "./evaluate";
import type { Fetched, ProtectionData, RepoFacts, RuleData } from "./facts";
import { scoreResults, type ControlResult, type PostureScore } from "./types";

/** La posture n'a pas pu être évaluée (dépôt illisible) : rien n'est enregistré. */
export class PostureFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PostureFailedError";
  }
}

type Octokit = ReturnType<typeof getSilentOctokit>;

// ─── Lecture tolérante : un échec devient un état explicite, jamais un « tout va bien » ───

function toFailure(error: unknown): Extract<Fetched<never>, { ok: false }> {
  const e = error as { status?: number; message?: string };
  const message = String(e?.message ?? "").split("\n")[0].replace(/\s+-\s+https?:\/\/\S+$/, "").slice(0, 200);
  if (/Upgrade to GitHub|make this repository public/i.test(message)) return { ok: false, kind: "plan", message };
  if (/rate limit/i.test(message)) return { ok: false, kind: "error", message: "quota de l'API GitHub épuisé" };
  if (e?.status === 404) return { ok: false, kind: "notfound", message: message || "introuvable" };
  if (e?.status === 403 || e?.status === 401) return { ok: false, kind: "forbidden", message: message || "accès refusé" };
  return { ok: false, kind: "error", message: describeGithubError(error) };
}

async function attempt<T>(fn: () => Promise<T>): Promise<Fetched<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return toFailure(error);
  }
}

const needsAdmin: Fetched<never> = { ok: false, kind: "forbidden", message: "droits administrateur requis" };

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

const MAX_WORKFLOWS = 25;

// ─── Collecte ─────────────────────────────────────────────────────────────────

export async function collectFacts(token: string, owner: string, repo: string): Promise<RepoFacts> {
  const octokit: Octokit = getSilentOctokit(token);

  const meta = await attempt(async () => {
    const { data } = await octokit.repos.get({ owner, repo });
    const sa = data.security_and_analysis as
      | { secret_scanning?: { status?: string }; secret_scanning_push_protection?: { status?: string } }
      | null
      | undefined;
    const status = (v?: string): "enabled" | "disabled" | null => (v === "enabled" ? "enabled" : v === "disabled" ? "disabled" : null);
    return {
      defaultBranch: data.default_branch ?? "main",
      isPrivate: data.private,
      archived: data.archived,
      admin: data.permissions?.admin === true,
      secretScanning: status(sa?.secret_scanning?.status),
      pushProtection: status(sa?.secret_scanning_push_protection?.status),
    };
  });
  if (!meta.ok) throw new PostureFailedError(`lecture du dépôt impossible (${meta.message})`);

  const { defaultBranch: branch, admin, isPrivate } = meta.data;

  // Arborescence (avec les SHA nécessaires à la lecture des workflows)
  let workflowShas: { path: string; sha: string }[] = [];
  const tree = await attempt(async () => {
    const { data } = await octokit.git.getTree({ owner, repo, tree_sha: branch, recursive: "true" });
    const entries = data.tree.filter((t) => t.type === "blob" && t.path);
    const analysis = analyzeTree(entries.map((t) => t.path!));
    const shaOf = new Map(entries.map((t) => [t.path!, t.sha ?? ""]));
    workflowShas = analysis.workflowFiles.slice(0, MAX_WORKFLOWS).map((path) => ({ path, sha: shaOf.get(path) ?? "" })).filter((w) => w.sha);
    return { analysis, truncated: !!data.truncated };
  });

  // Un dépôt public sans SECURITY.md propre hérite de celui du dépôt « <propriétaire>/.github » s'il existe.
  const inheritedSecurityPolicy: Promise<Fetched<boolean>> = (async () => {
    if (isPrivate || !tree.ok || tree.data.analysis.has.securityPolicy) return { ok: true as const, data: false };
    for (const path of ["SECURITY.md", ".github/SECURITY.md", "docs/SECURITY.md"]) {
      try {
        await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", { owner, repo: ".github", path });
        return { ok: true as const, data: true };
      } catch (error) {
        if ((error as { status?: number })?.status !== 404) return toFailure(error);
      }
    }
    return { ok: true as const, data: false };
  })();

  const workflows: Promise<Fetched<WorkflowAnalysis[]>> = (async () => {
    if (!tree.ok) return tree;
    return attempt(async () => {
      const analyses = await mapLimit(workflowShas, 5, async ({ path, sha }) => {
        const { data } = await octokit.git.getBlob({ owner, repo, file_sha: sha });
        return analyzeWorkflow(path, Buffer.from(data.content, data.encoding === "base64" ? "base64" : "utf8").toString("utf8"));
      });
      return analyses;
    });
  })();

  const protection = attempt<ProtectionData | null>(async () => {
    try {
      const { data } = await octokit.request("GET /repos/{owner}/{repo}/branches/{branch}/protection", { owner, repo, branch });
      const d = data as {
        required_pull_request_reviews?: { required_approving_review_count?: number };
        allow_force_pushes?: { enabled?: boolean };
        allow_deletions?: { enabled?: boolean };
        required_status_checks?: { contexts?: unknown[]; checks?: unknown[] } | null;
        enforce_admins?: { enabled?: boolean };
      };
      return {
        requiredReviews: d.required_pull_request_reviews ? (d.required_pull_request_reviews.required_approving_review_count ?? 0) : null,
        allowForcePushes: d.allow_force_pushes?.enabled ?? null,
        allowDeletions: d.allow_deletions?.enabled ?? null,
        requiredStatusChecks: !!d.required_status_checks && ((d.required_status_checks.contexts?.length ?? 0) > 0 || (d.required_status_checks.checks?.length ?? 0) > 0),
        enforceAdmins: d.enforce_admins?.enabled ?? null,
      };
    } catch (error) {
      if ((error as { status?: number })?.status === 404 && /not protected/i.test(String((error as Error).message))) return null;
      throw error;
    }
  });

  const rules = attempt<RuleData[]>(async () => {
    const { data } = await octokit.request("GET /repos/{owner}/{repo}/rules/branches/{branch}", { owner, repo, branch });
    return (data as { type: string; parameters?: { required_approving_review_count?: number } }[]).map((r) => ({
      type: r.type,
      requiredApprovals: r.parameters?.required_approving_review_count,
    }));
  });

  const workflowPermissions = admin
    ? attempt(async () => {
        const { data } = await octokit.request("GET /repos/{owner}/{repo}/actions/permissions/workflow", { owner, repo });
        const d = data as { default_workflow_permissions?: string; can_approve_pull_request_reviews?: boolean };
        return { defaultPermissions: (d.default_workflow_permissions === "write" ? "write" : "read") as "read" | "write", canApprovePullRequests: !!d.can_approve_pull_request_reviews };
      })
    : Promise.resolve(needsAdmin);

  const codeScanning = attempt(async () => {
    const { data } = await octokit.request("GET /repos/{owner}/{repo}/code-scanning/analyses", { owner, repo, per_page: 1 });
    const list = data as { created_at?: string }[];
    return { analyses: list.length, lastAnalysisAt: list[0]?.created_at ?? null };
  });

  const privateReporting = isPrivate
    ? Promise.resolve<Fetched<boolean>>({ ok: false, kind: "notfound", message: "dépôt privé" })
    : attempt(async () => {
        const { data } = await octokit.request("GET /repos/{owner}/{repo}/private-vulnerability-reporting", { owner, repo });
        return !!(data as { enabled?: boolean }).enabled;
      });

  const dependabotAlerts: Promise<Fetched<boolean>> = (async () => {
    try {
      await octokit.request("GET /repos/{owner}/{repo}/vulnerability-alerts", { owner, repo });
      return { ok: true as const, data: true };
    } catch (error) {
      if ((error as { status?: number })?.status === 404 && /disabled/i.test(String((error as Error).message))) return { ok: true as const, data: false };
      return toFailure(error);
    }
  })();

  const mergedPullRequests = attempt(async () => {
    const { data } = await octokit.pulls.list({ owner, repo, state: "closed", sort: "updated", direction: "desc", per_page: 50 });
    const merged = data.filter((p) => p.merged_at).slice(0, 10);
    const reviewed = await mapLimit(merged, 5, async (pr) => {
      const { data: reviews } = await octokit.pulls.listReviews({ owner, repo, pull_number: pr.number, per_page: 100 });
      return reviews.some((r) => r.state === "APPROVED" && r.user?.login !== pr.user?.login);
    });
    return { sampled: merged.length, reviewed: reviewed.filter(Boolean).length };
  });

  const commits = attempt(async () => {
    const { data } = await octokit.repos.listCommits({ owner, repo, sha: branch, per_page: 30 });
    return { sampled: data.length, verified: data.filter((c) => c.commit.verification?.verified).length };
  });

  const deployKeys = admin
    ? attempt(async () => {
        const { data } = await octokit.repos.listDeployKeys({ owner, repo, per_page: 100 });
        return data.map((k) => ({ title: k.title, readOnly: k.read_only }));
      })
    : Promise.resolve(needsAdmin);

  const webhooks = admin
    ? attempt(async () => {
        const { data } = await octokit.repos.listWebhooks({ owner, repo, per_page: 100 });
        return data.map((h) => ({
          url: String(h.config.url ?? ""),
          insecureSsl: String(h.config.insecure_ssl ?? "0") === "1",
          hasSecret: !!h.config.secret,
        }));
      })
    : Promise.resolve(needsAdmin);

  const outsideAdmins = admin
    ? attempt(async () => {
        const { data } = await octokit.repos.listCollaborators({ owner, repo, affiliation: "outside", per_page: 100 });
        return data.filter((c) => c.permissions?.admin).map((c) => c.login);
      })
    : Promise.resolve(needsAdmin);

  const [protectionR, rulesR, workflowsR, wpR, csR, pvrR, daR, prR, cR, dkR, whR, oaR, inheritedR] = await Promise.all([
    protection, rules, workflows, workflowPermissions, codeScanning, privateReporting, dependabotAlerts, mergedPullRequests, commits, deployKeys, webhooks, outsideAdmins, inheritedSecurityPolicy,
  ]);

  return {
    owner,
    repo,
    meta,
    tree,
    inheritedSecurityPolicy: inheritedR,
    protection: protectionR,
    rules: rulesR,
    workflows: workflowsR,
    workflowPermissions: wpR,
    codeScanning: csR,
    privateReporting: pvrR,
    dependabotAlerts: daR,
    mergedPullRequests: prR,
    commits: cR,
    deployKeys: dkR,
    webhooks: whR,
    outsideAdmins: oaR,
  };
}

// ─── Audit + stockage ─────────────────────────────────────────────────────────

export interface PostureSummary {
  owner: string;
  repo: string;
  checkedAt: Date;
  score: number;
  total: number;
  evaluated: number;
  passed: number;
  failed: number;
  warning: number;
  unknown: number;
  failCritical: number;
  failHigh: number;
  failMedium: number;
  failLow: number;
  isPrivate: boolean;
}

export async function auditPosture(token: string, owner: string, repo: string): Promise<{ score: PostureScore; results: ControlResult[] }> {
  const facts = await collectFacts(token, owner, repo);
  const results = evaluateControls(facts);
  const score = scoreResults(results);
  const meta = facts.meta.ok ? facts.meta.data : null;

  const data = {
    score: score.score,
    total: score.total,
    evaluated: score.evaluated,
    passed: score.passed,
    failed: score.failed,
    warning: score.warning,
    unknown: score.unknown,
    failCritical: score.failedBySeverity.critical,
    failHigh: score.failedBySeverity.high,
    failMedium: score.failedBySeverity.medium,
    failLow: score.failedBySeverity.low,
    isPrivate: meta?.isPrivate ?? false,
    defaultBranch: meta?.defaultBranch ?? "",
    results: JSON.stringify(results),
  };
  await db.repoPosture.upsert({
    where: { owner_repo: { owner, repo } },
    create: { owner, repo, ...data },
    update: { ...data, checkedAt: new Date() },
  });
  console.log(`[posture] ${owner}/${repo}: ${score.score}/100 — ${score.passed} ok, ${score.failed} échec(s), ${score.warning} avert., ${score.unknown} non évaluable(s)`);
  return { score, results };
}

export async function getPostureSummaries(repos: { owner: string; name: string }[]): Promise<Map<string, PostureSummary>> {
  if (repos.length === 0) return new Map();
  const rows = await db.repoPosture.findMany({
    where: { OR: repos.map((r) => ({ owner: r.owner, repo: r.name })) },
    select: {
      owner: true, repo: true, checkedAt: true, score: true, total: true, evaluated: true, passed: true, failed: true,
      warning: true, unknown: true, failCritical: true, failHigh: true, failMedium: true, failLow: true, isPrivate: true,
    },
  });
  return new Map(rows.map((r) => [`${r.owner}/${r.repo}`, r]));
}

export async function getPostureDetail(owner: string, repo: string): Promise<{ summary: PostureSummary; results: ControlResult[] } | null> {
  const row = await db.repoPosture.findUnique({ where: { owner_repo: { owner, repo } } });
  if (!row) return null;
  let results: ControlResult[] = [];
  try {
    results = JSON.parse(row.results) as ControlResult[];
  } catch {
    results = [];
  }
  const { results: _r, id: _i, defaultBranch: _d, ...summary } = row;
  return { summary, results };
}

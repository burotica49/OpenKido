"use server";

import { getOctokit } from "./github";
import { db } from "./db";

export type AlertSource = "code_scanning" | "dependabot" | "secret_scanning";
export type AlertSeverity = "critical" | "high" | "medium" | "low" | "warning" | "note" | "unknown";

export interface AuditAlert {
  id: string;
  source: AlertSource;
  severity: AlertSeverity;
  title: string;
  description: string;
  state: "open" | "dismissed" | "fixed" | "auto_dismissed";
  url: string;
  path?: string;
  createdAt: string;
  // Secret scanning specific
  secretType?: string;
}

export interface AuditSummary {
  owner: string;
  repo: string;
  checkedAt: Date | null;
  csTotal: number; csCritical: number; csHigh: number; csMedium: number; csLow: number;
  dbTotal: number; dbCritical: number; dbHigh: number; dbMedium: number; dbLow: number;
  ssTotal: number; ssActive: number;
}

// ─── Severity mapping ──────────────────────────────────────────────────────────

function mapCsSeverity(s: string | null | undefined): AlertSeverity {
  switch (s?.toLowerCase()) {
    case "critical": return "critical";
    case "high":     return "high";
    case "medium":   return "medium";
    case "low":      return "low";
    case "warning":  return "warning";
    case "note":     return "note";
    default:         return "unknown";
  }
}

function mapDbSeverity(s: string | null | undefined): AlertSeverity {
  switch (s?.toLowerCase()) {
    case "critical": return "critical";
    case "high":     return "high";
    case "medium":   return "medium";
    case "low":      return "low";
    default:         return "unknown";
  }
}

function severityRank(s: AlertSeverity): number {
  return { critical: 4, high: 3, medium: 2, low: 1, warning: 1, note: 0, unknown: 0 }[s] ?? 0;
}

// ─── Fetch functions ───────────────────────────────────────────────────────────

async function fetchCodeScanningAlerts(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string
): Promise<AuditAlert[]> {
  try {
    const { data } = await octokit.codeScanning.listAlertsForRepo({
      owner, repo, state: "open", per_page: 100,
    });
    return data.map((a) => ({
      id: `cs-${a.number}`,
      source: "code_scanning",
      severity: mapCsSeverity(a.rule?.severity),
      title: a.rule?.description ?? a.rule?.id ?? "Code scanning alert",
      description: a.most_recent_instance?.message?.text ?? "",
      state: (a.state as AuditAlert["state"]) ?? "open",
      url: a.html_url ?? "",
      path: a.most_recent_instance?.location?.path,
      createdAt: a.created_at ?? new Date().toISOString(),
    }));
  } catch (e: any) {
    // 403 = not enabled, 404 = not found — both are normal
    if (e?.status === 403 || e?.status === 404) return [];
    throw e;
  }
}

async function fetchDependabotAlerts(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string
): Promise<AuditAlert[]> {
  try {
    const { data } = await octokit.dependabot.listAlertsForRepo({
      owner, repo, state: "open", per_page: 100,
    });
    return data.map((a) => ({
      id: `db-${a.number}`,
      source: "dependabot",
      severity: mapDbSeverity(a.security_advisory?.severity),
      title: a.security_advisory?.summary ?? `Dependabot #${a.number}`,
      description: a.security_advisory?.description ?? "",
      state: (a.state as AuditAlert["state"]) ?? "open",
      url: a.html_url ?? "",
      path: a.dependency?.manifest_path,
      createdAt: a.created_at ?? new Date().toISOString(),
    }));
  } catch (e: any) {
    if (e?.status === 403 || e?.status === 404) return [];
    throw e;
  }
}

async function fetchSecretScanningAlerts(
  octokit: ReturnType<typeof getOctokit>,
  owner: string,
  repo: string
): Promise<AuditAlert[]> {
  try {
    const { data } = await octokit.secretScanning.listAlertsForRepo({
      owner, repo, state: "open", per_page: 100,
    });
    return data.map((a) => ({
      id: `ss-${a.number}`,
      source: "secret_scanning",
      severity: "critical",
      title: a.secret_type_display_name ?? a.secret_type ?? "Secret exposé",
      description: `Secret de type « ${a.secret_type_display_name ?? a.secret_type} » détecté.`,
      state: (a.state as AuditAlert["state"]) ?? "open",
      url: a.html_url ?? "",
      createdAt: a.created_at ?? new Date().toISOString(),
      secretType: a.secret_type ?? undefined,
    }));
  } catch (e: any) {
    if (e?.status === 403 || e?.status === 404) return [];
    throw e;
  }
}

// ─── Main audit function ───────────────────────────────────────────────────────

export async function auditRepo(
  token: string,
  owner: string,
  repo: string
): Promise<{ summary: AuditSummary; alerts: AuditAlert[] }> {
  const octokit = getOctokit(token);

  const [csAlerts, dbAlerts, ssAlerts] = await Promise.all([
    fetchCodeScanningAlerts(octokit, owner, repo),
    fetchDependabotAlerts(octokit, owner, repo),
    fetchSecretScanningAlerts(octokit, owner, repo),
  ]);

  const allAlerts = [...csAlerts, ...dbAlerts, ...ssAlerts]
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  // Code scanning counts
  const count = (arr: AuditAlert[], sev: AlertSeverity) => arr.filter((a) => a.severity === sev).length;
  const csTotal = csAlerts.length;
  const csCritical = count(csAlerts, "critical");
  const csHigh = count(csAlerts, "high");
  const csMedium = count(csAlerts, "medium");
  const csLow = count(csAlerts, "low") + count(csAlerts, "warning") + count(csAlerts, "note");

  const dbTotal = dbAlerts.length;
  const dbCritical = count(dbAlerts, "critical");
  const dbHigh = count(dbAlerts, "high");
  const dbMedium = count(dbAlerts, "medium");
  const dbLow = count(dbAlerts, "low");

  const ssTotal = ssAlerts.length;
  const ssActive = ssAlerts.filter((a) => a.state === "open").length;

  await db.repoAudit.upsert({
    where: { owner_repo: { owner, repo } },
    create: {
      owner, repo,
      csTotal, csCritical, csHigh, csMedium, csLow,
      dbTotal, dbCritical, dbHigh, dbMedium, dbLow,
      ssTotal, ssActive,
      alerts: JSON.stringify(allAlerts),
    },
    update: {
      checkedAt: new Date(),
      csTotal, csCritical, csHigh, csMedium, csLow,
      dbTotal, dbCritical, dbHigh, dbMedium, dbLow,
      ssTotal, ssActive,
      alerts: JSON.stringify(allAlerts),
    },
  });

  console.log(`[audit] ${owner}/${repo}: CS=${csTotal} DB=${dbTotal} SS=${ssTotal}`);

  const summary: AuditSummary = {
    owner, repo, checkedAt: new Date(),
    csTotal, csCritical, csHigh, csMedium, csLow,
    dbTotal, dbCritical, dbHigh, dbMedium, dbLow,
    ssTotal, ssActive,
  };

  return { summary, alerts: allAlerts };
}

export async function auditAllRepos(
  token: string,
  repos: { owner: string; name: string }[]
): Promise<number> {
  const CONCURRENCY = 5;
  let done = 0;
  for (let i = 0; i < repos.length; i += CONCURRENCY) {
    const batch = repos.slice(i, i + CONCURRENCY);
    await Promise.allSettled(batch.map((r) => auditRepo(token, r.owner, r.name)));
    done += batch.length;
  }
  return done;
}

export async function getAuditSummaries(
  repos: { owner: string; name: string }[]
): Promise<Map<string, AuditSummary>> {
  const rows = await db.repoAudit.findMany({
    where: { OR: repos.map((r) => ({ owner: r.owner, repo: r.name })) },
    select: {
      owner: true, repo: true, checkedAt: true,
      csTotal: true, csCritical: true, csHigh: true, csMedium: true, csLow: true,
      dbTotal: true, dbCritical: true, dbHigh: true, dbMedium: true, dbLow: true,
      ssTotal: true, ssActive: true,
    },
  });
  return new Map(rows.map((r) => [`${r.owner}/${r.repo}`, r as AuditSummary]));
}

export async function getAuditAlerts(owner: string, repo: string): Promise<AuditAlert[]> {
  const row = await db.repoAudit.findUnique({
    where: { owner_repo: { owner, repo } },
    select: { alerts: true },
  });
  if (!row) return [];
  try { return JSON.parse(row.alerts) as AuditAlert[]; } catch { return []; }
}

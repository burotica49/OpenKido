import "server-only";

import { describeGithubError, getOctokit } from "./github";
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
  /** Dependabot : « malware » pour un paquet malveillant, sinon « general ». */
  classification?: string;
}

export interface AuditSummary {
  owner: string;
  repo: string;
  checkedAt: Date | null;
  csTotal: number; csCritical: number; csHigh: number; csMedium: number; csLow: number;
  dbTotal: number; dbCritical: number; dbHigh: number; dbMedium: number; dbLow: number;
  ssTotal: number; ssActive: number;
  /** "ok" | "disabled" | "no-access" | "unknown" (audit antérieur à l'enregistrement des états). */
  csState: string; dbState: string; ssState: string;
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

// ─── États des sources et collecte paginée ─────────────────────────────────────

/** ok = interrogée ; disabled = fonction non activée sur le dépôt ; no-access = droits insuffisants. */
export type AuditSourceState = "ok" | "disabled" | "no-access";

interface SourceResult {
  state: AuditSourceState;
  alerts: AuditAlert[];
}

/** Au moins une source n'a pas pu être interrogée (GitHub en erreur) : rien n'est enregistré. */
export class AuditFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditFailedError";
  }
}

const MAX_ALERTS_PER_SOURCE = 1000;

async function collectPages<T>(pages: AsyncIterable<{ data: T[] }>): Promise<T[]> {
  const out: T[] = [];
  for await (const page of pages) {
    out.push(...page.data);
    if (out.length >= MAX_ALERTS_PER_SOURCE) break;
  }
  return out.slice(0, MAX_ALERTS_PER_SOURCE);
}

/** « Fonction désactivée » et « droits insuffisants » sont des états normaux ; le reste est une vraie erreur. */
function classify(error: unknown): { state: Exclude<AuditSourceState, "ok"> } | null {
  const e = error as { status?: number; message?: string };
  const message = String(e?.message ?? "");
  if (/rate limit/i.test(message)) return null;
  if ((e?.status === 403 || e?.status === 404) && /not enabled|disabled|must be enabled|no analysis found|advanced security/i.test(message)) {
    return { state: "disabled" };
  }
  if (e?.status === 403) return { state: "no-access" };
  if (e?.status === 404) return { state: "disabled" };
  return null;
}

async function runSource(label: string, fetchAlerts: () => Promise<AuditAlert[]>): Promise<SourceResult> {
  try {
    return { state: "ok", alerts: await fetchAlerts() };
  } catch (error) {
    const known = classify(error);
    if (known) return { state: known.state, alerts: [] };
    throw new AuditFailedError(`${label} : ${describeGithubError(error)}`);
  }
}

// ─── Fetch functions ───────────────────────────────────────────────────────────

const fetchCodeScanningAlerts = (octokit: ReturnType<typeof getOctokit>, owner: string, repo: string) =>
  runSource("Code Scanning", async () => {
    const data = await collectPages(octokit.paginate.iterator(octokit.codeScanning.listAlertsForRepo, { owner, repo, state: "open", per_page: 100 }));
    return data.map((a): AuditAlert => ({
      id: `cs-${a.number}`,
      source: "code_scanning",
      severity: mapCsSeverity(a.rule?.security_severity_level ?? a.rule?.severity),
      title: a.rule?.description ?? a.rule?.id ?? "Code scanning alert",
      description: a.most_recent_instance?.message?.text ?? "",
      state: (a.state as AuditAlert["state"]) ?? "open",
      url: a.html_url ?? "",
      path: a.most_recent_instance?.location?.path,
      createdAt: a.created_at ?? new Date().toISOString(),
    }));
  });

const fetchDependabotAlerts = (octokit: ReturnType<typeof getOctokit>, owner: string, repo: string) =>
  runSource("Dependabot", async () => {
    const data = await collectPages(octokit.paginate.iterator(octokit.dependabot.listAlertsForRepo, { owner, repo, state: "open", per_page: 100 }));
    return data.map((a): AuditAlert => ({
      id: `db-${a.number}`,
      source: "dependabot",
      severity: mapDbSeverity(a.security_advisory?.severity),
      title: a.security_advisory?.summary ?? `Dependabot #${a.number}`,
      description: a.security_advisory?.description ?? "",
      state: (a.state as AuditAlert["state"]) ?? "open",
      url: a.html_url ?? "",
      path: a.dependency?.manifest_path,
      createdAt: a.created_at ?? new Date().toISOString(),
      classification: (a.security_advisory as { classification?: string } | undefined)?.classification,
    }));
  });

const fetchSecretScanningAlerts = (octokit: ReturnType<typeof getOctokit>, owner: string, repo: string) =>
  runSource("Secret Scanning", async () => {
    const data = await collectPages(octokit.paginate.iterator(octokit.secretScanning.listAlertsForRepo, { owner, repo, state: "open", per_page: 100 }));
    return data.map((a): AuditAlert => ({
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
  });

// ─── Main audit function ───────────────────────────────────────────────────────

export async function auditRepo(
  token: string,
  owner: string,
  repo: string
): Promise<{ summary: AuditSummary; alerts: AuditAlert[] }> {
  const octokit = getOctokit(token);

  const [cs, dep, ss] = await Promise.all([
    fetchCodeScanningAlerts(octokit, owner, repo),
    fetchDependabotAlerts(octokit, owner, repo),
    fetchSecretScanningAlerts(octokit, owner, repo),
  ]);
  const csAlerts = cs.alerts;
  const dbAlerts = dep.alerts;
  const ssAlerts = ss.alerts;

  const allAlerts = [...csAlerts, ...dbAlerts, ...ssAlerts]
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

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
  const states = { csState: cs.state, dbState: dep.state, ssState: ss.state };

  await db.repoAudit.upsert({
    where: { owner_repo: { owner, repo } },
    create: {
      owner, repo,
      csTotal, csCritical, csHigh, csMedium, csLow,
      dbTotal, dbCritical, dbHigh, dbMedium, dbLow,
      ssTotal, ssActive,
      alerts: JSON.stringify(allAlerts),
      ...states,
    },
    update: {
      checkedAt: new Date(),
      csTotal, csCritical, csHigh, csMedium, csLow,
      dbTotal, dbCritical, dbHigh, dbMedium, dbLow,
      ssTotal, ssActive,
      alerts: JSON.stringify(allAlerts),
      ...states,
    },
  });

  console.log(`[audit] ${owner}/${repo}: CS=${csTotal}(${cs.state}) DB=${dbTotal}(${dep.state}) SS=${ssTotal}(${ss.state})`);

  const summary: AuditSummary = {
    owner, repo, checkedAt: new Date(),
    csTotal, csCritical, csHigh, csMedium, csLow,
    dbTotal, dbCritical, dbHigh, dbMedium, dbLow,
    ssTotal, ssActive,
    ...states,
  };

  return { summary, alerts: allAlerts };
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
      csState: true, dbState: true, ssState: true,
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

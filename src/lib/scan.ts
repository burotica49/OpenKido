import "server-only";

import { getDependencies } from "./github";
import { scanDependencies, computeRiskScore, riskLevel, topSeverity, type ComponentVuln } from "./osv";
import type { Ecosystem } from "./lockfiles";
import { db } from "./db";
import { licenseKey, lookupLicenses } from "./licenses";

export type ScanStatus = "complete" | "partial";

export interface ScannedComponent {
  name: string;
  version: string;
  ecosystem: Ecosystem;
  source?: string;
  scope?: "prod" | "dev";
  direct?: boolean;
  /** Licence SPDX déclarée ("NONE" = aucune) ; absent = non recherchée ou introuvable. */
  license?: string;
  /** false = version déclarée dans un manifeste (plage), pas une version installée. */
  resolved: boolean;
  /** « non-analysé » : OSV n'a pas pu être interrogé — on ne sait PAS si le composant est vulnérable. */
  status: "vulnerable" | "sain" | "non-analysé";
  topSeverity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  vulnCount: number;
  vulns: ComponentVuln["vulns"];
}

export interface ScanResult {
  owner: string;
  repo: string;
  branch: string;
  scannedAt: string;
  riskScore: number;
  level: "critical" | "warning" | "ok";
  total: number;
  vulnerable: number;
  components: ScannedComponent[];
  severityBreakdown: { CRITICAL: number; HIGH: number; MEDIUM: number; LOW: number };
  status: ScanStatus;
  /** Problèmes rencontrés pendant le scan (vide si `complete`). */
  warnings: string[];
  unscanned: number;
  /** Scan enregistré avant l'ajout du détail des CVE : relancer le scan pour l'afficher. */
  legacy?: boolean;
}

export interface RepoScanSummary {
  owner: string;
  repo: string;
  scannedAt: Date | null;
  total: number;
  vulnerable: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  status: string;
  note: string | null;
}

/** Le scan a échoué : rien n'est enregistré et le dernier bon scan est conservé. */
export class ScanFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScanFailedError";
  }
}

// Retourne le résumé DB pour une liste de repos (pour la page liste)
export async function getRepoScanSummaries(repos: { owner: string; name: string }[]): Promise<Map<string, RepoScanSummary>> {
  const rows = await db.repoScan.findMany({
    where: {
      OR: repos.map((r) => ({ owner: r.owner, repo: r.name })),
    },
    select: {
      owner: true,
      repo: true,
      scannedAt: true,
      total: true,
      vulnerable: true,
      critical: true,
      high: true,
      medium: true,
      low: true,
      status: true,
      note: true,
    },
  });

  const map = new Map<string, RepoScanSummary>();
  for (const row of rows) {
    map.set(`${row.owner}/${row.repo}`, row);
  }
  return map;
}

export interface TrendPoint {
  date: string; // YYYY-MM-DD
  critical: number;
  high: number;
  medium: number;
  low: number;
  vulnerable: number;
}

// Tendance agrégée sur N jours : pour chaque jour, le dernier snapshot connu
// de chaque repo est sommé (report du dernier état si pas de scan ce jour-là).
export async function getScanTrend(
  repos: { owner: string; name: string }[],
  days = 30
): Promise<TrendPoint[]> {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const rows = await db.scanHistory.findMany({
    where: {
      OR: repos.map((r) => ({ owner: r.owner, repo: r.name })),
    },
    orderBy: { scannedAt: "asc" },
    select: {
      owner: true, repo: true, scannedAt: true,
      critical: true, high: true, medium: true, low: true, vulnerable: true,
    },
  });
  if (rows.length === 0) return [];

  // Jours de l'intervalle
  const dayKeys: string[] = [];
  for (let d = new Date(since); d <= new Date(); d.setDate(d.getDate() + 1)) {
    dayKeys.push(d.toISOString().slice(0, 10));
  }

  // Dernier snapshot par repo et par jour
  type Snap = { critical: number; high: number; medium: number; low: number; vulnerable: number };
  const lastPerRepoDay = new Map<string, Map<string, Snap>>();
  for (const r of rows) {
    const repoKey = `${r.owner}/${r.repo}`;
    const dayKey = r.scannedAt.toISOString().slice(0, 10);
    if (!lastPerRepoDay.has(repoKey)) lastPerRepoDay.set(repoKey, new Map());
    lastPerRepoDay.get(repoKey)!.set(dayKey, r);
  }

  const points: TrendPoint[] = [];
  const carried = new Map<string, Snap>(); // dernier état connu par repo

  // Amorce : dernier snapshot antérieur à l'intervalle
  for (const [repoKey, byDay] of lastPerRepoDay) {
    for (const [dayKey, snap] of byDay) {
      if (dayKey < dayKeys[0]) carried.set(repoKey, snap);
    }
  }

  for (const dayKey of dayKeys) {
    for (const [repoKey, byDay] of lastPerRepoDay) {
      const snap = byDay.get(dayKey);
      if (snap) carried.set(repoKey, snap);
    }
    const agg: TrendPoint = { date: dayKey, critical: 0, high: 0, medium: 0, low: 0, vulnerable: 0 };
    for (const snap of carried.values()) {
      agg.critical += snap.critical;
      agg.high += snap.high;
      agg.medium += snap.medium;
      agg.low += snap.low;
      agg.vulnerable += snap.vulnerable;
    }
    points.push(agg);
  }

  // Ne garder que depuis le premier jour avec des données
  const firstIdx = points.findIndex((p) => p.critical + p.high + p.medium + p.low + p.vulnerable > 0);
  return firstIdx === -1 ? [] : points.slice(firstIdx);
}

// Repos à (re)scanner : jamais scannés, scan complet de plus de maxAgeH heures, ou scan partiel de plus d'une heure.
export async function getStaleRepos(
  repos: { owner: string; name: string; branch: string }[],
  maxAgeH = 24
): Promise<{ owner: string; name: string; branch: string }[]> {
  const summaries = await getRepoScanSummaries(repos.map((r) => ({ owner: r.owner, name: r.name })));
  const now = Date.now();
  return repos.filter((r) => {
    const s = summaries.get(`${r.owner}/${r.name}`);
    if (!s?.scannedAt) return true;
    const ageMs = now - new Date(s.scannedAt).getTime();
    return s.status === "complete" ? ageMs > maxAgeH * 3600 * 1000 : ageMs > 3600 * 1000;
  });
}

const STORED_VULN_SUMMARY_MAX = 300;

/**
 * Scanne un dépôt et enregistre le résultat.
 *  - échec (GitHub ou OSV injoignable) → ScanFailedError, rien n'est écrit ;
 *  - partiel → n'écrase jamais un scan complet existant et n'alimente pas l'historique ;
 *  - complet → mise à jour du scan + un point d'historique.
 */
export async function scanRepo(token: string, owner: string, repo: string, branch: string): Promise<ScanResult & { persisted: boolean }> {
  const collected = await getDependencies(token, owner, repo, branch);
  if (collected.status === "failed") {
    throw new ScanFailedError(collected.warnings.join(" ; ") || "lecture du dépôt impossible");
  }
  const outcome = await scanDependencies(collected.deps);
  if (outcome.status === "failed") {
    throw new ScanFailedError(outcome.warnings.join(" ; ") || "analyse OSV impossible");
  }

  const status: ScanStatus = collected.status === "complete" && outcome.status === "complete" ? "complete" : "partial";
  const warnings = [...collected.warnings, ...outcome.warnings];

  // Licences (deps.dev) : un échec ne fait jamais échouer ni dégrader le scan de sécurité.
  const found = await lookupLicenses(outcome.components).catch(() => ({ licenses: new Map<string, string>(), warning: undefined as string | undefined }));

  const components: ScannedComponent[] = outcome.components.map((c) => ({
    name: c.name,
    version: c.version,
    ecosystem: c.ecosystem,
    source: c.source,
    scope: c.scope,
    direct: c.direct,
    license: found.licenses.get(licenseKey(c)),
    resolved: c.resolved,
    status: c.unscanned ? "non-analysé" : c.vulns.length > 0 ? "vulnerable" : "sain",
    topSeverity: topSeverity(c.vulns),
    vulnCount: c.vulns.length,
    vulns: c.vulns,
  }));

  const vulnerable = components.filter((c) => c.status === "vulnerable").length;
  const riskScore = computeRiskScore(outcome.components);
  const breakdown = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const c of components) {
    for (const v of c.vulns) {
      if (v.severity in breakdown) breakdown[v.severity as keyof typeof breakdown]++;
    }
  }

  // Les CVE des composants vulnérables sont conservées : les pages détail lisent la base (aucun rescan à l'affichage).
  const storable = components.map((c) => ({
    name: c.name,
    version: c.version,
    ecosystem: c.ecosystem,
    source: c.source,
    scope: c.scope,
    direct: c.direct,
    ...(c.license ? { license: c.license } : {}),
    resolved: c.resolved,
    status: c.status,
    topSeverity: c.topSeverity,
    vulnCount: c.vulnCount,
    ...(c.vulns.length > 0
      ? { vulns: c.vulns.map((v) => ({ ...v, summary: v.summary.slice(0, STORED_VULN_SUMMARY_MAX) })) }
      : {}),
  }));

  const data = {
    branch,
    total: components.length,
    vulnerable,
    critical: breakdown.CRITICAL,
    high: breakdown.HIGH,
    medium: breakdown.MEDIUM,
    low: breakdown.LOW,
    components: JSON.stringify(storable),
    status,
    note: warnings.length > 0 ? warnings.join(" ; ").slice(0, 1000) : null,
  };

  let persisted = false;
  try {
    const previous = await db.repoScan.findUnique({ where: { owner_repo: { owner, repo } }, select: { status: true } });
    if (status === "partial" && previous?.status === "complete") {
      console.warn(`[scan] ${owner}/${repo}: scan partiel — le dernier scan complet est conservé (${warnings.join(" ; ")})`);
    } else {
      await db.repoScan.upsert({
        where: { owner_repo: { owner, repo } },
        create: { owner, repo, ...data },
        update: { ...data, scannedAt: new Date() },
      });
      persisted = true;
      if (status === "complete") {
        await db.scanHistory.create({
          data: { owner, repo, total: data.total, vulnerable, critical: data.critical, high: data.high, medium: data.medium, low: data.low },
        });
      }
    }
    console.log(
      `[scan] ${owner}/${repo}: ${status} — ${components.length} deps (${outcome.unscanned} non analysées), ${vulnerable} vuln (C:${breakdown.CRITICAL} H:${breakdown.HIGH} M:${breakdown.MEDIUM} L:${breakdown.LOW})${persisted ? "" : " [non enregistré]"}`
    );
  } catch (err) {
    console.error(`[scan] écriture en base ÉCHOUÉE — ${owner}/${repo}:`, err);
    throw err;
  }

  return {
    owner,
    repo,
    branch,
    scannedAt: new Date().toISOString(),
    riskScore,
    level: riskLevel(riskScore),
    total: components.length,
    vulnerable,
    components,
    severityBreakdown: breakdown,
    status,
    warnings,
    unscanned: outcome.unscanned,
    persisted,
  };
}

/** Dernier scan enregistré (aucun appel réseau) ; null si le dépôt n'a jamais été scanné. */
export async function getStoredScan(owner: string, repo: string): Promise<ScanResult | null> {
  const row = await db.repoScan.findUnique({ where: { owner_repo: { owner, repo } } });
  if (!row) return null;

  let parsed: Partial<ScannedComponent>[] = [];
  try {
    parsed = JSON.parse(row.components) as Partial<ScannedComponent>[];
  } catch {
    parsed = [];
  }
  const components: ScannedComponent[] = parsed.map((c) => ({
    name: String(c.name ?? ""),
    version: String(c.version ?? ""),
    ecosystem: (c.ecosystem ?? "npm") as Ecosystem,
    source: c.source,
    scope: c.scope,
    direct: c.direct,
    license: typeof c.license === "string" ? c.license : undefined,
    resolved: c.resolved ?? true,
    status: c.status === "non-analysé" ? "non-analysé" : (c.vulnCount ?? 0) > 0 ? "vulnerable" : "sain",
    topSeverity: c.topSeverity ?? "UNKNOWN",
    vulnCount: c.vulnCount ?? 0,
    vulns: c.vulns ?? [],
  }));
  const legacy = components.some((c) => c.status === "vulnerable" && c.vulns.length === 0);
  const riskScore = computeRiskScore(components.map((c) => ({ ...c, vulns: c.vulns })) as unknown as ComponentVuln[]);

  return {
    owner: row.owner,
    repo: row.repo,
    branch: row.branch,
    scannedAt: row.scannedAt.toISOString(),
    riskScore,
    level: riskLevel(riskScore),
    total: row.total,
    vulnerable: row.vulnerable,
    components,
    severityBreakdown: { CRITICAL: row.critical, HIGH: row.high, MEDIUM: row.medium, LOW: row.low },
    status: row.status === "partial" ? "partial" : "complete",
    warnings: row.note ? row.note.split(" ; ") : [],
    unscanned: components.filter((c) => c.status === "non-analysé").length,
    legacy,
  };
}

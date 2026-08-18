"use server";

import { getDependencies } from "./github";
import { scanDependencies, computeRiskScore, riskLevel, topSeverity, type ComponentVuln } from "./osv";
import { db } from "./db";

export interface ScannedComponent {
  name: string;
  version: string;
  ecosystem: string;
  source?: string;
  status: "vulnerable" | "sain";
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

// Repos dont le dernier scan date de plus de maxAgeH heures (ou jamais scannés)
export async function getStaleRepos(
  repos: { owner: string; name: string; branch: string }[],
  maxAgeH = 24
): Promise<{ owner: string; name: string; branch: string }[]> {
  const summaries = await getRepoScanSummaries(repos.map((r) => ({ owner: r.owner, name: r.name })));
  const cutoff = Date.now() - maxAgeH * 3600 * 1000;
  return repos.filter((r) => {
    const s = summaries.get(`${r.owner}/${r.name}`);
    return !s?.scannedAt || new Date(s.scannedAt).getTime() < cutoff;
  });
}

// Lance un scan complet, sauvegarde en DB et retourne le ScanResult
export async function scanRepo(
  token: string,
  owner: string,
  repo: string,
  branch: string
): Promise<ScanResult> {
  const deps = await getDependencies(token, owner, repo, branch);
  const scanned = await scanDependencies(deps);

  const components: ScannedComponent[] = scanned.map((c, i) => ({
    name: c.name,
    version: c.version,
    ecosystem: c.ecosystem,
    source: deps[i]?.source,
    status: c.vulns.length > 0 ? "vulnerable" : "sain",
    topSeverity: topSeverity(c.vulns),
    vulnCount: c.vulns.length,
    vulns: c.vulns,
  }));

  const vulnerable = components.filter((c) => c.status === "vulnerable").length;
  const riskScore = computeRiskScore(scanned);
  const breakdown = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const c of components) {
    for (const v of c.vulns) {
      if (v.severity in breakdown) breakdown[v.severity as keyof typeof breakdown]++;
    }
  }

  // Persist en DB (upsert par owner+repo)
  const storable = components.map((c) => ({
    name: c.name,
    version: c.version,
    ecosystem: c.ecosystem,
    source: c.source,
    status: c.status,
    topSeverity: c.topSeverity,
    vulnCount: c.vulnCount,
  }));

  try {
    await db.repoScan.upsert({
      where: { owner_repo: { owner, repo } },
      create: {
        owner,
        repo,
        branch,
        total: components.length,
        vulnerable,
        critical: breakdown.CRITICAL,
        high: breakdown.HIGH,
        medium: breakdown.MEDIUM,
        low: breakdown.LOW,
        components: JSON.stringify(storable),
      },
      update: {
        branch,
        scannedAt: new Date(),
        total: components.length,
        vulnerable,
        critical: breakdown.CRITICAL,
        high: breakdown.HIGH,
        medium: breakdown.MEDIUM,
        low: breakdown.LOW,
        components: JSON.stringify(storable),
      },
    });
    // Historique : un snapshot par scan (jamais écrasé)
    await db.scanHistory.create({
      data: {
        owner,
        repo,
        total: components.length,
        vulnerable,
        critical: breakdown.CRITICAL,
        high: breakdown.HIGH,
        medium: breakdown.MEDIUM,
        low: breakdown.LOW,
      },
    });

    console.log(`[scan] ${owner}/${repo}: ${components.length} deps, ${vulnerable} vuln (C:${breakdown.CRITICAL} H:${breakdown.HIGH} M:${breakdown.MEDIUM} L:${breakdown.LOW})`);
  } catch (err) {
    console.error(`[scan] upsert FAILED — ${owner}/${repo}:`, err);
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
  };
}

// Déclenche un scan depuis un bouton client (server action)
export async function triggerScan(
  token: string,
  owner: string,
  repo: string,
  branch: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await scanRepo(token, owner, repo, branch);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// Scanne tous les repos fournis en parallèle (max 5 simultanés)
export async function scanAllRepos(
  token: string,
  repos: { owner: string; name: string; branch: string }[]
): Promise<{ total: number; done: number; failed: number }> {
  const CONCURRENCY = 5;
  let done = 0;
  let failed = 0;

  for (let i = 0; i < repos.length; i += CONCURRENCY) {
    const batch = repos.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((r) => scanRepo(token, r.owner, r.name, r.branch))
    );
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled") {
        done++;
      } else {
        console.error(`[scan] scanAllRepos failed for ${batch[j].owner}/${batch[j].name}:`, r.reason);
        failed++;
      }
    }
  }

  return { total: repos.length, done, failed };
}

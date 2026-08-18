import type { ParsedDependencies } from "./github";

export interface OsvVuln {
  id: string;
  summary?: string;
  severity?: { type: string; score: string }[];
  database_specific?: { severity?: string; cvss?: { score?: number } };
  affected?: {
    package: { name: string; ecosystem: string };
    ranges?: { type: string; events: { fixed?: string }[] }[];
    ecosystem_specific?: { severity?: string };
  }[];
}

export interface ComponentVuln {
  name: string;
  version: string;
  ecosystem: string;
  vulns: {
    id: string;
    summary: string;
    severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
    cvssScore: number | null;
    fixedVersion: string | null;
  }[];
}

const ECOSYSTEM_MAP: Record<string, string> = {
  npm: "npm",
  pip: "PyPI",
  maven: "Maven",
  cargo: "crates.io",
};

const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"] as const;

// Calcule le score numérique CVSS v3 depuis un vecteur
// ex: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" → 9.8
function parseCvssV3Vector(vector: string): number | null {
  const match = vector.match(/CVSS:3\.\d\/(.+)/);
  if (!match) return null;
  const parts = Object.fromEntries(match[1].split("/").map((p) => p.split(":")));

  const AV: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
  const AC: Record<string, number> = { L: 0.77, H: 0.44 };
  const UI: Record<string, number> = { N: 0.85, R: 0.62 };
  const CIA: Record<string, number> = { N: 0, L: 0.22, H: 0.56 };
  const PR_U: Record<string, number> = { N: 0.85, L: 0.62, H: 0.27 };
  const PR_C: Record<string, number> = { N: 0.85, L: 0.68, H: 0.5 };

  const av = AV[parts.AV];
  const ac = AC[parts.AC];
  const pr = parts.S === "C" ? PR_C[parts.PR] : PR_U[parts.PR];
  const ui = UI[parts.UI];
  const c  = CIA[parts.C];
  const i  = CIA[parts.I];
  const a  = CIA[parts.A];

  if ([av, ac, pr, ui, c, i, a].some((v) => v === undefined)) return null;

  const iscBase = 1 - (1 - c) * (1 - i) * (1 - a);
  const isc = parts.S === "C"
    ? 7.52 * (iscBase - 0.029) - 3.25 * Math.pow(iscBase - 0.02, 15)
    : 6.42 * iscBase;

  if (isc <= 0) return 0;

  const exploitability = 8.22 * av * ac * pr * ui;
  const raw = parts.S === "C"
    ? Math.min(1.08 * (isc + exploitability), 10)
    : Math.min(isc + exploitability, 10);

  // Roundup to 1 decimal
  return Math.ceil(raw * 10) / 10;
}

function scoreToLevel(score: number): ComponentVuln["vulns"][0]["severity"] {
  if (score >= 9.0) return "CRITICAL";
  if (score >= 7.0) return "HIGH";
  if (score >= 4.0) return "MEDIUM";
  if (score > 0)    return "LOW";
  return "UNKNOWN";
}

function parseSeverity(vuln: OsvVuln): { level: ComponentVuln["vulns"][0]["severity"]; score: number | null } {
  // 1. database_specific.severity (GitHub Advisory DB: "CRITICAL", "HIGH", "MODERATE", "LOW")
  const dbSev = vuln.database_specific?.severity?.toUpperCase();
  if (dbSev) {
    const map: Record<string, ComponentVuln["vulns"][0]["severity"]> = {
      CRITICAL: "CRITICAL", HIGH: "HIGH", MODERATE: "MEDIUM", MEDIUM: "MEDIUM", LOW: "LOW",
    };
    const level = map[dbSev];
    if (level) return { level, score: vuln.database_specific?.cvss?.score ?? null };
  }

  // 2. Champ severity[] avec vecteur CVSS
  const cvssEntry = vuln.severity?.find((s) => s.type.startsWith("CVSS"));
  if (cvssEntry?.score) {
    // Essai parse numérique direct (certaines sources)
    const direct = parseFloat(cvssEntry.score);
    if (!isNaN(direct) && direct <= 10) {
      return { level: scoreToLevel(direct), score: direct };
    }
    // Parse vecteur CVSS v3
    const computed = parseCvssV3Vector(cvssEntry.score);
    if (computed !== null) {
      return { level: scoreToLevel(computed), score: computed };
    }
  }

  // 3. ecosystem_specific.severity dans affected
  for (const aff of vuln.affected ?? []) {
    const esSev = aff.ecosystem_specific?.severity?.toUpperCase();
    if (esSev) {
      const map: Record<string, ComponentVuln["vulns"][0]["severity"]> = {
        CRITICAL: "CRITICAL", HIGH: "HIGH", MODERATE: "MEDIUM", MEDIUM: "MEDIUM", LOW: "LOW",
      };
      const level = map[esSev];
      if (level) return { level, score: null };
    }
  }

  return { level: "UNKNOWN", score: null };
}

function getFixedVersion(vuln: OsvVuln, pkgName: string): string | null {
  for (const aff of vuln.affected ?? []) {
    if (aff.package.name.toLowerCase() !== pkgName.toLowerCase()) continue;
    for (const range of aff.ranges ?? []) {
      for (const event of range.events) {
        if (event.fixed) return event.fixed;
      }
    }
  }
  return null;
}

async function fetchVulnDetails(ids: string[]): Promise<Map<string, OsvVuln>> {
  const map = new Map<string, OsvVuln>();
  if (ids.length === 0) return map;

  const CONCURRENCY = 20;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((id) =>
        fetch(`https://api.osv.dev/v1/vulns/${id}`, { cache: "no-store" })
          .then((r) => r.ok ? r.json() as Promise<OsvVuln> : null)
          .catch(() => null)
      )
    );
    for (let j = 0; j < batch.length; j++) {
      const r = results[j];
      if (r.status === "fulfilled" && r.value) {
        map.set(batch[j], r.value);
      }
    }
  }
  return map;
}

export async function scanDependencies(deps: ParsedDependencies[]): Promise<ComponentVuln[]> {
  if (deps.length === 0) return [];

  const BATCH_SIZE = 50;
  const allResults: ComponentVuln[] = [];

  for (let i = 0; i < deps.length; i += BATCH_SIZE) {
    const batch = deps.slice(i, i + BATCH_SIZE);
    const queries = batch.map((d) => ({
      version: d.version,
      package: { name: d.name, ecosystem: ECOSYSTEM_MAP[d.ecosystem] ?? d.ecosystem },
    }));

    let data: { results: { vulns?: OsvVuln[] }[] } | null = null;
    try {
      const res = await fetch("https://api.osv.dev/v1/querybatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries }),
        cache: "no-store",
      });
      if (res.ok) data = await res.json();
    } catch {}

    // querybatch retourne des objets compacts {id, modified}.
    // On récupère les détails complets pour chaque vuln unique via /v1/vulns/{id}.
    const allIds = new Set<string>();
    for (const result of data?.results ?? []) {
      for (const v of result.vulns ?? []) {
        if (v.id) allIds.add(v.id);
      }
    }
    const detailsMap = await fetchVulnDetails([...allIds]);

    for (let j = 0; j < batch.length; j++) {
      const dep = batch[j];
      const compactVulns = data?.results[j]?.vulns ?? [];
      const osvVulns: OsvVuln[] = compactVulns
        .map((v: { id: string }) => detailsMap.get(v.id))
        .filter((v): v is OsvVuln => v !== undefined);

      allResults.push({
        name: dep.name,
        version: dep.version,
        ecosystem: dep.ecosystem,
        vulns: osvVulns.map((v) => {
          const { level, score } = parseSeverity(v);
          return {
            id: v.id,
            summary: v.summary ?? "No description",
            severity: level,
            cvssScore: score,
            fixedVersion: getFixedVersion(v, dep.name),
          };
        }),
      });
    }
  }

  return allResults;
}

export function computeRiskScore(components: ComponentVuln[]): number {
  const weights = { CRITICAL: 40, HIGH: 20, MEDIUM: 8, LOW: 2, UNKNOWN: 1 };
  let score = 0;
  for (const c of components) {
    for (const v of c.vulns) {
      score += weights[v.severity] ?? 1;
    }
  }
  return Math.min(100, Math.round(score));
}

export function riskLevel(score: number): "critical" | "warning" | "ok" {
  if (score >= 30) return "critical";
  if (score >= 10) return "warning";
  return "ok";
}

export function topSeverity(vulns: ComponentVuln["vulns"]): ComponentVuln["vulns"][0]["severity"] {
  for (const level of SEVERITY_ORDER) {
    if (vulns.some((v) => v.severity === level)) return level;
  }
  return "UNKNOWN";
}

import "server-only";
import type { Ecosystem, ParsedDependencies } from "./lockfiles";

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

export type VulnSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export interface ComponentVuln {
  name: string;
  version: string;
  ecosystem: Ecosystem;
  source?: string;
  scope?: "prod" | "dev";
  direct?: boolean;
  /** true = version exacte (lockfile) ; false = borne d'une plage déclarée. */
  resolved: boolean;
  /** true = l'interrogation d'OSV a échoué : on ne sait PAS si ce composant est vulnérable. */
  unscanned?: boolean;
  vulns: {
    id: string;
    summary: string;
    severity: VulnSeverity;
    cvssScore: number | null;
    fixedVersion: string | null;
  }[];
}

export interface ScanOutcome {
  components: ComponentVuln[];
  /** Nombre de composants non analysés (échec OSV). */
  unscanned: number;
  status: "complete" | "partial" | "failed";
  warnings: string[];
}

const OSV_ECOSYSTEM: Record<Ecosystem, string> = {
  npm: "npm",
  pip: "PyPI",
  go: "Go",
  cargo: "crates.io",
  composer: "Packagist",
  gem: "RubyGems",
  maven: "Maven",
  nuget: "NuGet",
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
      // Les plages de type GIT donnent un hash de commit, pas une version installable.
      if (range.type === "GIT") continue;
      for (const event of range.events) {
        if (event.fixed) return event.fixed;
      }
    }
  }
  return null;
}

// ─── Appels OSV : tentatives, cache, pagination ───────────────────────────────

const QUERY_BATCH_SIZE = 500;
const DETAILS_CONCURRENCY = 20;
const MAX_ATTEMPTS = 3;
const retryBaseMs = () => Number(process.env.OSV_RETRY_BASE_MS ?? 500);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch avec nouvelles tentatives sur erreur réseau, 429 et 5xx. Les autres statuts sont rendus tels quels. */
async function osvFetch(url: string, init?: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (res.status !== 429 && res.status < 500) return res;
      lastError = new Error(`OSV HTTP ${res.status}`);
      const retryAfter = Number(res.headers.get("retry-after"));
      if (attempt < MAX_ATTEMPTS - 1) await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : retryBaseMs() * 2 ** attempt);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS - 1) await sleep(retryBaseMs() * 2 ** attempt);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("OSV injoignable");
}

// Les fiches de vulnérabilité changent rarement : cache mémoire de 6 h (les mêmes avis reviennent d'un dépôt à l'autre).
const DETAILS_TTL_MS = 6 * 3600 * 1000;
const DETAILS_CACHE_MAX = 5000;
const detailsCache = new Map<string, { at: number; vuln: OsvVuln }>();

async function fetchVulnDetails(ids: string[]): Promise<{ details: Map<string, OsvVuln>; missing: string[] }> {
  const details = new Map<string, OsvVuln>();
  const missing: string[] = [];
  const toFetch: string[] = [];
  const now = Date.now();
  for (const id of ids) {
    const cached = detailsCache.get(id);
    if (cached && now - cached.at < DETAILS_TTL_MS) details.set(id, cached.vuln);
    else toFetch.push(id);
  }

  for (let i = 0; i < toFetch.length; i += DETAILS_CONCURRENCY) {
    const batch = toFetch.slice(i, i + DETAILS_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (id) => {
        try {
          const res = await osvFetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`);
          return res.ok ? ((await res.json()) as OsvVuln) : null;
        } catch {
          return null;
        }
      })
    );
    results.forEach((vuln, j) => {
      if (!vuln) {
        missing.push(batch[j]);
        return;
      }
      details.set(batch[j], vuln);
      if (detailsCache.size >= DETAILS_CACHE_MAX) detailsCache.delete(detailsCache.keys().next().value as string);
      detailsCache.set(batch[j], { at: Date.now(), vuln });
    });
  }
  return { details, missing };
}

interface OsvQuery {
  version: string;
  package: { name: string; ecosystem: string };
}
type QueryResult = { ids: string[] } | { error: string };

/** Interroge un lot ; sur erreur client (4xx) le lot est coupé en deux pour isoler l'entrée fautive. */
async function queryChunk(queries: OsvQuery[]): Promise<QueryResult[]> {
  let res: Response;
  try {
    res = await osvFetch("https://api.osv.dev/v1/querybatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OSV injoignable";
    return queries.map(() => ({ error: message }));
  }

  if (!res.ok) {
    if (res.status >= 400 && res.status < 500 && queries.length > 1) {
      const mid = Math.ceil(queries.length / 2);
      const [left, right] = await Promise.all([queryChunk(queries.slice(0, mid)), queryChunk(queries.slice(mid))]);
      return [...left, ...right];
    }
    return queries.map(() => ({ error: `OSV HTTP ${res.status}` }));
  }

  const data = (await res.json()) as { results?: { vulns?: { id: string }[]; next_page_token?: string }[] };
  const results = data.results ?? [];
  const out: QueryResult[] = [];
  for (let i = 0; i < queries.length; i++) {
    const r = results[i];
    if (!r) {
      out.push({ error: "réponse OSV incomplète" });
      continue;
    }
    const ids = (r.vulns ?? []).map((v) => v.id);
    let token = r.next_page_token;
    let failed: string | null = null;
    // Pagination des composants très exposés (plus de 1 000 avis).
    for (let page = 0; token && page < 10; page++) {
      try {
        const next = await osvFetch("https://api.osv.dev/v1/query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...queries[i], page_token: token }),
        });
        if (!next.ok) {
          failed = `OSV HTTP ${next.status}`;
          break;
        }
        const body = (await next.json()) as { vulns?: { id: string }[]; next_page_token?: string };
        ids.push(...(body.vulns ?? []).map((v) => v.id));
        token = body.next_page_token;
      } catch (error) {
        failed = error instanceof Error ? error.message : "OSV injoignable";
        break;
      }
    }
    out.push(failed ? { error: failed } : { ids });
  }
  return out;
}

// ─── Analyse ──────────────────────────────────────────────────────────────────

/**
 * Analyse des dépendances. Un échec d'interrogation d'OSV n'est JAMAIS présenté comme « sain » :
 * le composant est marqué `unscanned` et le statut global devient `partial` ou `failed`.
 */
export async function scanDependencies(deps: ParsedDependencies[]): Promise<ScanOutcome> {
  const warnings: string[] = [];
  const keyOf = (d: ParsedDependencies) => `${d.ecosystem}:${d.name}@${d.version}`;
  const valid = (d: ParsedDependencies) => !!d.name && !!d.version && d.name.length < 300 && d.version.length < 100;

  const unique = new Map<string, ParsedDependencies>();
  for (const d of deps) if (valid(d)) unique.set(keyOf(d), d);
  const keys = [...unique.keys()];

  const idsByKey = new Map<string, string[]>();
  const failedKeys = new Set<string>();
  const failureReasons = new Set<string>();

  for (let i = 0; i < keys.length; i += QUERY_BATCH_SIZE) {
    const chunk = keys.slice(i, i + QUERY_BATCH_SIZE);
    const results = await queryChunk(
      chunk.map((k) => {
        const d = unique.get(k)!;
        return { version: d.version, package: { name: d.name, ecosystem: OSV_ECOSYSTEM[d.ecosystem] ?? d.ecosystem } };
      })
    );
    results.forEach((r, j) => {
      if ("ids" in r) idsByKey.set(chunk[j], r.ids);
      else {
        failedKeys.add(chunk[j]);
        failureReasons.add(r.error);
      }
    });
  }

  const allIds = [...new Set([...idsByKey.values()].flat())];
  const { details, missing } = await fetchVulnDetails(allIds);
  const missingSet = new Set(missing);

  const components: ComponentVuln[] = deps.map((dep) => {
    const key = keyOf(dep);
    const base = {
      name: dep.name,
      version: dep.version,
      ecosystem: dep.ecosystem,
      source: dep.source,
      scope: dep.scope,
      direct: dep.direct,
      resolved: dep.resolved,
    };
    if (!valid(dep) || failedKeys.has(key) || !idsByKey.has(key)) {
      return { ...base, unscanned: true, vulns: [] };
    }
    const vulns = (idsByKey.get(key) ?? []).map((id) => {
      const v = details.get(id);
      if (!v) {
        // L'avis existe mais sa fiche est indisponible : on le compte quand même (jamais de faux « sain »).
        return { id, summary: "Détails indisponibles (OSV)", severity: "UNKNOWN" as const, cvssScore: null, fixedVersion: null };
      }
      const { level, score } = parseSeverity(v);
      return { id: v.id, summary: v.summary ?? "No description", severity: level, cvssScore: score, fixedVersion: getFixedVersion(v, dep.name) };
    });
    return { ...base, vulns };
  });

  const unscanned = components.filter((c) => c.unscanned).length;
  if (unscanned > 0) {
    warnings.push(`${unscanned} composant(s) non analysé(s) — ${[...failureReasons].slice(0, 2).join(" ; ") || "entrée invalide"}`);
  }
  if (missingSet.size > 0) warnings.push(`${missingSet.size} fiche(s) de vulnérabilité indisponible(s) (comptées sans détail)`);

  const status: ScanOutcome["status"] =
    keys.length > 0 && failedKeys.size === keys.length
      ? "failed"
      : failedKeys.size > 0 || missingSet.size > 0
        ? "partial"
        : "complete";

  return { components, unscanned, status, warnings };
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

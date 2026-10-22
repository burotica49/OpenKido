import "server-only";
import { db } from "./db";

// Licences déclarées par version de paquet, via deps.dev (API publique de Google, sans clé).
// Les licences d'une version publiée ne changent pas : le résultat est mis en cache en base.

const DEPS_DEV = "https://api.deps.dev/v3alpha/versionbatch";
const SYSTEMS: Record<string, string> = { npm: "NPM", pip: "PYPI", go: "GO", cargo: "CARGO", gem: "RUBYGEMS", maven: "MAVEN", nuget: "NUGET" };
const REQUESTS_PER_CALL = 500;
const CONCURRENCY = 3;
const TIME_BUDGET_MS = 60_000;
const DB_CHUNK = 300;

export interface LicenseTarget {
  ecosystem: string;
  name: string;
  version: string;
  scope?: "prod" | "dev";
  /** Version exacte (lockfile) : une plage déclarée n'a pas de licence propre. */
  resolved: boolean;
}

export const licenseKey = (t: { ecosystem: string; name: string; version: string }) => `${t.ecosystem}\u0000${t.name}\u0000${t.version}`;

function depsDevVersion(ecosystem: string, version: string): string {
  return ecosystem === "go" && !version.startsWith("v") ? `v${version}` : version;
}

interface BatchResponse {
  responses?: { request?: { versionKey?: { system?: string; name?: string; version?: string } }; version?: { licenses?: string[] } }[];
  nextPageToken?: string;
}

async function fetchChunk(chunk: LicenseTarget[], deadline: number): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  // deps.dev répond par pages de 100 : on suit le jeton de page.
  const requests = chunk.map((t) => ({ versionKey: { system: SYSTEMS[t.ecosystem], name: t.name, version: depsDevVersion(t.ecosystem, t.version) } }));
  const byRequest = new Map(chunk.map((t) => [`${SYSTEMS[t.ecosystem]}\u0000${t.name}\u0000${depsDevVersion(t.ecosystem, t.version)}`, t]));
  let pageToken: string | undefined;
  do {
    if (Date.now() > deadline) break;
    const res = await fetch(DEPS_DEV, {
      method: "POST",
      headers: { "content-type": "application/json", "User-Agent": "openkido" },
      body: JSON.stringify({ requests, ...(pageToken ? { pageToken } : {}) }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) throw new Error(`deps.dev HTTP ${res.status}`);
    const data = (await res.json()) as BatchResponse;
    for (const r of data.responses ?? []) {
      const vk = r.request?.versionKey;
      if (!vk || !r.version) continue; // paquet inconnu de deps.dev : licence inconnue
      const target = byRequest.get(`${vk.system ?? ""}\u0000${vk.name}\u0000${vk.version}`);
      if (!target) continue;
      const licenses = (r.version.licenses ?? []).filter(Boolean);
      found.set(licenseKey(target), licenses.length === 0 ? "NONE" : licenses.join(" AND "));
    }
    pageToken = data.nextPageToken || undefined;
  } while (pageToken);
  return found;
}

/**
 * Licences des dépendances de production (versions exactes). Les paquets introuvables ou en cas d'erreur
 * restent absents du résultat : « licence inconnue », jamais « aucune licence ». Ne lève jamais d'exception.
 */
export async function lookupLicenses(components: LicenseTarget[]): Promise<{ licenses: Map<string, string>; warning?: string }> {
  const licenses = new Map<string, string>();
  const seen = new Set<string>();
  const wanted = components.filter((c) => {
    if (!c.resolved || c.scope === "dev" || !SYSTEMS[c.ecosystem] || !c.name || !c.version) return false;
    const k = licenseKey(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (wanted.length === 0) return { licenses };

  try {
    // 1. Cache
    for (let i = 0; i < wanted.length; i += DB_CHUNK) {
      const rows = await db.packageLicense.findMany({
        where: { OR: wanted.slice(i, i + DB_CHUNK).map((c) => ({ ecosystem: c.ecosystem, name: c.name, version: c.version })) },
      });
      for (const r of rows) licenses.set(licenseKey(r), r.license);
    }
  } catch (e) {
    console.error("[licenses] cache illisible :", e);
  }

  // 2. deps.dev pour les absents
  const missing = wanted.filter((c) => !licenses.has(licenseKey(c)));
  if (missing.length === 0) return { licenses };
  const deadline = Date.now() + TIME_BUDGET_MS;
  const chunks: LicenseTarget[][] = [];
  for (let i = 0; i < missing.length; i += REQUESTS_PER_CALL) chunks.push(missing.slice(i, i + REQUESTS_PER_CALL));

  const fresh = new Map<string, string>();
  let failed = false;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, async () => {
      while (next < chunks.length && Date.now() < deadline) {
        const chunk = chunks[next++];
        try {
          for (const [k, v] of await fetchChunk(chunk, deadline)) fresh.set(k, v);
        } catch (e) {
          failed = true;
          console.error("[licenses] deps.dev :", e instanceof Error ? e.message : e);
        }
      }
    })
  );

  for (const [k, v] of fresh) licenses.set(k, v);
  if (fresh.size > 0) {
    try {
      const byKey = new Map(missing.map((c) => [licenseKey(c), c]));
      await db.packageLicense.createMany({
        data: [...fresh].flatMap(([k, license]) => {
          const c = byKey.get(k);
          return c ? [{ ecosystem: c.ecosystem, name: c.name, version: c.version, license }] : [];
        }),
      });
    } catch (e) {
      console.error("[licenses] écriture du cache impossible :", e);
    }
  }
  const unresolved = missing.length - fresh.size;
  return {
    licenses,
    warning: failed || Date.now() >= deadline ? `Licences : ${unresolved} paquet(s) non résolus (deps.dev indisponible ou délai dépassé).` : undefined,
  };
}

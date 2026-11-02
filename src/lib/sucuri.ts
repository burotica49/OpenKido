import "server-only";
import { db } from "./db";
import { normalizeSitecheck, type SitecheckResult } from "./sucuri-core";

const ENDPOINT = "https://sitecheck.sucuri.net/api/v3/";
const MAX_RESPONSE_BYTES = 512 * 1024;

export class SitecheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SitecheckError";
  }
}

/**
 * Interroge Sucuri SiteCheck pour un nom de domaine DÉJÀ validé (public, non résolu vers une adresse privée).
 * Sucuri analyse alors le site depuis ses propres serveurs : seul le nom de domaine leur est transmis.
 */
export async function fetchSitecheck(hostname: string): Promise<SitecheckResult> {
  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}?${new URLSearchParams({ scan: hostname })}`, {
      headers: { Accept: "application/json", "User-Agent": "openkido" },
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    throw new SitecheckError(`Sucuri injoignable (${e instanceof Error ? e.message : "réseau"})`);
  }
  if (res.status === 429) throw new SitecheckError("Sucuri limite le nombre d'analyses : réessayez dans quelques minutes");
  if (!res.ok) throw new SitecheckError(`Sucuri a répondu HTTP ${res.status}`);

  const text = await res.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new SitecheckError("Réponse de Sucuri trop volumineuse");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new SitecheckError("Réponse de Sucuri illisible");
  }
  const result = normalizeSitecheck(json);
  if (!result) throw new SitecheckError("Sucuri n'a renvoyé aucun résultat exploitable pour ce domaine");
  return result;
}

/** Analyse puis enregistre ; un échec ne remplace jamais le dernier résultat. */
export async function analyzeAndStoreSitecheck(hostname: string): Promise<SitecheckResult> {
  const result = await fetchSitecheck(hostname);
  await db.domain.update({ where: { domain: hostname }, data: { sucuri: JSON.stringify(result), sucuriAt: new Date() } });
  return result;
}

export function parseStoredSitecheck(raw: string | null | undefined): SitecheckResult | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SitecheckResult;
  } catch {
    return null;
  }
}

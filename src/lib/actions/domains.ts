"use server";

import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { checkDomain } from "@/lib/domain-check";
import { analyzeAndStoreSitecheck, SitecheckError } from "@/lib/sucuri";
import { UnsafeTargetError, normalizeHostname, resolvePublicTarget } from "@/lib/net-guard";

export type DomainActionResult = { ok: true } | { ok: false; error: string };

function toError(error: unknown): DomainActionResult {
  if (error instanceof UnsafeTargetError) return { ok: false, error: error.message };
  const code = (error as { code?: string })?.code;
  if (code === "ENOTFOUND" || code === "ENODATA") return { ok: false, error: "Domaine introuvable (DNS)" };
  console.error("[domains]", error);
  return { ok: false, error: "Vérification impossible" };
}

export async function addDomain(domain: string): Promise<DomainActionResult> {
  await requireSession();
  try {
    // Validation et résolution AVANT toute écriture : un domaine refusé ne laisse aucune trace.
    const hostname = normalizeHostname(domain);
    await resolvePublicTarget(hostname);
    await db.domain.upsert({ where: { domain: hostname }, create: { domain: hostname }, update: {} });
    await checkDomain(hostname);
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

export async function recheckDomain(domain: string): Promise<DomainActionResult> {
  await requireSession();
  try {
    await checkDomain(normalizeHostname(domain));
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

/** Analyse approfondie par Sucuri SiteCheck (service tiers) — lancée à la demande uniquement. */
export async function analyzeDomainSucuri(domain: string): Promise<DomainActionResult> {
  await requireSession();
  try {
    const hostname = normalizeHostname(domain);
    await resolvePublicTarget(hostname);
    const known = await db.domain.findUnique({ where: { domain: hostname }, select: { id: true } });
    if (!known) return { ok: false, error: "Domaine inconnu : ajoutez-le d'abord" };
    await analyzeAndStoreSitecheck(hostname);
    return { ok: true };
  } catch (error) {
    if (error instanceof SitecheckError) return { ok: false, error: error.message };
    return toError(error);
  }
}

export async function deleteDomain(domain: string): Promise<DomainActionResult> {
  await requireSession();
  try {
    await db.domain.delete({ where: { domain: normalizeHostname(domain) } }).catch(() => {});
    return { ok: true };
  } catch (error) {
    return toError(error);
  }
}

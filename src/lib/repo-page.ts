import "server-only";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getRepoAccess } from "@/lib/github";
import { getStoredScan, type ScanResult } from "@/lib/scan";
import { isValidRepoRef } from "@/lib/validate";

/** Session + accès au dépôt vérifiés (redirige ou renvoie 404 sinon). */
export async function requireRepoAccess(owner: string, repoName: string): Promise<{ token: string }> {
  const session = await auth();
  if (!session?.accessToken) redirect("/");
  if (!isValidRepoRef(owner, repoName)) notFound();
  const access = await getRepoAccess(session.accessToken, owner, repoName);
  if (!access) notFound();
  return { token: session.accessToken };
}

/**
 * Charge le dernier scan enregistré d'un dépôt pour les pages détail : session et accès au dépôt
 * vérifiés, puis lecture de la base. Aucun scan, aucune écriture (une page ne doit pas avoir d'effet de bord).
 */
export async function loadRepoScan(owner: string, repoName: string): Promise<{ scan: ScanResult | null }> {
  await requireRepoAccess(owner, repoName);
  return { scan: await getStoredScan(owner, repoName) };
}

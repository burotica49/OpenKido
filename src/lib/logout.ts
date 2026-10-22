"use server";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { revokeGithubGrant } from "@/lib/github";

/** Application desktop : une seule personne utilise la base locale, on la vide à la déconnexion. */
async function clearAllLocalData(): Promise<void> {
  await Promise.all([
    db.userPref.deleteMany(),
    db.repoScan.deleteMany(),
    db.repoQuality.deleteMany(),
    db.scanHistory.deleteMany(),
    db.repoAudit.deleteMany(),
    db.domain.deleteMany(),
  ]);
}

/**
 * Révoque le jeton GitHub de la session courante. Sans session valide, ne fait rien
 * (cette action est joignable par POST direct : elle ne doit jamais effacer de données
 * pour un appelant non authentifié).
 */
export async function revokeGithubSession(): Promise<void> {
  const session = await auth();
  if (!session?.accessToken) return;

  await revokeGithubGrant(session.accessToken);

  try {
    if (process.env.OPENKIDO_DESKTOP === "1") {
      await clearAllLocalData();
    } else if (session.githubLogin) {
      // Instance web partagée : on ne supprime que les préférences de cet utilisateur.
      await db.userPref.deleteMany({ where: { githubLogin: session.githubLogin } });
    }
  } catch (err) {
    console.warn("[logout] impossible de nettoyer la base locale:", err);
  }
}

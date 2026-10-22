import path from "node:path";
import { databaseUrl } from "./lib/db-url";
import { applyMigrations } from "./lib/migrate";

// Démarrage du serveur Node : migrations de base de données + avertissements de configuration.
export async function registerNode() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  try {
    const report = await applyMigrations({
      databaseUrl: databaseUrl(),
      migrationsDir: path.join(process.cwd(), "prisma", "migrations"),
    });
    if (report.applied.length > 0) {
      console.log(`[migrate] ${report.applied.length} migration(s) appliquée(s) : ${report.applied.join(", ")}`);
    }
    if (report.skipped) console.warn(`[migrate] ignoré — ${report.skipped}`);
  } catch (err) {
    // Non fatal : l'app démarre, mais les pages touchant la base signaleront l'erreur.
    console.error("[migrate] ÉCHEC :", err);
  }

  // Avertissements de configuration de sécurité (mode web)
  if (process.env.OPENKIDO_DESKTOP !== "1" && process.env.NODE_ENV === "production") {
    if (!process.env.ALLOWED_GITHUB_LOGINS && !process.env.ALLOWED_GITHUB_ORGS) {
      console.warn(
        "[security] ALLOWED_GITHUB_LOGINS / ALLOWED_GITHUB_ORGS non défini : tout compte GitHub peut se connecter à cette instance."
      );
    }
    if (!process.env.AUTH_URL && !process.env.NEXTAUTH_URL) {
      console.warn("[security] AUTH_URL non défini : les URL de callback sont déduites des en-têtes Host.");
    }
  }
}

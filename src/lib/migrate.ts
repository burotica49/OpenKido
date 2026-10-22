// Applique les migrations Prisma (prisma/migrations/*/migration.sql) au démarrage du serveur.
// Compatible avec la table `_prisma_migrations` : `prisma migrate dev/deploy` continue de fonctionner.
// Module volontairement autonome (aucun import relatif) pour pouvoir être testé hors de Next.js.
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";

export interface MigrationReport {
  applied: string[];
  skipped?: string;
}

const MIGRATION_DIR_RE = /^\d{14}_[A-Za-z0-9_]+$/;

export async function applyMigrations(opts: {
  databaseUrl: string;
  migrationsDir: string;
}): Promise<MigrationReport> {
  const { databaseUrl, migrationsDir } = opts;

  if (!fs.existsSync(migrationsDir)) {
    return { applied: [], skipped: `dossier de migrations introuvable : ${migrationsDir}` };
  }

  const names = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && MIGRATION_DIR_RE.test(d.name))
    .map((d) => d.name)
    .sort();

  const client = createClient({ url: databaseUrl });
  try {
    const tables = (
      await client.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
      )
    ).rows.map((r) => String(r.name));

    if (!tables.includes("_prisma_migrations")) {
      // Une base qui contient déjà des tables sans historique (db push) ne peut pas être
      // migrée automatiquement sans risque : on n'y touche pas.
      if (tables.length > 0) {
        return {
          applied: [],
          skipped: "base existante sans _prisma_migrations (baseline manuel requis)",
        };
      }
      await client.execute(`CREATE TABLE "_prisma_migrations" (
        "id"                    TEXT PRIMARY KEY NOT NULL,
        "checksum"              TEXT NOT NULL,
        "finished_at"           DATETIME,
        "migration_name"        TEXT NOT NULL,
        "logs"                  TEXT,
        "rolled_back_at"        DATETIME,
        "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
        "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
      )`);
    }

    const done = new Set(
      (
        await client.execute(
          'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'
        )
      ).rows.map((r) => String(r.migration_name))
    );

    const applied: string[] = [];
    for (const name of names) {
      if (done.has(name)) continue;

      const sqlFile = path.join(migrationsDir, name, "migration.sql");
      if (!fs.existsSync(sqlFile)) continue;
      const sql = fs.readFileSync(sqlFile, "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");

      const tx = await client.transaction("write");
      try {
        await tx.executeMultiple(sql);
        await tx.execute({
          sql: `INSERT INTO "_prisma_migrations"
                  ("id", "checksum", "finished_at", "migration_name", "applied_steps_count")
                VALUES (?, ?, current_timestamp, ?, 1)`,
          args: [randomUUID(), checksum, name],
        });
        await tx.commit();
      } catch (err) {
        await tx.rollback();
        throw new Error(`migration ${name} échouée : ${err instanceof Error ? err.message : err}`);
      } finally {
        tx.close();
      }
      applied.push(name);
    }

    return { applied };
  } finally {
    client.close();
  }
}

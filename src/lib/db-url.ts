import path from "node:path";
import { pathToFileURL } from "node:url";

/** URL de la base SQLite : `DATABASE_URL` (Electron, Docker) ou `prisma/openkido.db` en local. */
export function databaseUrl(): string {
  const fromEnv = process.env.DATABASE_URL;
  if (fromEnv) return fromEnv;
  return pathToFileURL(path.join(process.cwd(), "prisma", "openkido.db")).href;
}

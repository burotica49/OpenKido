import path from "path";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";

// In Electron, the main process injects DATABASE_URL pointing to userData.
// In Docker/dev, fall back to the local prisma/ directory.
const DB_PATH =
  process.env.DATABASE_URL ??
  `file:${path.join(process.cwd(), "prisma", "openkido.db")}`;

function makeClient() {
  const adapter = new PrismaLibSql({ url: DB_PATH });
  return new PrismaClient({ adapter } as never);
}

// Singleton en dev pour éviter les connexions multiples avec HMR
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const db = globalForPrisma.prisma ?? makeClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

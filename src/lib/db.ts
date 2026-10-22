import "server-only";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { databaseUrl } from "@/lib/db-url";

const DB_PATH = databaseUrl();

function makeClient() {
  const adapter = new PrismaLibSql({ url: DB_PATH });
  return new PrismaClient({ adapter } as never);
}

type DbClient = ReturnType<typeof makeClient>;

// Singleton en dev pour éviter les connexions multiples avec HMR
const globalForPrisma = globalThis as unknown as { prisma?: DbClient };
export const db: DbClient = globalForPrisma.prisma ?? makeClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

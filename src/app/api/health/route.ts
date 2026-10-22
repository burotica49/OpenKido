import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Santé du serveur local. L'application de bureau l'interroge au démarrage : `instance` prouve que la
 * réponse vient bien de NOTRE serveur (et pas d'une autre application qui occuperait le port), et la requête
 * SQL vérifie que la base et le module natif sont opérationnels.
 */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (error) {
    console.error("[health] base de données indisponible :", error instanceof Error ? error.message : error);
    return NextResponse.json({ ok: false, error: "database" }, { status: 503 });
  }
  return NextResponse.json({ ok: true, instance: process.env.OPENKIDO_INSTANCE ?? null });
}

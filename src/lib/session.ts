import "server-only";
import { auth } from "@/lib/auth";

export interface ServerSession {
  token: string;
  githubLogin?: string;
}

/**
 * À appeler en première ligne de chaque Server Action : une action exportée est
 * joignable par un POST direct, la vérification faite par la page ne la protège pas.
 */
export async function requireSession(): Promise<ServerSession> {
  const session = await auth();
  if (!session?.accessToken) throw new Error("Non authentifié");
  return { token: session.accessToken, githubLogin: session.githubLogin };
}

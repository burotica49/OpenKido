import type { NextRequest } from "next/server";
import { handlers } from "@/lib/auth";

export const { POST } = handlers;

/**
 * `/api/auth/session` est lisible par le JavaScript du navigateur : on en retire le jeton
 * GitHub (scope `repo`). Le serveur le lit toujours via `auth()`, qui ne passe pas par cette route.
 */
export async function GET(request: NextRequest) {
  const response = await handlers.GET(request);

  if (!new URL(request.url).pathname.endsWith("/session")) return response;

  let body: unknown;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }
  if (body && typeof body === "object" && "accessToken" in body) {
    delete (body as { accessToken?: unknown }).accessToken;
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.set("cache-control", "no-store");
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(body), { status: response.status, headers });
}

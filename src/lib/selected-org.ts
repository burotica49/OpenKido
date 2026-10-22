import "server-only";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { PERSONAL_ORG } from "@/lib/org-constants";

export { PERSONAL_ORG };
export { ORG_COOKIE } from "@/lib/org-constants";

function normalizeOrg(value: string | null | undefined): string | null {
  const v = value?.trim() ?? "";
  return v || null;
}

/** Org sélectionnée : login d’org, `@me` (compte perso), ou `null` (tous les dépôts). */
export async function getSelectedOrg(): Promise<string | null> {
  const session = await auth();
  const login = session?.githubLogin;
  if (!login) return null;

  try {
    const pref = await db.userPref.findUnique({
      where: { githubLogin: login },
      select: { selectedOrg: true },
    });
    return normalizeOrg(pref?.selectedOrg);
  } catch {
    return null;
  }
}

export function filterReposByOrg<T extends { owner: string }>(
  repos: T[],
  org: string | null,
  personalLogin: string
): T[] {
  if (!org) return repos;
  const needle = (org === PERSONAL_ORG ? personalLogin : org).toLowerCase();
  return repos.filter((r) => r.owner.toLowerCase() === needle);
}

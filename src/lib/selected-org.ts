import { cookies } from "next/headers";

export const ORG_COOKIE = "ok_selected_org";

/** Returns the selected org login, or null if personal account is selected. */
export async function getSelectedOrg(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(ORG_COOKIE)?.value ?? "";
  return value || null;
}

/** Filter repos by selected org (or personal account if null). */
export function filterReposByOrg<T extends { owner: string }>(
  repos: T[],
  org: string | null,
  personalLogin: string
): T[] {
  if (!org) return repos.filter((r) => r.owner === personalLogin);
  return repos.filter((r) => r.owner === org);
}

// Validation des entrées reçues par les Server Actions (données non fiables).
const OWNER_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}$/;

/** Borne le travail qu'un seul appel peut déclencher (quota GitHub, déni de service). */
export const MAX_REPOS_PER_CALL = 300;

export function assertRepoRef(owner: unknown, repo: unknown): { owner: string; repo: string } {
  if (typeof owner !== "string" || !OWNER_RE.test(owner) || owner === "." || owner === "..") {
    throw new Error("Propriétaire invalide");
  }
  if (typeof repo !== "string" || !REPO_RE.test(repo) || repo === "." || repo === "..") {
    throw new Error("Dépôt invalide");
  }
  return { owner, repo };
}

export function assertRepoList<T extends { owner: string; name: string }>(repos: unknown): T[] {
  if (!Array.isArray(repos)) throw new Error("Liste de dépôts invalide");
  if (repos.length > MAX_REPOS_PER_CALL) {
    throw new Error(`Trop de dépôts (max ${MAX_REPOS_PER_CALL} par appel)`);
  }
  for (const r of repos) assertRepoRef(r?.owner, r?.name);
  return repos as T[];
}

export function isValidRepoRef(owner: unknown, repo: unknown): boolean {
  try {
    assertRepoRef(owner, repo);
    return true;
  } catch {
    return false;
  }
}

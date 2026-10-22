"use server";

import { requireSession } from "@/lib/session";
import { getRepoAccess } from "@/lib/github";
import { PostureFailedError, auditPosture } from "@/lib/controls/engine";
import { assertRepoList, assertRepoRef } from "@/lib/validate";

export type PostureActionResult = { ok: true; score: number; unknown: number } | { ok: false; error: string };

function describe(error: unknown): string {
  if (error instanceof PostureFailedError) return `${error.message} — les dernières données sont conservées`;
  if (error instanceof Error) return error.message;
  return "Échec de l'audit de posture";
}

/** Audite la posture de sécurité d'un dépôt (≈ 20 à 40 appels à l'API GitHub). */
export async function auditPostureRepo(owner: string, repo: string): Promise<PostureActionResult> {
  try {
    const { token } = await requireSession();
    const ref = assertRepoRef(owner, repo);
    const access = await getRepoAccess(token, ref.owner, ref.repo);
    if (!access) return { ok: false, error: "Dépôt introuvable ou inaccessible" };
    const { score } = await auditPosture(token, ref.owner, ref.repo);
    return { ok: true, score: score.score, unknown: score.unknown };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

export interface PostureAllResult {
  total: number;
  done: number;
  failed: number;
  failures: { repo: string; error: string }[];
}

/** Audite plusieurs dépôts (2 en parallèle : chaque audit consomme beaucoup de requêtes GitHub). */
export async function auditPostureAll(repos: { owner: string; name: string }[]): Promise<PostureAllResult> {
  const { token } = await requireSession();
  const list = assertRepoList<{ owner: string; name: string }>(repos);

  const CONCURRENCY = 2;
  const result: PostureAllResult = { total: list.length, done: 0, failed: 0, failures: [] };
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const batch = list.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (r) => {
        const access = await getRepoAccess(token, r.owner, r.name);
        if (!access) throw new Error("dépôt inaccessible");
        return auditPosture(token, r.owner, r.name);
      })
    );
    settled.forEach((s, j) => {
      if (s.status === "fulfilled") result.done++;
      else {
        result.failed++;
        if (result.failures.length < 10) result.failures.push({ repo: `${batch[j].owner}/${batch[j].name}`, error: describe(s.reason) });
      }
    });
  }
  return result;
}

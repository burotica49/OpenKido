"use server";

import { requireSession } from "@/lib/session";
import { getRepoAccess } from "@/lib/github";
import { analyzeRepo as runAnalysis } from "@/lib/quality";
import { assertRepoList, assertRepoRef } from "@/lib/validate";

export type QualityActionResult = { ok: true } | { ok: false; error: string };

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "Échec de l'analyse";
}

/** Analyse la qualité d'un dépôt. La branche est lue sur GitHub, jamais fournie par le client. */
export async function analyzeRepo(owner: string, repo: string): Promise<QualityActionResult> {
  try {
    const { token } = await requireSession();
    const ref = assertRepoRef(owner, repo);
    const access = await getRepoAccess(token, ref.owner, ref.repo);
    if (!access) return { ok: false, error: "Dépôt introuvable ou inaccessible" };
    await runAnalysis(token, ref.owner, ref.repo, access.defaultBranch);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

export interface QualityAllResult {
  total: number;
  done: number;
  failed: number;
  failures: { repo: string; error: string }[];
}

/** Analyse plusieurs dépôts (3 en parallèle). */
export async function analyzeAllRepos(repos: { owner: string; name: string }[]): Promise<QualityAllResult> {
  const { token } = await requireSession();
  const list = assertRepoList<{ owner: string; name: string }>(repos);

  const CONCURRENCY = 3;
  const result: QualityAllResult = { total: list.length, done: 0, failed: 0, failures: [] };
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const batch = list.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (r) => {
        const access = await getRepoAccess(token, r.owner, r.name);
        if (!access) throw new Error("dépôt inaccessible");
        return runAnalysis(token, r.owner, r.name, access.defaultBranch);
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

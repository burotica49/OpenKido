"use server";

import { requireSession } from "@/lib/session";
import { getRepoAccess } from "@/lib/github";
import { ScanFailedError, scanRepo } from "@/lib/scan";
import { assertRepoList, assertRepoRef } from "@/lib/validate";

export type ScanActionResult =
  | { ok: true; status: "complete" | "partial"; unscanned: number; warnings: string[]; persisted: boolean }
  | { ok: false; error: string };

function describe(error: unknown): string {
  if (error instanceof ScanFailedError) return `${error.message} — les dernières données sont conservées`;
  if (error instanceof Error) return error.message;
  return "Échec du scan";
}

/** Scanne un dépôt (bouton « Scanner »). La branche est lue sur GitHub, jamais fournie par le client. */
export async function triggerScan(owner: string, repo: string): Promise<ScanActionResult> {
  try {
    const { token } = await requireSession();
    const ref = assertRepoRef(owner, repo);
    const access = await getRepoAccess(token, ref.owner, ref.repo);
    if (!access) return { ok: false, error: "Dépôt introuvable ou inaccessible" };
    const scan = await scanRepo(token, ref.owner, ref.repo, access.defaultBranch);
    return { ok: true, status: scan.status, unscanned: scan.unscanned, warnings: scan.warnings, persisted: scan.persisted };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

export interface ScanAllResult {
  total: number;
  /** Scans complets. */
  done: number;
  /** Scans incomplets (résultat partiel). */
  partial: number;
  failed: number;
  failures: { repo: string; error: string }[];
}

/** Scanne plusieurs dépôts (5 en parallèle). */
export async function scanAllRepos(repos: { owner: string; name: string }[]): Promise<ScanAllResult> {
  const { token, githubLogin } = await requireSession();
  const list = assertRepoList<{ owner: string; name: string }>(repos);
  console.log(`[scan] @${githubLogin ?? "?"} — ${list.length} repo(s)`);

  const CONCURRENCY = 5;
  const result: ScanAllResult = { total: list.length, done: 0, partial: 0, failed: 0, failures: [] };

  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const batch = list.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (r) => {
        const access = await getRepoAccess(token, r.owner, r.name);
        if (!access) throw new Error("dépôt inaccessible");
        return scanRepo(token, r.owner, r.name, access.defaultBranch);
      })
    );
    settled.forEach((s, j) => {
      if (s.status === "fulfilled") {
        if (s.value.status === "complete") result.done++;
        else result.partial++;
      } else {
        result.failed++;
        if (result.failures.length < 10) result.failures.push({ repo: `${batch[j].owner}/${batch[j].name}`, error: describe(s.reason) });
        console.error(`[scan] échec pour ${batch[j].owner}/${batch[j].name}:`, s.reason);
      }
    });
  }

  return result;
}

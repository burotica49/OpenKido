"use server";

import { requireSession } from "@/lib/session";
import { getRepoAccess } from "@/lib/github";
import { AuditFailedError, auditRepo as runAudit } from "@/lib/audit";
import { assertRepoList, assertRepoRef } from "@/lib/validate";
import { scanAndStoreSecrets } from "@/lib/secrets";

export type AuditActionResult = { ok: true; warning?: string } | { ok: false; error: string };

/** Analyse des secrets du code par Openkido : un échec n'invalide pas l'audit GitHub, il est signalé. */
async function secretsStep(token: string, owner: string, repo: string): Promise<string | undefined> {
  try {
    const { stored, result } = await scanAndStoreSecrets(token, owner, repo);
    return stored ? undefined : `${owner}/${repo} : analyse des secrets partielle (${result.note ?? "résultat incomplet"}), le dernier résultat complet est conservé`;
  } catch (e) {
    return `${owner}/${repo} : analyse des secrets impossible (${e instanceof Error ? e.message : "erreur"})`;
  }
}

function describe(error: unknown): string {
  if (error instanceof AuditFailedError) return `${error.message} — les dernières données sont conservées`;
  if (error instanceof Error) return error.message;
  return "Échec de l'audit";
}

/** Audite un dépôt (alertes Code Scanning, Dependabot, Secret Scanning). */
export async function auditRepo(owner: string, repo: string): Promise<AuditActionResult> {
  try {
    const { token } = await requireSession();
    const ref = assertRepoRef(owner, repo);
    const access = await getRepoAccess(token, ref.owner, ref.repo);
    if (!access) return { ok: false, error: "Dépôt introuvable ou inaccessible" };
    await runAudit(token, ref.owner, ref.repo);
    const warning = await secretsStep(token, ref.owner, ref.repo);
    return { ok: true, ...(warning ? { warning } : {}) };
  } catch (e) {
    return { ok: false, error: describe(e) };
  }
}

export interface AuditAllResult {
  total: number;
  done: number;
  failed: number;
  failures: { repo: string; error: string }[];
  /** Audits réussis dont l'analyse des secrets du code a échoué ou n'est que partielle. */
  warnings: string[];
}

/** Audite plusieurs dépôts (5 en parallèle). */
export async function auditAllRepos(repos: { owner: string; name: string }[]): Promise<AuditAllResult> {
  const { token } = await requireSession();
  const list = assertRepoList<{ owner: string; name: string }>(repos);

  const CONCURRENCY = 5;
  const result: AuditAllResult = { total: list.length, done: 0, failed: 0, failures: [], warnings: [] };
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const batch = list.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (r) => {
        const access = await getRepoAccess(token, r.owner, r.name);
        if (!access) throw new Error("dépôt inaccessible");
        await runAudit(token, r.owner, r.name);
        return secretsStep(token, r.owner, r.name);
      })
    );
    settled.forEach((s, j) => {
      if (s.status === "fulfilled") {
        result.done++;
        if (s.value && result.warnings.length < 10) result.warnings.push(s.value);
      }
      else {
        result.failed++;
        if (result.failures.length < 10) result.failures.push({ repo: `${batch[j].owner}/${batch[j].name}`, error: describe(s.reason) });
      }
    });
  }
  return result;
}

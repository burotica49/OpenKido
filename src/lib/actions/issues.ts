"use server";

import { requireSession } from "@/lib/session";
import { db } from "@/lib/db";
import { listRepos, getGithubLogin } from "@/lib/github";
import { filterReposByOrg, getSelectedOrg } from "@/lib/selected-org";
import { syncIssueHistory } from "@/lib/issues";
import {
  isIgnoreReason, isValidIssueKey, MAX_ASSIGNEE_LENGTH, MAX_NOTE_LENGTH, MAX_SNOOZE_DAYS,
} from "@/lib/issues-core";

export type IssueActionResult = { ok: true; count: number } | { ok: false; error: string };

const MAX_KEYS_PER_CALL = 200;

export type IssueAction =
  | { type: "ignore"; reason: string; note?: string }
  | { type: "snooze"; days: number; note?: string }
  | { type: "assign"; assignee: string }
  | { type: "reopen" };

function cleanText(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
}

/**
 * Applique une action (ignorer, reporter, assigner, rouvrir) à une ou plusieurs alertes du Feed.
 * Les états sont propres à l'utilisateur connecté.
 */
export async function updateIssues(keys: string[], action: IssueAction): Promise<IssueActionResult> {
  try {
    const { githubLogin } = await requireSession();
    if (!githubLogin) return { ok: false, error: "Compte GitHub inconnu" };
    if (!Array.isArray(keys) || keys.length === 0) return { ok: false, error: "Aucune alerte sélectionnée" };
    if (keys.length > MAX_KEYS_PER_CALL) return { ok: false, error: `Trop d'alertes (max ${MAX_KEYS_PER_CALL})` };
    if (!keys.every(isValidIssueKey)) return { ok: false, error: "Identifiant d'alerte invalide" };
    const unique = [...new Set(keys)];

    if (action?.type === "reopen") {
      // On garde l'éventuelle assignation : seul l'état « ignoré / reporté » est levé.
      await db.issueState.updateMany({ where: { githubLogin, key: { in: unique } }, data: { status: "open", reason: "", note: "", until: null } });
      return { ok: true, count: unique.length };
    }

    let data: { status?: string; reason?: string; note?: string; until?: Date | null; assignee?: string };
    if (action?.type === "ignore") {
      if (!isIgnoreReason(action.reason)) return { ok: false, error: "Motif invalide" };
      const note = cleanText(action.note, MAX_NOTE_LENGTH);
      if (action.reason === "other" && !note) return { ok: false, error: "Précisez le motif" };
      data = { status: "ignored", reason: action.reason, note, until: null };
    } else if (action?.type === "snooze") {
      const days = Math.floor(Number(action.days));
      if (!Number.isFinite(days) || days < 1 || days > MAX_SNOOZE_DAYS) return { ok: false, error: `Durée invalide (1 à ${MAX_SNOOZE_DAYS} jours)` };
      data = { status: "snoozed", reason: "", note: cleanText(action.note, MAX_NOTE_LENGTH), until: new Date(Date.now() + days * 86_400_000) };
    } else if (action?.type === "assign") {
      data = { assignee: cleanText(action.assignee, MAX_ASSIGNEE_LENGTH) };
    } else {
      return { ok: false, error: "Action inconnue" };
    }

    await db.$transaction(
      unique.map((key) =>
        db.issueState.upsert({
          where: { githubLogin_key: { githubLogin, key } },
          create: { githubLogin, key, ...data },
          update: data,
        })
      )
    );
    return { ok: true, count: unique.length };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Échec de l'action" };
  }
}

/** Enregistre le suivi des alertes (nouvelles / résolues) pour le périmètre sélectionné. */
export async function syncHistory(): Promise<{ ok: boolean }> {
  try {
    const { token, githubLogin } = await requireSession();
    const login = githubLogin ?? (await getGithubLogin(token));
    const repos = filterReposByOrg(await listRepos(token), await getSelectedOrg(), login);
    await syncIssueHistory(login, repos.map((r) => ({ owner: r.owner, name: r.name })));
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

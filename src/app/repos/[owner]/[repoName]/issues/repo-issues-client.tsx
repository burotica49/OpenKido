"use client";

import { IssuesWorkspace, SeverityHeader } from "@/components/app/issues-workspace";
import type { ResolvedIssue, ResolvedItem } from "@/lib/issues-core";

export function RepoIssuesClient({ issues, login, fullyCovered, resolved }: { issues: ResolvedIssue[]; login: string; fullyCovered: boolean; resolved: ResolvedItem[] }) {
  return (
    <IssuesWorkspace
      issues={issues}
      login={login}
      hideTarget
      fullyCovered={fullyCovered}
      resolved={resolved}
      emptyMessage="Aucune donnée pour ce dépôt. Lancez un scan (onglet Overview), un Code Audit ou un audit de Posture."
      header={(api) => <SeverityHeader api={api} showHints />}
    />
  );
}

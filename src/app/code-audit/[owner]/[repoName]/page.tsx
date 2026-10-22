import Link from "next/link";
import { requireRepoAccess } from "@/lib/repo-page";
import { getAuditAlerts, getAuditSummaries } from "@/lib/audit";
import { getSecretFindings, getSecretSummaries } from "@/lib/secrets";
import { TopBar } from "@/components/app/sidebar";
import { AuditNowButton } from "@/components/app/audit-now-button";
import { AuditFindings } from "./findings-client";
import { cn } from "@/lib/utils";
import {
  IconArrowLeft, IconBan, IconBug, IconCheck, IconCode, IconKey,
} from "@tabler/icons-react";

export const dynamic = "force-dynamic";

const SOURCES = [
  { id: "code_scanning", label: "Code Scanning", icon: <IconCode size={14} />, key: "csState" },
  { id: "dependabot", label: "Dependabot", icon: <IconBug size={14} />, key: "dbState" },
  { id: "secret_scanning", label: "Secret Scanning", icon: <IconKey size={14} />, key: "ssState" },
] as const;

const STATE_TEXT: Record<string, string> = {
  ok: "Interrogée",
  disabled: "Désactivée sur ce dépôt",
  "no-access": "Accès refusé",
  unknown: "Audit à relancer",
};

export default async function CodeAuditRepoPage({ params }: { params: Promise<{ owner: string; repoName: string }> }) {
  const { owner, repoName } = await params;
  await requireRepoAccess(owner, repoName);

  const [summaries, alerts, secretSummaries, secretFindings] = await Promise.all([
    getAuditSummaries([{ owner, name: repoName }]),
    getAuditAlerts(owner, repoName),
    getSecretSummaries([{ owner, name: repoName }]),
    getSecretFindings(owner, repoName),
  ]);
  const secretSummary = secretSummaries.get(`${owner}/${repoName}`);
  const summary = summaries.get(`${owner}/${repoName}`);

  return (
    <div className="flex flex-col flex-1 bg-background">
      <TopBar breadcrumb={`Code Audit / ${owner} / ${repoName}`} />
      <div className="px-6 py-5 space-y-5">
        <Link href="/code-audit" className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
          <IconArrowLeft size={13} /> Retour au Code Audit
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">{owner} / {repoName}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {summary?.checkedAt
                ? `Dernier audit le ${new Date(summary.checkedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}`
                : "Ce dépôt n'a pas encore été audité."}
            </p>
          </div>
          <AuditNowButton owner={owner} repo={repoName} label={summary ? "Relancer l'audit" : "Lancer l'audit"} />
        </div>

        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {SOURCES.map((src) => {
              const state = summary[src.key];
              const count = alerts.filter((a) => a.source === src.id).length;
              return (
                <div key={src.id} className="rounded-lg border border-border bg-white px-4 py-3.5">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
                    {src.icon} {src.label}
                  </div>
                  {state === "ok" ? (
                    <p className={cn("flex items-center gap-1.5 text-sm font-medium", count > 0 ? "text-red-600" : "text-green-600")}>
                      {count > 0 ? `${count} alerte${count > 1 ? "s" : ""} ouverte${count > 1 ? "s" : ""}` : <><IconCheck size={14} /> Aucune alerte</>}
                    </p>
                  ) : (
                    <p className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                      <IconBan size={14} /> {STATE_TEXT[state] ?? STATE_TEXT.unknown}
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {state === "ok" ? STATE_TEXT.ok : "Aucune donnée : ce n'est pas la preuve d'un dépôt sain."}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        <AuditFindings
          alerts={alerts}
          secretFindings={secretFindings}
          secretChecked={secretSummary ? secretSummary.checkedAt.toISOString() : null}
          secretFiles={secretSummary?.filesScanned ?? 0}
          secretNote={secretSummary?.note ?? null}
          allSourcesOk={!!summary && SOURCES.every((s) => summary[s.key] === "ok")}
          hasSummary={!!summary}
        />
      </div>
    </div>
  );
}

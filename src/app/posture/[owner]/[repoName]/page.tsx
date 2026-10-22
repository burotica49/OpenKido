import Link from "next/link";
import { requireRepoAccess } from "@/lib/repo-page";
import { getPostureDetail } from "@/lib/controls/engine";
import type { ControlState } from "@/lib/controls/types";
import { SEVERITY_HELP, STATE_HELP, verdict } from "@/lib/controls/glossary";
import { TopBar } from "@/components/app/sidebar";
import { PostureNowButton } from "@/components/app/posture-now-button";
import { PostureControls } from "./controls-client";
import { SEV, SEV_LABEL, STATE } from "../../state-ui";
import { cn } from "@/lib/utils";
import { IconArrowLeft, IconHelpCircle } from "@tabler/icons-react";

export const dynamic = "force-dynamic";

const scoreColor = (s: number) => (s >= 75 ? "text-green-600" : s >= 50 ? "text-amber-500" : "text-red-500");

export default async function PostureRepoPage({ params }: { params: Promise<{ owner: string; repoName: string }> }) {
  const { owner, repoName } = await params;
  await requireRepoAccess(owner, repoName);
  const detail = await getPostureDetail(owner, repoName);

  return (
    <div className="flex flex-col flex-1 bg-background">
      <TopBar breadcrumb={`Posture / ${owner} / ${repoName}`} />
      <div className="px-6 py-5 space-y-5">
        <Link href="/posture" className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
          <IconArrowLeft size={13} /> Retour à la posture des dépôts
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">{owner} / {repoName}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {detail ? `Dernier audit le ${detail.summary.checkedAt.toLocaleDateString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}` : "Ce dépôt n'a pas encore été audité."}
            </p>
          </div>
          <PostureNowButton owner={owner} repo={repoName} label={detail ? "Relancer l'audit" : "Lancer l'audit"} />
        </div>

        {detail && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="rounded-lg border border-border bg-white px-4 py-3.5 md:col-span-1">
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Score</p>
                <p className={cn("text-3xl font-bold tabular-nums", scoreColor(detail.summary.score))}>{detail.summary.score}<span className="text-sm text-muted-foreground"> / 100</span></p>
              </div>
              {[
                { label: "Conformes", value: detail.summary.passed, cls: "text-green-600" },
                { label: "Échecs", value: detail.summary.failed, cls: detail.summary.failed > 0 ? "text-red-600" : "text-green-600" },
                { label: "À examiner", value: detail.summary.warning, cls: detail.summary.warning > 0 ? "text-amber-600" : "text-foreground" },
                { label: "Non évaluables", value: detail.summary.unknown, cls: "text-muted-foreground" },
              ].map((x) => (
                <div key={x.label} className="rounded-lg border border-border bg-white px-4 py-3.5">
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">{x.label}</p>
                  <p className={cn("text-2xl font-semibold tabular-nums", x.cls)}>{x.value}</p>
                </div>
              ))}
            </div>
            {(() => {
              const v = verdict(detail.summary);
              return (
                <div className={cn("rounded-lg border px-4 py-3 text-[13px]", v.tone === "bad" ? "border-red-200 bg-red-50 text-red-900" : v.tone === "ok" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-green-200 bg-green-50 text-green-900")}>
                  <p className="font-medium">En clair</p>
                  <p className="mt-0.5">{v.text}</p>
                </div>
              );
            })()}
            <details className="rounded-lg border border-border bg-white px-4 py-3 text-[12px] text-muted-foreground">
              <summary className="cursor-pointer text-[13px] font-medium text-foreground">Comment lire ces résultats ?</summary>
              <div className="mt-3 space-y-3">
                <p><span className="font-medium text-foreground">Le score</span> ({detail.summary.score}/100) est la part des vérifications réussies, en donnant plus de poids aux plus graves : une vérification critique compte 10 points, élevée 6, moyenne 3, faible 1. Une vérification « à examiner » compte pour moitié. Ici : {detail.summary.passed} conforme(s) sur {detail.summary.evaluated} évaluée(s).</p>
                <div>
                  <p className="font-medium text-foreground mb-1">Les états</p>
                  <ul className="space-y-0.5">
                    {(["pass", "fail", "warning", "unknown", "na"] as ControlState[]).map((k) => (
                      <li key={k}><span className={cn("font-medium", STATE[k].cls)}>{STATE[k].label}</span> — {STATE_HELP[k]}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-foreground mb-1">Les niveaux de gravité</p>
                  <ul className="space-y-0.5">
                    {(["critical", "high", "medium", "low"] as const).map((k) => (
                      <li key={k}><span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold mr-1", SEV[k])}>{SEV_LABEL[k]}</span>{SEVERITY_HELP[k]}</li>
                    ))}
                  </ul>
                </div>
                <p>Cet audit est en <span className="font-medium text-foreground">lecture seule</span> : rien n&apos;est modifié sur votre dépôt. Chaque problème est accompagné d&apos;un lien vers le réglage GitHub à changer.</p>
              </div>
            </details>
            {detail.summary.unknown > 0 && (
              <p className="text-[12px] text-muted-foreground flex items-start gap-2">
                <IconHelpCircle size={14} className="mt-0.5 shrink-0" />
                Les contrôles « non évaluables » (droits administrateur manquants, fonction indisponible sur l&apos;offre du dépôt…) sont exclus du score : ils ne comptent ni pour ni contre, mais le score ne vaut que pour les {detail.summary.evaluated} contrôles évalués.
              </p>
            )}

            {(() => {
              const order = { critical: 0, high: 1, medium: 2, low: 3 } as const;
              const todo = detail.results.filter((r) => r.state === "fail").sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 3);
              if (todo.length === 0) return null;
              return (
                <section className="rounded-lg border border-violet-200 bg-violet-50/50 px-5 py-4">
                  <p className="text-[13px] font-medium mb-2">Par quoi commencer ?</p>
                  <ol className="list-decimal pl-5 space-y-1 text-[12px]">
                    {todo.map((r) => <li key={r.id}><span className="font-medium">{r.title}</span> <span className="text-muted-foreground">(gravité {SEV_LABEL[r.severity].toLowerCase()})</span></li>)}
                  </ol>
                </section>
              );
            })()}

            <PostureControls results={detail.results} />
          </>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconAlertTriangle, IconLoader2, IconRefresh, IconShieldLock, IconX, IconHelpCircle } from "@tabler/icons-react";
import type { GithubRepo } from "@/lib/github";
import type { PostureSummary } from "@/lib/controls/engine";
import { auditPostureAll, auditPostureRepo } from "@/lib/actions/posture";
import { HelpPanel, Term } from "@/components/app/help-panel";
import { PageHeader } from "@/components/app/sidebar";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Summary = Omit<PostureSummary, "checkedAt"> & { checkedAt: string };
interface Notice { kind: "error" | "warning"; text: string }

const scoreColor = (s: number) => (s >= 75 ? "text-green-600" : s >= 50 ? "text-amber-500" : "text-red-500");
const scoreBg = (s: number) => (s >= 75 ? "bg-green-600" : s >= 50 ? "bg-amber-500" : "bg-red-500");

function Chip({ n, label, tone }: { n: number; label: string; tone: string }) {
  if (n === 0) return null;
  return <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums", tone)}>{label} {n}</span>;
}

function AuditButton({ repo, onNotice }: { repo: GithubRepo; onNotice: (n: Notice | null) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={(e) => {
        e.stopPropagation();
        start(async () => {
          const r = await auditPostureRepo(repo.owner, repo.name);
          onNotice(r.ok ? null : { kind: "error", text: `${repo.full_name} : ${r.error}` });
          router.refresh();
        });
      }}
      className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-[12px] text-violet-600 hover:bg-violet-50 border border-violet-200 transition-colors disabled:opacity-50"
    >
      {pending ? <IconLoader2 size={12} className="animate-spin" /> : <IconRefresh size={12} />}
      {pending ? "Audit…" : "Auditer"}
    </button>
  );
}

export function PostureClient({ repos, summaries }: { repos: GithubRepo[]; summaries: Record<string, Summary> }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "critical" | "never">("all");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function handleAuditAll() {
    if (running) return;
    setRunning(true);
    setNotice(null);
    setProgress({ done: 0, total: repos.length });
    const BATCH = 4;
    let done = 0;
    let failed = 0;
    const failures: { repo: string; error: string }[] = [];
    for (let i = 0; i < repos.length; i += BATCH) {
      const batch = repos.slice(i, i + BATCH);
      try {
        const r = await auditPostureAll(batch.map((x) => ({ owner: x.owner, name: x.name })));
        failed += r.failed;
        failures.push(...r.failures);
      } catch (error) {
        failed += batch.length;
        failures.push({ repo: `${batch.length} dépôt(s)`, error: error instanceof Error ? error.message : "erreur inconnue" });
      }
      done += batch.length;
      setProgress({ done: Math.min(done, repos.length), total: repos.length });
    }
    setRunning(false);
    setProgress(null);
    if (failed > 0) setNotice({ kind: "error", text: `${failed} audit(s) en échec — ${failures.slice(0, 3).map((f) => `${f.repo} (${f.error})`).join(" ; ")}` });
    router.refresh();
  }

  const audited = Object.values(summaries);
  const avgScore = audited.length ? Math.round(audited.reduce((a, s) => a + s.score, 0) / audited.length) : null;
  const totalCritical = audited.reduce((a, s) => a + s.failCritical, 0);
  const totalHigh = audited.reduce((a, s) => a + s.failHigh, 0);
  // Couverture = part des contrôles applicables qui ont pu être évalués (hors « sans objet »).
  const coverage = (s: Summary) => (s.evaluated + s.unknown > 0 ? s.evaluated / (s.evaluated + s.unknown) : 1);
  const avgCoverage = audited.length ? Math.round((audited.reduce((a, s) => a + coverage(s), 0) / audited.length) * 100) : null;

  const filtered = repos
    .filter((r) => r.full_name.toLowerCase().includes(query.toLowerCase()))
    .filter((r) => {
      const s = summaries[`${r.owner}/${r.name}`];
      if (filter === "critical") return s && s.failCritical + s.failHigh > 0;
      if (filter === "never") return !s;
      return true;
    })
    .sort((a, b) => (summaries[`${a.owner}/${a.name}`]?.score ?? -1) - (summaries[`${b.owner}/${b.name}`]?.score ?? -1));

  return (
    <div className="flex flex-col flex-1 bg-background">
      <PageHeader title="Posture des dépôts" subtitle="Protection des branches, CI/CD, secrets, gouvernance et accès — aligné sur OpenSSF Scorecard">
        <button
          onClick={handleAuditAll}
          disabled={running}
          className="inline-flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 text-[13px] font-medium transition-colors disabled:opacity-60"
        >
          {running ? <IconLoader2 size={14} className="animate-spin" /> : <IconRefresh size={14} />}
          {running ? `Audit… ${progress?.done ?? 0}/${progress?.total ?? repos.length}` : "Tout auditer"}
        </button>
      </PageHeader>

      {running && progress && (
        <div className="bg-white border-b border-border px-6 py-2 flex items-center gap-3">
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-violet-500 rounded-full transition-all duration-300" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
          <span className="text-[12px] text-muted-foreground tabular-nums">{progress.done} / {progress.total}</span>
        </div>
      )}

      {notice && (
        <div className={cn("flex items-start justify-between gap-3 px-6 py-2.5 text-[12px] border-b", notice.kind === "error" ? "bg-red-50 text-red-800 border-red-200" : "bg-amber-50 text-amber-800 border-amber-200")}>
          <span className="flex items-start gap-2"><IconAlertTriangle size={14} className="mt-0.5 shrink-0" />{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Fermer" className="shrink-0 opacity-70 hover:opacity-100"><IconX size={14} /></button>
        </div>
      )}

      {audited.length > 0 && (
        <div className="grid grid-cols-4 bg-white border-b border-border divide-x divide-border">
          <div className="px-6 py-4">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Score moyen</p>
            <p className={cn("text-2xl font-semibold tabular-nums", avgScore !== null ? scoreColor(avgScore) : "")}>{avgScore ?? "—"}<span className="text-sm text-muted-foreground"> / 100</span></p>
            <p className="text-[11px] text-muted-foreground mt-0.5">part des vérifications réussies</p>
          </div>
          <div className="px-6 py-4">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5" title="Points de sécurité non respectés dont la gravité est critique (à traiter en premier)">Échecs critiques</p>
            <p className={cn("text-2xl font-semibold tabular-nums", totalCritical > 0 ? "text-red-600" : "text-green-600")}>{totalCritical}</p>
          </div>
          <div className="px-6 py-4">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Échecs élevés</p>
            <p className={cn("text-2xl font-semibold tabular-nums", totalHigh > 0 ? "text-orange-600" : "text-green-600")}>{totalHigh}</p>
          </div>
          <div className="px-6 py-4">
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Dépôts audités</p>
            <p className="text-2xl font-semibold tabular-nums">{audited.length}<span className="text-sm text-muted-foreground"> / {repos.length}</span></p>
            {avgCoverage !== null && <p className="text-[11px] text-muted-foreground mt-0.5">couverture moyenne {avgCoverage} %</p>}
          </div>
        </div>
      )}

      <HelpPanel>
        <p>Chaque dépôt GitHub est vérifié sur 27 points de sécurité (protection de la branche principale, relecture du code, détection des secrets, workflows CI…). Cette page ne modifie rien : elle lit seulement les réglages.</p>
        <p><Term>Score</Term> : de 0 à 100, la part des points respectés, les plus graves comptant davantage. Vert à partir de 75, orange de 50 à 74, rouge en dessous.</p>
        <p><Term>Échecs</Term> : les points non respectés, classés par gravité — <span className="font-semibold text-red-700">C</span> critique (urgent), <span className="font-semibold text-orange-700">H</span> élevée (rapide), <span className="font-semibold text-amber-700">M</span> moyenne (à planifier), <span className="font-semibold text-blue-700">L</span> faible (bonne pratique).</p>
        <p><Term>Non évaluables</Term> : points que l&apos;application n&apos;a pas pu vérifier (droits insuffisants, fonction indisponible). Ils sont ignorés dans le score.</p>
        <p>Cliquez sur un dépôt pour voir chaque point, pourquoi il compte et comment le corriger. Les dépôts au score le plus bas sont affichés en premier.</p>
      </HelpPanel>

      <div className="bg-white border-b border-border px-6 py-3 flex items-center gap-3">
        <div className="w-64"><Input placeholder="Rechercher…" value={query} onChange={(e) => setQuery(e.target.value)} className="h-8 text-[13px] bg-muted/40 border-border" /></div>
        {(["all", "critical", "never"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={cn("text-[12px] px-2.5 py-1 rounded-md transition-colors", filter === f ? "bg-violet-100 text-violet-700 font-medium" : "text-muted-foreground hover:bg-muted")}>
            {{ all: "Tous", critical: "Échecs critiques/élevés", never: "Non audités" }[f]}
          </button>
        ))}
      </div>

      <div className="flex-1 bg-white">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {["Score", "Repository", "Échecs", "Non évaluables", "Audité", ""].map((h) => (
                <th key={h} className="text-left px-4 first:px-6 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((repo) => {
              const s = summaries[`${repo.owner}/${repo.name}`];
              return (
                <tr key={repo.id} className="hover:bg-muted/20 transition-colors group">
                  <td className="px-6 py-3 w-32">
                    {s ? (
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-12 rounded-full bg-muted overflow-hidden"><div className={cn("h-full rounded-full", scoreBg(s.score))} style={{ width: `${s.score}%` }} /></div>
                        <span className={cn("font-semibold tabular-nums", scoreColor(s.score))}>{s.score}</span>
                      </div>
                    ) : <span className="text-muted-foreground italic text-[12px]">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/posture/${repo.owner}/${repo.name}`} className="font-medium hover:text-violet-600 transition-colors">{repo.name}</Link>
                    <p className="text-[11px] text-muted-foreground">{repo.owner}{repo.private ? " · privé" : ""}</p>
                  </td>
                  <td className="px-4 py-3">
                    {s ? (
                      s.failed === 0 ? <span className="text-[12px] text-green-600">Aucun</span> : (
                        <div className="flex items-center gap-1 flex-wrap" title="C = critique, H = élevée, M = moyenne, L = faible">
                          <Chip n={s.failCritical} label="C" tone="bg-red-100 text-red-700" />
                          <Chip n={s.failHigh} label="H" tone="bg-orange-100 text-orange-700" />
                          <Chip n={s.failMedium} label="M" tone="bg-amber-100 text-amber-700" />
                          <Chip n={s.failLow} label="L" tone="bg-blue-100 text-blue-700" />
                        </div>
                      )
                    ) : <span className="text-muted-foreground italic text-[12px]">Pas encore audité</span>}
                  </td>
                  <td className="px-4 py-3">
                    {s && s.unknown > 0 ? (
                      <span title="Contrôles impossibles à évaluer (droits insuffisants, fonction indisponible…) : ils ne comptent ni pour ni contre le score." className="inline-flex items-center gap-1 text-[12px] text-muted-foreground"><IconHelpCircle size={13} />{s.unknown}</span>
                    ) : <span className="text-muted-foreground text-[12px]">—</span>}
                  </td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">
                    {s ? new Date(s.checkedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : <span className="italic">Jamais</span>}
                  </td>
                  <td className="px-4 py-3"><div className="opacity-0 group-hover:opacity-100 transition-opacity"><AuditButton repo={repo} onNotice={setNotice} /></div></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="py-16 text-center text-sm text-muted-foreground">Aucun dépôt ne correspond à la sélection.</div>}
      </div>
      <p className="px-6 py-3 text-[11px] text-muted-foreground flex items-center gap-1.5"><IconShieldLock size={12} />Lecture seule : aucun réglage de vos dépôts n&apos;est modifié. Chaque audit consomme environ 20 à 40 requêtes de l&apos;API GitHub.</p>
    </div>
  );
}

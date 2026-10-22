"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  IconRefresh, IconLoader2, IconCheck, IconX,
  IconGitBranch, IconTestPipe, IconBraces,
  IconFileText, IconSparkles, IconChartBar,
  IconCode, IconAlertTriangle,
} from "@tabler/icons-react";
import type { GithubRepo } from "@/lib/github";
import type { RepoQualityModel } from "@/generated/prisma/models/RepoQuality";
import { analyzeRepo, analyzeAllRepos } from "@/lib/actions/quality";
import { HelpPanel, Term } from "@/components/app/help-panel";
import { DetailDrawer, DrawerSection } from "@/components/app/detail-drawer";
import { TopBar, PageHeader } from "@/components/app/sidebar";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ─── Helpers ─────────────────────────────────────────────────────────

function scoreColor(score: number) {
  if (score >= 75) return "text-green-600";
  if (score >= 50) return "text-amber-500";
  return "text-red-500";
}

function scoreBg(score: number) {
  if (score >= 75) return "bg-green-600";
  if (score >= 50) return "bg-amber-500";
  return "bg-red-500";
}

function scoreLabel(score: number) {
  if (score >= 75) return "Bon";
  if (score >= 50) return "Moyen";
  if (score > 0)   return "Faible";
  return "Non analysé";
}

function Check({ value, label }: { value: boolean; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded font-medium",
      value ? "text-green-700 bg-green-50" : "text-muted-foreground bg-muted")}>
      {value ? <IconCheck size={10} /> : <IconX size={10} />}
      {label}
    </span>
  );
}

const CHECKS: { key: keyof RepoQualityModel; label: string; weight: number; icon: React.ReactNode }[] = [
  { key: "hasCi",          label: "CI/CD",        weight: 25, icon: <IconGitBranch size={14} /> },
  { key: "hasTests",       label: "Tests",         weight: 25, icon: <IconTestPipe size={14} /> },
  { key: "hasLint",        label: "Linting",       weight: 15, icon: <IconBraces size={14} /> },
  { key: "hasFormat",      label: "Formatage",     weight: 10, icon: <IconSparkles size={14} /> },
  { key: "hasTypes",       label: "TypeScript",    weight: 10, icon: <IconCode size={14} /> },
  { key: "hasReadme",      label: "README",        weight: 10, icon: <IconFileText size={14} /> },
  { key: "hasChangelog",   label: "Changelog",     weight: 3,  icon: <IconChartBar size={14} /> },
  { key: "hasEditorconfig",label: "EditorConfig",  weight: 2,  icon: <IconBraces size={14} /> },
];

// ─── Bouton analyse individuelle ─────────────────────────────────────

interface Notice { kind: "error"; text: string }

function AnalyzeButton({ repo, onNotice }: { repo: GithubRepo; onNotice: (n: Notice | null) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button onClick={(e) => {
      e.stopPropagation();
      start(async () => {
        const r = await analyzeRepo(repo.owner, repo.name);
        onNotice(r.ok ? null : { kind: "error", text: `${repo.full_name} : ${r.error}` });
        router.refresh();
      });
    }}
      disabled={pending}
      className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-[12px] text-violet-600 hover:bg-violet-50 border border-violet-200 transition-colors disabled:opacity-50">
      {pending ? <IconLoader2 size={12} className="animate-spin" /> : <IconRefresh size={12} />}
      {pending ? "Analyse…" : "Analyser"}
    </button>
  );
}

// ─── Composant principal ──────────────────────────────────────────────

export function CodeQualityClient({
  repos,
  summaries,
}: {
  repos: GithubRepo[];
  summaries: Record<string, RepoQualityModel>;
}) {
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"score" | "name" | "recent">("score");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  async function handleAnalyzeAll() {
    if (scanning) return;
    setScanning(true);
    setNotice(null);
    setProgress({ done: 0, total: repos.length });
    const BATCH = 3;
    let done = 0;
    let failed = 0;
    const failures: { repo: string; error: string }[] = [];
    for (let i = 0; i < repos.length; i += BATCH) {
      const batch = repos.slice(i, i + BATCH);
      try {
        const r = await analyzeAllRepos(batch.map((x) => ({ owner: x.owner, name: x.name })));
        failed += r.failed;
        failures.push(...r.failures);
      } catch (error) {
        failed += batch.length;
        failures.push({ repo: `${batch.length} dépôt(s)`, error: error instanceof Error ? error.message : "erreur inconnue" });
      }
      done += batch.length;
      setProgress({ done: Math.min(done, repos.length), total: repos.length });
    }
    setScanning(false);
    setProgress(null);
    if (failed > 0) setNotice({ kind: "error", text: `${failed} analyse(s) en échec — ${failures.slice(0, 3).map((f) => `${f.repo} (${f.error})`).join(" ; ")}` });
    router.refresh();
  }

  const filtered = repos
    .filter((r) => r.full_name.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      if (sortBy === "recent") return (b.pushed_at ?? "").localeCompare(a.pushed_at ?? "");
      const sa = summaries[`${a.owner}/${a.name}`]?.score ?? -1;
      const sb = summaries[`${b.owner}/${b.name}`]?.score ?? -1;
      return sa - sb; // worst first
    });

  const analysedCount = Object.keys(summaries).length;
  const avgScore = analysedCount > 0
    ? Math.round(Object.values(summaries).reduce((a, s) => a + s.score, 0) / analysedCount)
    : null;

  // Aggregate check counts
  const checkCounts = CHECKS.map((c) => ({
    ...c,
    passing: Object.values(summaries).filter((s) => s[c.key] === true).length,
    total: analysedCount,
  }));

  return (
    <div className="flex flex-col flex-1 bg-background">
      <TopBar breadcrumb="Code Quality" />

      <PageHeader title="Code Quality" subtitle="Analyse des bonnes pratiques sur vos repositories">
        <div className="flex items-center gap-2">
          {avgScore !== null && (
            <span className={cn("text-[13px] font-semibold", scoreColor(avgScore))}>
              Score moyen : {avgScore} / 100
            </span>
          )}
          <button onClick={handleAnalyzeAll} disabled={scanning}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 text-[13px] font-medium transition-colors disabled:opacity-60">
            {scanning ? <IconLoader2 size={14} className="animate-spin" /> : <IconRefresh size={14} />}
            {scanning ? `Analyse… ${progress?.done ?? 0}/${progress?.total ?? repos.length}` : "Tout analyser"}
          </button>
        </div>
      </PageHeader>

      <HelpPanel>
        <p>Cette page vérifie si vos dépôts suivent les bonnes pratiques de développement, qui rendent un projet plus fiable et plus facile à maintenir. Elle examine les fichiers du dépôt, sans rien modifier.</p>
        <p><Term>Score</Term> : de 0 à 100. Chaque pratique présente rapporte des points selon son importance : CI/CD (25), tests (25), linting (15), formatage (10), TypeScript (10), README (10), changelog (3), EditorConfig (2).</p>
        <p><Term>CI/CD</Term> : exécution automatique des vérifications à chaque changement. <Term>Tests</Term> : code qui contrôle que le logiciel fonctionne. <Term>Linting</Term> : outil qui repère les erreurs de style ou de logique. <Term>Formatage</Term> : mise en forme uniforme du code.</p>
        <p>Les pastilles « n/N » au-dessus du tableau indiquent, pour chaque pratique, combien de dépôts la respectent.</p>
      </HelpPanel>

      {notice && (
        <div className="flex items-start justify-between gap-3 px-6 py-2.5 text-[12px] border-b bg-red-50 text-red-800 border-red-200">
          <span className="flex items-start gap-2"><IconAlertTriangle size={14} className="mt-0.5 shrink-0" />{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Fermer" className="shrink-0 opacity-70 hover:opacity-100"><IconX size={14} /></button>
        </div>
      )}

      {/* Progress bar */}
      {scanning && progress && (
        <div className="bg-white border-b border-border px-6 py-2">
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-violet-500 rounded-full transition-all duration-300"
                style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
            <span className="text-[12px] text-muted-foreground tabular-nums shrink-0">{progress.done} / {progress.total}</span>
          </div>
        </div>
      )}

      {/* Summary bar — checks overview */}
      {analysedCount > 0 && (
        <div className="bg-white border-b border-border px-6 py-3">
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-[11px] text-muted-foreground mr-2">Sur {analysedCount} repos analysés :</span>
            {checkCounts.map((c) => (
              <span key={String(c.key)} className={cn(
                "inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border font-medium",
                c.passing === c.total ? "text-green-700 bg-green-50 border-green-200"
                  : c.passing > c.total / 2 ? "text-amber-600 bg-amber-50 border-amber-200"
                  : "text-muted-foreground bg-muted border-border"
              )}>
                {c.icon} {c.label} <span className="opacity-60">{c.passing}/{c.total}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="bg-white border-b border-border px-6 py-3 flex items-center gap-3">
        <div className="relative w-64">
          <Input placeholder="Rechercher…" value={query} onChange={(e) => setQuery(e.target.value)}
            className="h-8 text-[13px] bg-muted/40 border-border" />
        </div>
        <span className="text-[12px] text-muted-foreground">Trier par :</span>
        {(["score", "name", "recent"] as const).map((s) => (
          <button key={s} onClick={() => setSortBy(s)}
            className={cn("text-[12px] px-2.5 py-1 rounded-md transition-colors",
              sortBy === s ? "bg-violet-100 text-violet-700 font-medium" : "text-muted-foreground hover:bg-muted")}>
            {s === "score" ? "Score" : s === "name" ? "Nom" : "Récent"}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 bg-white">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-6 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Score</th>
              <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Repository</th>
              <th className="text-center px-3 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">CI/CD</th>
              <th className="text-center px-3 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Tests</th>
              <th className="text-center px-3 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Lint</th>
              <th className="text-center px-3 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Format</th>
              <th className="text-center px-3 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">TS</th>
              <th className="text-center px-3 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">README</th>
              <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Analysé</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((repo) => {
              const key = `${repo.owner}/${repo.name}`;
              const q = summaries[key];
              const checkedAt = q?.checkedAt
                ? new Date(q.checkedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
                : null;

              return (
                <tr
                  key={repo.id}
                  onClick={() => q && setOpenKey(openKey === key ? null : key)}
                  className={cn("hover:bg-muted/20 transition-colors group border-l-2", q && "cursor-pointer", openKey === key ? "border-l-violet-600 bg-violet-50/40" : "border-l-transparent")}
                >
                  {/* Score */}
                  <td className="px-6 py-3 w-28">
                    {q ? (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden max-w-[48px]">
                          <div className={cn("h-full rounded-full", scoreBg(q.score))}
                            style={{ width: `${q.score}%` }} />
                        </div>
                        <span className={cn("text-[13px] font-semibold tabular-nums", scoreColor(q.score))}>
                          {q.score}
                        </span>
                      </div>
                    ) : (
                      <span className="text-[12px] text-muted-foreground italic">—</span>
                    )}
                  </td>

                  {/* Repo */}
                  <td className="px-4 py-3">
                    <Link href={`/repos/${repo.owner}/${repo.name}`} onClick={(e) => e.stopPropagation()}
                      className="font-medium hover:text-violet-600 transition-colors">
                      {repo.name}
                    </Link>
                    <p className="text-[11px] text-muted-foreground">{repo.owner}</p>
                  </td>

                  {/* Checks */}
                  {(["hasCi","hasTests","hasLint","hasFormat","hasTypes","hasReadme"] as const).map((k) => (
                    <td key={k} className="px-3 py-3 text-center">
                      {q
                        ? q[k]
                          ? <IconCheck size={14} className="text-green-600 mx-auto" />
                          : <IconX size={14} className="text-red-400 mx-auto" />
                        : <span className="text-muted-foreground">—</span>
                      }
                    </td>
                  ))}

                  {/* Date */}
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">
                    {checkedAt ?? <span className="italic">Jamais</span>}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div onClick={(e) => e.stopPropagation()} className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <AnalyzeButton repo={repo} onNotice={setNotice} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="py-16 text-center text-sm text-muted-foreground">
            Aucun repo ne correspond à &quot;{query}&quot;.
          </div>
        )}
      </div>

      {openKey && summaries[openKey] && (() => {
        const q = summaries[openKey];
        const repo = repos.find((r) => `${r.owner}/${r.name}` === openKey);
        const files = (raw: string): string[] => { try { return JSON.parse(raw) as string[]; } catch { return []; } };
        const fileMap: Partial<Record<keyof RepoQualityModel, string[]>> = { hasCi: files(q.ciFiles), hasTests: files(q.testFiles), hasLint: files(q.lintFiles) };
        return (
          <DetailDrawer
            onClose={() => setOpenKey(null)}
            label={`Qualité de ${openKey}`}
            headerRight={repo ? <Link href={`/repos/${repo.owner}/${repo.name}`} className="rounded border border-border px-2.5 py-1 text-[12px] hover:bg-muted">Ouvrir le dépôt</Link> : undefined}
          >
            <div>
              <p className="text-[12px] text-muted-foreground">{openKey} · branche {q.defaultBranch}</p>
              <div className="flex items-baseline gap-2 mt-1">
                <span className={cn("text-3xl font-bold tabular-nums", scoreColor(q.score))}>{q.score}</span>
                <span className="text-sm text-muted-foreground">/ 100</span>
              </div>
              <p className="text-[12px] text-muted-foreground mt-1">Analysé le {new Date(q.checkedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</p>
            </div>
            <DrawerSection title="Bonnes pratiques">
              <ul className="rounded-md border border-border divide-y divide-border">
                {CHECKS.map((c) => {
                  const ok = q[c.key] as boolean;
                  const list = fileMap[c.key] ?? [];
                  return (
                    <li key={c.key as string} className="px-3 py-2.5 text-[12px]">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{c.icon}</span>
                        <span className="font-medium">{c.label}</span>
                        {ok ? <IconCheck size={13} className="text-green-600" /> : <IconX size={13} className="text-red-400" />}
                        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{ok ? c.weight : 0} / {c.weight} pts</span>
                      </div>
                      {list.length > 0 && <p className="font-mono text-[11px] text-muted-foreground mt-1 break-all">{list.slice(0, 5).join(", ")}{list.length > 5 ? ` +${list.length - 5}` : ""}</p>}
                    </li>
                  );
                })}
              </ul>
            </DrawerSection>
          </DetailDrawer>
        );
      })()}
    </div>
  );
}

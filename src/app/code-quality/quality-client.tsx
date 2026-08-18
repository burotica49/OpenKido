"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  IconRefresh, IconLoader2, IconCheck, IconX,
  IconGitBranch, IconTestPipe, IconBraces,
  IconFileText, IconSparkles, IconChartBar,
  IconCode,
} from "@tabler/icons-react";
import type { GithubRepo } from "@/lib/github";
import type { RepoQualityModel } from "@/generated/prisma/models/RepoQuality";
import { analyzeRepo, analyzeAllRepos } from "@/lib/quality";
import { TopBar, PageHeader } from "@/components/app/sidebar";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useSession } from "next-auth/react";

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

function AnalyzeButton({ repo, token }: { repo: GithubRepo; token: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button onClick={(e) => { e.stopPropagation(); start(async () => { await analyzeRepo(token, repo.owner, repo.name, repo.default_branch); router.refresh(); }); }}
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
  const { data: session } = useSession();
  const token = session?.accessToken ?? "";
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"score" | "name" | "recent">("score");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function handleAnalyzeAll() {
    if (!token || scanning) return;
    setScanning(true);
    setProgress({ done: 0, total: repos.length });
    const BATCH = 3;
    let done = 0;
    for (let i = 0; i < repos.length; i += BATCH) {
      const batch = repos.slice(i, i + BATCH);
      await analyzeAllRepos(token, batch.map((r) => ({ owner: r.owner, name: r.name, branch: r.default_branch })));
      done += batch.length;
      setProgress({ done: Math.min(done, repos.length), total: repos.length });
    }
    setScanning(false);
    setProgress(null);
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
          <button onClick={handleAnalyzeAll} disabled={scanning || !token}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 text-[13px] font-medium transition-colors disabled:opacity-60">
            {scanning ? <IconLoader2 size={14} className="animate-spin" /> : <IconRefresh size={14} />}
            {scanning ? `Analyse… ${progress?.done ?? 0}/${progress?.total ?? repos.length}` : "Tout analyser"}
          </button>
        </div>
      </PageHeader>

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
                <tr key={repo.id} className="hover:bg-muted/20 transition-colors group">
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
                    <Link href={`/repos/${repo.owner}/${repo.name}`}
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
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      {token && <AnalyzeButton repo={repo} token={token} />}
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
    </div>
  );
}

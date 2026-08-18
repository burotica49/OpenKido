"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  IconSearch, IconFilter, IconLock, IconExternalLink,
  IconRefresh, IconLoader2, IconShieldCheck, IconBrandGithub,
  IconGitPullRequest, IconCircleCheck, IconCircleX,
  IconAlertTriangle, IconPlayerPlay, IconSettings,
} from "@tabler/icons-react";
import type { GithubRepo, GithubPR } from "@/lib/github";
import type { RepoScanSummary, TrendPoint } from "@/lib/scan";
import { triggerScan, scanAllRepos } from "@/lib/scan";
import { TrendChart } from "@/components/app/trend-chart";
import { Input } from "@/components/ui/input";
import { TopBar, PageHeader } from "@/components/app/sidebar";
import { SevRow } from "@/components/app/severity-badge";
import { cn } from "@/lib/utils";
import { useSession } from "next-auth/react";

const LANG_COLORS: Record<string, string> = {
  JavaScript: "#f1e05a", TypeScript: "#3178c6", Python: "#3572A5",
  PHP: "#4F5D95", Vue: "#41b883", Java: "#b07219", Ruby: "#701516",
  Go: "#00ADD8", Rust: "#dea584", CSS: "#563d7c", HTML: "#e34c26",
};

function LangDot({ lang }: { lang: string }) {
  return <span className="h-2.5 w-2.5 rounded-full shrink-0 inline-block" style={{ background: LANG_COLORS[lang] ?? "#8b8b9a" }} />;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return "aujourd'hui";
  if (d === 1) return "hier";
  if (d < 30) return `il y a ${d}j`;
  const m = Math.floor(d / 30);
  if (m < 12) return `il y a ${m} mois`;
  return `il y a ${Math.floor(m / 12)} an${Math.floor(m / 12) > 1 ? "s" : ""}`;
}

function ScanButton({ repo, token }: { repo: GithubRepo; token: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function handleScan() {
    startTransition(async () => {
      await triggerScan(token, repo.owner, repo.name, repo.default_branch ?? "main");
      router.refresh();
    });
  }
  return (
    <button onClick={(e) => { e.stopPropagation(); handleScan(); }} disabled={pending}
      className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-[12px] text-violet-600 hover:bg-violet-50 transition-colors border border-violet-200 disabled:opacity-50">
      {pending ? <IconLoader2 size={12} className="animate-spin" /> : <IconRefresh size={12} />}
      {pending ? "Scan…" : "Scanner"}
    </button>
  );
}

// ─── Tab Repositories ───────────────────────────────────────────────
function ReposTab({ repos, summaries, token, query, setQuery }: {
  repos: GithubRepo[];
  summaries: Record<string, RepoScanSummary>;
  token: string;
  query: string;
  setQuery: (q: string) => void;
}) {
  const filtered = useMemo(() =>
    repos.filter((r) => r.full_name.toLowerCase().includes(query.toLowerCase())),
    [repos, query]
  );

  return (
    <div className="flex-1 bg-white">
      <div className="flex items-center gap-2 px-6 py-3 border-b border-border">
        <div className="relative w-64">
          <IconSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Rechercher un repo…" value={query} onChange={(e) => setQuery(e.target.value)}
            className="pl-8 h-8 text-[13px] bg-muted/40 border-border" />
        </div>
        <button className="flex items-center gap-1.5 rounded-md border border-border px-3 h-8 text-[13px] text-muted-foreground hover:bg-muted transition-colors">
          <IconFilter size={14} /> Filtrer
        </button>
        <div className="ml-auto">
          <a href="https://github.com/settings/repositories" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 h-8 text-[13px] text-muted-foreground hover:bg-muted transition-colors">
            <IconBrandGithub size={14} /> Gérer sur GitHub
          </a>
        </div>
      </div>

      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="text-left px-6 py-2.5 font-medium text-muted-foreground text-[12px]">Repo</th>
            <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-[12px]">Langage</th>
            <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-[12px]">Issues</th>
            <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-[12px]">Dernier scan</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {filtered.map((repo) => {
            const key = `${repo.owner}/${repo.name}`;
            const summary = summaries[key];
            const lastScan = summary?.scannedAt
              ? new Date(summary.scannedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })
              : null;
            return (
              <tr key={repo.id} className="hover:bg-muted/20 transition-colors group">
                <td className="px-6 py-3">
                  <div className="flex items-center gap-2">
                    <Link href={`/repos/${repo.owner}/${repo.name}`}
                      className="font-medium text-foreground hover:text-violet-600 transition-colors">
                      {repo.name}
                    </Link>
                    {repo.private && <IconLock size={12} className="text-muted-foreground" />}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{repo.owner}</p>
                </td>
                <td className="px-4 py-3">
                  {repo.language
                    ? <div className="flex items-center gap-1.5"><LangDot lang={repo.language} /><span className="text-[13px]">{repo.language}</span></div>
                    : <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-4 py-3">
                  {summary
                    ? summary.total === 0
                      ? <span className="text-[12px] text-muted-foreground">Aucune dépendance</span>
                      : summary.vulnerable === 0
                        ? <span className="inline-flex items-center gap-1 text-[12px] text-green-600 font-medium"><IconShieldCheck size={13} />Sain ({summary.total})</span>
                        : <SevRow critical={summary.critical} high={summary.high} medium={summary.medium} low={summary.low} />
                    : <span className="text-[12px] text-muted-foreground italic">Pas encore scanné</span>}
                </td>
                <td className="px-4 py-3 text-[12px] text-muted-foreground">{lastScan ?? <span className="italic">—</span>}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    {token && <ScanButton repo={repo} token={token} />}
                    <Link href={`/repos/${repo.owner}/${repo.name}`}
                      className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border border-border">
                      <IconPlayerPlay size={12} /> Détail
                    </Link>
                    <a href={`https://github.com/${repo.full_name}`} target="_blank" rel="noopener noreferrer"
                      className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                      <IconExternalLink size={14} />
                    </a>
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
  );
}

// ─── Tab Pull Requests ───────────────────────────────────────────────
function PullRequestsTab({ pullRequests, query, setQuery }: {
  pullRequests: GithubPR[];
  query: string;
  setQuery: (q: string) => void;
}) {
  const filtered = useMemo(() =>
    pullRequests.filter((pr) =>
      pr.title.toLowerCase().includes(query.toLowerCase()) ||
      pr.repoFullName.toLowerCase().includes(query.toLowerCase())
    ),
    [pullRequests, query]
  );

  return (
    <div className="flex-1 bg-white">
      <div className="flex items-center gap-2 px-6 py-3 border-b border-border">
        <div className="relative w-64">
          <IconSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Rechercher une PR…" value={query} onChange={(e) => setQuery(e.target.value)}
            className="pl-8 h-8 text-[13px] bg-muted/40 border-border" />
        </div>
        <span className="ml-auto text-[12px] text-muted-foreground">{pullRequests.length} PR ouvertes</span>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
            <IconGitPullRequest size={20} className="text-muted-foreground" />
          </div>
          <p className="text-[14px] font-medium">Aucune pull request ouverte</p>
          <p className="text-[13px] text-muted-foreground">Vos PRs ouvertes sur tous vos repos apparaîtront ici.</p>
        </div>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-6 py-2.5 font-medium text-muted-foreground text-[12px]">Pull Request</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-[12px]">Repository</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-[12px]">Auteur</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-[12px]">Labels</th>
              <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-[12px]">Ouvert</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((pr) => (
              <tr key={pr.id} className="hover:bg-muted/20 transition-colors">
                <td className="px-6 py-3 max-w-xs">
                  <div className="flex items-start gap-2">
                    <IconGitPullRequest size={14} className={cn("mt-0.5 shrink-0", pr.draft ? "text-muted-foreground" : "text-green-600")} />
                    <div className="min-w-0">
                      <a href={pr.url} target="_blank" rel="noopener noreferrer"
                        className="font-medium hover:text-violet-600 transition-colors line-clamp-1">
                        {pr.title}
                      </a>
                      <p className="text-[11px] text-muted-foreground mt-0.5">#{pr.number}{pr.draft && " · Brouillon"}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/repos/${pr.repoOwner}/${pr.repoName}`}
                    className="text-[12px] text-muted-foreground hover:text-violet-600 transition-colors font-mono">
                    {pr.repoFullName}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    {pr.authorAvatar && (
                      <Image src={pr.authorAvatar} alt="" width={18} height={18} className="rounded-full" />
                    )}
                    <span className="text-[12px] text-muted-foreground">{pr.author}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {pr.labels.filter(Boolean).slice(0, 3).map((l) => (
                      <span key={l} className="inline-flex text-[11px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                        {l}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-[12px] text-muted-foreground whitespace-nowrap">{timeAgo(pr.createdAt)}</td>
                <td className="px-4 py-3">
                  <a href={pr.url} target="_blank" rel="noopener noreferrer"
                    className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors inline-flex">
                    <IconExternalLink size={14} />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Tab Checks ─────────────────────────────────────────────────────
function ChecksTab({ repos, summaries }: {
  repos: GithubRepo[];
  summaries: Record<string, RepoScanSummary>;
}) {
  type CheckStatus = "critical" | "warning" | "ok" | "pending";

  function checkStatus(summary?: RepoScanSummary): CheckStatus {
    if (!summary) return "pending";
    if (summary.critical > 0) return "critical";
    if (summary.high > 0 || summary.medium > 0) return "warning";
    return "ok";
  }

  const STATUS_CONFIG: Record<CheckStatus, { icon: React.ReactNode; label: string; className: string }> = {
    critical: {
      icon: <IconCircleX size={15} />,
      label: "Critique",
      className: "text-red-600",
    },
    warning: {
      icon: <IconAlertTriangle size={15} />,
      label: "Avertissement",
      className: "text-amber-500",
    },
    ok: {
      icon: <IconCircleCheck size={15} />,
      label: "Sain",
      className: "text-green-600",
    },
    pending: {
      icon: <IconCircleCheck size={15} />,
      label: "Non scanné",
      className: "text-muted-foreground",
    },
  };

  const sorted = [...repos].sort((a, b) => {
    const order: CheckStatus[] = ["critical", "warning", "pending", "ok"];
    return order.indexOf(checkStatus(summaries[`${a.owner}/${a.name}`])) -
           order.indexOf(checkStatus(summaries[`${b.owner}/${b.name}`]));
  });

  const counts = { critical: 0, warning: 0, ok: 0, pending: 0 };
  for (const r of repos) counts[checkStatus(summaries[`${r.owner}/${r.name}`])]++;

  return (
    <div className="flex-1 bg-white">
      {/* Summary bar */}
      <div className="flex items-center gap-6 px-6 py-3 border-b border-border bg-muted/20">
        {(["critical", "warning", "ok", "pending"] as CheckStatus[]).map((s) => (
          <div key={s} className={cn("flex items-center gap-1.5 text-[13px]", STATUS_CONFIG[s].className)}>
            {STATUS_CONFIG[s].icon}
            <span className="font-medium tabular-nums">{counts[s]}</span>
            <span className="text-muted-foreground text-[12px]">{STATUS_CONFIG[s].label}</span>
          </div>
        ))}
      </div>

      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="text-left px-6 py-2.5 font-medium text-muted-foreground text-[12px]">Statut</th>
            <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-[12px]">Repository</th>
            <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-[12px]">Issues</th>
            <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-[12px]">Dépendances</th>
            <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-[12px]">Dernier scan</th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sorted.map((repo) => {
            const key = `${repo.owner}/${repo.name}`;
            const summary = summaries[key];
            const status = checkStatus(summary);
            const cfg = STATUS_CONFIG[status];
            const lastScan = summary?.scannedAt
              ? new Date(summary.scannedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
              : null;
            return (
              <tr key={repo.id} className="hover:bg-muted/20 transition-colors">
                <td className="px-6 py-3">
                  <div className={cn("flex items-center gap-1.5 font-medium", cfg.className)}>
                    {cfg.icon}
                    <span className="text-[12px]">{cfg.label}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/repos/${repo.owner}/${repo.name}`}
                    className="font-medium hover:text-violet-600 transition-colors">
                    {repo.name}
                  </Link>
                  <p className="text-[11px] text-muted-foreground">{repo.owner}</p>
                </td>
                <td className="px-4 py-3">
                  {summary && summary.vulnerable > 0
                    ? <SevRow critical={summary.critical} high={summary.high} medium={summary.medium} low={summary.low} />
                    : <span className="text-[12px] text-muted-foreground">—</span>}
                </td>
                <td className="px-4 py-3 text-[12px] text-muted-foreground tabular-nums">
                  {summary ? `${summary.total} dép.` : "—"}
                </td>
                <td className="px-4 py-3 text-[12px] text-muted-foreground">
                  {lastScan ?? <span className="italic">Jamais</span>}
                </td>
                <td className="px-4 py-3">
                  <Link href={`/repos/${repo.owner}/${repo.name}`}
                    className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border border-border opacity-0 group-hover:opacity-100">
                    <IconSettings size={12} /> Détail
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Composant principal ─────────────────────────────────────────────
type Tab = "repos" | "pullrequests" | "checks";

export function ReposClient({
  repos,
  pullRequests,
  summaries,
  trend,
}: {
  repos: GithubRepo[];
  pullRequests: GithubPR[];
  summaries: Record<string, RepoScanSummary>;
  trend: TrendPoint[];
}) {
  const { data: session } = useSession();
  const token = session?.accessToken ?? "";
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("repos");
  const [scanningAll, setScanningAll] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null);

  async function handleScanAll() {
    if (!token || scanningAll) return;
    setScanningAll(true);
    setScanProgress({ done: 0, total: repos.length });
    const BATCH = 5;
    let done = 0;
    for (let i = 0; i < repos.length; i += BATCH) {
      const batch = repos.slice(i, i + BATCH);
      await scanAllRepos(token, batch.map((r) => ({ owner: r.owner, name: r.name, branch: r.default_branch ?? "main" })));
      done += batch.length;
      setScanProgress({ done: Math.min(done, repos.length), total: repos.length });
    }
    setScanningAll(false);
    setScanProgress(null);
    router.refresh();
  }

  const scannedCount = Object.keys(summaries).length;

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "repos", label: "Repositories", count: repos.length },
    { id: "pullrequests", label: "Pull Requests", count: pullRequests.length },
    { id: "checks", label: "Checks", count: repos.length },
  ];

  return (
    <div className="flex flex-col flex-1 bg-background">
      <TopBar breadcrumb="Repositories" />

      <PageHeader title="Repositories">
        <div className="flex items-center gap-2">
          {scannedCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium bg-violet-50 text-violet-700 border border-violet-200">
              <IconShieldCheck size={12} />{scannedCount} scannés
            </span>
          )}
          <button onClick={handleScanAll} disabled={scanningAll || !token}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 text-[13px] font-medium transition-colors disabled:opacity-60">
            {scanningAll ? <IconLoader2 size={14} className="animate-spin" /> : <IconRefresh size={14} />}
            {scanningAll ? `Scan… ${scanProgress?.done ?? 0}/${scanProgress?.total ?? repos.length}` : "Tout scanner"}
          </button>
        </div>
      </PageHeader>

      {/* Progress bar */}
      {scanningAll && scanProgress && (
        <div className="bg-white border-b border-border px-6 py-2">
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-violet-500 rounded-full transition-all duration-300"
                style={{ width: `${(scanProgress.done / scanProgress.total) * 100}%` }} />
            </div>
            <span className="text-[12px] text-muted-foreground tabular-nums shrink-0">
              {scanProgress.done} / {scanProgress.total}
            </span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white border-b border-border px-6">
        <div className="flex items-end gap-0">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => { setTab(t.id); setQuery(""); }}
              className={cn("px-4 py-2.5 text-[13px] border-b-2 -mb-px transition-colors flex items-center gap-1.5",
                t.id === tab ? "border-violet-600 text-violet-600 font-medium" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className={cn("text-[11px] px-1.5 py-0.5 rounded-full tabular-nums min-w-[20px] text-center",
                  t.id === tab ? "bg-violet-100 text-violet-700" : "bg-muted text-muted-foreground")}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {tab === "repos" && <ReposTab repos={repos} summaries={summaries} token={token} query={query} setQuery={setQuery} />}
      {tab === "pullrequests" && <PullRequestsTab pullRequests={pullRequests} query={query} setQuery={setQuery} />}
      {tab === "checks" && (
        <div className="flex-1 bg-white">
          <TrendChart points={trend} />
          <ChecksTab repos={repos} summaries={summaries} />
        </div>
      )}
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  IconRefresh, IconLoader2, IconCheck, IconShieldCheck,
  IconBug, IconKey, IconAlertTriangle, IconSearch,
  IconCode, IconGitBranch,
} from "@tabler/icons-react";
import { useSession } from "next-auth/react";
import type { GithubRepo } from "@/lib/github";
import type { AuditSummary } from "@/lib/audit";
import { auditRepo, auditAllRepos } from "@/lib/audit";
import { PageHeader } from "@/components/app/sidebar";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ─── Severity badge ────────────────────────────────────────────────────────────

type Sev = "critical" | "high" | "medium" | "low";

const SEV_STYLE: Record<Sev, string> = {
  critical: "bg-red-100 text-red-700",
  high:     "bg-orange-100 text-orange-700",
  medium:   "bg-amber-100 text-amber-700",
  low:      "bg-blue-100 text-blue-700",
};

function SevBadge({ count, sev }: { count: number; sev: Sev }) {
  if (count === 0) return null;
  return (
    <span className={cn("text-[11px] px-1.5 py-0.5 rounded font-semibold tabular-nums", SEV_STYLE[sev])}>
      {sev[0].toUpperCase()} {count}
    </span>
  );
}

function totalAlerts(s: AuditSummary) {
  return s.csTotal + s.dbTotal + s.ssActive;
}

function worstSeverity(s: AuditSummary): Sev | null {
  if (s.csCritical + s.dbCritical + s.ssActive > 0) return "critical";
  if (s.csHigh + s.dbHigh > 0) return "high";
  if (s.csMedium + s.dbMedium > 0) return "medium";
  if (s.csLow + s.dbLow > 0) return "low";
  return null;
}

const SOURCE_LABEL: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  code_scanning:  { label: "Code Scanning", icon: <IconCode size={12} />,  color: "text-violet-600" },
  dependabot:     { label: "Dependabot",    icon: <IconBug size={12} />,   color: "text-orange-500" },
  secret_scanning:{ label: "Secrets",       icon: <IconKey size={12} />,   color: "text-red-600" },
};

// ─── Audit button per repo ─────────────────────────────────────────────────────

function AuditButton({ repo, token }: { repo: GithubRepo; token: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      onClick={(e) => { e.stopPropagation(); start(async () => { await auditRepo(token, repo.owner, repo.name); router.refresh(); }); }}
      disabled={pending}
      className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-[12px] text-violet-600 hover:bg-violet-50 border border-violet-200 transition-colors disabled:opacity-50"
    >
      {pending ? <IconLoader2 size={12} className="animate-spin" /> : <IconRefresh size={12} />}
      {pending ? "Audit…" : "Auditer"}
    </button>
  );
}

// ─── Stats card ────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, tone = "default" }: {
  icon: React.ReactNode; label: string; value: number | string;
  sub?: string; tone?: "ok" | "warning" | "critical" | "default";
}) {
  const toneClass = { ok: "text-green-600", warning: "text-amber-500", critical: "text-red-600", default: "text-foreground" }[tone];
  return (
    <div className="px-6 py-4 border-r border-border last:border-0">
      <div className="flex items-center gap-1.5 mb-1 text-muted-foreground text-[11px] uppercase tracking-wider">
        {icon}<span>{label}</span>
      </div>
      <p className={cn("text-2xl font-semibold tabular-nums", toneClass)}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function CodeAuditClient({
  repos,
  summaries,
}: {
  repos: GithubRepo[];
  summaries: Record<string, AuditSummary>;
}) {
  const { data: session } = useSession();
  const token = session?.accessToken ?? "";
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "issues" | "secrets" | "clean">("all");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function handleAuditAll() {
    if (!token || scanning) return;
    setScanning(true);
    setProgress({ done: 0, total: repos.length });
    const BATCH = 5;
    let done = 0;
    for (let i = 0; i < repos.length; i += BATCH) {
      const batch = repos.slice(i, i + BATCH);
      await auditAllRepos(token, batch.map((r) => ({ owner: r.owner, name: r.name })));
      done += batch.length;
      setProgress({ done: Math.min(done, repos.length), total: repos.length });
    }
    setScanning(false);
    setProgress(null);
    router.refresh();
  }

  // Aggregate stats
  const audited = Object.values(summaries);
  const totalCritical = audited.reduce((a, s) => a + s.csCritical + s.dbCritical + s.ssActive, 0);
  const totalHigh = audited.reduce((a, s) => a + s.csHigh + s.dbHigh, 0);
  const totalSecrets = audited.reduce((a, s) => a + s.ssActive, 0);
  const cleanRepos = audited.filter((s) => totalAlerts(s) === 0).length;

  const filtered = repos
    .filter((r) => r.full_name.toLowerCase().includes(query.toLowerCase()))
    .filter((r) => {
      const s = summaries[`${r.owner}/${r.name}`];
      if (filter === "issues") return s && totalAlerts(s) > 0;
      if (filter === "secrets") return s && s.ssActive > 0;
      if (filter === "clean") return s && totalAlerts(s) === 0;
      return true;
    })
    .sort((a, b) => {
      const sa = summaries[`${a.owner}/${a.name}`];
      const sb = summaries[`${b.owner}/${b.name}`];
      return (totalAlerts(sb ?? { csTotal:0,dbTotal:0,ssActive:0 } as AuditSummary))
           - (totalAlerts(sa ?? { csTotal:0,dbTotal:0,ssActive:0 } as AuditSummary));
    });

  return (
    <div className="flex flex-col flex-1 bg-background">
      <PageHeader title="Code Audit" subtitle="Analyse SAST, Dependabot et secrets exposés via GitHub">
        <div className="flex items-center gap-2">
          <button
            onClick={handleAuditAll}
            disabled={scanning || !token}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 text-[13px] font-medium transition-colors disabled:opacity-60"
          >
            {scanning ? <IconLoader2 size={14} className="animate-spin" /> : <IconRefresh size={14} />}
            {scanning ? `Audit… ${progress?.done ?? 0}/${progress?.total ?? repos.length}` : "Tout auditer"}
          </button>
        </div>
      </PageHeader>

      {/* Progress bar */}
      {scanning && progress && (
        <div className="bg-white border-b border-border px-6 py-2">
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-violet-500 rounded-full transition-all duration-300"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
            <span className="text-[12px] text-muted-foreground tabular-nums shrink-0">{progress.done} / {progress.total}</span>
          </div>
        </div>
      )}

      {/* Stats bar */}
      {audited.length > 0 && (
        <div className="grid grid-cols-4 bg-white border-b border-border">
          <StatCard icon={<IconAlertTriangle size={14} />} label="Critiques" value={totalCritical}
            tone={totalCritical > 0 ? "critical" : "ok"}
            sub={totalCritical === 0 ? "Aucune" : "Action immédiate"} />
          <StatCard icon={<IconBug size={14} />} label="Élevées" value={totalHigh}
            tone={totalHigh > 0 ? "warning" : "ok"} />
          <StatCard icon={<IconKey size={14} />} label="Secrets exposés" value={totalSecrets}
            tone={totalSecrets > 0 ? "critical" : "ok"}
            sub={totalSecrets === 0 ? "Aucun détecté" : "Rotation requise"} />
          <StatCard icon={<IconShieldCheck size={14} />} label="Repos sains" value={`${cleanRepos}/${audited.length}`}
            tone={cleanRepos === audited.length ? "ok" : "default"} />
        </div>
      )}

      {/* Toolbar */}
      <div className="bg-white border-b border-border px-6 py-3 flex items-center gap-3">
        <div className="w-64">
          <Input placeholder="Rechercher…" value={query} onChange={(e) => setQuery(e.target.value)}
            className="h-8 text-[13px] bg-muted/40 border-border" />
        </div>
        {(["all", "issues", "secrets", "clean"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn("text-[12px] px-2.5 py-1 rounded-md transition-colors",
              filter === f ? "bg-violet-100 text-violet-700 font-medium" : "text-muted-foreground hover:bg-muted")}>
            {{ all: "Tous", issues: "Avec alertes", secrets: "Secrets", clean: "Sains" }[f]}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 bg-white">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-6 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Repository</th>
              <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                <span className="flex items-center gap-1"><IconCode size={12} /> Code Scanning</span>
              </th>
              <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                <span className="flex items-center gap-1"><IconBug size={12} /> Dependabot</span>
              </th>
              <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                <span className="flex items-center gap-1"><IconKey size={12} /> Secrets</span>
              </th>
              <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Audité</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((repo) => {
              const key = `${repo.owner}/${repo.name}`;
              const s = summaries[key];
              const checkedAt = s?.checkedAt
                ? new Date(s.checkedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
                : null;
              const worst = s ? worstSeverity(s) : null;

              return (
                <tr key={repo.id} className="hover:bg-muted/20 transition-colors group">
                  {/* Repo name */}
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      {worst ? (
                        <span className={cn("h-2 w-2 rounded-full shrink-0", {
                          "bg-red-500": worst === "critical",
                          "bg-orange-500": worst === "high",
                          "bg-amber-400": worst === "medium",
                          "bg-blue-400": worst === "low",
                        })} />
                      ) : s ? (
                        <IconCheck size={12} className="text-green-500 shrink-0" />
                      ) : (
                        <span className="h-2 w-2 rounded-full bg-muted shrink-0" />
                      )}
                      <div>
                        <Link href={`/code-audit/${repo.owner}/${repo.name}`}
                          className="font-medium hover:text-violet-600 transition-colors">
                          {repo.name}
                        </Link>
                        <p className="text-[11px] text-muted-foreground">{repo.owner}</p>
                      </div>
                    </div>
                  </td>

                  {/* Code Scanning */}
                  <td className="px-4 py-3">
                    {s ? (
                      s.csTotal === 0
                        ? <span className="text-[12px] text-green-600 flex items-center gap-1"><IconCheck size={12} /> Aucune</span>
                        : <div className="flex items-center gap-1 flex-wrap">
                            <SevBadge count={s.csCritical} sev="critical" />
                            <SevBadge count={s.csHigh} sev="high" />
                            <SevBadge count={s.csMedium} sev="medium" />
                            <SevBadge count={s.csLow} sev="low" />
                          </div>
                    ) : <span className="text-muted-foreground text-[12px] italic">—</span>}
                  </td>

                  {/* Dependabot */}
                  <td className="px-4 py-3">
                    {s ? (
                      s.dbTotal === 0
                        ? <span className="text-[12px] text-green-600 flex items-center gap-1"><IconCheck size={12} /> Aucune</span>
                        : <div className="flex items-center gap-1 flex-wrap">
                            <SevBadge count={s.dbCritical} sev="critical" />
                            <SevBadge count={s.dbHigh} sev="high" />
                            <SevBadge count={s.dbMedium} sev="medium" />
                            <SevBadge count={s.dbLow} sev="low" />
                          </div>
                    ) : <span className="text-muted-foreground text-[12px] italic">—</span>}
                  </td>

                  {/* Secrets */}
                  <td className="px-4 py-3">
                    {s ? (
                      s.ssActive === 0
                        ? <span className="text-[12px] text-green-600 flex items-center gap-1"><IconCheck size={12} /> Aucun</span>
                        : <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold">
                            <IconKey size={10} /> {s.ssActive}
                          </span>
                    ) : <span className="text-muted-foreground text-[12px] italic">—</span>}
                  </td>

                  {/* Date */}
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">
                    {checkedAt ?? <span className="italic">Jamais</span>}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      {token && <AuditButton repo={repo} token={token} />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="py-16 text-center text-sm text-muted-foreground">
            Aucun repo ne correspond à la sélection.
          </div>
        )}
      </div>
    </div>
  );
}

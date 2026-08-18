import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getOctokit } from "@/lib/github";
import { scanRepo } from "@/lib/scan";
import { SevRow, SevCircle } from "@/components/app/severity-badge";
import { buttonVariants } from "@/components/ui/button";
import {
  IconAlertTriangle, IconPackage, IconSparkles,
  IconClockExclamation, IconArrowRight,
} from "@tabler/icons-react";

export const dynamic = "force-dynamic";

export default async function RepoDashboardPage({
  params,
}: { params: Promise<{ owner: string; repoName: string }> }) {
  const { owner, repoName } = await params;
  const session = await auth();
  if (!session?.accessToken) redirect("/");

  const octokit = getOctokit(session.accessToken);
  let branch = "main";
  try {
    const { data } = await octokit.repos.get({ owner, repo: repoName });
    branch = data.default_branch;
  } catch {}

  const scan = await scanRepo(session.accessToken, owner, repoName, branch);

  const top5 = scan.components
    .filter((c) => c.vulnCount > 0)
    .sort((a, b) => ["CRITICAL","HIGH","MEDIUM","LOW","UNKNOWN"].indexOf(a.topSeverity) - ["CRITICAL","HIGH","MEDIUM","LOW","UNKNOWN"].indexOf(b.topSeverity))
    .slice(0, 5);

  return (
    <div className="px-6 py-5 space-y-5 max-w-5xl">

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Composants scannés" value={scan.total} />
        <StatCard label="Vulnérables" value={scan.vulnerable} highlight={scan.vulnerable > 0 ? "warning" : undefined} />
        <StatCard label="Critiques" value={scan.severityBreakdown.CRITICAL} highlight={scan.severityBreakdown.CRITICAL > 0 ? "critical" : undefined} />
        <StatCard label="Sains" value={scan.total - scan.vulnerable} highlight="ok" />
      </div>

      {/* Issues breakdown */}
      <div className="rounded-lg border border-border bg-white overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <span className="text-[13px] font-medium">Issues par sévérité</span>
          <span className="text-[12px] text-muted-foreground">
            Scan du {new Date(scan.scannedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
        <div className="px-5 py-4 flex items-center gap-6">
          <div className="flex flex-col items-center gap-1">
            <SevCircle severity="CRITICAL" count={scan.severityBreakdown.CRITICAL} />
            <span className="text-[11px] text-muted-foreground">Critical</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <SevCircle severity="HIGH" count={scan.severityBreakdown.HIGH} />
            <span className="text-[11px] text-muted-foreground">High</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <SevCircle severity="MEDIUM" count={scan.severityBreakdown.MEDIUM} />
            <span className="text-[11px] text-muted-foreground">Medium</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <SevCircle severity="LOW" count={scan.severityBreakdown.LOW} />
            <span className="text-[11px] text-muted-foreground">Low</span>
          </div>
        </div>
      </div>

      {/* Top vulnerabilities */}
      {top5.length > 0 && (
        <div className="rounded-lg border border-border bg-white overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <IconAlertTriangle size={14} className="text-amber-500" />
              <span className="text-[13px] font-medium">Vulnérabilités prioritaires</span>
            </div>
            <Link href={`/repos/${owner}/${repoName}/inventory`} className="text-[12px] text-violet-600 hover:underline flex items-center gap-1">
              Voir tout <IconArrowRight size={12} />
            </Link>
          </div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="text-left px-5 py-2 text-[11px] font-medium text-muted-foreground">Composant</th>
                <th className="text-left px-4 py-2 text-[11px] font-medium text-muted-foreground">Version</th>
                <th className="text-left px-4 py-2 text-[11px] font-medium text-muted-foreground">Sévérité</th>
                <th className="text-left px-4 py-2 text-[11px] font-medium text-muted-foreground">CVEs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {top5.map((c) => (
                <tr key={`${c.name}@${c.version}:${c.source ?? ""}`} className="hover:bg-muted/20 transition-colors">
                  <td className="px-5 py-2.5">
                    <Link href={`/repos/${owner}/${repoName}/components/${c.name}`} className="flex items-center gap-1.5 font-mono text-xs font-medium hover:text-violet-600 transition-colors">
                      <IconPackage size={13} className="text-muted-foreground" />
                      {c.name}
                    </Link>
                    {c.source && c.source !== "package.json" && (
                      <p className="text-[11px] text-muted-foreground font-mono mt-0.5 pl-[19px]">
                        {c.source.replace(/\/package\.json$/, "")}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{c.version}</td>
                  <td className="px-4 py-2.5">
                    <SevCircle severity={c.topSeverity} count={1} />
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground tabular-nums">{c.vulnCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {scan.total === 0 && (
        <div className="rounded-lg border border-border bg-white px-5 py-10 flex flex-col items-center gap-3 text-center">
          <IconClockExclamation size={28} className="text-muted-foreground" />
          <p className="text-sm font-medium">Aucune dépendance détectée</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Pas de <code className="font-mono">package.json</code> ni de <code className="font-mono">requirements.txt</code> trouvé (racine et sous-dossiers).
          </p>
        </div>
      )}

      {scan.total > 0 && scan.vulnerable === 0 && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-5 py-4 flex items-center gap-3">
          <IconSparkles size={18} className="text-green-600 shrink-0" />
          <div>
            <p className="text-[13px] font-medium text-green-900">Aucune vulnérabilité détectée</p>
            <p className="text-xs text-green-700 mt-0.5">{scan.total} composants scannés via OSV.dev, tous sains.</p>
          </div>
        </div>
      )}

      <div>
        <Link href={`/repos/${owner}/${repoName}/inventory`} className={buttonVariants({ size: "sm" })}>
          Voir l&apos;inventaire complet
        </Link>
      </div>
    </div>
  );
}

function StatCard({ label, value, highlight }: { label: string; value: number; highlight?: "critical" | "warning" | "ok" }) {
  const palette: Record<string, string> = {
    critical: "text-red-600",
    warning:  "text-amber-600",
    ok:       "text-green-600",
  };
  const valueClass = (highlight ? palette[highlight] : undefined) ?? "text-foreground";
  return (
    <div className="rounded-lg border border-border bg-white px-4 py-3.5">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${valueClass}`}>{value}</p>
    </div>
  );
}

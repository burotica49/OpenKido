import Link from "next/link";
import { loadRepoScan } from "@/lib/repo-page";
import { getScanTrend } from "@/lib/scan";
import { TrendChart } from "@/components/app/trend-chart";
import { ScanStatusBanner } from "@/components/app/scan-status-banner";
import { NeverScanned } from "@/components/app/never-scanned";
import { ScanNowButton } from "@/components/app/scan-now-button";
import { SevCircle } from "@/components/app/severity-badge";
import { ComponentsTable } from "@/components/app/components-table";
import { versionsByName } from "@/lib/components-util";
import { buttonVariants } from "@/components/ui/button";
import {
  IconAlertTriangle, IconSparkles,
  IconClockExclamation, IconArrowRight,
} from "@tabler/icons-react";

export const dynamic = "force-dynamic";

export default async function RepoDashboardPage({
  params,
}: { params: Promise<{ owner: string; repoName: string }> }) {
  const { owner, repoName } = await params;
  const { scan } = await loadRepoScan(owner, repoName);
  if (!scan) {
    return (
      <div className="px-6 py-5">
        <NeverScanned owner={owner} repo={repoName} />
      </div>
    );
  }
  const trend = await getScanTrend([{ owner, name: repoName }]);
  const healthy = scan.components.filter((c) => c.status === "sain").length;

  const top5 = scan.components
    .filter((c) => c.vulnCount > 0)
    .sort((a, b) => ["CRITICAL","HIGH","MEDIUM","LOW","UNKNOWN"].indexOf(a.topSeverity) - ["CRITICAL","HIGH","MEDIUM","LOW","UNKNOWN"].indexOf(b.topSeverity))
    .slice(0, 5);

  return (
    <div className="px-6 py-5 space-y-5">
      <ScanStatusBanner scan={scan} />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Composants scannés" value={scan.total} />
        <StatCard label="Vulnérables" value={scan.vulnerable} highlight={scan.vulnerable > 0 ? "warning" : undefined} />
        <StatCard label="Critiques" value={scan.severityBreakdown.CRITICAL} highlight={scan.severityBreakdown.CRITICAL > 0 ? "critical" : undefined} />
        <StatCard label="Sains" value={healthy} highlight="ok" />
      </div>

      {/* Issues breakdown */}
      <div className="rounded-lg border border-border bg-white overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <span className="text-[13px] font-medium">Issues par sévérité</span>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-muted-foreground">
              Scan du {new Date(scan.scannedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}
            </span>
            <ScanNowButton owner={owner} repo={repoName} />
          </div>
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

      {/* Évolution des vulnérabilités */}
      <div className="rounded-lg border border-border bg-white overflow-hidden">
        <TrendChart points={trend} />
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
          <ComponentsTable owner={owner} repo={repoName} rows={top5} versionsByName={versionsByName(scan.components, top5)} variant="overview" />
        </div>
      )}

      {scan.total === 0 && scan.status === "complete" && (
        <div className="rounded-lg border border-border bg-white px-5 py-10 flex flex-col items-center gap-3 text-center">
          <IconClockExclamation size={28} className="text-muted-foreground" />
          <p className="text-sm font-medium">Aucune dépendance détectée</p>
          <p className="text-xs text-muted-foreground max-w-xs">
            Aucun lockfile ni manifeste de dépendances reconnu (npm, yarn, pnpm, pip, Go, Rust, PHP, Ruby, Maven…) dans ce dépôt.
          </p>
        </div>
      )}

      {scan.total > 0 && scan.vulnerable === 0 && scan.status === "complete" && scan.unscanned === 0 && (
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

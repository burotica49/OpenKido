import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listRepos, getGithubLogin } from "@/lib/github";
import { riskLevel } from "@/lib/osv";
import { frameworks, evaluateFramework, type FrameworkReport } from "@/lib/compliance";
import type { ScanResult } from "@/lib/scan";
import { getRepoScanSummaries } from "@/lib/scan";
import { getSelectedOrg, filterReposByOrg } from "@/lib/selected-org";
import { TopBar, PageHeader } from "@/components/app/sidebar";
import { ComplianceClient } from "./compliance-client";

export const dynamic = "force-dynamic";

export default async function CompliancePage() {
  const session = await auth();
  if (!session?.accessToken) redirect("/");

  const login = session.githubLogin ?? await getGithubLogin(session.accessToken);

  const allRepos = await listRepos(session.accessToken);
  const selectedOrg = await getSelectedOrg();
  const filteredRepos = filterReposByOrg(allRepos, selectedOrg, login);

  // Read from DB — no live scanning
  const summaryMap = await getRepoScanSummaries(
    filteredRepos.map((r) => ({ owner: r.owner, name: r.name }))
  );

  // Convert DB summaries to ScanResult shape for compliance evaluation
  const scans: ScanResult[] = [];
  for (const [, s] of summaryMap) {
    const breakdown = { CRITICAL: s.critical, HIGH: s.high, MEDIUM: s.medium, LOW: s.low };
    const riskScore = s.critical * 10 + s.high * 5 + s.medium * 2 + s.low;
    scans.push({
      owner: s.owner,
      repo: s.repo,
      branch: "",
      scannedAt: s.scannedAt ? s.scannedAt.toISOString() : new Date(0).toISOString(),
      riskScore,
      level: riskLevel(riskScore),
      total: s.total,
      vulnerable: s.vulnerable,
      components: [],
      severityBreakdown: breakdown,
    });
  }

  const scannedCount = scans.length;
  const reports: FrameworkReport[] = frameworks.map((f) => evaluateFramework(f, scans));
  const globalScore = reports.length > 0
    ? Math.round(reports.reduce((acc, r) => acc + r.score, 0) / reports.length)
    : 0;
  const totalCritical = scans.reduce((acc, s) => acc + s.severityBreakdown.CRITICAL, 0);
  const totalVuln = scans.reduce((acc, s) => acc + s.vulnerable, 0);
  const totalComponents = scans.reduce((acc, s) => acc + s.total, 0);

  return (
    <div className="flex flex-col flex-1 bg-background">
      <TopBar breadcrumb="Conformité" />
      <PageHeader
        title="Conformité"
        subtitle={`${scannedCount} repos analysés · score global ${globalScore} %`}
      />
      <ComplianceClient
        reports={reports}
        globalScore={globalScore}
        scannedRepos={scannedCount}
        totalComponents={totalComponents}
        totalVuln={totalVuln}
        totalCritical={totalCritical}
      />
    </div>
  );
}

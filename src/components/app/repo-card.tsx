import Link from "next/link";
import { IconBrandGithub, IconLock, IconAlertTriangle, IconBug, IconClock } from "@tabler/icons-react";
import type { GithubRepo } from "@/lib/github";
import type { ScanResult } from "@/lib/scan";
import { RiskBadge, RiskBar } from "@/components/app/risk-badge";
import { cn } from "@/lib/utils";

export function RepoCard({ repo, scan }: { repo: GithubRepo; scan?: ScanResult | null }) {
  const href = `/repos/${repo.owner}/${repo.name}`;

  return (
    <Link
      href={href}
      className="group flex flex-col gap-3.5 rounded-xl border border-border bg-card px-4 py-3.5 transition-all hover:border-border/80 hover:bg-card/80"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <IconBrandGithub size={16} stroke={1.75} className="text-muted-foreground shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-[13px] font-medium truncate">
              <span className="text-muted-foreground">{repo.owner} / </span>
              {repo.name}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[11px] text-muted-foreground">{repo.default_branch}</span>
              {repo.language && (
                <span className="text-[11px] text-muted-foreground">· {repo.language}</span>
              )}
              {repo.private && (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  · <IconLock size={10} /> Privé
                </span>
              )}
            </div>
          </div>
        </div>
        {scan ? (
          <RiskBadge level={scan.level} />
        ) : (
          <span className="badge-muted inline-flex rounded px-2 py-0.5 text-[11px]">Non scanné</span>
        )}
      </div>

      {scan ? (
        <>
          <RiskBar score={scan.riskScore} level={scan.level} />
          <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
            <span className={cn("flex items-center gap-1", scan.vulnerable > 0 && "text-amber-500")}>
              <IconAlertTriangle size={12} />
              {scan.vulnerable} vulnérable{scan.vulnerable > 1 ? "s" : ""}
            </span>
            <span className="flex items-center gap-1">
              <IconBug size={12} />
              {scan.total} composants
            </span>
            <span className="ml-auto flex items-center gap-1">
              <IconClock size={11} />
              {new Date(scan.scannedAt).toLocaleDateString("fr-FR")}
            </span>
          </div>
        </>
      ) : (
        <p className="text-[12px] text-muted-foreground">Ouvrez le repo pour lancer le scan.</p>
      )}
    </Link>
  );
}

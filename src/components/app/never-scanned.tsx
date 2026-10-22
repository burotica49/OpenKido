import { IconClockExclamation } from "@tabler/icons-react";
import { ScanNowButton } from "@/components/app/scan-now-button";

export function NeverScanned({ owner, repo }: { owner: string; repo: string }) {
  return (
    <div className="rounded-lg border border-border bg-white px-5 py-10 flex flex-col items-center gap-3 text-center">
      <IconClockExclamation size={28} className="text-muted-foreground" />
      <p className="text-sm font-medium">Ce dépôt n&apos;a pas encore été scanné</p>
      <p className="text-xs text-muted-foreground max-w-sm">
        Le scan lit les lockfiles et manifestes du dépôt (npm, yarn, pnpm, pip, Go, Rust, PHP, Ruby, Maven…) puis interroge OSV.dev.
      </p>
      <ScanNowButton owner={owner} repo={repo} label="Lancer le scan" primary />
    </div>
  );
}

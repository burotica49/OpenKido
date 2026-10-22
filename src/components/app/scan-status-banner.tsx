import { IconAlertTriangle, IconInfoCircle } from "@tabler/icons-react";
import type { ScanResult } from "@/lib/scan";
import { ScanNowButton } from "@/components/app/scan-now-button";

/** Signale un scan incomplet (résultat = borne basse) ou enregistré dans un ancien format. */
export function ScanStatusBanner({ scan }: { scan: ScanResult }) {
  if (scan.status === "partial") {
    return (
      <div className="flex items-start justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="flex items-start gap-2.5 text-amber-900">
          <IconAlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="text-[13px] font-medium">Scan incomplet — les chiffres ci-dessous sont un minimum</p>
            <ul className="mt-1 list-disc pl-4 text-[12px] text-amber-800 space-y-0.5">
              {scan.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          </div>
        </div>
        <ScanNowButton owner={scan.owner} repo={scan.repo} />
      </div>
    );
  }
  if (scan.legacy) {
    return (
      <div className="flex items-center justify-between gap-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
        <div className="flex items-center gap-2.5 text-blue-900">
          <IconInfoCircle size={16} className="shrink-0" />
          <p className="text-[13px]">Ce scan a été enregistré avant l&apos;ajout du détail des vulnérabilités : relancez-le pour les afficher.</p>
        </div>
        <ScanNowButton owner={scan.owner} repo={scan.repo} />
      </div>
    );
  }
  return null;
}

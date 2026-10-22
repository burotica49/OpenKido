"use client";

import Link from "next/link";
import { IconExternalLink, IconPackage } from "@tabler/icons-react";
import { DetailDrawer, DrawerSection } from "@/components/app/detail-drawer";
import { SeverityBadge } from "@/components/app/risk-badge";
import { classifyLicense } from "@/lib/licenses-core";
import { pickFix } from "@/lib/issues-core";
import type { ScannedComponent } from "@/lib/scan";
import { cn } from "@/lib/utils";

function Tag({ children, tone = "muted", title }: { children: React.ReactNode; tone?: "muted" | "amber" | "violet"; title?: string }) {
  return (
    <span
      title={title}
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium",
        tone === "muted" && "bg-muted text-muted-foreground",
        tone === "amber" && "bg-amber-50 text-amber-700",
        tone === "violet" && "bg-violet-50 text-violet-700"
      )}
    >
      {children}
    </span>
  );
}

export function ComponentTags({ c }: { c: ScannedComponent }) {
  return (
    <>
      {c.direct === true && <Tag tone="violet">direct</Tag>}
      {c.direct === false && <Tag>transitif</Tag>}
      {c.scope === "dev" && <Tag>dev</Tag>}
      {!c.resolved && <Tag tone="amber" title="Plage déclarée, version installée inconnue">plage</Tag>}
    </>
  );
}

/** Détail d'un composant (toutes ses versions présentes dans le dépôt) dans un panneau à droite. */
export function ComponentDrawer({ owner, repo, versions, onClose }: { owner: string; repo: string; versions: ScannedComponent[]; onClose: () => void }) {
  const first = versions[0];
  const fix = pickFix(versions.flatMap((c) => c.vulns));
  const license = first.license ? classifyLicense(first.license) : null;

  return (
    <DetailDrawer
      onClose={onClose}
      label={`Détail de ${first.name}`}
      width={560}
      headerRight={
        <Link href={`/repos/${owner}/${repo}/components/${encodeURIComponent(first.name)}`} className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-[12px] hover:bg-muted">
          Ouvrir la page <IconExternalLink size={12} />
        </Link>
      }
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted shrink-0"><IconPackage size={20} className="text-muted-foreground" /></div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold font-mono break-all">{first.name}</h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">
            {first.ecosystem}{versions.length > 1 ? ` · ${versions.length} versions présentes` : ` · v${first.version}`}{first.source ? ` · ${first.source}` : ""}
          </p>
        </div>
      </div>

      <DrawerSection title="En résumé">
        <p className="text-[13px] leading-relaxed">
          {versions.every((c) => c.status === "non-analysé")
            ? "Ce composant n'a pas pu être analysé (OSV injoignable lors du scan) : on ne sait pas s'il est vulnérable."
            : fix.none && versions.some((c) => c.vulnCount > 0)
              ? "Des failles connues touchent ce composant, mais aucune version corrigée n'est publiée."
              : fix.version
                ? <>Des failles connues touchent ce composant. Mettre à jour vers <span className="font-mono rounded bg-green-50 text-green-700 px-1.5 py-0.5">{fix.version}</span> ou plus récent.</>
                : "Aucune faille connue pour la version présente dans ce dépôt."}
        </p>
        {license && (
          <p className="text-[12px] text-foreground/80 mt-2">
            Licence : <span className="font-mono">{first.license}</span>
            {license.risk === "restricted" || license.risk === "none" ? <span className="text-amber-700"> — {license.label} : {license.why}</span> : null}
          </p>
        )}
      </DrawerSection>

      {versions.map((c) => (
        <DrawerSection key={`${c.version}:${c.source ?? ""}`} title={`Version ${c.version}`} count={c.vulns.length}>
          <div className="flex items-center gap-1.5 mb-2"><ComponentTags c={c} /></div>
          {c.vulns.length === 0 ? (
            <p className="rounded-md border border-border px-3 py-3 text-[12px] text-muted-foreground">
              {c.status === "non-analysé" ? "Non analysé (OSV injoignable lors du scan)." : "Aucune vulnérabilité connue pour cette version."}
            </p>
          ) : (
            <ul className="rounded-md border border-border divide-y divide-border">
              {c.vulns.map((v) => (
                <li key={v.id} className="px-3 py-2.5 text-[12px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <SeverityBadge severity={v.severity} />
                    <a href={`https://osv.dev/vulnerability/${encodeURIComponent(v.id)}`} target="_blank" rel="noopener noreferrer" className="font-mono font-medium text-violet-700 hover:underline">{v.id}</a>
                    {v.cvssScore !== null && <span className="text-[11px] text-muted-foreground tabular-nums">CVSS {v.cvssScore.toFixed(1)}</span>}
                    <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                      {v.fixedVersion ? <>{c.version} → <span className="text-green-700 font-medium">{v.fixedVersion}</span></> : "pas de correctif"}
                    </span>
                  </div>
                  {v.summary && <p className="text-muted-foreground mt-1 break-words">{v.summary}</p>}
                </li>
              ))}
            </ul>
          )}
        </DrawerSection>
      ))}
    </DetailDrawer>
  );
}

"use client";

import { useState } from "react";
import { IconHelpCircle, IconPackage, IconShieldCheck } from "@tabler/icons-react";
import { ComponentDrawer, ComponentTags } from "@/components/app/component-detail";
import { SevCircle } from "@/components/app/severity-badge";
import type { ScannedComponent } from "@/lib/scan";
import { cn } from "@/lib/utils";

function manifestLabel(source?: string): string {
  if (!source) return "—";
  return source
    .split(", ")
    .map((path) => {
      const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      return dir || "racine";
    })
    .join(", ");
}

const TH = "text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide";

/**
 * Tableau de composants dont chaque ligne ouvre le détail à droite (vue d'ensemble et inventaire d'un dépôt).
 * `versionsByName` regroupe toutes les versions d'un même paquet présentes dans le dépôt.
 */
export function ComponentsTable({ owner, repo, rows, versionsByName, variant }: {
  owner: string;
  repo: string;
  rows: ScannedComponent[];
  versionsByName: Record<string, ScannedComponent[]>;
  variant: "overview" | "inventory";
}) {
  const [openName, setOpenName] = useState<string | null>(null);
  const inventory = variant === "inventory";
  const openVersions = openName ? versionsByName[openName] : undefined;

  return (
    <>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className={cn(TH, "px-6")}>Composant</th>
            <th className={TH}>Version</th>
            {inventory && <th className={TH}>Type</th>}
            {inventory && <th className={TH}>Dossier</th>}
            {inventory && <th className={TH}>Écosystème</th>}
            <th className={TH}>Sévérité</th>
            <th className={TH}>CVEs</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((c) => {
            const active = openName === c.name;
            return (
              <tr
                key={`${c.ecosystem}:${c.name}@${c.version}:${c.source ?? ""}`}
                onClick={() => setOpenName(active ? null : c.name)}
                className={cn("cursor-pointer hover:bg-muted/20 transition-colors border-l-2", active ? "border-l-violet-600 bg-violet-50/40" : "border-l-transparent")}
              >
                <td className="px-6 py-2.5">
                  <div className="flex items-center gap-2">
                    {c.status === "vulnerable" ? <IconPackage size={13} className="text-muted-foreground shrink-0" />
                      : c.status === "non-analysé" ? <IconHelpCircle size={13} className="text-amber-500 shrink-0" />
                      : <IconShieldCheck size={13} className="text-green-500 shrink-0" />}
                    <span className={cn("font-mono text-xs", c.status === "vulnerable" && "font-medium")}>{c.name}</span>
                  </div>
                  {!inventory && c.source && c.source !== "package.json" && (
                    <p className="text-[11px] text-muted-foreground font-mono mt-0.5 pl-[21px]">{c.source.replace(/\/package\.json$/, "")}</p>
                  )}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                  {c.version}
                  {!c.resolved && (
                    <span title="Version déclarée dans un manifeste (plage), pas la version installée. Ajoutez un lockfile pour une analyse exacte." className="ml-1 text-amber-600">~</span>
                  )}
                </td>
                {inventory && <td className="px-4 py-2.5"><div className="flex items-center gap-1"><ComponentTags c={c} /></div></td>}
                {inventory && <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground">{manifestLabel(c.source)}</td>}
                {inventory && <td className="px-4 py-2.5 text-xs text-muted-foreground capitalize">{c.ecosystem}</td>}
                <td className="px-4 py-2.5">
                  {c.status === "vulnerable" ? (
                    <SevCircle severity={c.topSeverity} count={1} />
                  ) : c.status === "non-analysé" ? (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">Non analysé</span>
                  ) : (
                    <span className="badge-ok text-[11px] rounded-full px-2 py-0.5">Sain</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums">{c.vulnCount > 0 ? c.vulnCount : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {openVersions && openVersions.length > 0 && (
        <ComponentDrawer owner={owner} repo={repo} versions={openVersions} onClose={() => setOpenName(null)} />
      )}
    </>
  );
}

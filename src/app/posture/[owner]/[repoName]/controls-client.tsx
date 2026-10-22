"use client";

import { useState } from "react";
import { DetailDrawer, DrawerSection } from "@/components/app/detail-drawer";
import { CONTROL_WHY, SEVERITY_HELP, STATE_HELP } from "@/lib/controls/glossary";
import { FAMILY_LABEL, FAMILY_ORDER, type ControlResult, type ControlState } from "@/lib/controls/types";
import { cn } from "@/lib/utils";
import { SEV, SEV_LABEL, STATE } from "../../state-ui";

const STATE_ORDER: ControlState[] = ["fail", "warning", "unknown", "pass", "na"];

/** Transforme les URL https des recommandations (générées par l'application) en liens. */
function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https:\/\/[^\s)]+)/g).map((part, i) =>
        /^https:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-violet-600 underline underline-offset-2 break-all">{part}</a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

function ControlDrawer({ c, onClose }: { c: ControlResult; onClose: () => void }) {
  const st = STATE[c.state];
  return (
    <DetailDrawer onClose={onClose} label={`Détail du contrôle ${c.id}`}>
      <div>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className={cn("inline-flex items-center gap-1 text-[12px] font-medium", st.cls)}>{st.icon}{st.label}</span>
          <span title={SEVERITY_HELP[c.severity as keyof typeof SEVERITY_HELP]} className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", SEV[c.severity])}>Gravité {SEV_LABEL[c.severity].toLowerCase()}</span>
          {c.scorecard && <span title="Contrôle correspondant d'OpenSSF Scorecard" className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Scorecard : {c.scorecard}</span>}
        </div>
        <p className="font-mono text-[11px] text-muted-foreground">{c.id} · {FAMILY_LABEL[c.family]}</p>
        <h2 className="text-lg font-semibold mt-0.5">{c.title}</h2>
        <p className="text-[12px] text-muted-foreground mt-1">{STATE_HELP[c.state]}</p>
      </div>

      {CONTROL_WHY[c.id] && c.state !== "na" && (
        <DrawerSection title="Pourquoi c'est important"><p className="text-[13px] leading-relaxed">{CONTROL_WHY[c.id]}</p></DrawerSection>
      )}

      <DrawerSection title="Constat"><p className="text-[13px] leading-relaxed break-words">{c.evidence}</p></DrawerSection>

      {c.items && c.items.length > 0 && (
        <DrawerSection title="Éléments concernés" count={c.items.length}>
          <ul className="rounded-md border border-border divide-y divide-border">
            {c.items.map((it) => <li key={it} className="px-3 py-1.5 font-mono text-[11px] text-muted-foreground break-all">{it}</li>)}
          </ul>
        </DrawerSection>
      )}

      {c.remediation && (
        <DrawerSection title="Comment corriger">
          <p className="rounded-md bg-violet-50 px-3 py-2.5 text-[12px] text-violet-900"><Linkified text={c.remediation} /></p>
        </DrawerSection>
      )}
    </DetailDrawer>
  );
}

/** Contrôles par famille ; chaque ligne ouvre le détail à droite. */
export function PostureControls({ results }: { results: ControlResult[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = results.find((r) => r.id === openId);

  return (
    <>
      {FAMILY_ORDER.map((family) => {
        const items = results.filter((r) => r.family === family).sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state));
        if (items.length === 0) return null;
        return (
          <section key={family} className="rounded-lg border border-border bg-white overflow-hidden">
            <div className="px-5 py-3 border-b border-border text-[13px] font-medium">{FAMILY_LABEL[family]}</div>
            <ul className="divide-y divide-border">
              {items.map((c) => {
                const st = STATE[c.state];
                const active = c.id === openId;
                return (
                  <li
                    key={c.id}
                    onClick={() => setOpenId(active ? null : c.id)}
                    className={cn("flex items-center gap-3 px-5 py-3 cursor-pointer hover:bg-muted/20 border-l-2", active ? "border-l-violet-600 bg-violet-50/40" : "border-l-transparent")}
                  >
                    <span className={cn("shrink-0", st.cls)} title={st.label}>{st.icon}</span>
                    <span className="font-mono text-[11px] text-muted-foreground w-14 shrink-0">{c.id}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium">{c.title}</p>
                      <p className={cn("text-[12px] truncate", c.state === "unknown" || c.state === "na" ? "text-muted-foreground" : "text-foreground/70")}>{c.evidence}</p>
                    </div>
                    <span title={SEVERITY_HELP[c.severity as keyof typeof SEVERITY_HELP]} className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold shrink-0", SEV[c.severity])}>{SEV_LABEL[c.severity]}</span>
                    <span title={STATE_HELP[c.state]} className={cn("w-24 shrink-0 text-right text-[11px]", st.cls)}>{st.label}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {open && <ControlDrawer c={open} onClose={() => setOpenId(null)} />}
    </>
  );
}

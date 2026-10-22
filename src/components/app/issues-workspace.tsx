"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  IconBellOff, IconCheck, IconCircleCheck, IconClockPause, IconCopy, IconExternalLink, IconEyeOff, IconLoader2, IconUser, IconX,
} from "@tabler/icons-react";
import { DetailDrawer, DrawerSection } from "@/components/app/detail-drawer";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { syncHistory, updateIssues, type IssueAction } from "@/lib/actions/issues";
import { countBySeverity, formatDuration, groupIssues, IGNORE_REASONS, pickFix, type FeedUnit, type IgnoreReason, type IssueGroup, type IssueKind, type IssueSeverity, type ResolvedIssue, type ResolvedItem } from "@/lib/issues-core";
import { cn } from "@/lib/utils";

export const SEV_LABEL: Record<IssueSeverity, string> = { critical: "Critique", high: "Élevée", medium: "Moyenne", low: "Faible" };
const SEV_CLS: Record<IssueSeverity, string> = {
  critical: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-blue-100 text-blue-700",
};
const KIND_LABEL: Record<IssueKind, string> = {
  dependency: "Dépendance",
  malware: "Malware",
  license: "Licence",
  "code-scanning": "Code",
  dependabot: "Dependabot",
  secret: "Secret",
  posture: "Configuration",
  domain: "Domaine",
};

export type Tab = "open" | "snoozed" | "ignored" | "resolved";
type Panel = { mode: "ignore" | "snooze" | "assign"; keys: string[] } | null;

function Tag({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "violet" | "amber" }) {
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", tone === "violet" ? "bg-violet-100 text-violet-700" : tone === "amber" ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground")}>
      {children}
    </span>
  );
}

function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "";
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      title="Copier la commande"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* presse-papiers indisponible */ }
      }}
      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
    >
      {done ? <IconCheck size={12} /> : <IconCopy size={12} />}
    </button>
  );
}

function StatusPill({ status, isNew }: { status: ResolvedIssue["status"]; isNew: boolean }) {
  const [label, cls] =
    status === "ignored" ? ["Ignorée", "bg-muted text-muted-foreground border-border"]
    : status === "snoozed" ? ["Reportée", "bg-amber-50 text-amber-700 border-amber-200"]
    : isNew ? ["Nouveau", "bg-violet-100 text-violet-700 border-violet-200"]
    : ["À faire", "bg-white text-foreground/70 border-border"];
  return <span className={cn("inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-medium", cls)}>{label}</span>;
}

const FixTime = ({ minutes }: { minutes?: number }) => (
  <span title="Estimation indicative du temps de correction" className="text-[12px] tabular-nums text-foreground/80">{minutes === undefined ? "—" : formatDuration(minutes)}</span>
);

function RowActions({ inactive, onAction, onReopen }: { inactive: boolean; onAction: (mode: "ignore" | "snooze" | "assign") => void; onReopen: () => void }) {
  return (
    <div onClick={(e) => e.stopPropagation()} className="w-[104px] shrink-0 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
      {inactive ? (
        <button onClick={onReopen} className="rounded border border-border px-2 py-1 text-[11px] hover:bg-muted">Rouvrir</button>
      ) : (
        <>
          <button onClick={() => onAction("assign")} title="Assigner" className="rounded border border-border p-1.5 hover:bg-muted"><IconUser size={13} /></button>
          <button onClick={() => onAction("snooze")} title="Reporter" className="rounded border border-border p-1.5 hover:bg-muted"><IconClockPause size={13} /></button>
          <button onClick={() => onAction("ignore")} title="Ignorer" className="rounded border border-border p-1.5 hover:bg-muted"><IconEyeOff size={13} /></button>
        </>
      )}
    </div>
  );
}

function IssueRow({ issue, hideTarget, selected, active, onOpen, onToggle, onAction, onReopen }: {
  issue: ResolvedIssue; hideTarget?: boolean; selected: boolean; active: boolean; onOpen: () => void; onToggle: () => void;
  onAction: (mode: "ignore" | "snooze" | "assign") => void; onReopen: () => void;
}) {
  const inactive = issue.status !== "open";
  return (
    <li
      onClick={onOpen}
      className={cn("flex items-start gap-3 px-6 py-3 hover:bg-muted/20 group cursor-pointer border-l-2", active ? "border-l-violet-600 bg-violet-50/40" : "border-l-transparent", inactive && "opacity-80")}
    >
      <input type="checkbox" checked={selected} onChange={onToggle} onClick={(e) => e.stopPropagation()} aria-label="Sélectionner" className="mt-1 accent-violet-600" />
      <span className={cn("mt-0.5 w-16 shrink-0 text-center rounded px-1.5 py-0.5 text-[10px] font-semibold", SEV_CLS[issue.severity])}>{SEV_LABEL[issue.severity]}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-medium break-all">{issue.title}</span>
          <Tag>{KIND_LABEL[issue.kind]}</Tag>
          {issue.kind === "dependency" && <Tag tone={issue.devOnly ? "amber" : "muted"}>{issue.devOnly ? "Développement" : "Production"}</Tag>}
          {issue.direct === false && <Tag>Indirecte</Tag>}
          {issue.noFix && <Tag tone="amber">Sans correctif</Tag>}
          {issue.assignee && <Tag tone="violet">→ {issue.assignee}</Tag>}
        </div>
        {!hideTarget && <p className="text-[11px] text-muted-foreground mt-0.5">{issue.target}</p>}
        <p className="text-[12px] text-foreground/80 mt-1 break-words line-clamp-2">{issue.detail}</p>
        {issue.fix?.command && (
          <p className="text-[11px] mt-1.5 text-violet-700" onClick={(e) => e.stopPropagation()}>
            <span className="inline-flex items-center gap-1.5 rounded bg-violet-50 px-1.5 py-0.5 font-mono">{issue.fix.command}<CopyButton text={issue.fix.command} /></span>
          </p>
        )}
        {issue.status === "ignored" && (
          <p className="text-[11px] text-muted-foreground mt-1.5">
            Ignorée — {IGNORE_REASONS[issue.reason as IgnoreReason] ?? issue.reason}{issue.note ? ` : ${issue.note}` : ""}
          </p>
        )}
        {issue.status === "snoozed" && <p className="text-[11px] text-muted-foreground mt-1.5">Reportée jusqu&apos;au {fmtDate(issue.until)}{issue.note ? ` — ${issue.note}` : ""}</p>}
        {issue.snoozeExpired && <p className="text-[11px] text-amber-700 mt-1.5">Le report est arrivé à échéance : l&apos;alerte est de nouveau ouverte.</p>}
      </div>
      <div className="w-24 shrink-0 pt-0.5"><FixTime minutes={issue.fixMinutes} /></div>
      <div className="w-24 shrink-0"><StatusPill status={issue.status} isNew={issue.isNew} /></div>
      <RowActions inactive={inactive} onAction={onAction} onReopen={onReopen} />
    </li>
  );
}

function GroupRow({ group, selected, active, onOpen, onToggle, onAction, onReopen }: {
  group: IssueGroup; selected: boolean; active: boolean; onOpen: () => void; onToggle: () => void;
  onAction: (mode: "ignore" | "snooze" | "assign") => void; onReopen: () => void;
}) {
  const status = group.members[0].status;
  const inactive = status !== "open";
  const anyNew = group.members.some((m) => m.isNew);
  return (
    <li
      onClick={onOpen}
      className={cn("flex items-start gap-3 px-6 py-3 hover:bg-muted/20 group cursor-pointer border-l-2", active ? "border-l-violet-600 bg-violet-50/40" : "border-l-transparent", inactive && "opacity-80")}
    >
      <input type="checkbox" checked={selected} onChange={onToggle} onClick={(e) => e.stopPropagation()} aria-label="Sélectionner le groupe" className="mt-1 accent-violet-600" />
      <span className={cn("mt-0.5 w-16 shrink-0 text-center rounded px-1.5 py-0.5 text-[10px] font-semibold", SEV_CLS[group.severity])}>{SEV_LABEL[group.severity]}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-medium break-all">{group.title}</span>
          <Tag>{KIND_LABEL[group.kind]}</Tag>
          <Tag tone="violet">{group.targets.length} dépôt{group.targets.length > 1 ? "s" : ""}</Tag>
          {group.versions.length > 1 && <Tag>{group.versions.length} versions</Tag>}
          {group.noFix && <Tag tone="amber">Sans correctif</Tag>}
        </div>
        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{group.targets.join(" · ")}</p>
        <p className="text-[12px] text-foreground/80 mt-1 break-words line-clamp-1">{group.members[0].detail}</p>
      </div>
      <div className="w-24 shrink-0 pt-0.5"><FixTime minutes={group.fixMinutes} /></div>
      <div className="w-24 shrink-0"><StatusPill status={status} isNew={anyNew} /></div>
      <RowActions inactive={inactive} onAction={onAction} onReopen={onReopen} />
    </li>
  );
}

function GroupDrawer({ group, onClose, onAction, onReopen, onOpenMember }: {
  group: IssueGroup; onClose: () => void;
  onAction: (mode: "ignore" | "snooze" | "assign") => void; onReopen: () => void; onOpenMember: (key: string) => void;
}) {
  const status = group.members[0].status;
  return (
    <DetailDrawer
      onClose={onClose}
      label="Détail du groupe d'alertes"
      width={560}
      headerRight={<span className="text-[12px] text-muted-foreground">{group.members.length} alerte(s) regroupée(s)</span>}
      footer={status === "open" ? (
        <>
          <button onClick={() => onAction("assign")} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] hover:bg-muted"><IconUser size={13} />Assigner tout</button>
          <button onClick={() => onAction("snooze")} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] hover:bg-muted"><IconClockPause size={13} />Reporter tout</button>
          <button onClick={() => onAction("ignore")} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] hover:bg-muted"><IconEyeOff size={13} />Ignorer tout</button>
        </>
      ) : (
        <button onClick={onReopen} className="rounded-md bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 text-[12px]">Tout rouvrir</button>
      )}
    >
      <div>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className={cn("rounded px-2 py-0.5 text-[11px] font-semibold", SEV_CLS[group.severity])}>{SEV_LABEL[group.severity]}</span>
          <Tag>{KIND_LABEL[group.kind]}</Tag>
          <Tag tone="violet">{group.targets.length} dépôt{group.targets.length > 1 ? "s" : ""}</Tag>
          {group.noFix && <Tag tone="amber">Sans correctif</Tag>}
        </div>
        <h2 className="text-lg font-semibold break-all">{group.title}</h2>
        <p className="text-[12px] text-muted-foreground mt-0.5">Versions présentes : {group.versions.join(", ")}</p>
      </div>

      <DrawerSection title="En résumé">
        <p className="text-[13px] leading-relaxed">{KIND_HELP[group.kind]}</p>
        <p className="text-[12px] text-foreground/80 mt-2">Ce paquet est concerné dans {group.targets.length} dépôt{group.targets.length > 1 ? "s" : ""}.{group.fixMinutes !== undefined ? ` Temps de correction estimé au total : ${formatDuration(group.fixMinutes)}.` : ""}</p>
      </DrawerSection>

      <DrawerSection title="À corriger dans chaque dépôt" count={group.members.length}>
        <ul className="rounded-md border border-border divide-y divide-border">
          {group.members.map((m) => {
            const fix = pickFix(m.vulns ?? []);
            return (
              <li key={m.key} onClick={() => onOpenMember(m.key)} className="px-3 py-2.5 text-[12px] cursor-pointer hover:bg-muted/30">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium break-all">{m.target}</span>
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", SEV_CLS[m.severity])}>{SEV_LABEL[m.severity]}</span>
                  {m.devOnly && <Tag tone="amber">Développement</Tag>}
                  {m.direct === false && <Tag>Indirecte</Tag>}
                  <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                    {fix.version ? <>{m.component?.version} → <span className="text-green-700 font-medium">{fix.version}</span></> : m.component?.version ?? ""}
                  </span>
                </div>
                {m.vulns && m.vulns.length > 0 && (
                  <p className="mt-1 text-muted-foreground break-words">{m.vulns.slice(0, 4).map((v) => v.id).join(", ")}{m.vulns.length > 4 ? ` +${m.vulns.length - 4}` : ""}</p>
                )}
                <p className="mt-1 text-[11px] text-muted-foreground">Correction : {m.fixMinutes !== undefined ? formatDuration(m.fixMinutes) : "—"} · <span className="text-violet-700">voir le détail</span></p>
              </li>
            );
          })}
        </ul>
      </DrawerSection>
    </DetailDrawer>
  );
}

const KIND_HELP: Partial<Record<IssueKind, string>> = {
  dependency: "Une bibliothèque utilisée par ce projet contient des failles de sécurité connues. Un attaquant peut les exploiter si le code vulnérable est appelé par votre application.",
  malware: "Ce paquet est signalé comme malveillant : il peut voler des secrets ou exécuter du code dès son installation. C'est une urgence, même si c'est une dépendance de développement.",
  license: "La licence de cette dépendance peut imposer des obligations (publier votre code, ne pas l'utiliser commercialement…) ou ne pas vous donner le droit de l'utiliser.",
  secret: "Un mot de passe, une clé ou un jeton est présent en clair dans le code. Toute personne ayant accès au dépôt peut l'utiliser.",
  posture: "Un réglage de sécurité du dépôt n'est pas en place. Cela n'est pas une faille en soi, mais cela facilite ou aggrave une attaque.",
  domain: "Un problème de configuration d'un nom de domaine surveillé (certificat, redirection HTTPS, en-têtes de sécurité).",
  "code-scanning": "GitHub a repéré dans votre propre code une construction qui peut être exploitée (injection, mauvaise validation…).",
  dependabot: "GitHub signale une dépendance vulnérable.",
};

function advisoryUrl(id: string): string | null {
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(id)) return null;
  return `https://osv.dev/vulnerability/${id}`;
}

function IssueDrawer({ issue, onClose, onAction, onReopen }: {
  issue: ResolvedIssue; onClose: () => void;
  onAction: (mode: "ignore" | "snooze" | "assign") => void; onReopen: () => void;
}) {
  const vulns = issue.vulns ?? [];
  const current = issue.component?.version;
  return (
    <DetailDrawer
      onClose={onClose}
      label="Détail de l'alerte"
      headerRight={<Link href={issue.href} className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-[12px] hover:bg-muted">Ouvrir la page <IconExternalLink size={12} /></Link>}
      footer={<>
        {issue.status === "open" ? (
          <>
            <button onClick={() => onAction("assign")} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] hover:bg-muted"><IconUser size={13} />Assigner</button>
            <button onClick={() => onAction("snooze")} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] hover:bg-muted"><IconClockPause size={13} />Reporter</button>
            <button onClick={() => onAction("ignore")} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[12px] hover:bg-muted"><IconEyeOff size={13} />Ignorer</button>
          </>
        ) : (
          <button onClick={onReopen} className="rounded-md bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 text-[12px]">Rouvrir</button>
        )}
</>}
    >
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className={cn("rounded px-2 py-0.5 text-[11px] font-semibold", SEV_CLS[issue.severity])}>{SEV_LABEL[issue.severity]}</span>
            <Tag>{KIND_LABEL[issue.kind]}</Tag>
            {issue.kind === "dependency" && <Tag tone={issue.devOnly ? "amber" : "muted"}>{issue.devOnly ? "Développement" : "Production"}</Tag>}
            {issue.direct === false && <Tag>Indirecte</Tag>}
            {issue.noFix && <Tag tone="amber">Sans correctif</Tag>}
            <Tag tone={issue.status === "open" ? "muted" : "violet"}>{issue.status === "open" ? "À traiter" : issue.status === "ignored" ? "Ignorée" : "Reportée"}</Tag>
          </div>
          <h2 className="text-lg font-semibold break-all">{issue.title}</h2>
          <p className="text-[12px] text-muted-foreground mt-0.5">{issue.target}{issue.assignee ? ` · assignée à ${issue.assignee}` : ""}</p>
        </div>

        <section>
          <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">En résumé</h3>
          <p className="text-[13px] leading-relaxed">{KIND_HELP[issue.kind]}</p>
          <p className="text-[12px] text-foreground/80 mt-2 break-words">{issue.detail}</p>
        </section>

        {(issue.fix || issue.kind === "dependency") && (
          <section>
            <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Comment corriger ?</h3>
            {issue.fix ? (
              <div className="rounded-md bg-violet-50 text-violet-900 px-3 py-2.5 text-[12px] space-y-2">
                <p>{issue.fix.text}</p>
                {issue.fix.command && (
                  <p className="inline-flex items-center gap-2 rounded bg-white px-2 py-1 font-mono text-[11px] break-all">{issue.fix.command}<CopyButton text={issue.fix.command} /></p>
                )}
              </div>
            ) : (
              <p className="rounded-md bg-amber-50 text-amber-900 px-3 py-2.5 text-[12px]">Aucune version corrigée n&apos;est publiée à ce jour. Surveillez la bibliothèque, cherchez une alternative, ou limitez l&apos;exposition (le code vulnérable est-il réellement appelé ?). Vous pouvez ignorer l&apos;alerte avec un motif en attendant.</p>
            )}
          </section>
        )}

        {vulns.length > 0 && (
          <section>
            <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Détail des failles <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums normal-case">{vulns.length}</span></h3>
            <ul className="rounded-md border border-border divide-y divide-border">
              {vulns.map((v) => {
                const url = advisoryUrl(v.id);
                return (
                  <li key={v.id} className="px-3 py-2.5 text-[12px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="font-mono font-medium text-violet-700 hover:underline">{v.id}</a> : <span className="font-mono font-medium">{v.id}</span>}
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", SEV_CLS[v.severity])}>{SEV_LABEL[v.severity]}</span>
                      <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                        {v.fixedVersion ? <>{current ? `${current} → ` : "→ "}<span className="text-green-700 font-medium">{v.fixedVersion}</span></> : "pas de correctif"}
                      </span>
                    </div>
                    {v.summary && <p className="text-muted-foreground mt-1 break-words">{v.summary}</p>}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {issue.kind === "license" && issue.component?.license && (
          <section>
            <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Licence déclarée</h3>
            <p className="font-mono text-[12px]">{issue.component.license}</p>
          </section>
        )}

        {issue.status === "ignored" && (
          <section className="text-[12px]">
            <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Décision</h3>
            <p>Ignorée — {IGNORE_REASONS[issue.reason as IgnoreReason] ?? issue.reason}{issue.note ? ` : ${issue.note}` : ""}</p>
          </section>
        )}
        {issue.status === "snoozed" && (
          <section className="text-[12px]">
            <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Décision</h3>
            <p>Reportée jusqu&apos;au {fmtDate(issue.until)}{issue.note ? ` — ${issue.note}` : ""}</p>
          </section>
        )}
        {issue.externalUrl && (
          <a href={issue.externalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12px] text-violet-700 hover:underline">Voir sur GitHub <IconExternalLink size={12} /></a>
        )}
    </DetailDrawer>
  );
}

function ActionDialog({ panel, login, count, onClose, onSubmit, pending, error }: {
  panel: Panel; login: string; count: number; onClose: () => void; pending: boolean; error: string | null;
  onSubmit: (action: IssueAction) => void;
}) {
  const [reason, setReason] = useState<IgnoreReason>("false-positive");
  const [note, setNote] = useState("");
  const [days, setDays] = useState(30);
  const [assignee, setAssignee] = useState("");
  const mode = panel?.mode;
  const title = mode === "ignore" ? "Ignorer" : mode === "snooze" ? "Reporter" : "Assigner";
  const plural = count > 1 ? `${count} alertes` : "cette alerte";

  return (
    <Dialog open={!!panel} onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title} {plural}</DialogTitle>
          <DialogDescription>
            {mode === "ignore" && "L'alerte disparaît du Feed. Le motif est conservé : vous pouvez la rouvrir à tout moment."}
            {mode === "snooze" && "L'alerte est masquée jusqu'à la date choisie, puis redevient ouverte automatiquement."}
            {mode === "assign" && "Indiquez qui doit s'en occuper (un login GitHub ou un nom). Laissez vide pour retirer l'assignation."}
          </DialogDescription>
        </DialogHeader>

        {mode === "ignore" && (
          <div className="space-y-2 text-[13px]">
            {(Object.keys(IGNORE_REASONS) as IgnoreReason[]).map((k) => (
              <label key={k} className="flex items-center gap-2"><input type="radio" name="reason" checked={reason === k} onChange={() => setReason(k)} className="accent-violet-600" />{IGNORE_REASONS[k]}</label>
            ))}
            <Input placeholder={reason === "other" ? "Précisez le motif (obligatoire)" : "Commentaire (facultatif)"} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          </div>
        )}
        {mode === "snooze" && (
          <div className="space-y-2 text-[13px]">
            <div className="flex gap-2 flex-wrap">
              {[7, 30, 90].map((d) => (
                <button key={d} onClick={() => setDays(d)} className={cn("rounded-md border px-2.5 py-1 text-[12px]", days === d ? "border-violet-600 bg-violet-50 text-violet-700" : "border-border hover:bg-muted")}>{d} jours</button>
              ))}
            </div>
            <Input placeholder="Commentaire (facultatif)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          </div>
        )}
        {mode === "assign" && (
          <div className="space-y-2">
            <Input placeholder="Login GitHub ou nom" value={assignee} maxLength={80} onChange={(e) => setAssignee(e.target.value)} />
            <button onClick={() => setAssignee(login)} className="text-[12px] text-violet-600 hover:underline">Me l&apos;assigner ({login})</button>
          </div>
        )}

        {error && <p className="text-[12px] text-red-600">{error}</p>}
        <DialogFooter>
          <button onClick={onClose} disabled={pending} className="rounded-md border border-border px-3 py-1.5 text-[13px] hover:bg-muted">Annuler</button>
          <button
            disabled={pending || (mode === "ignore" && reason === "other" && !note.trim())}
            onClick={() => onSubmit(mode === "ignore" ? { type: "ignore", reason, note } : mode === "snooze" ? { type: "snooze", days, note } : { type: "assign", assignee })}
            className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 hover:bg-violet-700 text-white px-3 py-1.5 text-[13px] disabled:opacity-60"
          >
            {pending && <IconLoader2 size={13} className="animate-spin" />}Valider
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface WorkspaceApi {
  sev: IssueSeverity | "all";
  setSev: (s: IssueSeverity | "all") => void;
  setTab: (t: Tab) => void;
  onlyNew: boolean;
  setOnlyNew: (v: boolean) => void;
  counts: ReturnType<typeof countBySeverity>;
  devHidden: number;
  noFixCount: number;
  newCount: number;
  resolvedCount: number;
}

/** Compteurs par gravité, nouvelles et résolues, cliquables pour filtrer la liste. */
export function SeverityHeader({ api, showHints = false }: { api: WorkspaceApi; showHints?: boolean }) {
  const { sev, setSev, setTab, counts, devHidden, noFixCount, onlyNew, setOnlyNew, newCount, resolvedCount } = api;
  return (
    <div className="bg-white border-b border-border">
      <div className="grid grid-cols-6 divide-x divide-border">
        {(["critical", "high", "medium", "low"] as const).map((s) => (
          <button key={s} onClick={() => { setTab("open"); setOnlyNew(false); setSev(sev === s ? "all" : s); }} className={cn("text-left px-6 py-4 hover:bg-muted/30 transition-colors", sev === s && "bg-violet-50/60")}>
            <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">{SEV_LABEL[s]}</p>
            <p className={cn("text-2xl font-semibold tabular-nums", counts[s] === 0 ? "text-green-600" : s === "critical" ? "text-red-600" : s === "high" ? "text-orange-600" : "text-foreground")}>{counts[s]}</p>
          </button>
        ))}
        <button onClick={() => { setTab("open"); setSev("all"); setOnlyNew(!onlyNew); }} title="Alertes apparues depuis moins de 7 jours" className={cn("text-left px-6 py-4 hover:bg-muted/30 transition-colors", onlyNew && "bg-violet-50/60")}>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Nouvelles</p>
          <p className={cn("text-2xl font-semibold tabular-nums", newCount > 0 ? "text-violet-600" : "text-foreground")}>{newCount}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">sur 7 jours</p>
        </button>
        <button onClick={() => { setTab("resolved"); setSev("all"); setOnlyNew(false); }} title="Alertes qui ont disparu depuis moins de 7 jours" className="text-left px-6 py-4 hover:bg-muted/30 transition-colors">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Résolues</p>
          <p className={cn("text-2xl font-semibold tabular-nums", resolvedCount > 0 ? "text-green-600" : "text-foreground")}>{resolvedCount}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">sur 7 jours</p>
        </button>
      </div>
      {showHints && (devHidden > 0 || noFixCount > 0) && (
        <p className="px-6 py-1.5 border-t border-border text-[11px] text-muted-foreground">
          {devHidden > 0 && `${devHidden} dépendance(s) de développement masquée(s)`}{devHidden > 0 && noFixCount > 0 && " · "}{noFixCount > 0 && `${noFixCount} alerte(s) sans correctif`} — non comptées ci-dessus pour les dépendances de développement.
        </p>
      )}
    </div>
  );
}

/**
 * Liste des alertes avec onglets, filtres, regroupement par paquet, sélection multiple, panneau de détail
 * à droite et actions. Utilisée par le Feed global et par l'onglet Issues d'un dépôt.
 */
export function IssuesWorkspace({ issues, login, header, hideTarget, emptyMessage, fullyCovered = true, resolved = [], historyDirty = false }: {
  issues: ResolvedIssue[];
  login: string;
  /** Contenu affiché au-dessus des filtres (compteurs…), avec accès aux filtres. */
  header?: (api: WorkspaceApi) => React.ReactNode;
  /** Masque le dépôt sur chaque ligne (déjà connu : page d'un dépôt). */
  hideTarget?: boolean;
  emptyMessage?: string;
  /** false si certaines analyses manquent : « aucune alerte » n'est alors pas affiché comme « tout est à jour ». */
  fullyCovered?: boolean;
  /** Alertes résolues depuis moins de 7 jours. */
  resolved?: ResolvedItem[];
  /** Le suivi des alertes (nouvelles / résolues) doit être enregistré : déclenché une fois à l'ouverture. */
  historyDirty?: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("open");
  const [sev, setSev] = useState<IssueSeverity | "all">("all");
  const [kind, setKind] = useState<IssueKind | "all">("all");
  const [query, setQuery] = useState("");
  const [showDev, setShowDev] = useState(false);
  const [onlyFixable, setOnlyFixable] = useState(false);
  const [onlyMine, setOnlyMine] = useState(false);
  const [onlyNew, setOnlyNew] = useState(false);
  const [grouped, setGrouped] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState<Panel>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Enregistre le suivi (nouvelles / résolues) : l'affichage est déjà à jour, l'écriture sert aux prochaines visites.
  useEffect(() => {
    if (historyDirty) void syncHistory();
  }, [historyDirty]);

  const byStatus = (s: Exclude<Tab, "resolved">) => issues.filter((i) => i.status === s);
  const open = byStatus("open");
  // Chiffres d'en-tête : alertes ouvertes qui comptent vraiment (hors dépendances de développement).
  const openProd = open.filter((i) => !i.devOnly);
  const counts = countBySeverity(openProd);
  const devHidden = open.filter((i) => i.devOnly).length;
  const noFixCount = openProd.filter((i) => i.noFix).length;
  const newCount = openProd.filter((i) => i.isNew).length;

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (tab === "resolved") return [];
    return issues.filter((i) => {
      if (i.status !== tab) return false;
      if (tab === "open" && !showDev && i.devOnly) return false;
      if (onlyNew && !i.isNew) return false;
      if (sev !== "all" && i.severity !== sev) return false;
      if (kind !== "all" && i.kind !== kind) return false;
      if (onlyFixable && (i.noFix || (i.kind === "dependency" && !i.fix))) return false;
      if (onlyMine && i.assignee.toLowerCase() !== login.toLowerCase()) return false;
      if (q && !`${i.title} ${i.target} ${i.detail}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [issues, tab, sev, kind, q, showDev, onlyFixable, onlyMine, onlyNew, login]);

  const units: FeedUnit[] = useMemo(
    () => (grouped ? groupIssues(visible) : visible.map((issue): FeedUnit => ({ type: "issue", issue }))),
    [visible, grouped]
  );
  const shown = units.slice(0, 300);
  const keysOf = (u: FeedUnit) => (u.type === "group" ? u.members.map((m) => m.key) : [u.issue.key]);
  const unitKey = (u: FeedUnit) => (u.type === "group" ? u.key : u.issue.key);

  const toggle = (u: FeedUnit) => setSelected((prev) => {
    const n = new Set(prev);
    const keys = keysOf(u);
    if (keys.every((k) => n.has(k))) keys.forEach((k) => n.delete(k)); else keys.forEach((k) => n.add(k));
    return n;
  });
  const allSelected = shown.length > 0 && shown.every((u) => keysOf(u).every((k) => selected.has(k)));

  function run(keys: string[], action: IssueAction) {
    setError(null);
    start(async () => {
      const r = await updateIssues(keys, action);
      if (!r.ok) { setError(r.error); return; }
      setPanel(null);
      setSelected(new Set());
      router.refresh();
    });
  }

  const resolvedVisible = resolved.filter((r) => (sev === "all" || r.severity === sev) && (kind === "all" || r.kind === kind) && (!q || `${r.title} ${r.target}`.toLowerCase().includes(q)));
  const openUnit = openKey ? shown.concat(units).find((u) => unitKey(u) === openKey) : undefined;
  const openIssue = openKey && !openUnit ? issues.find((i) => i.key === openKey) : undefined;

  return (
    <div className="flex flex-col flex-1">
      {header?.({ sev, setSev, setTab, onlyNew, setOnlyNew, counts, devHidden, noFixCount, newCount, resolvedCount: resolved.length })}

      <div className="bg-white border-b border-border px-6 py-3 flex items-center gap-2 flex-wrap">
        {([["open", "Ouvertes", open.length], ["snoozed", "Reportées", byStatus("snoozed").length], ["ignored", "Ignorées", byStatus("ignored").length], ["resolved", "Résolues (7 j)", resolved.length]] as const).map(([t, label, n]) => (
          <button key={t} onClick={() => { setTab(t); setSelected(new Set()); }} className={cn("text-[12px] px-2.5 py-1 rounded-md", tab === t ? "bg-violet-100 text-violet-700 font-medium" : "text-muted-foreground hover:bg-muted")}>
            {label} <span className="tabular-nums opacity-70">{n}</span>
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-border" />
        <div className="w-56"><Input placeholder="Rechercher…" value={query} onChange={(e) => setQuery(e.target.value)} className="h-8 text-[13px] bg-muted/40 border-border" /></div>
        <select value={kind} onChange={(e) => setKind(e.target.value as IssueKind | "all")} className="h-8 rounded-md border border-border bg-white px-2 text-[12px]" aria-label="Type">
          <option value="all">Tous les types</option>
          {(Object.keys(KIND_LABEL) as IssueKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground" title="Un même paquet présent dans plusieurs dépôts n'apparaît qu'une fois"><input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} className="accent-violet-600" />Regrouper par paquet</label>
        <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><input type="checkbox" checked={showDev} onChange={(e) => setShowDev(e.target.checked)} className="accent-violet-600" />Dépendances de dev</label>
        <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><input type="checkbox" checked={onlyFixable} onChange={(e) => setOnlyFixable(e.target.checked)} className="accent-violet-600" />Avec correctif</label>
        <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} className="accent-violet-600" />Nouvelles</label>
        <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground"><input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} className="accent-violet-600" />Qui m&apos;est assigné</label>
      </div>

      {selected.size > 0 && tab !== "resolved" && (
        <div className="sticky top-0 z-10 flex items-center gap-2 bg-violet-600 text-white px-6 py-2 text-[12px]">
          <span className="font-medium">{selected.size} alerte(s) sélectionnée(s)</span>
          {tab === "open" ? (
            <>
              <button onClick={() => setPanel({ mode: "ignore", keys: [...selected] })} className="rounded bg-white/15 hover:bg-white/25 px-2 py-1 inline-flex items-center gap-1"><IconEyeOff size={12} />Ignorer</button>
              <button onClick={() => setPanel({ mode: "snooze", keys: [...selected] })} className="rounded bg-white/15 hover:bg-white/25 px-2 py-1 inline-flex items-center gap-1"><IconClockPause size={12} />Reporter</button>
              <button onClick={() => setPanel({ mode: "assign", keys: [...selected] })} className="rounded bg-white/15 hover:bg-white/25 px-2 py-1 inline-flex items-center gap-1"><IconUser size={12} />Assigner</button>
            </>
          ) : (
            <button disabled={pending} onClick={() => run([...selected], { type: "reopen" })} className="rounded bg-white/15 hover:bg-white/25 px-2 py-1">Rouvrir</button>
          )}
          <button onClick={() => setSelected(new Set())} className="ml-auto inline-flex items-center gap-1 opacity-80 hover:opacity-100"><IconX size={12} />Désélectionner</button>
        </div>
      )}

      <div className="flex-1 bg-white">
        {tab === "resolved" ? (
          resolvedVisible.length > 0 ? (
            <ul className="divide-y divide-border">
              {resolvedVisible.map((r) => (
                <li key={r.key} className="flex items-center gap-3 px-6 py-3">
                  <IconCircleCheck size={16} className="text-green-600 shrink-0" />
                  <span className={cn("w-16 shrink-0 text-center rounded px-1.5 py-0.5 text-[10px] font-semibold", SEV_CLS[r.severity as IssueSeverity] ?? "bg-muted")}>{SEV_LABEL[r.severity as IssueSeverity] ?? r.severity}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium break-all">{r.title}</p>
                    <p className="text-[11px] text-muted-foreground">{KIND_LABEL[r.kind as IssueKind] ?? r.kind} · {r.target}</p>
                  </div>
                  <span className="text-[12px] text-muted-foreground">Résolue le {fmtDate(r.resolvedAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="py-20 text-center text-sm text-muted-foreground">
              <IconBellOff size={28} className="mx-auto mb-3 opacity-40" />
              Aucune alerte résolue ces 7 derniers jours. Une alerte est « résolue » quand un nouveau scan ou audit ne la détecte plus.
            </div>
          )
        ) : (
          <>
            {shown.length > 0 && (
              <div className="flex items-center gap-3 px-6 py-2 border-b border-border bg-muted/30 text-[11px] text-muted-foreground uppercase tracking-wide">
                <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(shown.flatMap(keysOf)))} aria-label="Tout sélectionner" className="accent-violet-600" />
                <span className="w-16 shrink-0">Gravité</span>
                <span className="flex-1">{units.length} élément(s){grouped && units.length < visible.length ? ` (${visible.length} alertes regroupées)` : ""}{units.length > shown.length && ` — ${shown.length} affichés, affinez avec les filtres`}</span>
                <span className="w-24 shrink-0" title="Estimation indicative">Temps de correction</span>
                <span className="w-24 shrink-0">Statut</span>
                <span className="w-[104px] shrink-0" />
              </div>
            )}
            <ul className="divide-y divide-border">
              {shown.map((u) =>
                u.type === "group" ? (
                  <GroupRow
                    key={u.key}
                    group={u}
                    selected={keysOf(u).every((k) => selected.has(k))}
                    active={openKey === u.key}
                    onOpen={() => setOpenKey(openKey === u.key ? null : u.key)}
                    onToggle={() => toggle(u)}
                    onAction={(mode) => setPanel({ mode, keys: keysOf(u) })}
                    onReopen={() => run(keysOf(u), { type: "reopen" })}
                  />
                ) : (
                  <IssueRow
                    key={u.issue.key}
                    issue={u.issue}
                    hideTarget={hideTarget}
                    selected={selected.has(u.issue.key)}
                    active={openKey === u.issue.key}
                    onOpen={() => setOpenKey(openKey === u.issue.key ? null : u.issue.key)}
                    onToggle={() => toggle(u)}
                    onAction={(mode) => setPanel({ mode, keys: [u.issue.key] })}
                    onReopen={() => run([u.issue.key], { type: "reopen" })}
                  />
                )
              )}
            </ul>
            {visible.length === 0 && (
              <div className="py-20 text-center text-sm text-muted-foreground">
                <IconBellOff size={28} className="mx-auto mb-3 opacity-40" />
                {issues.length === 0
                  ? (emptyMessage ?? "Aucune donnée pour l'instant. Lancez un scan (Repositories), un Code Audit, un audit de Posture ou ajoutez des domaines.")
                  : tab === "open" && fullyCovered ? "Aucune alerte ouverte avec ces filtres. Tout est à jour." : "Aucune alerte avec ces filtres."}
              </div>
            )}
          </>
        )}
      </div>

      {openUnit?.type === "group" && (
        <GroupDrawer
          group={openUnit}
          onClose={() => setOpenKey(null)}
          onAction={(mode) => setPanel({ mode, keys: keysOf(openUnit) })}
          onReopen={() => run(keysOf(openUnit), { type: "reopen" })}
          onOpenMember={(key) => setOpenKey(key)}
        />
      )}
      {(openUnit?.type === "issue" || openIssue) && (() => {
        const issue = openUnit?.type === "issue" ? openUnit.issue : openIssue!;
        return (
          <IssueDrawer
            issue={issue}
            onClose={() => setOpenKey(null)}
            onAction={(mode) => setPanel({ mode, keys: [issue.key] })}
            onReopen={() => run([issue.key], { type: "reopen" })}
          />
        );
      })()}

      <ActionDialog
        key={panel ? `${panel.mode}:${panel.keys.length}:${panel.keys[0]}` : "closed"}
        panel={panel}
        login={login}
        count={panel?.keys.length ?? 0}
        pending={pending}
        error={error}
        onClose={() => { setPanel(null); setError(null); }}
        onSubmit={(action) => panel && run(panel.keys, action)}
      />
    </div>
  );
}

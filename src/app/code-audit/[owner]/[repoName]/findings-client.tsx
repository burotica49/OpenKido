"use client";

import { useState } from "react";
import { IconCheck, IconExternalLink, IconKey, IconShieldCheck } from "@tabler/icons-react";
import { DetailDrawer, DrawerSection } from "@/components/app/detail-drawer";
import type { AuditAlert } from "@/lib/audit";
import type { SecretFinding } from "@/lib/secret-rules";
import { cn } from "@/lib/utils";

const SEV_STYLE: Record<string, string> = {
  critical: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-blue-100 text-blue-700",
  warning: "bg-blue-100 text-blue-700",
  note: "bg-muted text-muted-foreground",
  unknown: "bg-muted text-muted-foreground",
};
const SEV_LABEL: Record<string, string> = {
  critical: "Critique", high: "Élevée", medium: "Moyenne", low: "Faible", warning: "Avertissement", note: "Note", unknown: "Inconnue",
};
const SOURCE_LABEL: Record<string, string> = { code_scanning: "Code Scanning", dependabot: "Dependabot", secret_scanning: "Secret Scanning" };
const SOURCE_HELP: Record<string, string> = {
  code_scanning: "GitHub a repéré dans votre propre code une construction qui peut être exploitée (injection, mauvaise validation…).",
  dependabot: "Une bibliothèque utilisée par ce dépôt contient une faille connue.",
  secret_scanning: "GitHub a détecté un secret (mot de passe, clé, jeton) dans le dépôt. Il doit être révoqué chez son fournisseur.",
};

type Selected = { type: "alert"; id: string } | { type: "secret"; id: string } | null;

function SecretDrawer({ f, onClose }: { f: SecretFinding; onClose: () => void }) {
  return (
    <DetailDrawer onClose={onClose} label="Détail du secret détecté">
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className={cn("rounded px-2 py-0.5 text-[11px] font-semibold", SEV_STYLE[f.severity])}>{SEV_LABEL[f.severity]}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Analyse Openkido</span>
        </div>
        <h2 className="text-lg font-semibold">{f.name}</h2>
      </div>
      <DrawerSection title="En résumé">
        <p className="text-[13px] leading-relaxed">Un secret est présent en clair dans le code. Toute personne ayant accès au dépôt (ou à son historique) peut l&apos;utiliser.</p>
      </DrawerSection>
      <DrawerSection title="Emplacement">
        <p className="font-mono text-[12px] break-all">{f.path}:{f.line}</p>
        <p className="font-mono text-[12px] text-muted-foreground mt-1">Aperçu masqué : {f.preview}</p>
      </DrawerSection>
      <DrawerSection title="Comment corriger">
        <p className="rounded-md bg-violet-50 px-3 py-2.5 text-[12px] text-violet-900">Révoquer ce secret chez son fournisseur et en émettre un nouveau. Le supprimer du code ne suffit pas : il reste lisible dans l&apos;historique git. Ensuite, le charger depuis une variable d&apos;environnement.</p>
      </DrawerSection>
    </DetailDrawer>
  );
}

function AlertDrawer({ a, onClose }: { a: AuditAlert; onClose: () => void }) {
  return (
    <DetailDrawer
      onClose={onClose}
      label="Détail de l'alerte"
      headerRight={a.url && /^https:\/\/github\.com\//.test(a.url) ? (
        <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-[12px] hover:bg-muted">Voir sur GitHub <IconExternalLink size={12} /></a>
      ) : undefined}
    >
      <div>
        <div className="flex items-center gap-2 flex-wrap mb-2">
          <span className={cn("rounded px-2 py-0.5 text-[11px] font-semibold", SEV_STYLE[a.severity] ?? SEV_STYLE.unknown)}>{SEV_LABEL[a.severity] ?? a.severity}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{SOURCE_LABEL[a.source] ?? a.source}</span>
          {a.classification === "malware" && <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">Malware</span>}
        </div>
        <h2 className="text-lg font-semibold break-words">{a.title}</h2>
        <p className="text-[12px] text-muted-foreground mt-1">Détectée le {new Date(a.createdAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</p>
      </div>
      <DrawerSection title="En résumé"><p className="text-[13px] leading-relaxed">{SOURCE_HELP[a.source]}</p></DrawerSection>
      {a.path && <DrawerSection title="Fichier"><p className="font-mono text-[12px] break-all">{a.path}</p></DrawerSection>}
      {a.description && <DrawerSection title="Description"><p className="text-[12px] leading-relaxed whitespace-pre-wrap break-words text-foreground/80">{a.description.slice(0, 4000)}</p></DrawerSection>}
    </DetailDrawer>
  );
}

/** Secrets du code et alertes GitHub d'un dépôt ; chaque ligne ouvre le détail à droite. */
export function AuditFindings({ alerts, secretFindings, secretChecked, secretFiles, secretNote, allSourcesOk, hasSummary }: {
  alerts: AuditAlert[];
  secretFindings: SecretFinding[];
  secretChecked: string | null;
  secretFiles: number;
  secretNote: string | null;
  allSourcesOk: boolean;
  hasSummary: boolean;
}) {
  const [selected, setSelected] = useState<Selected>(null);
  const toggle = (s: NonNullable<Selected>) => setSelected(selected?.type === s.type && selected.id === s.id ? null : s);
  const secretKey = (f: SecretFinding) => f.fingerprint + f.path + f.line;
  const openSecret = selected?.type === "secret" ? secretFindings.find((f) => secretKey(f) === selected.id) : undefined;
  const openAlert = selected?.type === "alert" ? alerts.find((a) => a.id === selected.id) : undefined;

  return (
    <>
      <div className="rounded-lg border border-border bg-white overflow-hidden">
        <div className="px-5 py-3 border-b border-border text-[13px] font-medium flex items-center gap-2">
          <IconKey size={14} /> Secrets dans le code (analyse Openkido)
          {secretChecked && <span className="text-[11px] font-normal text-muted-foreground">{secretFiles} fichiers analysés le {new Date(secretChecked).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}</span>}
        </div>
        {!secretChecked ? (
          <p className="px-5 py-4 text-[12px] text-muted-foreground">Pas encore analysé : lancez l&apos;audit.</p>
        ) : secretFindings.length === 0 ? (
          <p className="px-5 py-4 text-[12px] text-green-700 flex items-center gap-2"><IconCheck size={14} /> Aucun secret détecté dans la branche par défaut.{secretNote ? ` (${secretNote})` : ""}</p>
        ) : (
          <ul className="divide-y divide-border">
            {secretFindings.map((f) => {
              const active = selected?.type === "secret" && selected.id === secretKey(f);
              return (
                <li key={secretKey(f)} onClick={() => toggle({ type: "secret", id: secretKey(f) })} className={cn("flex items-start gap-3 px-5 py-3 cursor-pointer hover:bg-muted/20 border-l-2", active ? "border-l-violet-600 bg-violet-50/40" : "border-l-transparent")}>
                  <span className={cn("mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold shrink-0", SEV_STYLE[f.severity])}>{SEV_LABEL[f.severity]}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">{f.name}</p>
                    <p className="font-mono text-[11px] text-muted-foreground mt-0.5 break-all">{f.path}:{f.line} · {f.preview}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="px-5 py-2.5 border-t border-border text-[11px] text-muted-foreground">
          Seule la branche par défaut est analysée, pas l&apos;historique des commits : un secret supprimé reste récupérable et doit être révoqué chez son fournisseur. Les valeurs ne sont jamais enregistrées.{secretNote ? ` ${secretNote}` : ""}
        </p>
      </div>

      {alerts.length > 0 ? (
        <div className="rounded-lg border border-border bg-white overflow-hidden">
          <div className="px-5 py-3 border-b border-border text-[13px] font-medium">Alertes ouvertes ({alerts.length})</div>
          <ul className="divide-y divide-border">
            {alerts.map((a) => {
              const active = selected?.type === "alert" && selected.id === a.id;
              return (
                <li key={a.id} onClick={() => toggle({ type: "alert", id: a.id })} className={cn("flex items-start gap-3 px-5 py-3 cursor-pointer hover:bg-muted/20 border-l-2", active ? "border-l-violet-600 bg-violet-50/40" : "border-l-transparent")}>
                  <span className={cn("mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold shrink-0", SEV_STYLE[a.severity] ?? SEV_STYLE.unknown)}>{SEV_LABEL[a.severity] ?? a.severity}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium">{a.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {SOURCE_LABEL[a.source]}{a.path ? ` · ${a.path}` : ""} · {new Date(a.createdAt).toLocaleDateString("fr-FR")}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : hasSummary && allSourcesOk ? (
        <div className="rounded-lg border border-green-200 bg-green-50 px-5 py-4 flex items-center gap-3">
          <IconShieldCheck size={18} className="text-green-600 shrink-0" />
          <p className="text-[13px] text-green-900">Les trois sources ont été interrogées : aucune alerte ouverte.</p>
        </div>
      ) : null}

      {openSecret && <SecretDrawer f={openSecret} onClose={() => setSelected(null)} />}
      {openAlert && <AlertDrawer a={openAlert} onClose={() => setSelected(null)} />}
    </>
  );
}

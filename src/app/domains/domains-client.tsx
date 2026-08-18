"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  IconWorldWww, IconPlus, IconRefresh, IconTrash,
  IconLoader2, IconShieldCheck, IconShieldX,
  IconLock, IconLockOpen, IconAlertTriangle,
  IconCheck, IconX, IconExternalLink,
} from "@tabler/icons-react";
import { addDomain, deleteDomain, recheckDomain } from "@/lib/domain-check";
import type { DomainModel as Domain } from "@/generated/prisma/models/Domain";
import { TopBar, PageHeader } from "@/components/app/sidebar";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ─── Helpers ─────────────────────────────────────────────────────────

function sslBadge(d: Domain) {
  if (d.sslValid === null) return null;
  if (!d.sslValid)
    return <Pill icon={<IconLockOpen size={12} />} label="SSL invalide" className="text-red-600 bg-red-50 border-red-200" />;
  if ((d.sslDaysLeft ?? 999) <= 14)
    return <Pill icon={<IconAlertTriangle size={12} />} label={`Expire dans ${d.sslDaysLeft}j`} className="text-amber-600 bg-amber-50 border-amber-200" />;
  if ((d.sslDaysLeft ?? 999) <= 30)
    return <Pill icon={<IconLock size={12} />} label={`${d.sslDaysLeft}j restants`} className="text-yellow-600 bg-yellow-50 border-yellow-200" />;
  return <Pill icon={<IconLock size={12} />} label={`SSL · ${d.sslDaysLeft}j`} className="text-green-700 bg-green-50 border-green-200" />;
}

function statusBadge(d: Domain) {
  if (d.httpStatus === null) return <Pill label="Injoignable" className="text-muted-foreground bg-muted border-border" />;
  if (d.httpStatus >= 200 && d.httpStatus < 300)
    return <Pill label={`HTTP ${d.httpStatus}`} className="text-green-700 bg-green-50 border-green-200" />;
  return <Pill label={`HTTP ${d.httpStatus}`} className="text-amber-600 bg-amber-50 border-amber-200" />;
}

function Pill({ icon, label, className }: { icon?: React.ReactNode; label: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border font-medium", className)}>
      {icon}{label}
    </span>
  );
}

function BoolIcon({ value }: { value: boolean | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  return value
    ? <IconCheck size={14} className="text-green-600" />
    : <IconX size={14} className="text-red-400" />;
}

function globalScore(d: Domain): "ok" | "warn" | "critical" | "unknown" {
  if (d.checkedAt === null) return "unknown";
  if (!d.sslValid || d.httpStatus === null) return "critical";
  if ((d.sslDaysLeft ?? 999) <= 30) return "warn";
  const headers = [d.hasHsts, d.hasCsp, d.hasXFrame, d.hasXContent, d.hasRp];
  const missing = headers.filter((h) => h === false).length;
  if (missing >= 3) return "warn";
  return "ok";
}

const SCORE_CONFIG = {
  ok:       { icon: <IconShieldCheck size={15} />, label: "Sain",     className: "text-green-600" },
  warn:     { icon: <IconAlertTriangle size={15} />, label: "Attention", className: "text-amber-500" },
  critical: { icon: <IconShieldX size={15} />, label: "Critique",   className: "text-red-600" },
  unknown:  { icon: <IconWorldWww size={15} />, label: "Non vérifié", className: "text-muted-foreground" },
};

// ─── Ligne d'action ───────────────────────────────────────────────────

function DomainActions({ domain, onDone }: { domain: string; onDone: () => void }) {
  const [rechecking, startRecheck] = useTransition();
  const [deleting, startDelete] = useTransition();

  return (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        onClick={() => startRecheck(async () => { await recheckDomain(domain); onDone(); })}
        disabled={rechecking}
        className="inline-flex items-center gap-1 rounded px-2 py-1 text-[12px] text-violet-600 hover:bg-violet-50 border border-violet-200 transition-colors disabled:opacity-50"
      >
        {rechecking ? <IconLoader2 size={12} className="animate-spin" /> : <IconRefresh size={12} />}
        Vérifier
      </button>
      <button
        onClick={() => startDelete(async () => { await deleteDomain(domain); onDone(); })}
        disabled={deleting}
        className="rounded p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
      >
        {deleting ? <IconLoader2 size={12} className="animate-spin" /> : <IconTrash size={12} />}
      </button>
    </div>
  );
}

// ─── Formulaire d'ajout ───────────────────────────────────────────────

function AddDomainForm({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    startTransition(async () => {
      try {
        await addDomain(value.trim());
        setValue("");
        onDone();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <div className="relative">
        <IconWorldWww size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="exemple.com"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="pl-8 h-9 w-64 text-[13px]"
          disabled={pending}
        />
      </div>
      <button
        type="submit"
        disabled={pending || !value.trim()}
        className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white px-4 h-9 text-[13px] font-medium transition-colors disabled:opacity-60"
      >
        {pending ? <IconLoader2 size={14} className="animate-spin" /> : <IconPlus size={14} />}
        {pending ? "Vérification…" : "Ajouter"}
      </button>
      {error && <span className="text-[12px] text-red-500">{error}</span>}
    </form>
  );
}

// ─── Composant principal ──────────────────────────────────────────────

export function DomainsClient({ domains: initial }: { domains: Domain[] }) {
  const router = useRouter();
  const refresh = () => router.refresh();

  const counts = { ok: 0, warn: 0, critical: 0, unknown: 0 };
  for (const d of initial) counts[globalScore(d)]++;

  return (
    <div className="flex flex-col flex-1 bg-background">
      <TopBar breadcrumb="Domains" />

      <PageHeader title="Domains" subtitle="Surveillance SSL, headers et statut HTTP de vos domaines">
        <AddDomainForm onDone={refresh} />
      </PageHeader>

      {/* Summary */}
      {initial.length > 0 && (
        <div className="flex items-center gap-6 px-6 py-3 bg-white border-b border-border">
          {(["critical", "warn", "ok", "unknown"] as const).map((s) => {
            const cfg = SCORE_CONFIG[s];
            return counts[s] > 0 ? (
              <div key={s} className={cn("flex items-center gap-1.5 text-[13px]", cfg.className)}>
                {cfg.icon}
                <span className="font-medium tabular-nums">{counts[s]}</span>
                <span className="text-muted-foreground text-[12px]">{cfg.label}</span>
              </div>
            ) : null;
          })}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 bg-white">
        {initial.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
              <IconWorldWww size={24} className="text-muted-foreground" />
            </div>
            <div>
              <p className="text-[14px] font-medium">Aucun domaine surveillé</p>
              <p className="text-[13px] text-muted-foreground mt-1">Ajoutez un domaine pour surveiller son SSL et ses headers de sécurité.</p>
            </div>
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-6 py-2.5 font-medium text-muted-foreground text-[12px]">Statut</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-[12px]">Domaine</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-[12px]">HTTP</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-[12px]">SSL</th>
                <th className="text-center px-3 py-2.5 font-medium text-muted-foreground text-[12px]">HSTS</th>
                <th className="text-center px-3 py-2.5 font-medium text-muted-foreground text-[12px]">CSP</th>
                <th className="text-center px-3 py-2.5 font-medium text-muted-foreground text-[12px]">X-Frame</th>
                <th className="text-center px-3 py-2.5 font-medium text-muted-foreground text-[12px]">X-Content</th>
                <th className="text-center px-3 py-2.5 font-medium text-muted-foreground text-[12px]">Referrer</th>
                <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-[12px]">Vérifié</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {initial.map((d) => {
                const score = globalScore(d);
                const cfg = SCORE_CONFIG[score];
                const checkedAt = d.checkedAt
                  ? new Date(d.checkedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
                  : null;

                return (
                  <tr key={d.id} className="hover:bg-muted/20 transition-colors group">
                    <td className="px-6 py-3">
                      <div className={cn("flex items-center gap-1.5 font-medium text-[12px]", cfg.className)}>
                        {cfg.icon} {cfg.label}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{d.domain}</span>
                        <a href={`https://${d.domain}`} target="_blank" rel="noopener noreferrer"
                          className="text-muted-foreground hover:text-foreground transition-colors">
                          <IconExternalLink size={12} />
                        </a>
                      </div>
                      {d.ipAddress && <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{d.ipAddress}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {statusBadge(d)}
                        {d.httpsRedirect && <Pill icon={<IconLock size={11} />} label="→ HTTPS" className="text-green-700 bg-green-50 border-green-200" />}
                      </div>
                    </td>
                    <td className="px-4 py-3">{sslBadge(d)}</td>
                    <td className="px-3 py-3 text-center"><BoolIcon value={d.hasHsts} /></td>
                    <td className="px-3 py-3 text-center"><BoolIcon value={d.hasCsp} /></td>
                    <td className="px-3 py-3 text-center"><BoolIcon value={d.hasXFrame} /></td>
                    <td className="px-3 py-3 text-center"><BoolIcon value={d.hasXContent} /></td>
                    <td className="px-3 py-3 text-center"><BoolIcon value={d.hasRp} /></td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground whitespace-nowrap">
                      {checkedAt ?? <span className="italic">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <DomainActions domain={d.domain} onDone={refresh} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

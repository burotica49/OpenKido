"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  IconWorldWww, IconPlus, IconRefresh, IconTrash,
  IconLoader2, IconShieldCheck, IconShieldX,
  IconLock, IconLockOpen, IconAlertTriangle,
  IconCheck, IconX, IconExternalLink,
} from "@tabler/icons-react";
import { addDomain, analyzeDomainSucuri, deleteDomain, recheckDomain } from "@/lib/actions/domains";
import type { SitecheckResult } from "@/lib/sucuri-core";
import type { DomainModel as Domain } from "@/generated/prisma/models/Domain";
import { HelpPanel, Term } from "@/components/app/help-panel";
import { DetailDrawer, DrawerSection } from "@/components/app/detail-drawer";
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

function DomainActions({ domain, onDone, always = false }: { domain: string; onDone: () => void; always?: boolean }) {
  const [rechecking, startRecheck] = useTransition();
  const [deleting, startDelete] = useTransition();

  return (
    <div className={cn("flex items-center gap-1 transition-opacity", !always && "opacity-0 group-hover:opacity-100")}>
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

// ─── Analyse Sucuri SiteCheck ─────────────────────────────────────────

function parseSucuri(raw: string | null): SitecheckResult | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SitecheckResult;
  } catch {
    return null;
  }
}

const RATING_CLS: Record<string, string> = {
  A: "bg-green-100 text-green-700", B: "bg-lime-100 text-lime-700", C: "bg-amber-100 text-amber-700",
  D: "bg-orange-100 text-orange-700", E: "bg-red-100 text-red-700", F: "bg-red-100 text-red-700",
};
function Rating({ value, label }: { value?: string; label?: string }) {
  if (!value) return <span className="text-muted-foreground text-[12px]">—</span>;
  return (
    <span title={label} className={cn("inline-flex h-6 min-w-6 items-center justify-center rounded px-1.5 text-[12px] font-bold", RATING_CLS[value[0]] ?? "bg-muted text-muted-foreground")}>
      {value}
    </span>
  );
}

function SucuriPanel({ domain, raw, at, onDone }: { domain: string; raw: string | null; at: Date | string | null; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const r = parseSucuri(raw);
  const run = () => {
    setError(null);
    start(async () => {
      const res = await analyzeDomainSucuri(domain);
      if (!res.ok) setError(res.error);
      onDone();
    });
  };

  return (
    <div className="space-y-3">
      {r ? (
        <>
          <div className="grid grid-cols-4 gap-2">
            {([["Global", r.ratings.total], ["Sécurité", r.ratings.security], ["Domaine", r.ratings.domain], ["TLS", r.ratings.tls]] as const).map(([label, v]) => (
              <div key={label} className="rounded-md border border-border px-2 py-2 text-center">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
                <Rating value={v} label={`${label} : ${v ?? "non noté"}`} />
              </div>
            ))}
          </div>

          {r.alerts.length > 0 ? (
            <ul className="rounded-md border border-red-200 bg-red-50 divide-y divide-red-100">
              {r.alerts.map((a, i) => (
                <li key={i} className="px-3 py-2 text-[12px] text-red-900"><span className="font-medium">{a.kind === "malware" ? "Malware : " : a.kind === "blacklist" ? "Liste noire : " : ""}{a.title}</span>{a.details ? <span className="block text-red-800/80 break-all">{a.details}</span> : null}</li>
              ))}
            </ul>
          ) : (
            <p className="rounded-md bg-green-50 px-3 py-2 text-[12px] text-green-800 flex items-center gap-2"><IconShieldCheck size={14} />Sucuri ne signale aucun malware ni aucune liste noire.</p>
          )}

          <ul className="rounded-md border border-border divide-y divide-border text-[12px]">
            {r.site.hosting.length > 0 && <li className="px-3 py-2 flex gap-2"><span className="w-28 shrink-0 text-muted-foreground">Hébergeur</span>{r.site.hosting.join(", ")}</li>}
            {r.site.ips.length > 0 && <li className="px-3 py-2 flex gap-2"><span className="w-28 shrink-0 text-muted-foreground">Adresse IP</span><span className="font-mono">{r.site.ips.join(", ")}</span></li>}
            {r.site.server.length > 0 && <li className="px-3 py-2 flex gap-2"><span className="w-28 shrink-0 text-muted-foreground">Serveur</span>{r.site.server.join(", ")}</li>}
            {r.site.poweredBy.length > 0 && <li className="px-3 py-2 flex gap-2"><span className="w-28 shrink-0 text-muted-foreground">Propulsé par</span>{r.site.poweredBy.join(", ")}</li>}
            {r.cms.length > 0 && <li className="px-3 py-2 flex gap-2"><span className="w-28 shrink-0 text-muted-foreground">CMS</span>{r.cms.map((c) => `${c.name}${c.version ? ` ${c.version}` : ""}`).join(", ")}</li>}
            {r.tls.issuer && <li className="px-3 py-2 flex gap-2"><span className="w-28 shrink-0 text-muted-foreground">Certificat</span>{r.tls.issuer}{r.tls.expires ? ` · expire le ${r.tls.expires}` : ""}</li>}
          </ul>

          {r.outdated.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-900 space-y-1">
              <p className="font-medium">Logiciel obsolète détecté</p>
              {r.outdated.map((o) => (
                <p key={o.name}>
                  {o.name} {o.version ?? ""}{o.safeVersion ? ` → au moins ${o.safeVersion}` : ""}
                  {o.url && <> · <a href={o.url} target="_blank" rel="noopener noreferrer" className="underline">notes de version</a></>}
                </p>
              ))}
              <p className="text-amber-800/80">Sans mise à jour, des failles connues restent exploitables.</p>
            </div>
          )}

          {r.recommendations.length > 0 && (
            <div>
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">Recommandations de durcissement</p>
              <ul className="rounded-md border border-border divide-y divide-border">
                {r.recommendations.map((rec) => (
                  <li key={rec.id} className="px-3 py-2 text-[12px] flex items-start gap-2">
                    <span className={cn("mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold", rec.level === "major" ? "bg-orange-100 text-orange-700" : "bg-muted text-muted-foreground")}>{rec.level === "major" ? "Importante" : "Mineure"}</span>
                    <span>{rec.title}{rec.details ? <span className="block text-muted-foreground break-words">{rec.details}</span> : null}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">
            Analyse du {at ? new Date(at).toLocaleDateString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }) : "—"} ·{" "}
            <a href={`https://sitecheck.sucuri.net/results/${encodeURIComponent(domain)}`} target="_blank" rel="noopener noreferrer" className="underline">rapport complet sur Sucuri</a>
          </p>
        </>
      ) : (
        <p className="text-[12px] text-muted-foreground">Pas encore analysé. L&apos;analyse recherche malware, listes noires, logiciels obsolètes (CMS, PHP) et défauts de durcissement.</p>
      )}

      <button
        onClick={run}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md border border-violet-200 px-3 py-1.5 text-[12px] font-medium text-violet-600 hover:bg-violet-50 transition-colors disabled:opacity-60"
      >
        {pending ? <IconLoader2 size={13} className="animate-spin" /> : <IconRefresh size={13} />}
        {pending ? "Analyse en cours…" : r ? "Relancer l'analyse Sucuri" : "Lancer l'analyse Sucuri"}
      </button>
      {error && <p className="text-[12px] text-red-600">{error}</p>}
      <p className="text-[11px] text-muted-foreground">Service tiers : le nom de domaine est transmis à Sucuri SiteCheck (sitecheck.sucuri.net), qui analyse le site depuis ses propres serveurs.</p>
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
      const result = await addDomain(value.trim());
      if (result.ok) {
        setValue("");
        onDone();
      } else {
        setError(result.error);
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

  const [openId, setOpenId] = useState<number | null>(null);
  const openDomain = initial.find((d) => d.id === openId);
  const counts = { ok: 0, warn: 0, critical: 0, unknown: 0 };
  for (const d of initial) counts[globalScore(d)]++;

  return (
    <div className="flex flex-col flex-1 bg-background">
      <TopBar breadcrumb="Domains" />

      <PageHeader title="Domains" subtitle="Surveillance SSL, headers et statut HTTP de vos domaines">
        <AddDomainForm onDone={refresh} />
      </PageHeader>

      <HelpPanel>
        <p>Pour chaque nom de domaine ajouté, l&apos;application vérifie, à chaque vérification lancée, que le site est joignable et bien configuré côté sécurité.</p>
        <p><Term>Certificat SSL</Term> : ce qui permet le cadenas HTTPS. Un certificat expiré affiche un avertissement à vos visiteurs ; la page indique le nombre de jours restants.</p>
        <p><Term>En-têtes de sécurité</Term> (HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) : consignes envoyées au navigateur pour limiter les attaques courantes (détournement de page, injection de scripts…). Plus il y en a, mieux le site est protégé.</p>
        <p><Term>Analyse Sucuri</Term> : dans le détail d&apos;un domaine, vous pouvez lancer une analyse approfondie par le service gratuit Sucuri SiteCheck : malware, listes noires, CMS et PHP obsolètes, défauts de durcissement, avec une note de A à F. Elle n&apos;est lancée que sur demande : le nom de domaine est alors transmis à Sucuri. Les problèmes trouvés remontent aussi dans la page Issues.</p>
        <p><Term>Statuts</Term> : <Term>Sain</Term> = tout est en ordre ; <Term>Attention</Term> = certificat bientôt expiré ou en-têtes manquants ; <Term>Critique</Term> = certificat invalide/expiré ou site injoignable ; <Term>Non vérifié</Term> = pas encore testé.</p>
      </HelpPanel>

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
                <th className="text-center px-3 py-2.5 font-medium text-muted-foreground text-[12px]" title="Note globale de l'analyse Sucuri SiteCheck (A à F)">Sucuri</th>
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
                  <tr
                    key={d.id}
                    onClick={() => setOpenId(openId === d.id ? null : d.id)}
                    className={cn("hover:bg-muted/20 transition-colors group cursor-pointer border-l-2", openId === d.id ? "border-l-violet-600 bg-violet-50/40" : "border-l-transparent")}
                  >
                    <td className="px-6 py-3">
                      <div className={cn("flex items-center gap-1.5 font-medium text-[12px]", cfg.className)}>
                        {cfg.icon} {cfg.label}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{d.domain}</span>
                        <a href={`https://${d.domain}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
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
                    <td className="px-3 py-3 text-center"><Rating value={parseSucuri(d.sucuri)?.ratings.total} label="Note globale Sucuri" /></td>
                    <td className="px-3 py-3 text-center"><BoolIcon value={d.hasHsts} /></td>
                    <td className="px-3 py-3 text-center"><BoolIcon value={d.hasCsp} /></td>
                    <td className="px-3 py-3 text-center"><BoolIcon value={d.hasXFrame} /></td>
                    <td className="px-3 py-3 text-center"><BoolIcon value={d.hasXContent} /></td>
                    <td className="px-3 py-3 text-center"><BoolIcon value={d.hasRp} /></td>
                    <td className="px-4 py-3 text-[12px] text-muted-foreground whitespace-nowrap">
                      {checkedAt ?? <span className="italic">—</span>}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <DomainActions domain={d.domain} onDone={refresh} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {openDomain && (() => {
        const d = openDomain;
        const cfg = SCORE_CONFIG[globalScore(d)];
        const headers: { label: string; value: boolean | null; help: string }[] = [
          { label: "HSTS", value: d.hasHsts, help: "Force le navigateur à utiliser HTTPS, même si le visiteur tape http://." },
          { label: "CSP (Content-Security-Policy)", value: d.hasCsp, help: "Limite les sources de scripts et de contenus autorisées : freine l'injection de code (XSS)." },
          { label: "X-Frame-Options", value: d.hasXFrame, help: "Empêche d'afficher votre site dans une page tierce (détournement de clic)." },
          { label: "X-Content-Type-Options", value: d.hasXContent, help: "Empêche le navigateur de deviner le type d'un fichier (attaques par contenu déguisé)." },
          { label: "Referrer-Policy", value: d.hasRp, help: "Limite les informations d'URL transmises aux sites visités ensuite." },
        ];
        return (
          <DetailDrawer
            onClose={() => setOpenId(null)}
            label={`Détail de ${d.domain}`}
            headerRight={<a href={`https://${d.domain}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1 text-[12px] hover:bg-muted">Ouvrir le site <IconExternalLink size={12} /></a>}
            footer={<DomainActions domain={d.domain} onDone={refresh} always />}
          >
            <div>
              <div className={cn("flex items-center gap-1.5 font-medium text-[12px] mb-1", cfg.className)}>{cfg.icon} {cfg.label}</div>
              <h2 className="text-lg font-semibold break-all">{d.domain}</h2>
              <p className="text-[12px] text-muted-foreground mt-0.5">
                {d.checkedAt ? `Vérifié le ${new Date(d.checkedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}` : "Pas encore vérifié"}
                {d.ipAddress ? ` · ${d.ipAddress}` : ""}
              </p>
            </div>
            <DrawerSection title="Connexion">
              <div className="flex items-center gap-1.5 flex-wrap">
                {statusBadge(d)}
                {d.httpsRedirect === true && <Pill icon={<IconLock size={11} />} label="HTTP → HTTPS" className="text-green-700 bg-green-50 border-green-200" />}
                {d.httpsRedirect === false && <Pill icon={<IconLockOpen size={11} />} label="Pas de redirection HTTPS" className="text-amber-600 bg-amber-50 border-amber-200" />}
              </div>
            </DrawerSection>
            <DrawerSection title="Certificat SSL">
              <div className="flex items-center gap-1.5 flex-wrap mb-2">{sslBadge(d) ?? <span className="text-[12px] text-muted-foreground">Non vérifié</span>}</div>
              {d.sslIssuer && <p className="text-[12px] text-muted-foreground">Émetteur : {d.sslIssuer}</p>}
              {d.sslExpiry && <p className="text-[12px] text-muted-foreground">Expire le {new Date(d.sslExpiry).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}</p>}
            </DrawerSection>
            <DrawerSection title="En-têtes de sécurité">
              <ul className="rounded-md border border-border divide-y divide-border">
                {headers.map((h) => (
                  <li key={h.label} className="px-3 py-2.5 text-[12px]">
                    <div className="flex items-center gap-2"><span className="font-medium">{h.label}</span><span className="ml-auto"><BoolIcon value={h.value} /></span></div>
                    <p className="text-muted-foreground mt-0.5">{h.help}</p>
                  </li>
                ))}
              </ul>
            </DrawerSection>
            <DrawerSection title="Analyse Sucuri SiteCheck">
              <SucuriPanel domain={d.domain} raw={d.sucuri} at={d.sucuriAt} onDone={refresh} />
            </DrawerSection>
          </DetailDrawer>
        );
      })()}
    </div>
  );
}

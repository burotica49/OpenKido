"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  IconRefresh, IconLoader2, IconCheck, IconShieldCheck,
  IconBug, IconKey, IconAlertTriangle, IconSearch,
  IconCode, IconGitBranch, IconX, IconBan,
} from "@tabler/icons-react";
import type { GithubRepo } from "@/lib/github";
import type { AuditSummary } from "@/lib/audit";
import type { SecretSummary } from "@/lib/secrets";
import { auditRepo, auditAllRepos } from "@/lib/actions/audit";
import { HelpPanel, Term } from "@/components/app/help-panel";
import { PageHeader } from "@/components/app/sidebar";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ─── Severity badge ────────────────────────────────────────────────────────────

type Sev = "critical" | "high" | "medium" | "low";

const SEV_STYLE: Record<Sev, string> = {
  critical: "bg-red-100 text-red-700",
  high:     "bg-orange-100 text-orange-700",
  medium:   "bg-amber-100 text-amber-700",
  low:      "bg-blue-100 text-blue-700",
};

function SevBadge({ count, sev }: { count: number; sev: Sev }) {
  if (count === 0) return null;
  return (
    <span className={cn("text-[11px] px-1.5 py-0.5 rounded font-semibold tabular-nums", SEV_STYLE[sev])}>
      {sev[0].toUpperCase()} {count}
    </span>
  );
}

function totalAlerts(s: AuditSummary) {
  return s.csTotal + s.dbTotal + s.ssActive;
}

/** Les trois sources ont été interrogées avec succès (aucune n'est désactivée, refusée ou inconnue). */
function fullyCovered(s: AuditSummary) {
  return s.csState === "ok" && s.dbState === "ok" && s.ssState === "ok";
}

const STATE_LABEL: Record<string, { text: string; title: string }> = {
  disabled: { text: "Désactivé", title: "Cette fonction n'est pas activée sur le dépôt : GitHub ne remonte aucune alerte, ce qui ne veut PAS dire que le dépôt est sain." },
  "no-access": { text: "Accès refusé", title: "Droits insuffisants pour lire ces alertes." },
  unknown: { text: "À relancer", title: "Audit enregistré avant le suivi de l'état des sources : relancez l'audit." },
};

/** Cellule d'une source : « aucune alerte » n'est affiché QUE si la source a réellement été interrogée. */
function SourceCell({ state, total, crit, high, med, low, empty }: {
  state: string; total: number; crit: number; high: number; med: number; low: number; empty: string;
}) {
  if (state !== "ok") {
    const info = STATE_LABEL[state] ?? STATE_LABEL.unknown;
    return (
      <span title={info.title} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium bg-muted text-muted-foreground">
        <IconBan size={11} />{info.text}
      </span>
    );
  }
  if (total === 0) {
    return <span className="text-[12px] text-green-600 flex items-center gap-1"><IconCheck size={12} /> {empty}</span>;
  }
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <SevBadge count={crit} sev="critical" />
      <SevBadge count={high} sev="high" />
      <SevBadge count={med} sev="medium" />
      <SevBadge count={low} sev="low" />
    </div>
  );
}

interface Notice { kind: "error" | "warning"; text: string }

function worstSeverity(s: AuditSummary): Sev | null {
  if (s.csCritical + s.dbCritical + s.ssActive > 0) return "critical";
  if (s.csHigh + s.dbHigh > 0) return "high";
  if (s.csMedium + s.dbMedium > 0) return "medium";
  if (s.csLow + s.dbLow > 0) return "low";
  return null;
}

const SOURCE_LABEL: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  code_scanning:  { label: "Code Scanning", icon: <IconCode size={12} />,  color: "text-violet-600" },
  dependabot:     { label: "Dependabot",    icon: <IconBug size={12} />,   color: "text-orange-500" },
  secret_scanning:{ label: "Secrets",       icon: <IconKey size={12} />,   color: "text-red-600" },
};

// ─── Audit button per repo ─────────────────────────────────────────────────────

function AuditButton({ repo, onNotice }: { repo: GithubRepo; onNotice: (n: Notice | null) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        start(async () => {
          const r = await auditRepo(repo.owner, repo.name);
          onNotice(r.ok ? null : { kind: "error", text: `${repo.full_name} : ${r.error}` });
          router.refresh();
        });
      }}
      disabled={pending}
      className="inline-flex items-center gap-1 rounded px-2.5 py-1 text-[12px] text-violet-600 hover:bg-violet-50 border border-violet-200 transition-colors disabled:opacity-50"
    >
      {pending ? <IconLoader2 size={12} className="animate-spin" /> : <IconRefresh size={12} />}
      {pending ? "Audit…" : "Auditer"}
    </button>
  );
}

// ─── Stats card ────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, tone = "default" }: {
  icon: React.ReactNode; label: string; value: number | string;
  sub?: string; tone?: "ok" | "warning" | "critical" | "default";
}) {
  const toneClass = { ok: "text-green-600", warning: "text-amber-500", critical: "text-red-600", default: "text-foreground" }[tone];
  return (
    <div className="px-6 py-4 border-r border-border last:border-0">
      <div className="flex items-center gap-1.5 mb-1 text-muted-foreground text-[11px] uppercase tracking-wider">
        {icon}<span>{label}</span>
      </div>
      <p className={cn("text-2xl font-semibold tabular-nums", toneClass)}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function CodeAuditClient({
  repos,
  summaries,
  secrets,
}: {
  repos: GithubRepo[];
  summaries: Record<string, AuditSummary>;
  secrets: Record<string, SecretSummary>;
}) {
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "issues" | "secrets" | "clean" | "uncovered">("all");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function handleAuditAll() {
    if (scanning) return;
    setScanning(true);
    setNotice(null);
    setProgress({ done: 0, total: repos.length });
    const BATCH = 5;
    let done = 0;
    let failed = 0;
    const failures: { repo: string; error: string }[] = [];
    const warnings: string[] = [];
    for (let i = 0; i < repos.length; i += BATCH) {
      const batch = repos.slice(i, i + BATCH);
      try {
        const r = await auditAllRepos(batch.map((x) => ({ owner: x.owner, name: x.name })));
        failed += r.failed;
        failures.push(...r.failures);
        warnings.push(...r.warnings);
      } catch (error) {
        failed += batch.length;
        failures.push({ repo: `${batch.length} dépôt(s)`, error: error instanceof Error ? error.message : "erreur inconnue" });
      }
      done += batch.length;
      setProgress({ done: Math.min(done, repos.length), total: repos.length });
    }
    setScanning(false);
    setProgress(null);
    if (failed === 0 && warnings.length > 0) {
      setNotice({ kind: "warning", text: `${warnings.length} analyse(s) des secrets incomplète(s) — ${warnings.slice(0, 2).join(" ; ")}` });
    }
    if (failed > 0) {
      setNotice({ kind: "error", text: `${failed} audit(s) en échec — ${failures.slice(0, 3).map((f) => `${f.repo} (${f.error})`).join(" ; ")}` });
    }
    router.refresh();
  }

  // Aggregate stats
  const audited = Object.values(summaries);
  const totalCritical = audited.reduce((a, s) => a + s.csCritical + s.dbCritical + s.ssActive, 0);
  const totalHigh = audited.reduce((a, s) => a + s.csHigh + s.dbHigh, 0);
  const totalSecrets = audited.reduce((a, s) => a + s.ssActive, 0);
  // « Sain » = les trois sources interrogées ET aucune alerte. Une source désactivée n'est pas un dépôt sain.
  const cleanRepos = audited.filter((s) => fullyCovered(s) && totalAlerts(s) === 0).length;
  const uncoveredRepos = audited.filter((s) => !fullyCovered(s)).length;
  const secretScanningOn = audited.filter((s) => s.ssState === "ok").length;

  const filtered = repos
    .filter((r) => r.full_name.toLowerCase().includes(query.toLowerCase()))
    .filter((r) => {
      const s = summaries[`${r.owner}/${r.name}`];
      if (filter === "issues") return s && totalAlerts(s) > 0;
      if (filter === "secrets") return s && s.ssActive > 0;
      if (filter === "clean") return s && fullyCovered(s) && totalAlerts(s) === 0;
      if (filter === "uncovered") return s && !fullyCovered(s);
      return true;
    })
    .sort((a, b) => {
      const sa = summaries[`${a.owner}/${a.name}`];
      const sb = summaries[`${b.owner}/${b.name}`];
      return (totalAlerts(sb ?? { csTotal:0,dbTotal:0,ssActive:0 } as AuditSummary))
           - (totalAlerts(sa ?? { csTotal:0,dbTotal:0,ssActive:0 } as AuditSummary));
    });

  return (
    <div className="flex flex-col flex-1 bg-background">
      <PageHeader title="Code Audit" subtitle="Analyse SAST, Dependabot et secrets exposés via GitHub">
        <div className="flex items-center gap-2">
          <button
            onClick={handleAuditAll}
            disabled={scanning}
            className="inline-flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 text-[13px] font-medium transition-colors disabled:opacity-60"
          >
            {scanning ? <IconLoader2 size={14} className="animate-spin" /> : <IconRefresh size={14} />}
            {scanning ? `Audit… ${progress?.done ?? 0}/${progress?.total ?? repos.length}` : "Tout auditer"}
          </button>
        </div>
      </PageHeader>

      <HelpPanel>
        <p>Cette page reprend les alertes de sécurité que <Term>GitHub</Term> détecte lui-même sur vos dépôts, en trois catégories :</p>
        <p><Term>Code Scanning</Term> : failles dans votre propre code (injections, mauvaise utilisation de fonctions dangereuses…). <Term>Dependabot</Term> : bibliothèques utilisées qui ont une faille connue. <Term>Secrets</Term> : mots de passe, clés d&apos;API ou jetons envoyés par erreur dans le code.</p>
        <p>Les pastilles indiquent le nombre d&apos;alertes par gravité : critique, élevée, moyenne, faible. Les secrets exposés sont toujours à traiter en urgence : il faut les révoquer, pas seulement les supprimer du code.</p>
        <p><Term>Secrets (code)</Term> : en plus de GitHub, Openkido analyse lui-même les fichiers de la branche par défaut (clés AWS, jetons GitHub, clés privées, mots de passe dans les URL de bases de données…). Cela fonctionne aussi sur vos dépôts privés. L&apos;historique des anciens commits n&apos;est pas analysé : un secret supprimé du code reste récupérable dans l&apos;historique et doit être révoqué. Les valeurs ne sont jamais enregistrées, seulement un aperçu masqué. Un astérisque indique une analyse partielle (fichiers trop volumineux).</p>
        <p><Term>Désactivé</Term> veut dire que la fonction n&apos;est pas activée sur le dépôt : rien n&apos;est analysé, ce qui ne signifie pas que le dépôt est sain. « Sains » ne compte que les dépôts où les trois sources sont actives et sans alerte.</p>
      </HelpPanel>

      {/* Progress bar */}
      {scanning && progress && (
        <div className="bg-white border-b border-border px-6 py-2">
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-violet-500 rounded-full transition-all duration-300"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
            <span className="text-[12px] text-muted-foreground tabular-nums shrink-0">{progress.done} / {progress.total}</span>
          </div>
        </div>
      )}

      {notice && (
        <div className={cn("flex items-start justify-between gap-3 px-6 py-2.5 text-[12px] border-b",
          notice.kind === "error" ? "bg-red-50 text-red-800 border-red-200" : "bg-amber-50 text-amber-800 border-amber-200")}>
          <span className="flex items-start gap-2"><IconAlertTriangle size={14} className="mt-0.5 shrink-0" />{notice.text}</span>
          <button onClick={() => setNotice(null)} aria-label="Fermer" className="shrink-0 opacity-70 hover:opacity-100"><IconX size={14} /></button>
        </div>
      )}

      {/* Sources désactivées : explique pourquoi la page paraît vide */}
      {audited.length > 0 && (() => {
        const off = (k: "csState" | "dbState" | "ssState") => audited.filter((s) => s[k] === "disabled").length;
        const rows = [
          { label: "Code Scanning (CodeQL)", n: off("csState"), hint: "gratuit sur les dépôts publics ; GitHub Code Security (payant) pour les privés" },
          { label: "Dependabot", n: off("dbState"), hint: "gratuit sur tous les dépôts" },
          { label: "Secret Scanning", n: off("ssState"), hint: "gratuit sur les dépôts publics ; GitHub Secret Protection (payant) pour les privés" },
        ].filter((r) => r.n > 0);
        if (rows.length === 0) return null;
        const first = audited.length ? repos.find((r) => summaries[`${r.owner}/${r.name}`]) : undefined;
        return (
          <div className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-[12px] text-amber-900">
            <p className="font-medium flex items-center gap-2"><IconAlertTriangle size={14} />Cette page affiche les alertes remontées par GitHub : si une fonction n&apos;y est pas activée, il n&apos;y a rien à afficher.</p>
            <ul className="mt-1.5 space-y-0.5 list-disc pl-6">
              {rows.map((r) => <li key={r.label}><span className="font-medium">{r.label}</span> est désactivé sur {r.n}/{audited.length} dépôts — {r.hint}.</li>)}
            </ul>
            <p className="mt-1.5">« Désactivé » ne veut pas dire « sain » : le dépôt n&apos;est simplement pas analysé par GitHub. Pour activer : réglages du dépôt → <span className="font-medium">Code security</span>{first ? <> (par ex. <a className="underline" href={`https://github.com/${first.owner}/${first.name}/settings/security_analysis`} target="_blank" rel="noopener noreferrer">{first.full_name}</a>)</> : null}. L&apos;onglet <span className="font-medium">Repositories</span> analyse déjà les vulnérabilités de vos dépendances sans rien activer.</p>
          </div>
        );
      })()}

      {/* Stats bar */}
      {audited.length > 0 && (
        <div className="grid grid-cols-4 bg-white border-b border-border">
          <StatCard icon={<IconAlertTriangle size={14} />} label="Critiques" value={totalCritical}
            tone={totalCritical > 0 ? "critical" : "ok"}
            sub={totalCritical === 0 ? "Aucune" : "Action immédiate"} />
          <StatCard icon={<IconBug size={14} />} label="Élevées" value={totalHigh}
            tone={totalHigh > 0 ? "warning" : "ok"} />
          <StatCard icon={<IconKey size={14} />} label="Secrets exposés" value={totalSecrets}
            tone={totalSecrets > 0 ? "critical" : "default"}
            sub={totalSecrets > 0 ? "Rotation requise" : `Secret Scanning actif sur ${secretScanningOn}/${audited.length} dépôts`} />
          <StatCard icon={<IconShieldCheck size={14} />} label="Repos sains" value={`${cleanRepos}/${audited.length}`}
            tone={cleanRepos === audited.length ? "ok" : "default"}
            sub={uncoveredRepos > 0 ? `${uncoveredRepos} avec une source désactivée` : undefined} />
        </div>
      )}

      {/* Toolbar */}
      <div className="bg-white border-b border-border px-6 py-3 flex items-center gap-3">
        <div className="w-64">
          <Input placeholder="Rechercher…" value={query} onChange={(e) => setQuery(e.target.value)}
            className="h-8 text-[13px] bg-muted/40 border-border" />
        </div>
        {(["all", "issues", "secrets", "clean", "uncovered"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn("text-[12px] px-2.5 py-1 rounded-md transition-colors",
              filter === f ? "bg-violet-100 text-violet-700 font-medium" : "text-muted-foreground hover:bg-muted")}>
            {{ all: "Tous", issues: "Avec alertes", secrets: "Secrets", clean: "Sains", uncovered: "Non couverts" }[f]}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 bg-white">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left px-6 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Repository</th>
              <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                <span className="flex items-center gap-1"><IconCode size={12} /> Code Scanning</span>
              </th>
              <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                <span className="flex items-center gap-1"><IconBug size={12} /> Dependabot</span>
              </th>
              <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                <span className="flex items-center gap-1"><IconKey size={12} /> Secrets</span>
              </th>
              <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                <span className="flex items-center gap-1" title="Analyse des fichiers du dépôt par Openkido, indépendante de GitHub"><IconKey size={12} /> Secrets (code)</span>
              </th>
              <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Audité</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((repo) => {
              const key = `${repo.owner}/${repo.name}`;
              const s = summaries[key];
              const checkedAt = s?.checkedAt
                ? new Date(s.checkedAt).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
                : null;
              const worst = s ? worstSeverity(s) : null;

              return (
                <tr key={repo.id} className="hover:bg-muted/20 transition-colors group">
                  {/* Repo name */}
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      {worst ? (
                        <span className={cn("h-2 w-2 rounded-full shrink-0", {
                          "bg-red-500": worst === "critical",
                          "bg-orange-500": worst === "high",
                          "bg-amber-400": worst === "medium",
                          "bg-blue-400": worst === "low",
                        })} />
                      ) : s && fullyCovered(s) ? (
                        <IconCheck size={12} className="text-green-500 shrink-0" />
                      ) : s ? (
                        <IconBan size={12} className="text-muted-foreground shrink-0" />
                      ) : (
                        <span className="h-2 w-2 rounded-full bg-muted shrink-0" />
                      )}
                      <div>
                        <Link href={`/code-audit/${repo.owner}/${repo.name}`}
                          className="font-medium hover:text-violet-600 transition-colors">
                          {repo.name}
                        </Link>
                        <p className="text-[11px] text-muted-foreground">{repo.owner}</p>
                      </div>
                    </div>
                  </td>

                  {/* Code Scanning */}
                  <td className="px-4 py-3">
                    {s ? <SourceCell state={s.csState} total={s.csTotal} crit={s.csCritical} high={s.csHigh} med={s.csMedium} low={s.csLow} empty="Aucune" />
                       : <span className="text-muted-foreground text-[12px] italic">—</span>}
                  </td>

                  {/* Dependabot */}
                  <td className="px-4 py-3">
                    {s ? <SourceCell state={s.dbState} total={s.dbTotal} crit={s.dbCritical} high={s.dbHigh} med={s.dbMedium} low={s.dbLow} empty="Aucune" />
                       : <span className="text-muted-foreground text-[12px] italic">—</span>}
                  </td>

                  {/* Secrets */}
                  <td className="px-4 py-3">
                    {s ? (
                      s.ssState !== "ok"
                        ? <SourceCell state={s.ssState} total={0} crit={0} high={0} med={0} low={0} empty="Aucun" />
                        : s.ssActive === 0
                          ? <span className="text-[12px] text-green-600 flex items-center gap-1"><IconCheck size={12} /> Aucun</span>
                          : <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold">
                              <IconKey size={10} /> {s.ssActive}
                            </span>
                    ) : <span className="text-muted-foreground text-[12px] italic">—</span>}
                  </td>

                  {/* Secrets détectés dans le code par Openkido */}
                  <td className="px-4 py-3">
                    {(() => {
                      const sc = secrets[key];
                      if (!sc) return <span className="text-muted-foreground text-[12px] italic">—</span>;
                      if (sc.total === 0) {
                        return <span className="text-[12px] text-green-600 flex items-center gap-1" title={sc.note ?? `${sc.filesScanned} fichiers analysés`}><IconCheck size={12} /> Aucun{sc.status === "partial" ? " *" : ""}</span>;
                      }
                      return (
                        <div className="flex items-center gap-1 flex-wrap" title={sc.note ?? undefined}>
                          <SevBadge count={sc.critical} sev="critical" />
                          <SevBadge count={sc.high} sev="high" />
                          <SevBadge count={sc.medium} sev="medium" />
                          <SevBadge count={sc.low} sev="low" />
                        </div>
                      );
                    })()}
                  </td>

                  {/* Date */}
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">
                    {checkedAt ?? <span className="italic">Jamais</span>}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                      <AuditButton repo={repo} onNotice={setNotice} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="py-16 text-center text-sm text-muted-foreground">
            Aucun repo ne correspond à la sélection.
          </div>
        )}
      </div>
    </div>
  );
}

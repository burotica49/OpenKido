import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listRepos, getGithubLogin } from "@/lib/github";
import { getFeed } from "@/lib/issues";
import { getPostureSummaries } from "@/lib/controls/engine";
import { getSelectedOrg, filterReposByOrg, PERSONAL_ORG } from "@/lib/selected-org";
import { buildReport, coverageGaps, IGNORE_REASONS, type IgnoreReason, type IssueKind, type IssueSeverity, type ResolvedIssue } from "@/lib/issues-core";
import { TopBar } from "@/components/app/sidebar";
import { ExportButton } from "./export-button";
import pkg from "../../../package.json";

export const dynamic = "force-dynamic";

const SEV: Record<IssueSeverity, string> = { critical: "Critique", high: "Élevée", medium: "Moyenne", low: "Faible" };
const SEV_CLS: Record<IssueSeverity, string> = { critical: "text-red-700", high: "text-orange-600", medium: "text-amber-600", low: "text-blue-600" };
const KIND: Record<IssueKind, string> = {
  malware: "Paquets malveillants", secret: "Secrets exposés", dependency: "Dépendances vulnérables", "code-scanning": "Failles de code (CodeQL)",
  dependabot: "Alertes Dependabot", license: "Licences à risque", posture: "Configuration des dépôts", domain: "Domaines",
};
const fmt = (d: Date | string) => new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="break-inside-avoid-page space-y-2">
      <h2 className="text-[15px] font-semibold border-b border-border pb-1">{title}</h2>
      {children}
    </section>
  );
}

function IssueTable({ issues }: { issues: ResolvedIssue[] }) {
  return (
    <table className="w-full text-[11px] border-collapse">
      <thead>
        <tr className="text-left text-muted-foreground border-b border-border">
          <th className="py-1 pr-2 font-medium w-16">Gravité</th>
          <th className="py-1 pr-2 font-medium">Élément</th>
          <th className="py-1 pr-2 font-medium">Cible</th>
          <th className="py-1 font-medium">Action recommandée</th>
        </tr>
      </thead>
      <tbody>
        {issues.map((i) => (
          <tr key={i.key} className="border-b border-border/60 align-top break-inside-avoid">
            <td className={`py-1.5 pr-2 font-semibold ${SEV_CLS[i.severity]}`}>{SEV[i.severity]}</td>
            <td className="py-1.5 pr-2"><span className="font-medium">{i.title}</span><br /><span className="text-muted-foreground break-all">{i.detail.slice(0, 160)}</span></td>
            <td className="py-1.5 pr-2 break-all">{i.target}</td>
            <td className="py-1.5">{i.fix?.text.slice(0, 220) ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function ReportPage() {
  const session = await auth();
  if (!session?.accessToken) redirect("/");

  const login = session.githubLogin ?? (await getGithubLogin(session.accessToken));
  const org = await getSelectedOrg();
  const repos = filterReposByOrg(await listRepos(session.accessToken), org, login);
  const refs = repos.map((r) => ({ owner: r.owner, name: r.name }));
  const [feed, posture] = await Promise.all([getFeed(login, refs), getPostureSummaries(refs)]);

  const report = buildReport(feed.issues);
  const gaps = coverageGaps(feed.coverage);
  const scope = org === null ? "Tous les dépôts accessibles" : org === PERSONAL_ORG ? `Compte personnel (@${login})` : `Organisation ${org}`;
  const postureList = [...posture.values()];
  const avgPosture = postureList.length ? Math.round(postureList.reduce((a, p) => a + p.score, 0) / postureList.length) : null;
  const byKind = (kind: IssueKind) => report.open.filter((i) => i.kind === kind && !i.devOnly);

  const headline =
    report.counts.critical > 0 ? `${report.counts.critical} problème(s) critique(s) à traiter en priorité.`
    : report.counts.high > 0 ? `Aucun problème critique ; ${report.counts.high} problème(s) de gravité élevée à corriger rapidement.`
    : report.counts.total > 0 ? "Aucun problème critique ni élevé ; des points d'amélioration subsistent."
    : "Aucun problème ouvert sur le périmètre analysé.";

  return (
    <div className="flex flex-col flex-1 bg-background print:bg-white">
      <TopBar breadcrumb="Rapport" />
      <div className="mx-auto w-full max-w-4xl px-8 py-8 space-y-7 bg-white print:px-0 print:py-0 text-[12px] leading-relaxed">
        <header className="flex items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-violet-600 font-semibold">Openkido · Confidentiel</p>
            <h1 className="text-2xl font-bold mt-1">Rapport de sécurité</h1>
            <p className="text-muted-foreground mt-1">{scope} · établi le {fmt(new Date())} · {repos.length} dépôt(s), {feed.coverage.domains} domaine(s)</p>
          </div>
          <ExportButton />
        </header>

        <Section title="Synthèse">
          <p className="text-[13px] font-medium">{headline}</p>
          <div className="grid grid-cols-5 gap-3 mt-2">
            {(["critical", "high", "medium", "low"] as const).map((s) => (
              <div key={s} className="rounded border border-border px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{SEV[s]}</p>
                <p className={`text-xl font-semibold tabular-nums ${report.counts[s] > 0 ? SEV_CLS[s] : "text-green-600"}`}>{report.counts[s]}</p>
              </div>
            ))}
            <div className="rounded border border-border px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Posture moyenne</p>
              <p className="text-xl font-semibold tabular-nums">{avgPosture ?? "—"}{avgPosture !== null && <span className="text-xs text-muted-foreground"> /100</span>}</p>
            </div>
          </div>
          {report.byKind.length > 0 && (
            <table className="w-full text-[11px] mt-3 border-collapse">
              <thead><tr className="text-left text-muted-foreground border-b border-border"><th className="py-1 font-medium">Catégorie</th>{(["critical", "high", "medium", "low"] as const).map((s) => <th key={s} className="py-1 font-medium text-right w-16">{SEV[s]}</th>)}<th className="py-1 font-medium text-right w-14">Total</th></tr></thead>
              <tbody>
                {report.byKind.map((k) => (
                  <tr key={k.kind} className="border-b border-border/60">
                    <td className="py-1">{KIND[k.kind]}</td>
                    {(["critical", "high", "medium", "low"] as const).map((s) => <td key={s} className="py-1 text-right tabular-nums">{k.counts[s] || "·"}</td>)}
                    <td className="py-1 text-right tabular-nums font-medium">{k.counts.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {report.devHidden > 0 && <p className="text-muted-foreground">{report.devHidden} alerte(s) sur des dépendances de développement (non livrées en production) ne sont pas comptées.</p>}
        </Section>

        <Section title="Couverture et limites de l'analyse">
          {gaps.length > 0 ? (
            <>
              <p className="text-amber-700 font-medium">Ces chiffres ne portent que sur ce qui a été analysé. Éléments non couverts :</p>
              <ul className="list-disc pl-5">{gaps.map((g) => <li key={g}>{g}</li>)}</ul>
            </>
          ) : <p>Tous les dépôts et domaines du périmètre ont été analysés par chaque outil.</p>}
          <p className="text-muted-foreground">
            Sources : base de vulnérabilités OSV.dev (dépendances, paquets malveillants), deps.dev (licences), API GitHub (alertes, configuration des dépôts), analyse des fichiers de la branche par défaut (secrets) et vérifications réseau des domaines.
            L&apos;historique des commits n&apos;est pas analysé : un secret supprimé du code doit tout de même être révoqué. L&apos;absence d&apos;alerte n&apos;est pas une garantie d&apos;absence de faille.
          </p>
        </Section>

        {report.priorities.length > 0 && (
          <Section title={`Priorités (gravité critique et élevée${report.counts.critical + report.counts.high > report.priorities.length ? ` — ${report.priorities.length} premières sur ${report.counts.critical + report.counts.high}` : ""})`}>
            <IssueTable issues={report.priorities} />
          </Section>
        )}

        {report.byRepo.length > 0 && (
          <Section title="Situation par dépôt">
            <table className="w-full text-[11px] border-collapse">
              <thead><tr className="text-left text-muted-foreground border-b border-border"><th className="py-1 font-medium">Dépôt</th><th className="py-1 font-medium text-right w-12">Crit.</th><th className="py-1 font-medium text-right w-12">Élevée</th><th className="py-1 font-medium text-right w-12">Autres</th><th className="py-1 font-medium text-right w-14">Malware</th><th className="py-1 font-medium text-right w-14">Secrets</th><th className="py-1 font-medium text-right w-16">Licences</th><th className="py-1 font-medium text-right w-14">Posture</th></tr></thead>
              <tbody>
                {report.byRepo.slice(0, 60).map((r) => {
                  const p = posture.get(r.target);
                  return (
                    <tr key={r.target} className="border-b border-border/60 break-inside-avoid">
                      <td className="py-1 break-all">{r.target}</td>
                      <td className={`py-1 text-right tabular-nums ${r.counts.critical ? "text-red-700 font-semibold" : ""}`}>{r.counts.critical || "·"}</td>
                      <td className={`py-1 text-right tabular-nums ${r.counts.high ? "text-orange-600 font-semibold" : ""}`}>{r.counts.high || "·"}</td>
                      <td className="py-1 text-right tabular-nums">{r.counts.medium + r.counts.low || "·"}</td>
                      <td className="py-1 text-right tabular-nums">{r.malware || "·"}</td>
                      <td className="py-1 text-right tabular-nums">{r.secrets || "·"}</td>
                      <td className="py-1 text-right tabular-nums">{r.licenses || "·"}</td>
                      <td className="py-1 text-right tabular-nums">{p ? p.score : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {report.byRepo.length > 60 && <p className="text-muted-foreground">{report.byRepo.length - 60} dépôt(s) supplémentaire(s) non listé(s).</p>}
          </Section>
        )}

        {byKind("malware").length > 0 && <Section title="Paquets malveillants"><IssueTable issues={byKind("malware")} /></Section>}
        {byKind("secret").length > 0 && <Section title="Secrets exposés"><IssueTable issues={byKind("secret").slice(0, 60)} /></Section>}
        {byKind("license").length > 0 && (
          <Section title="Licences à examiner">
            <IssueTable issues={byKind("license").slice(0, 40)} />
            {byKind("license").length > 40 && <p className="text-muted-foreground">{byKind("license").length - 40} autre(s) non listée(s).</p>}
          </Section>
        )}
        {byKind("domain").length > 0 && <Section title="Domaines"><IssueTable issues={byKind("domain")} /></Section>}

        {(report.accepted.length > 0 || report.snoozed.length > 0) && (
          <Section title="Registre des risques acceptés et reportés">
            <p className="text-muted-foreground">Alertes ignorées ou reportées volontairement, avec leur motif (traçabilité pour un audit).</p>
            <table className="w-full text-[11px] border-collapse">
              <thead><tr className="text-left text-muted-foreground border-b border-border"><th className="py-1 pr-2 font-medium w-16">Gravité</th><th className="py-1 pr-2 font-medium">Élément</th><th className="py-1 pr-2 font-medium">Décision</th><th className="py-1 font-medium">Motif</th></tr></thead>
              <tbody>
                {[...report.accepted, ...report.snoozed].slice(0, 80).map((i) => (
                  <tr key={i.key} className="border-b border-border/60 align-top break-inside-avoid">
                    <td className={`py-1.5 pr-2 font-semibold ${SEV_CLS[i.severity]}`}>{SEV[i.severity]}</td>
                    <td className="py-1.5 pr-2"><span className="font-medium">{i.title}</span><br /><span className="text-muted-foreground break-all">{i.target}</span></td>
                    <td className="py-1.5 pr-2">{i.status === "ignored" ? "Ignorée" : `Reportée jusqu'au ${i.until ? fmt(i.until) : "?"}`}</td>
                    <td className="py-1.5">{i.status === "ignored" ? `${IGNORE_REASONS[i.reason as IgnoreReason] ?? i.reason}${i.note ? ` — ${i.note}` : ""}` : i.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        )}

        <footer className="border-t border-border pt-3 text-[10px] text-muted-foreground">
          Généré par Openkido v{pkg.version} le {fmt(new Date())} pour @{login}. Document confidentiel : il contient des informations sensibles sur la sécurité de vos dépôts.
        </footer>
      </div>
    </div>
  );
}

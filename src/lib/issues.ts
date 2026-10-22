import "server-only";
import { db } from "./db";
import {
  applyStates, buildIssues, effectiveHistory, planHistorySync, planIsEmpty, recentResolved, sortIssues,
  type AuditAlertInput, type HistoryPlan, type HistoryRow, type IssueState, type IssueStatus, type PostureInput, type ResolvedIssue, type ResolvedItem,
  type SecretsInput, type ScanComponentInput, type ScanInput,
} from "./issues-core";

export interface FeedCoverage {
  repos: number;
  scanned: number;
  partialScans: number;
  audited: number;
  /** Audits dont au moins une source est désactivée ou illisible : « aucune alerte » n'y veut rien dire. */
  auditUncovered: number;
  posture: number;
  /** Dépôts dont l'analyse des secrets du code a été faite. */
  secretsScanned: number;
  /** Scans de dépendances sans aucune licence résolue (scan antérieur à l'analyse des licences, ou deps.dev injoignable). */
  scansWithoutLicenses: number;
  domains: number;
  domainsChecked: number;
}

export interface Feed {
  issues: ResolvedIssue[];
  coverage: FeedCoverage;
  /** Alertes résolues depuis moins de 7 jours. */
  resolved: ResolvedItem[];
  /** L'historique des alertes (nouvelles / résolues) n'est pas à jour : à enregistrer via `syncIssueHistory`. */
  historyDirty: boolean;
}

type StoredComponent = Partial<ScanComponentInput> & { vulnCount?: number };

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Charge les états (ignoré, reporté, assigné) d'un utilisateur. */
export async function loadIssueStates(githubLogin: string): Promise<Map<string, IssueState>> {
  const rows = await db.issueState.findMany({ where: { githubLogin } });
  return new Map(
    rows.map((r) => [r.key, { status: (r.status as IssueStatus) ?? "open", reason: r.reason, note: r.note, until: r.until, assignee: r.assignee }])
  );
}

async function loadHistory(githubLogin: string): Promise<HistoryRow[]> {
  const rows = await db.issueHistory.findMany({ where: { githubLogin } });
  return rows.map((r) => ({ key: r.key, kind: r.kind, severity: r.severity, target: r.target, title: r.title, firstSeen: r.firstSeen, resolvedAt: r.resolvedAt, baseline: r.baseline }));
}

async function buildFeed(githubLogin: string, repos: { owner: string; name: string }[]): Promise<{ feed: Feed; plan: HistoryPlan }> {
  const where = repos.length > 0 ? { OR: repos.map((r) => ({ owner: r.owner, repo: r.name })) } : { id: -1 };

  const [scanRows, auditRows, postureRows, secretRows, domainRows, states, history] = await Promise.all([
    db.repoScan.findMany({ where, select: { owner: true, repo: true, status: true, components: true } }),
    db.repoAudit.findMany({ where, select: { owner: true, repo: true, alerts: true, csState: true, dbState: true, ssState: true } }),
    db.repoPosture.findMany({ where, select: { owner: true, repo: true, results: true } }),
    db.repoSecrets.findMany({ where, select: { owner: true, repo: true, findings: true } }),
    db.domain.findMany(),
    loadIssueStates(githubLogin),
    loadHistory(githubLogin),
  ]);

  const scans: ScanInput[] = scanRows.map((r) => ({
    owner: r.owner,
    repo: r.repo,
    status: r.status === "partial" ? "partial" : "complete",
    components: parseJson<StoredComponent[]>(r.components, []).map((comp) => {
      return {
        name: String(comp.name ?? ""),
        version: String(comp.version ?? ""),
        ecosystem: String(comp.ecosystem ?? "npm"),
        scope: comp.scope,
        direct: comp.direct,
        license: typeof comp.license === "string" ? comp.license : undefined,
        status: comp.status === "non-analysé" ? "non-analysé" : (comp.vulnCount ?? comp.vulns?.length ?? 0) > 0 ? "vulnerable" : "sain",
        vulns: comp.vulns ?? [],
      } satisfies ScanComponentInput;
    }),
  }));

  const audits = auditRows.map((r) => ({ owner: r.owner, repo: r.repo, alerts: parseJson<AuditAlertInput[]>(r.alerts, []) }));
  const postures = postureRows.map((r) => ({ owner: r.owner, repo: r.repo, results: parseJson<PostureInput["results"]>(r.results, []) }));

  const secrets = secretRows.map((r): SecretsInput => ({ owner: r.owner, repo: r.repo, findings: parseJson<SecretsInput["findings"]>(r.findings, []) }));

  const built = buildIssues({ scans, audits, postures, secrets, domains: domainRows });
  // Périmètre analysé : une alerte n'est « résolue » que si son dépôt ou domaine a bien été chargé ici.
  const scope = new Set<string>([...repos.map((r) => `${r.owner}/${r.name}`), ...domainRows.map((d) => d.domain)]);
  const now = new Date();
  const plan = planHistorySync(history, built, scope, now);
  const effective = effectiveHistory(history, plan, now);
  const issues = sortIssues(applyStates(built, states, now, effective));
  const scansWithoutLicenses = scans.filter((s) => s.components.some((c) => c.scope !== "dev") && !s.components.some((c) => c.license !== undefined)).length;

  const feed: Feed = {
    issues,
    resolved: recentResolved(effective, now).filter((r) => scope.has(r.target)),
    historyDirty: !planIsEmpty(plan),
    coverage: {
      repos: repos.length,
      scanned: scanRows.length,
      partialScans: scanRows.filter((r) => r.status === "partial").length,
      audited: auditRows.length,
      auditUncovered: auditRows.filter((r) => r.csState !== "ok" || r.dbState !== "ok" || r.ssState !== "ok").length,
      posture: postureRows.length,
      secretsScanned: secretRows.length,
      scansWithoutLicenses,
      domains: domainRows.length,
      domainsChecked: domainRows.filter((d) => d.checkedAt !== null).length,
    },
  };
  return { feed, plan };
}

/** Assemble le Feed à partir des dernières données enregistrées (aucun appel réseau, aucune écriture). */
export async function getFeed(githubLogin: string, repos: { owner: string; name: string }[]): Promise<Feed> {
  return (await buildFeed(githubLogin, repos)).feed;
}

/** Enregistre l'historique des alertes (nouvelles et résolues). Appelé explicitement, jamais pendant l'affichage d'une page. */
export async function syncIssueHistory(githubLogin: string, repos: { owner: string; name: string }[]): Promise<{ changed: boolean }> {
  const { plan } = await buildFeed(githubLogin, repos);
  if (planIsEmpty(plan)) return { changed: false };
  const now = new Date();
  const row = (r: HistoryRow) => ({ githubLogin, key: r.key, kind: r.kind, severity: r.severity, target: r.target, title: r.title.slice(0, 200), firstSeen: r.firstSeen, resolvedAt: r.resolvedAt, baseline: r.baseline });
  await db.$transaction([
    ...[...plan.create, ...plan.reopen].map((r) => {
      const data = row(r);
      return db.issueHistory.upsert({ where: { githubLogin_key: { githubLogin, key: r.key } }, create: data, update: data });
    }),
    ...plan.refresh.map((r) => db.issueHistory.update({ where: { githubLogin_key: { githubLogin, key: r.key } }, data: { severity: r.severity, title: r.title.slice(0, 200) } })),
    ...(plan.resolve.length > 0 ? [db.issueHistory.updateMany({ where: { githubLogin, key: { in: plan.resolve }, resolvedAt: null }, data: { resolvedAt: now } })] : []),
  ]);
  return { changed: true };
}

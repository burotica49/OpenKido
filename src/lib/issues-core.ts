// Feed unifié des problèmes : normalisation des résultats de scan, d'audit, de posture et de domaines
// en une seule liste, avec empreintes stables et application des états (ignoré, reporté, assigné).
// Module pur (aucun accès réseau ni base) : importable côté client pour les types et testable.

import { classifyLicense } from "./licenses-core";

export type IssueSeverity = "critical" | "high" | "medium" | "low";
export type IssueKind = "dependency" | "malware" | "license" | "code-scanning" | "dependabot" | "secret" | "posture" | "domain";
export type IssueStatus = "open" | "ignored" | "snoozed";

export const SEVERITY_ORDER: IssueSeverity[] = ["critical", "high", "medium", "low"];
const SEV_RANK: Record<IssueSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export const IGNORE_REASONS = {
  "false-positive": "Faux positif",
  "accepted-risk": "Risque accepté",
  "not-used": "Code ou dépendance non utilisé",
  mitigated: "Déjà atténué ailleurs",
  other: "Autre",
} as const;
export type IgnoreReason = keyof typeof IGNORE_REASONS;
export const isIgnoreReason = (v: unknown): v is IgnoreReason => typeof v === "string" && v in IGNORE_REASONS;

export interface IssueFix {
  /** Phrase d'action en français. */
  text: string;
  /** Commande à copier, quand elle est sûre. */
  command?: string;
}

export interface Issue {
  /** Empreinte stable : ne change pas d'un scan à l'autre tant que le problème est le même. */
  key: string;
  kind: IssueKind;
  severity: IssueSeverity;
  title: string;
  detail: string;
  /** « owner/repo » ou nom de domaine. */
  target: string;
  owner?: string;
  repo?: string;
  /** Page de détail dans l'application. */
  href: string;
  externalUrl?: string;
  /** Dépendance de développement uniquement (non livrée en production). */
  devOnly: boolean;
  /** Dépendance directe (false = indirecte, undefined = inconnu). */
  direct?: boolean;
  fix?: IssueFix;
  /** Dépendance : aucun correctif publié. */
  noFix?: boolean;
  /** Dépendance ou licence : le composant concerné. */
  component?: { ecosystem: string; name: string; version: string; license?: string };
  /** Dépendance ou malware : détail de chaque faille. */
  vulns?: IssueVuln[];
  /** Estimation indicative du temps de correction, en minutes (absente si aucun correctif n'existe). */
  fixMinutes?: number;
}

export interface IssueVuln {
  id: string;
  severity: IssueSeverity;
  summary: string;
  fixedVersion: string | null;
}

export interface IssueState {
  status: IssueStatus;
  reason: string;
  note: string;
  until: Date | null;
  assignee: string;
}

export interface ResolvedIssue extends Issue {
  /** Première détection par Openkido (absente avant le premier suivi). */
  firstSeen: string | null;
  /** Détectée depuis moins de 7 jours, hors premier relevé de référence. */
  isNew: boolean;
  status: IssueStatus;
  reason: string;
  note: string;
  until: string | null;
  assignee: string;
  /** Report arrivé à échéance : l'alerte redevient ouverte. */
  snoozeExpired: boolean;
}

// ─── Versions ──────────────────────────────────────────────────────────────────

function segments(v: string): (number | string)[] {
  return v.replace(/^v/i, "").split(/[.\-+_]/).filter(Boolean).map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}

/** Comparaison tolérante de versions (numérique d'abord). Suffisant pour choisir le plus récent correctif. */
export function compareVersions(a: string, b: string): number {
  const x = segments(a);
  const y = segments(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i] ?? 0;
    const q = y[i] ?? 0;
    if (p === q) continue;
    if (typeof p === "number" && typeof q === "number") return p < q ? -1 : 1;
    // Un segment texte (« beta », « rc ») précède l'absence de segment : 1.0.0-rc < 1.0.0
    if (typeof p === "string" && typeof q === "number") return q === 0 && x.length > y.length ? -1 : 1;
    if (typeof p === "number" && typeof q === "string") return p === 0 && y.length > x.length ? 1 : -1;
    return String(p) < String(q) ? -1 : 1;
  }
  return 0;
}

export interface FixInfo {
  /** Plus petite version qui corrige TOUTES les failles qui ont un correctif. */
  version: string | null;
  /** Certaines failles n'ont aucun correctif publié. */
  partial: boolean;
  none: boolean;
}

export function pickFix(vulns: { fixedVersion: string | null }[]): FixInfo {
  const fixes = vulns.map((v) => v.fixedVersion).filter((v): v is string => !!v);
  if (fixes.length === 0) return { version: null, partial: false, none: true };
  const version = fixes.reduce((max, v) => (compareVersions(v, max) > 0 ? v : max));
  return { version, partial: fixes.length < vulns.length, none: false };
}

// ─── Sources ───────────────────────────────────────────────────────────────────

export interface ScanComponentInput {
  name: string;
  version: string;
  ecosystem: string;
  scope?: "prod" | "dev";
  direct?: boolean;
  /** Licence SPDX déclarée ; "NONE" = aucune ; absent = non recherchée. */
  license?: string;
  status: "vulnerable" | "sain" | "non-analysé";
  vulns: { id: string; summary: string; severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN"; fixedVersion: string | null }[];
}
export interface ScanInput {
  owner: string;
  repo: string;
  status: "complete" | "partial";
  components: ScanComponentInput[];
}
export interface AuditAlertInput {
  id: string;
  source: "code_scanning" | "dependabot" | "secret_scanning";
  severity: "critical" | "high" | "medium" | "low" | "warning" | "note" | "unknown";
  title: string;
  description: string;
  state: string;
  url: string;
  path?: string;
  /** Dependabot : « malware » pour un paquet malveillant. */
  classification?: string;
}
export interface AuditInput {
  owner: string;
  repo: string;
  alerts: AuditAlertInput[];
}
export interface SecretsInput {
  owner: string;
  repo: string;
  findings: { ruleId: string; name: string; severity: IssueSeverity; path: string; line: number; preview: string; fingerprint: string }[];
}
export interface PostureInput {
  owner: string;
  repo: string;
  results: { id: string; severity: IssueSeverity; title: string; state: string; evidence: string; remediation?: string }[];
}
export interface DomainInput {
  domain: string;
  checkedAt: Date | null;
  httpStatus: number | null;
  httpsRedirect: boolean | null;
  sslValid: boolean | null;
  sslDaysLeft: number | null;
  hasHsts: boolean | null;
  hasCsp: boolean | null;
  hasXFrame: boolean | null;
  hasXContent: boolean | null;
  hasRp: boolean | null;
}

export interface IssueSources {
  scans: ScanInput[];
  audits: AuditInput[];
  secrets?: SecretsInput[];
  postures: PostureInput[];
  domains: DomainInput[];
}

const VULN_SEV: Record<string, IssueSeverity> = { CRITICAL: "critical", HIGH: "high", MEDIUM: "medium", LOW: "low", UNKNOWN: "medium" };
const ALERT_SEV: Record<string, IssueSeverity> = { critical: "critical", high: "high", medium: "medium", low: "low", warning: "medium", note: "low", unknown: "medium" };

function worst(sevs: IssueSeverity[]): IssueSeverity {
  return sevs.reduce((w, s) => (SEV_RANK[s] < SEV_RANK[w] ? s : w), "low" as IssueSeverity);
}

function installCommand(ecosystem: string, name: string, version: string): string | undefined {
  // Les caractères du nom/version viennent de registres tiers : on n'émet une commande que pour des valeurs « sûres ».
  const safe = /^[@A-Za-z0-9._/~+-]+$/;
  if (!safe.test(name) || !safe.test(version)) return undefined;
  switch (ecosystem) {
    case "npm": return `npm install ${name}@${version}`;
    case "pip": return `pip install "${name}>=${version}"`;
    case "go": return `go get ${name}@v${version.replace(/^v/, "")}`;
    case "cargo": return `cargo update -p ${name} --precise ${version}`;
    case "composer": return `composer require ${name}:^${version}`;
    default: return undefined;
  }
}

const isMalwareId = (id: string) => /^MAL-/i.test(id);

function dependencyIssues(scan: ScanInput): Issue[] {
  const target = `${scan.owner}/${scan.repo}`;
  const out: Issue[] = [];
  for (const c of scan.components) {
    const base = {
      target,
      owner: scan.owner,
      repo: scan.repo,
      href: `/repos/${scan.owner}/${scan.repo}`,
      direct: c.direct,
      component: { ecosystem: c.ecosystem, name: c.name, version: c.version, ...(c.license !== undefined ? { license: c.license } : {}) },
    };
    const vulnList: IssueVuln[] = c.vulns.map((v) => ({ id: v.id, severity: VULN_SEV[v.severity] ?? "medium", summary: v.summary.slice(0, 200), fixedVersion: v.fixedVersion }));

    const malware = c.vulns.filter((v) => isMalwareId(v.id));
    if (c.status === "vulnerable" && malware.length > 0) {
      // Un paquet malveillant s'exécute à l'installation, y compris en développement : jamais classé « dev ».
      out.push({
        ...base,
        key: `dep|${target}|${c.ecosystem}:${c.name}@${c.version}`,
        kind: "malware",
        severity: "critical",
        title: `${c.name} ${c.version}`,
        detail: `Paquet signalé comme malveillant (${malware.map((v) => v.id).slice(0, 3).join(", ")}) : ${malware[0].summary || "code malveillant connu"}.`,
        devOnly: false,
        vulns: vulnList.filter((v) => isMalwareId(v.id)),
        fix: {
          text: `Supprimer ${c.name} du projet et du lockfile. Si ce paquet a été installé sur un poste ou en CI, considérez les secrets de cette machine comme compromis et révoquez-les.`,
        },
      });
      continue;
    }

    if (c.status === "vulnerable" && c.vulns.length > 0) {
      const severity = worst(c.vulns.map((v) => VULN_SEV[v.severity] ?? "medium"));
      const fix = pickFix(c.vulns);
      const ids = c.vulns.map((v) => v.id);
      let fixInfo: IssueFix | undefined;
      if (fix.version) {
        const indirect = c.direct === false;
        fixInfo = {
          text: indirect
            ? `Passer ${c.name} à la version ${fix.version} ou plus récente. Dépendance indirecte : mettez à jour le paquet qui l'utilise, ou forcez la version (overrides / resolutions).`
            : `Mettre ${c.name} à la version ${fix.version} ou plus récente.${fix.partial ? " Certaines failles n'ont pas encore de correctif." : ""}`,
          ...(indirect ? {} : { command: installCommand(c.ecosystem, c.name, fix.version) }),
        };
      }
      out.push({
        ...base,
        key: `dep|${target}|${c.ecosystem}:${c.name}@${c.version}`,
        kind: "dependency",
        severity,
        title: `${c.name} ${c.version}`,
        detail: `${c.vulns.length} faille(s) connue(s) : ${c.vulns[0].summary || c.vulns[0].id}${c.vulns.length > 1 ? ` (+${c.vulns.length - 1} autre(s))` : ""} — ${ids.slice(0, 3).join(", ")}${ids.length > 3 ? "…" : ""}`,
        devOnly: c.scope === "dev",
        fix: fixInfo,
        noFix: fix.none,
        vulns: vulnList,
      });
    }

    if (c.license !== undefined && c.scope !== "dev") {
      const v = classifyLicense(c.license);
      if (v.risk === "restricted" || v.risk === "none") {
        out.push({
          ...base,
          key: `lic|${target}|${c.ecosystem}:${c.name}@${c.version}`,
          kind: "license",
          severity: v.severity,
          title: `${c.name} ${c.version}`,
          detail: v.risk === "none" ? v.why : `Licence ${c.license} (${v.label}) — ${v.why}`,
          devOnly: false,
          fix: { text: "Vérifier avec votre service juridique que cet usage est compatible avec votre licence et votre mode de distribution, ou remplacer la dépendance par une alternative sous licence permissive." },
        });
      }
    }
  }
  return out;
}

function secretIssues(s: SecretsInput): Issue[] {
  const target = `${s.owner}/${s.repo}`;
  return s.findings.map((f): Issue => ({
    key: `secret|${target}|${f.ruleId}:${f.fingerprint}`,
    kind: "secret",
    severity: f.severity,
    title: f.name,
    detail: `${f.path}:${f.line} — ${f.preview}`,
    target,
    owner: s.owner,
    repo: s.repo,
    href: `/code-audit/${s.owner}/${s.repo}`,
    devOnly: false,
    fix: { text: "Révoquer ce secret chez son fournisseur et en émettre un nouveau. Le supprimer du code ne suffit pas : il reste lisible dans l'historique git. Ensuite, le charger depuis une variable d'environnement." },
  }));
}

function alertIssues(audit: AuditInput, skipDependabot: boolean): Issue[] {
  const target = `${audit.owner}/${audit.repo}`;
  const out: Issue[] = [];
  for (const a of audit.alerts) {
    if (a.state !== "open") continue;
    if (a.source === "dependabot" && skipDependabot && a.classification !== "malware") continue;
    const malware = a.source === "dependabot" && a.classification === "malware";
    const kind: IssueKind = malware ? "malware" : a.source === "code_scanning" ? "code-scanning" : a.source === "dependabot" ? "dependabot" : "secret";
    out.push({
      key: `alert|${target}|${a.id}`,
      kind,
      severity: malware ? "critical" : (ALERT_SEV[a.severity] ?? "medium"),
      title: a.title,
      detail: a.path ? `${a.path} — ${a.description.slice(0, 200)}` : a.description.slice(0, 240),
      target,
      owner: audit.owner,
      repo: audit.repo,
      href: `/code-audit/${audit.owner}/${audit.repo}`,
      externalUrl: a.url.startsWith("https://") ? a.url : undefined,
      devOnly: false,
      fix: kind === "secret"
        ? { text: "Révoquer le secret chez son fournisseur et en émettre un nouveau : le supprimer du code ne suffit pas, il reste dans l'historique." }
        : malware
          ? { text: "Supprimer ce paquet immédiatement. S'il a été installé, considérez les secrets de la machine concernée comme compromis." }
          : undefined,
    });
  }
  return out;
}

function postureIssues(p: PostureInput): Issue[] {
  const target = `${p.owner}/${p.repo}`;
  return p.results
    .filter((r) => r.state === "fail")
    .map((r): Issue => ({
      key: `posture|${target}|${r.id}`,
      kind: "posture",
      severity: r.severity,
      title: r.title,
      detail: r.evidence,
      target,
      owner: p.owner,
      repo: p.repo,
      href: `/posture/${p.owner}/${p.repo}`,
      devOnly: false,
      fix: r.remediation ? { text: r.remediation } : undefined,
    }));
}

function domainIssues(d: DomainInput): Issue[] {
  if (d.checkedAt === null) return [];
  const mk = (id: string, severity: IssueSeverity, title: string, detail: string, fix?: string): Issue => ({
    key: `domain|${d.domain}|${id}`,
    kind: "domain", severity, title, detail, target: d.domain, href: "/domains", devOnly: false,
    fix: fix ? { text: fix } : undefined,
  });
  const out: Issue[] = [];
  if (d.httpStatus === null) out.push(mk("unreachable", "high", "Domaine injoignable", "Le site n'a pas répondu lors de la dernière vérification.", "Vérifier le DNS, le serveur et le pare-feu."));
  if (d.sslValid === false) out.push(mk("ssl-invalid", "critical", "Certificat SSL invalide", "Les navigateurs afficheront un avertissement de sécurité.", "Renouveler ou réinstaller le certificat."));
  else if (d.sslValid === true && d.sslDaysLeft !== null && d.sslDaysLeft <= 30) {
    out.push(mk("ssl-expiry", d.sslDaysLeft <= 14 ? "high" : "medium", `Certificat SSL expire dans ${d.sslDaysLeft} jour(s)`, "Un certificat expiré rend le site inaccessible sans avertissement.", "Renouveler le certificat (ou vérifier le renouvellement automatique)."));
  }
  if (d.httpsRedirect === false) out.push(mk("no-https-redirect", "medium", "Pas de redirection HTTP → HTTPS", "Les visiteurs arrivant en HTTP restent en connexion non chiffrée.", "Rediriger tout le trafic HTTP vers HTTPS."));
  const headers: [boolean | null, string][] = [[d.hasHsts, "HSTS"], [d.hasCsp, "CSP"], [d.hasXFrame, "X-Frame-Options"], [d.hasXContent, "X-Content-Type-Options"], [d.hasRp, "Referrer-Policy"]];
  const missing = headers.filter(([v]) => v === false).map(([, n]) => n);
  if (missing.length > 0) {
    out.push(mk("headers", missing.length >= 3 ? "medium" : "low", `${missing.length} en-tête(s) de sécurité manquant(s)`, missing.join(", "), "Ajouter ces en-têtes dans la configuration du serveur web."));
  }
  return out;
}

/**
 * Assemble tous les problèmes. Les alertes Dependabot ne sont reprises que si le dépôt n'a pas de scan complet
 * des dépendances : sinon elles feraient doublon avec l'analyse OSV.
 */
export function buildIssues(src: IssueSources): Issue[] {
  const completeScans = new Set(src.scans.filter((s) => s.status === "complete").map((s) => `${s.owner}/${s.repo}`));
  const all = [
    ...src.scans.flatMap(dependencyIssues),
    ...src.audits.flatMap((a) => alertIssues(a, completeScans.has(`${a.owner}/${a.repo}`))),
    ...(src.secrets ?? []).flatMap(secretIssues),
    ...src.postures.flatMap(postureIssues),
    ...src.domains.flatMap(domainIssues),
  ];
  // Empreintes uniques (deux composants identiques dans deux manifestes ne doivent pas se dédoubler).
  const seen = new Set<string>();
  return all
    .filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)))
    .map((i) => {
      const minutes = estimateFixMinutes(i);
      return minutes === undefined ? i : { ...i, fixMinutes: minutes };
    });
}

// ─── Estimation du temps de correction ─────────────────────────────────────────

const majorOf = (v: string) => Number(v.replace(/^v/i, "").split(/[.\-+]/)[0]);

/**
 * Estimation indicative (minutes) : un ordre de grandeur pour prioriser, pas un engagement.
 * `undefined` = pas de correctif connu, donc pas d'estimation.
 */
export function estimateFixMinutes(i: Omit<Issue, "fixMinutes">): number | undefined {
  switch (i.kind) {
    case "dependency": {
      if (i.noFix) return undefined;
      const fix = pickFix(i.vulns ?? []);
      if (!fix.version) return undefined;
      let m = i.direct === false ? 90 : 30;
      const cur = i.component?.version;
      // Changement de version majeure : lecture des notes de version, adaptations probables.
      if (cur && Number.isFinite(majorOf(cur)) && Number.isFinite(majorOf(fix.version)) && majorOf(fix.version) > majorOf(cur)) m += 120;
      return m;
    }
    case "malware": return 60;
    case "secret": return 60;
    case "license": return 120;
    case "code-scanning": return 90;
    case "dependabot": return 30;
    case "posture": return i.severity === "critical" ? 60 : i.severity === "high" ? 30 : 15;
    case "domain":
      return /\|headers$/.test(i.key) || /\|unreachable$/.test(i.key) ? 60 : 30;
  }
}

/** « 45 min », « 1 hr », « 2 hr 30 min ». */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r === 0 ? `${h} hr` : `${h} hr ${r} min`;
}

// ─── Regroupement par paquet ───────────────────────────────────────────────────

export interface IssueGroup {
  type: "group";
  /** Empreinte stable du groupe (jamais envoyée au serveur : les actions portent sur les membres). */
  key: string;
  kind: IssueKind;
  severity: IssueSeverity;
  /** Nom du paquet. */
  title: string;
  ecosystem: string;
  members: ResolvedIssue[];
  targets: string[];
  versions: string[];
  /** Somme des estimations des membres corrigeables. */
  fixMinutes?: number;
  noFix: boolean;
  devOnly: boolean;
}
export type FeedUnit = { type: "issue"; issue: ResolvedIssue } | IssueGroup;

const GROUPABLE: IssueKind[] = ["dependency", "malware", "license"];

/**
 * Regroupe un même paquet présent dans plusieurs dépôts (ou en plusieurs versions). Les alertes d'un
 * autre type, et les paquets présents une seule fois, restent isolés. L'ordre d'entrée est conservé
 * (le groupe prend la place de son premier membre) puis la liste est triée par gravité.
 */
export function groupIssues(issues: ResolvedIssue[]): FeedUnit[] {
  const groups = new Map<string, ResolvedIssue[]>();
  for (const i of issues) {
    if (!GROUPABLE.includes(i.kind) || !i.component) continue;
    const k = `group|${i.kind}|${i.component.ecosystem}:${i.component.name}`;
    const list = groups.get(k) ?? [];
    list.push(i);
    groups.set(k, list);
  }
  const emitted = new Set<string>();
  const units: FeedUnit[] = [];
  for (const i of issues) {
    const k = i.component && GROUPABLE.includes(i.kind) ? `group|${i.kind}|${i.component.ecosystem}:${i.component.name}` : null;
    const members = k ? groups.get(k) : undefined;
    if (!k || !members || members.length < 2) {
      units.push({ type: "issue", issue: i });
      continue;
    }
    if (emitted.has(k)) continue;
    emitted.add(k);
    const fixable = members.filter((m) => m.fixMinutes !== undefined);
    units.push({
      type: "group",
      key: k,
      kind: i.kind,
      severity: worst(members.map((m) => m.severity)),
      title: i.component!.name,
      ecosystem: i.component!.ecosystem,
      members,
      targets: [...new Set(members.map((m) => m.target))],
      versions: [...new Set(members.map((m) => m.component!.version))],
      fixMinutes: fixable.length > 0 ? fixable.reduce((a, m) => a + (m.fixMinutes ?? 0), 0) : undefined,
      noFix: members.every((m) => m.noFix),
      devOnly: members.every((m) => m.devOnly),
    });
  }
  const sevOf = (u: FeedUnit) => (u.type === "group" ? u.severity : u.issue.severity);
  const devOf = (u: FeedUnit) => (u.type === "group" ? u.devOnly : u.issue.devOnly);
  const noFixOf = (u: FeedUnit) => (u.type === "group" ? u.noFix : !!u.issue.noFix);
  return units
    .map((u, idx) => ({ u, idx }))
    .sort((a, b) => SEV_RANK[sevOf(a.u)] - SEV_RANK[sevOf(b.u)] || Number(devOf(a.u)) - Number(devOf(b.u)) || Number(noFixOf(a.u)) - Number(noFixOf(b.u)) || a.idx - b.idx)
    .map((x) => x.u);
}

// ─── Historique (nouvelles et résolues) ────────────────────────────────────────

export const RECENT_DAYS = 7;
const DAY = 86_400_000;

export interface HistoryRow {
  key: string;
  kind: string;
  severity: string;
  target: string;
  title: string;
  firstSeen: Date;
  resolvedAt: Date | null;
  /** Relevé de référence (premier passage) : ces alertes ne sont pas « nouvelles ». */
  baseline: boolean;
}

export interface HistoryPlan {
  create: HistoryRow[];
  /** Alertes revenues après avoir été résolues. */
  reopen: HistoryRow[];
  /** Alertes disparues (corrigées) dans le périmètre. */
  resolve: string[];
  /** Titre ou gravité modifiés. */
  refresh: HistoryRow[];
  baseline: boolean;
}

// Les alertes Dependabot font doublon avec l'analyse des dépendances et apparaissent/disparaissent
// selon l'existence d'un scan complet : elles ne sont pas suivies, pour ne pas fausser les compteurs.
const NOT_TRACKED: IssueKind[] = ["dependabot"];

/**
 * Compare les alertes actuelles à l'historique. Une alerte n'est « résolue » que si elle appartient au
 * périmètre analysé (`scope` : dépôts et domaines réellement chargés), jamais parce qu'un dépôt est hors périmètre.
 */
export function planHistorySync(existing: HistoryRow[], current: Issue[], scope: Set<string>, now: Date = new Date()): HistoryPlan {
  const baseline = existing.length === 0;
  const byKey = new Map(existing.map((r) => [r.key, r]));
  const tracked = current.filter((i) => !NOT_TRACKED.includes(i.kind));
  const currentKeys = new Set(tracked.map((i) => i.key));
  const plan: HistoryPlan = { create: [], reopen: [], resolve: [], refresh: [], baseline };

  for (const i of tracked) {
    const row = byKey.get(i.key);
    const fresh: HistoryRow = { key: i.key, kind: i.kind, severity: i.severity, target: i.target, title: i.title, firstSeen: now, resolvedAt: null, baseline: false };
    if (!row) plan.create.push({ ...fresh, baseline });
    else if (row.resolvedAt) plan.reopen.push(fresh);
    else if (row.severity !== i.severity || row.title !== i.title) plan.refresh.push({ ...row, severity: i.severity, title: i.title });
  }
  for (const row of existing) {
    if (!row.resolvedAt && !currentKeys.has(row.key) && scope.has(row.target)) plan.resolve.push(row.key);
  }
  return plan;
}

export const planIsEmpty = (p: HistoryPlan) => p.create.length + p.reopen.length + p.resolve.length + p.refresh.length === 0;

/** Historique « effectif » : l'existant, avec le plan appliqué virtuellement (affichage immédiat, avant écriture). */
export function effectiveHistory(existing: HistoryRow[], plan: HistoryPlan, now: Date = new Date()): HistoryRow[] {
  const map = new Map(existing.map((r) => [r.key, r]));
  for (const r of [...plan.create, ...plan.reopen]) map.set(r.key, r);
  for (const r of plan.refresh) map.set(r.key, r);
  for (const key of plan.resolve) {
    const r = map.get(key);
    if (r) map.set(key, { ...r, resolvedAt: now });
  }
  return [...map.values()];
}

export interface ResolvedItem {
  key: string;
  kind: string;
  severity: string;
  title: string;
  target: string;
  resolvedAt: string;
}

/** Alertes résolues depuis moins de 7 jours. */
export function recentResolved(history: HistoryRow[], now: Date = new Date()): ResolvedItem[] {
  const since = now.getTime() - RECENT_DAYS * DAY;
  return history
    .filter((r) => r.resolvedAt && r.resolvedAt.getTime() >= since)
    .sort((a, b) => b.resolvedAt!.getTime() - a.resolvedAt!.getTime())
    .slice(0, 300)
    .map((r) => ({ key: r.key, kind: r.kind, severity: r.severity, title: r.title, target: r.target, resolvedAt: r.resolvedAt!.toISOString() }));
}

// ─── États ─────────────────────────────────────────────────────────────────────

export function applyStates(issues: Issue[], states: Map<string, IssueState>, now: Date = new Date(), history: HistoryRow[] = []): ResolvedIssue[] {
  const seen = new Map(history.filter((h) => !h.resolvedAt).map((h) => [h.key, h]));
  const since = now.getTime() - RECENT_DAYS * DAY;
  return issues.map((i): ResolvedIssue => {
    const h = seen.get(i.key);
    const meta = { firstSeen: h ? h.firstSeen.toISOString() : null, isNew: !!h && !h.baseline && h.firstSeen.getTime() >= since };
    const s = states.get(i.key);
    if (!s) return { ...i, ...meta, status: "open", reason: "", note: "", until: null, assignee: "", snoozeExpired: false };
    const expired = s.status === "snoozed" && s.until !== null && s.until.getTime() <= now.getTime();
    return {
      ...i,
      ...meta,
      status: expired ? "open" : s.status,
      reason: s.reason,
      note: s.note,
      until: s.until ? s.until.toISOString() : null,
      assignee: s.assignee,
      snoozeExpired: expired,
    };
  });
}

/** Tri : gravité, puis production avant développement, puis corrigeable avant sans correctif, puis nom. */
export function sortIssues<T extends Issue>(issues: T[]): T[] {
  return [...issues].sort(
    (a, b) =>
      SEV_RANK[a.severity] - SEV_RANK[b.severity] ||
      Number(a.devOnly) - Number(b.devOnly) ||
      Number(!!a.noFix) - Number(!!b.noFix) ||
      a.target.localeCompare(b.target) ||
      a.title.localeCompare(b.title)
  );
}

export interface IssueCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}

export function countBySeverity(issues: Issue[]): IssueCounts {
  const c: IssueCounts = { critical: 0, high: 0, medium: 0, low: 0, total: 0 };
  for (const i of issues) {
    c[i.severity]++;
    c.total++;
  }
  return c;
}

// ─── Validation des clés et paramètres (Server Actions) ────────────────────────

export const MAX_KEY_LENGTH = 300;
export const MAX_NOTE_LENGTH = 300;
export const MAX_ASSIGNEE_LENGTH = 80;
export const MAX_SNOOZE_DAYS = 365;

const KEY_RE = /^(dep|lic|alert|secret|posture|domain)\|[A-Za-z0-9_.@:/+~ -]{1,260}(\|[A-Za-z0-9_.@:/+~ -]{1,200})?$/;
export function isValidIssueKey(key: unknown): key is string {
  return typeof key === "string" && key.length <= MAX_KEY_LENGTH && KEY_RE.test(key);
}

// ─── Couverture ────────────────────────────────────────────────────────────────

export interface CoverageInput {
  repos: number;
  scanned: number;
  partialScans: number;
  audited: number;
  auditUncovered: number;
  posture: number;
  secretsScanned: number;
  scansWithoutLicenses: number;
  domains: number;
  domainsChecked: number;
}

/** Ce qui n'a pas été analysé : « aucune alerte » ne veut rien dire pour ces éléments. */
export function coverageGaps(c: CoverageInput): string[] {
  const gaps: string[] = [];
  if (c.repos - c.scanned > 0) gaps.push(`${c.repos - c.scanned} dépôt(s) jamais scanné(s) (dépendances)`);
  if (c.partialScans > 0) gaps.push(`${c.partialScans} scan(s) partiel(s)`);
  if (c.repos - c.audited > 0) gaps.push(`${c.repos - c.audited} dépôt(s) sans Code Audit`);
  if (c.auditUncovered > 0) gaps.push(`${c.auditUncovered} Code Audit avec une source GitHub désactivée`);
  if (c.repos - c.secretsScanned > 0) gaps.push(`${c.repos - c.secretsScanned} dépôt(s) dont les secrets du code n'ont pas été analysés`);
  if (c.scansWithoutLicenses > 0) gaps.push(`${c.scansWithoutLicenses} scan(s) sans analyse des licences (relancer le scan)`);
  if (c.repos - c.posture > 0) gaps.push(`${c.repos - c.posture} dépôt(s) sans audit de posture`);
  if (c.domains - c.domainsChecked > 0) gaps.push(`${c.domains - c.domainsChecked} domaine(s) non vérifié(s)`);
  return gaps;
}

// ─── Rapport ───────────────────────────────────────────────────────────────────

export interface ReportRepoRow {
  target: string;
  counts: IssueCounts;
  malware: number;
  secrets: number;
  licenses: number;
}

export interface ReportData {
  open: ResolvedIssue[];
  counts: IssueCounts;
  devHidden: number;
  byKind: { kind: IssueKind; counts: IssueCounts }[];
  byRepo: ReportRepoRow[];
  priorities: ResolvedIssue[];
  accepted: ResolvedIssue[];
  snoozed: ResolvedIssue[];
}

const KIND_ORDER: IssueKind[] = ["malware", "secret", "dependency", "code-scanning", "dependabot", "license", "posture", "domain"];

/** Agrège les alertes pour le rapport. Les dépendances de développement sont exclues des chiffres (comme dans le Feed). */
export function buildReport(issues: ResolvedIssue[], maxPriorities = 25): ReportData {
  const open = issues.filter((i) => i.status === "open");
  const counted = open.filter((i) => !i.devOnly);
  const byKind = KIND_ORDER.map((kind) => ({ kind, counts: countBySeverity(counted.filter((i) => i.kind === kind)) })).filter((k) => k.counts.total > 0);

  const repos = new Map<string, ResolvedIssue[]>();
  for (const i of counted) {
    if (!i.repo) continue;
    const list = repos.get(i.target) ?? [];
    list.push(i);
    repos.set(i.target, list);
  }
  const byRepo = [...repos.entries()]
    .map(([target, list]): ReportRepoRow => ({
      target,
      counts: countBySeverity(list),
      malware: list.filter((i) => i.kind === "malware").length,
      secrets: list.filter((i) => i.kind === "secret").length,
      licenses: list.filter((i) => i.kind === "license").length,
    }))
    .sort((a, b) => b.counts.critical - a.counts.critical || b.counts.high - a.counts.high || b.counts.total - a.counts.total || a.target.localeCompare(b.target));

  const priorities = sortIssues(counted.filter((i) => i.severity === "critical" || i.severity === "high")).slice(0, maxPriorities);
  return {
    open,
    counts: countBySeverity(counted),
    devHidden: open.length - counted.length,
    byKind,
    byRepo,
    priorities,
    accepted: issues.filter((i) => i.status === "ignored"),
    snoozed: issues.filter((i) => i.status === "snoozed"),
  };
}

import { describe, expect, it } from "vitest";
import {
  applyStates, buildIssues, compareVersions, countBySeverity, effectiveHistory, formatDuration, groupIssues, isValidIssueKey, pickFix,
  planHistorySync, planIsEmpty, recentResolved, sortIssues,
  type DomainInput, type HistoryRow, type IssueSources, type IssueState, type ScanComponentInput,
} from "./issues-core";

const vuln = (id: string, severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN", fixedVersion: string | null = null) => ({ id, summary: `sum ${id}`, severity, fixedVersion });
const comp = (over: Partial<ScanComponentInput> = {}): ScanComponentInput => ({
  name: "lodash", version: "4.17.1", ecosystem: "npm", scope: "prod", direct: true, status: "vulnerable", vulns: [vuln("GHSA-1", "HIGH", "4.17.21")], ...over,
});
const sources = (over: Partial<IssueSources> = {}): IssueSources => ({ scans: [], audits: [], postures: [], domains: [], ...over });
const domain = (over: Partial<DomainInput> = {}): DomainInput => ({
  domain: "example.com", checkedAt: new Date(), httpStatus: 200, httpsRedirect: true, sslValid: true, sslDaysLeft: 90,
  hasHsts: true, hasCsp: true, hasXFrame: true, hasXContent: true, hasRp: true, ...over,
});

describe("compareVersions / pickFix", () => {
  it("compare numériquement", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("2.0", "2.0.0")).toBe(0);
    expect(compareVersions("v1.2.3", "1.2.4")).toBe(-1);
  });
  it("une préversion précède la version finale", () => {
    expect(compareVersions("1.0.0-rc1", "1.0.0")).toBe(-1);
  });
  it("retient le correctif le plus récent", () => {
    expect(pickFix([{ fixedVersion: "1.2.0" }, { fixedVersion: "1.10.0" }, { fixedVersion: "1.9.0" }])).toEqual({ version: "1.10.0", partial: false, none: false });
  });
  it("signale correctif partiel ou absent", () => {
    expect(pickFix([{ fixedVersion: "2.0.0" }, { fixedVersion: null }])).toMatchObject({ version: "2.0.0", partial: true });
    expect(pickFix([{ fixedVersion: null }])).toEqual({ version: null, partial: false, none: true });
  });
});

describe("buildIssues — dépendances", () => {
  const scan = (components: ScanComponentInput[], status: "complete" | "partial" = "complete") => ({ owner: "o", repo: "r", status, components });

  it("une alerte par composant vulnérable, à la pire gravité", () => {
    const [i] = buildIssues(sources({ scans: [scan([comp({ vulns: [vuln("A", "LOW", "1.0.1"), vuln("B", "CRITICAL", "1.0.2")] })])] }));
    expect(i.severity).toBe("critical");
    expect(i.fix?.text).toContain("1.0.2");
    expect(i.fix?.command).toBe("npm install lodash@1.0.2");
  });
  it("ignore les composants sains et non analysés (jamais comptés comme alerte)", () => {
    expect(buildIssues(sources({ scans: [scan([comp({ status: "sain", vulns: [] }), comp({ name: "x", status: "non-analysé", vulns: [] })])] }))).toHaveLength(0);
  });
  it("marque dev-only, indirect et sans correctif", () => {
    const [i] = buildIssues(sources({ scans: [scan([comp({ scope: "dev", direct: false, vulns: [vuln("A", "HIGH")] })])] }));
    expect(i).toMatchObject({ devOnly: true, direct: false, noFix: true });
    expect(i.fix).toBeUndefined();
  });
  it("dépendance indirecte : pas de commande, conseil sur le paquet parent", () => {
    const [i] = buildIssues(sources({ scans: [scan([comp({ direct: false })])] }));
    expect(i.fix?.command).toBeUndefined();
    expect(i.fix?.text).toMatch(/indirecte/);
  });
  it("n'émet aucune commande pour un nom suspect", () => {
    const [i] = buildIssues(sources({ scans: [scan([comp({ name: "x; rm -rf ~" })])] }));
    expect(i.fix?.command).toBeUndefined();
  });
  it("l'empreinte est stable et ne dépend pas de l'ordre", () => {
    const a = buildIssues(sources({ scans: [scan([comp(), comp({ name: "b" })])] })).map((i) => i.key).sort();
    const b = buildIssues(sources({ scans: [scan([comp({ name: "b" }), comp()])] })).map((i) => i.key).sort();
    expect(a).toEqual(b);
  });
  it("dédoublonne deux composants identiques", () => {
    expect(buildIssues(sources({ scans: [scan([comp(), comp()])] }))).toHaveLength(1);
  });
});

describe("buildIssues — alertes, posture, domaines", () => {
  const alert = (over = {}) => ({ id: "db-1", source: "dependabot" as const, severity: "high" as const, title: "t", description: "d", state: "open", url: "https://github.com/x", ...over });

  it("n'ajoute que les alertes ouvertes", () => {
    const out = buildIssues(sources({ audits: [{ owner: "o", repo: "r", alerts: [alert({ source: "code_scanning" }), alert({ id: "cs-2", source: "code_scanning", state: "dismissed" })] }] }));
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("code-scanning");
  });
  it("Dependabot fait doublon avec un scan complet mais pas avec un scan partiel ou absent", () => {
    const audits = [{ owner: "o", repo: "r", alerts: [alert()] }];
    expect(buildIssues(sources({ audits, scans: [{ owner: "o", repo: "r", status: "complete", components: [] }] }))).toHaveLength(0);
    expect(buildIssues(sources({ audits, scans: [{ owner: "o", repo: "r", status: "partial", components: [] }] }))).toHaveLength(1);
    expect(buildIssues(sources({ audits }))).toHaveLength(1);
  });
  it("les secrets sont critiques, sans lien externe non https", () => {
    const [i] = buildIssues(sources({ audits: [{ owner: "o", repo: "r", alerts: [alert({ id: "ss-1", source: "secret_scanning", severity: "critical", url: "javascript:alert(1)" })] }] }));
    expect(i.kind).toBe("secret");
    expect(i.externalUrl).toBeUndefined();
    expect(i.fix?.text).toMatch(/Révoquer/);
  });
  it("la posture ne remonte que les échecs", () => {
    const out = buildIssues(sources({ postures: [{ owner: "o", repo: "r", results: [
      { id: "BP-01", severity: "high", title: "Branche", state: "fail", evidence: "e", remediation: "https://x" },
      { id: "BP-02", severity: "high", title: "Revue", state: "unknown", evidence: "e" },
      { id: "GOV-01", severity: "low", title: "Sec", state: "warning", evidence: "e" },
    ] }] }));
    expect(out.map((i) => i.key)).toEqual(["posture|o/r|BP-01"]);
  });
  it("domaines : SSL invalide, expiration, en-têtes", () => {
    const out = buildIssues(sources({ domains: [domain({ sslValid: false }), domain({ domain: "b.com", sslDaysLeft: 10 }), domain({ domain: "c.com", hasHsts: false, hasCsp: false, hasRp: false })] }));
    const by = (d: string) => out.filter((i) => i.target === d);
    expect(by("example.com")[0].severity).toBe("critical");
    expect(by("b.com")[0]).toMatchObject({ severity: "high", key: "domain|b.com|ssl-expiry" });
    expect(by("c.com")[0]).toMatchObject({ severity: "medium", key: "domain|c.com|headers" });
  });
  it("un domaine jamais vérifié ne produit rien", () => {
    expect(buildIssues(sources({ domains: [domain({ checkedAt: null, sslValid: null })] }))).toHaveLength(0);
  });
  it("toutes les empreintes produites sont acceptées par la validation", () => {
    const out = buildIssues(sources({
      scans: [{ owner: "o", repo: "r.x-y", status: "complete", components: [comp({ name: "@scope/pkg", version: "1.2.3-beta.1+b5" }), comp({ name: "github.com/a/b", ecosystem: "go", version: "v1.0.0" })] }],
      audits: [{ owner: "o", repo: "r", alerts: [alert({ source: "code_scanning", id: "cs-1" })] }],
      postures: [{ owner: "o", repo: "r", results: [{ id: "CI-03", severity: "critical", title: "t", state: "fail", evidence: "e" }] }],
      domains: [domain({ sslValid: false })],
    }));
    expect(out.length).toBeGreaterThan(3);
    for (const i of out) expect(isValidIssueKey(i.key), i.key).toBe(true);
  });
});

describe("malware, licences, secrets", () => {
  const scan = (components: ScanComponentInput[]) => ({ owner: "o", repo: "r", status: "complete" as const, components });

  it("un paquet MAL-* est un malware critique, jamais « dev »", () => {
    const [i] = buildIssues(sources({ scans: [scan([comp({ scope: "dev", vulns: [vuln("MAL-2024-1234", "UNKNOWN")] })])] }));
    expect(i).toMatchObject({ kind: "malware", severity: "critical", devOnly: false });
    expect(i.fix?.text).toMatch(/compromis/);
  });
  it("une alerte Dependabot de classification malware reste listée même avec un scan complet", () => {
    const audits = [{ owner: "o", repo: "r", alerts: [{ id: "db-9", source: "dependabot" as const, severity: "high" as const, title: "evil", description: "", state: "open", url: "https://github.com/x", classification: "malware" }] }];
    const out = buildIssues(sources({ audits, scans: [{ owner: "o", repo: "r", status: "complete", components: [] }] }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "malware", severity: "critical" });
  });
  it("licences : GPL, AGPL et absence de licence remontent ; permissives, inconnues et dev non", () => {
    const out = buildIssues(sources({ scans: [scan([
      comp({ name: "a", status: "sain", vulns: [], license: "MIT" }),
      comp({ name: "b", status: "sain", vulns: [], license: "GPL-3.0" }),
      comp({ name: "c", status: "sain", vulns: [], license: "AGPL-3.0" }),
      comp({ name: "d", status: "sain", vulns: [], license: "NONE" }),
      comp({ name: "e", status: "sain", vulns: [], license: "SEE LICENSE IN X" }),
      comp({ name: "f", status: "sain", vulns: [], license: "GPL-3.0", scope: "dev" }),
      comp({ name: "g", status: "sain", vulns: [] }),
    ])] }));
    expect(out.map((i) => [i.title.split(" ")[0], i.kind, i.severity])).toEqual([["b", "license", "medium"], ["c", "license", "high"], ["d", "license", "medium"]]);
    expect(out.every((i) => i.key.startsWith("lic|"))).toBe(true);
  });
  it("un composant vulnérable et sous GPL produit deux alertes distinctes", () => {
    const out = buildIssues(sources({ scans: [scan([comp({ license: "GPL-3.0" })])] }));
    expect(out.map((i) => i.kind).sort()).toEqual(["dependency", "license"]);
    expect(new Set(out.map((i) => i.key)).size).toBe(2);
  });
  it("secrets du code : une alerte par détection, empreinte acceptée par la validation", () => {
    const out = buildIssues(sources({ secrets: [{ owner: "o", repo: "r", findings: [
      { ruleId: "aws-access-key", name: "Clé d'accès AWS", severity: "critical", path: "src/a.ts", line: 3, preview: "AKIA••••••••", fingerprint: "0123456789ab" },
    ] }] }));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: "secret", severity: "critical", key: "secret|o/r|aws-access-key:0123456789ab" });
    expect(isValidIssueKey(out[0].key)).toBe(true);
    expect(out[0].fix?.text).toMatch(/Révoquer/);
  });
});

describe("applyStates", () => {
  const issues = buildIssues(sources({ scans: [{ owner: "o", repo: "r", status: "complete", components: [comp()] }] }));
  const key = issues[0].key;
  const st = (over: Partial<IssueState>): Map<string, IssueState> => new Map([[key, { status: "open", reason: "", note: "", until: null, assignee: "", ...over }]]);
  const now = new Date("2026-10-21T12:00:00Z");

  it("ouvert par défaut", () => {
    expect(applyStates(issues, new Map(), now)[0]).toMatchObject({ status: "open", assignee: "" });
  });
  it("ignoré", () => {
    expect(applyStates(issues, st({ status: "ignored", reason: "false-positive" }), now)[0]).toMatchObject({ status: "ignored", reason: "false-positive" });
  });
  it("reporté tant que l'échéance n'est pas passée, puis rouvert", () => {
    expect(applyStates(issues, st({ status: "snoozed", until: new Date("2026-11-01T00:00:00Z") }), now)[0]).toMatchObject({ status: "snoozed", snoozeExpired: false });
    expect(applyStates(issues, st({ status: "snoozed", until: new Date("2026-10-01T00:00:00Z") }), now)[0]).toMatchObject({ status: "open", snoozeExpired: true });
  });
  it("assignation conservée", () => {
    expect(applyStates(issues, st({ assignee: "alice" }), now)[0]).toMatchObject({ status: "open", assignee: "alice" });
  });
});

describe("tri et comptage", () => {
  it("gravité, puis production avant dev, puis corrigeable avant sans correctif", () => {
    const out = sortIssues(buildIssues(sources({ scans: [{ owner: "o", repo: "r", status: "complete", components: [
      comp({ name: "a-dev", scope: "dev" }),
      comp({ name: "b-nofix", vulns: [vuln("X", "HIGH")] }),
      comp({ name: "c-fix" }),
      comp({ name: "d-crit", vulns: [vuln("Y", "CRITICAL", "9.0.0")] }),
    ] }] })));
    expect(out.map((i) => i.title.split(" ")[0])).toEqual(["d-crit", "c-fix", "b-nofix", "a-dev"]);
  });
  it("compte par gravité", () => {
    const c = countBySeverity(buildIssues(sources({ domains: [domain({ sslValid: false })] })));
    expect(c).toMatchObject({ critical: 1, total: 1 });
  });
});

describe("isValidIssueKey", () => {
  it("refuse les clés hors format", () => {
    expect(isValidIssueKey("dep|o/r|npm:a@1")).toBe(true);
    expect(isValidIssueKey("evil|x")).toBe(false);
    expect(isValidIssueKey("dep|o/r|a;b")).toBe(false);
    expect(isValidIssueKey("dep|" + "a".repeat(400))).toBe(false);
    expect(isValidIssueKey(42)).toBe(false);
  });
});

describe("estimation du temps de correction", () => {
  const issuesOf = (components: ScanComponentInput[]) => buildIssues(sources({ scans: [{ owner: "o", repo: "r", status: "complete", components }] }));

  it("direct 30 min, indirect 1 h 30, changement de version majeure +2 h, sans correctif aucune estimation", () => {
    expect(issuesOf([comp()])[0].fixMinutes).toBe(30);
    expect(issuesOf([comp({ direct: false })])[0].fixMinutes).toBe(90);
    expect(issuesOf([comp({ version: "1.2.0", vulns: [vuln("A", "HIGH", "2.0.0")] })])[0].fixMinutes).toBe(150);
    expect(issuesOf([comp({ vulns: [vuln("A", "HIGH")] })])[0].fixMinutes).toBeUndefined();
  });
  it("autres types", () => {
    const out = buildIssues(sources({
      domains: [domain({ sslValid: false })],
      secrets: [{ owner: "o", repo: "r", findings: [{ ruleId: "x", name: "n", severity: "high", path: "a", line: 1, preview: "p", fingerprint: "0123456789ab" }] }],
    }));
    expect(out.find((i) => i.kind === "secret")?.fixMinutes).toBe(60);
    expect(out.find((i) => i.kind === "domain")?.fixMinutes).toBe(30);
  });
  it("formate la durée", () => {
    expect(formatDuration(30)).toBe("30 min");
    expect(formatDuration(60)).toBe("1 hr");
    expect(formatDuration(150)).toBe("2 hr 30 min");
  });
});

describe("groupIssues", () => {
  const resolved = (components: [string, ScanComponentInput][]) =>
    applyStates(buildIssues(sources({ scans: components.map(([repo, c]) => ({ owner: "o", repo, status: "complete" as const, components: [c] })) })), new Map());

  it("regroupe un même paquet présent dans plusieurs dépôts, pas les paquets isolés", () => {
    const units = groupIssues(resolved([["a", comp()], ["b", comp({ version: "4.17.5" })], ["c", comp({ name: "autre" })]]));
    expect(units).toHaveLength(2);
    const g = units.find((u) => u.type === "group");
    expect(g).toMatchObject({ type: "group", title: "lodash", targets: ["o/a", "o/b"], versions: ["4.17.1", "4.17.5"], fixMinutes: 60 });
    expect(units.filter((u) => u.type === "issue")).toHaveLength(1);
  });
  it("le groupe prend la pire gravité ; le tri se fait par gravité", () => {
    const units = groupIssues(resolved([
      ["a", comp({ vulns: [vuln("A", "LOW", "1.0.1")] })],
      ["b", comp({ vulns: [vuln("B", "CRITICAL", "1.0.2")] })],
      ["c", comp({ name: "x", vulns: [vuln("C", "HIGH", "2.0.0")] })],
    ]));
    expect(units[0]).toMatchObject({ type: "group", severity: "critical" });
  });
  it("ne mélange pas les types ni les écosystèmes", () => {
    const units = groupIssues(resolved([["a", comp({ license: "GPL-3.0" })], ["b", comp({ license: "GPL-3.0" })], ["c", comp({ ecosystem: "pip" })]]));
    // 2 dépendances npm (groupe) + 2 licences npm (groupe) + 1 dépendance pip
    expect(units.map((u) => u.type).sort()).toEqual(["group", "group", "issue"]);
  });
});

describe("historique : nouvelles et résolues", () => {
  const now = new Date("2026-10-21T12:00:00Z");
  const day = 86_400_000;
  const issues = buildIssues(sources({ scans: [{ owner: "o", repo: "r", status: "complete", components: [comp(), comp({ name: "b" })] }] }));
  const row = (i: (typeof issues)[number], over: Partial<HistoryRow> = {}): HistoryRow => ({
    key: i.key, kind: i.kind, severity: i.severity, target: i.target, title: i.title, firstSeen: new Date(now.getTime() - 30 * day), resolvedAt: null, baseline: false, ...over,
  });
  const scope = new Set(["o/r"]);

  it("premier passage : relevé de référence, rien n'est « nouveau »", () => {
    const plan = planHistorySync([], issues, scope, now);
    expect(plan.baseline).toBe(true);
    expect(plan.create).toHaveLength(2);
    expect(plan.create.every((r) => r.baseline)).toBe(true);
    const resolved = applyStates(issues, new Map(), now, effectiveHistory([], plan, now));
    expect(resolved.every((i) => !i.isNew)).toBe(true);
  });
  it("une alerte apparue après le relevé est nouvelle pendant 7 jours", () => {
    const existing = [row(issues[0])];
    const plan = planHistorySync(existing, issues, scope, now);
    expect(plan.baseline).toBe(false);
    expect(plan.create.map((r) => r.key)).toEqual([issues[1].key]);
    const out = applyStates(issues, new Map(), now, effectiveHistory(existing, plan, now));
    expect(out.find((i) => i.key === issues[1].key)?.isNew).toBe(true);
    expect(out.find((i) => i.key === issues[0].key)?.isNew).toBe(false);
    // 8 jours plus tard, elle n'est plus nouvelle
    const later = new Date(now.getTime() + 8 * day);
    expect(applyStates(issues, new Map(), later, [row(issues[1], { firstSeen: now })]).find((i) => i.key === issues[1].key)?.isNew).toBe(false);
  });
  it("une alerte disparue du périmètre est résolue, pas celle d'un dépôt hors périmètre", () => {
    const gone = row({ ...issues[0], key: "dep|o/r|npm:gone@1", title: "gone" });
    const elsewhere = row({ ...issues[0], key: "dep|o/other|npm:x@1", target: "o/other", title: "x" });
    const plan = planHistorySync([gone, elsewhere, row(issues[0]), row(issues[1])], issues, scope, now);
    expect(plan.resolve).toEqual(["dep|o/r|npm:gone@1"]);
    const list = recentResolved(effectiveHistory([gone], plan, now), now);
    expect(list.map((r) => r.title)).toEqual(["gone"]);
  });
  it("une alerte résolue qui revient redevient nouvelle", () => {
    const existing = [row(issues[0], { resolvedAt: new Date(now.getTime() - day) }), row(issues[1])];
    const plan = planHistorySync(existing, issues, scope, now);
    expect(plan.reopen.map((r) => r.key)).toEqual([issues[0].key]);
    expect(applyStates(issues, new Map(), now, effectiveHistory(existing, plan, now)).find((i) => i.key === issues[0].key)?.isNew).toBe(true);
  });
  it("résolues : seulement les 7 derniers jours", () => {
    const old = row(issues[0], { resolvedAt: new Date(now.getTime() - 9 * day) });
    const recent = row(issues[1], { resolvedAt: new Date(now.getTime() - 2 * day) });
    expect(recentResolved([old, recent], now).map((r) => r.key)).toEqual([issues[1].key]);
  });
  it("plan vide quand rien ne change ; Dependabot n'est pas suivi", () => {
    expect(planIsEmpty(planHistorySync(issues.map((i) => row(i)), issues, scope, now))).toBe(true);
    const alerts = buildIssues(sources({ audits: [{ owner: "o", repo: "r", alerts: [{ id: "db-1", source: "dependabot", severity: "high", title: "t", description: "", state: "open", url: "https://github.com/x" }] }] }));
    expect(planHistorySync([row(issues[0])], alerts, scope, now).create).toHaveLength(0);
  });
});

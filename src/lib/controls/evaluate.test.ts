import { describe, expect, it } from "vitest";
import { analyzeTree, analyzeWorkflow } from "./analyzers";
import { evaluateControls } from "./evaluate";
import type { Fetched, RepoFacts } from "./facts";
import { scoreResults } from "./types";

const ok = <T,>(data: T): Fetched<T> => ({ ok: true, data });
const ko = (kind: "plan" | "forbidden" | "notfound" | "error", message = "x"): Fetched<never> => ({ ok: false, kind, message });

function facts(over: Partial<RepoFacts> = {}): RepoFacts {
  return {
    owner: "o", repo: "r",
    meta: ok({ defaultBranch: "main", isPrivate: false, archived: false, admin: true, secretScanning: "enabled", pushProtection: "enabled" }),
    tree: ok({ analysis: analyzeTree(["package.json", "package-lock.json", "SECURITY.md", ".github/CODEOWNERS", "LICENSE", ".github/dependabot.yml", ".github/workflows/ci.yml"]), truncated: false }),
    inheritedSecurityPolicy: ok(false),
    protection: ok({ requiredReviews: 1, allowForcePushes: false, allowDeletions: false, requiredStatusChecks: true, enforceAdmins: true }),
    rules: ok([]),
    workflows: ok([analyzeWorkflow("ci.yml", "on: push\npermissions:\n  contents: read\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@8f152de45cc393bb48ce5d89d36b731f54556e65\n")]),
    workflowPermissions: ok({ defaultPermissions: "read", canApprovePullRequests: false }),
    codeScanning: ok({ analyses: 3, lastAnalysisAt: new Date().toISOString() }),
    privateReporting: ok(true),
    dependabotAlerts: ok(true),
    mergedPullRequests: ok({ sampled: 10, reviewed: 10 }),
    commits: ok({ sampled: 30, verified: 30 }),
    deployKeys: ok([]), webhooks: ok([]), outsideAdmins: ok([]),
    ...over,
  };
}
const byId = (f: RepoFacts) => Object.fromEntries(evaluateControls(f).map((r) => [r.id, r]));

describe("dépôt exemplaire", () => {
  it("tous les contrôles applicables sont conformes", () => {
    const r = evaluateControls(facts());
    expect(r.filter((c) => c.state === "fail" || c.state === "warning" || c.state === "unknown")).toEqual([]);
    expect(scoreResults(r).score).toBe(100);
  });
});

describe("dépôt privé sur l'offre gratuite (protection de branche indisponible)", () => {
  const f = facts({
    meta: ok({ defaultBranch: "main", isPrivate: true, archived: false, admin: true, secretScanning: null, pushProtection: null }),
    protection: ko("plan", "Upgrade to GitHub Pro"), rules: ko("plan", "Upgrade to GitHub Pro"),
    dependabotAlerts: ok(false), codeScanning: ko("forbidden", "Code scanning is not enabled for this repository"),
    mergedPullRequests: ok({ sampled: 0, reviewed: 0 }),
  });
  const r = byId(f);
  it("BP-01 échoue une seule fois ; les contrôles dépendants sont « sans objet » (pas de double comptage)", () => {
    expect(r["BP-01"].state).toBe("fail");
    for (const id of ["BP-02", "BP-03", "BP-04", "BP-05"]) expect(r[id].state).toBe("na");
  });
  it("Secret Scanning indisponible = échec (admin) ; push protection dépend de lui", () => {
    expect(r["SF-02"].state).toBe("fail");
    expect(r["SF-03"].state).toBe("na");
  });
  it("Dependabot désactivé et code scanning absent = échecs, pas « aucune alerte »", () => {
    expect(r["SF-01"].state).toBe("fail");
    expect(r["SF-04"].state).toBe("fail");
  });
  it("aucune PR fusionnée = à examiner ; SECURITY.md/licence sans objet pour un dépôt privé", () => {
    expect(r["REV-01"].state).toBe("warning");
    expect(r["GOV-01"].state).toBe("na");
    expect(r["GOV-03"].state).toBe("na");
  });
});

describe("honnêteté : jamais de « conforme » sans preuve", () => {
  it("protection classique illisible (non-admin) + ruleset partiel → relectures et checks non évaluables", () => {
    const r = byId(facts({
      meta: ok({ defaultBranch: "main", isPrivate: false, archived: false, admin: false, secretScanning: null, pushProtection: null }),
      protection: ko("notfound", "Not Found"), rules: ok([{ type: "deletion" }, { type: "non_fast_forward" }]),
      workflowPermissions: ko("forbidden"), deployKeys: ko("forbidden"), webhooks: ko("forbidden"), outsideAdmins: ko("forbidden"),
    }));
    expect(r["BP-01"].state).toBe("pass");
    expect(r["BP-02"].state).toBe("unknown");
    expect(r["BP-04"].state).toBe("unknown");
    expect(r["BP-03"].state).toBe("pass");
    expect(r["SF-02"].state).toBe("unknown");
    for (const id of ["ACC-01", "ACC-02", "ACC-03"]) expect(r[id].state).toBe("unknown");
  });
  it("une PR exigée mais sans approbation est un échec explicite", () => {
    const r = byId(facts({ protection: ok({ requiredReviews: 0, allowForcePushes: false, allowDeletions: false, requiredStatusChecks: true, enforceAdmins: true }) }));
    expect(r["BP-02"].state).toBe("fail");
    expect(r["BP-02"].evidence).toMatch(/sans approbation/);
  });
  it("arborescence illisible → contrôles dépendants non évaluables", () => {
    const r = byId(facts({ tree: ko("error", "timeout"), workflows: ko("error", "timeout") }));
    for (const id of ["SEC-01", "SEC-02", "GOV-02", "GOV-04", "SF-06", "CI-01", "CI-03"]) expect(r[id].state).toBe("unknown");
  });
  it("SECURITY.md hérité du dépôt .github du propriétaire", () => {
    const f = facts({ tree: ok({ analysis: analyzeTree(["package.json", "package-lock.json"]), truncated: false }), inheritedSecurityPolicy: ok(true) });
    expect(byId(f)["GOV-01"].state).toBe("pass");
  });
  it("outil d'analyse statique visible dans un workflow = SAST conforme même sans droit de lecture", () => {
    const wf = analyzeWorkflow("codeql.yml", "on: push\npermissions: read-all\njobs:\n  a:\n    steps:\n      - uses: github/codeql-action/analyze@8f152de45cc393bb48ce5d89d36b731f54556e65\n");
    expect(byId(facts({ workflows: ok([wf]), codeScanning: ko("forbidden", "You are not authorized") }))["SF-04"].state).toBe("pass");
  });
});

describe("CI/CD", () => {
  it("workflows dangereux : pull_request_target + checkout, injection, actions tierces non épinglées", () => {
    const bad = analyzeWorkflow(".github/workflows/bad.yml", `on: pull_request_target
jobs:
  a:
    runs-on: self-hosted
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - uses: third/party@main
      - run: echo "\${{ github.event.pull_request.title }}"
`);
    const r = byId(facts({ workflows: ok([bad]), workflowPermissions: ok({ defaultPermissions: "write", canApprovePullRequests: false }) }));
    expect(r["CI-03"].state).toBe("fail");
    expect(r["CI-04"].state).toBe("fail");
    expect(r["CI-01"].state).toBe("fail");
    expect(r["CI-02"].state).toBe("fail");
    expect(r["CI-05"].state).toBe("fail");
    expect(r["CI-04"].items?.[0]).toMatch(/bad\.yml:10/);
  });
  it("aucun workflow : tous les contrôles CI sont sans objet", () => {
    const r = byId(facts({ workflows: ok([]) }));
    for (const id of ["CI-01", "CI-02", "CI-03", "CI-04", "CI-05"]) expect(r[id].state).toBe("na");
  });
});

describe("secrets et accès", () => {
  it("fichiers sensibles : échec (haute confiance) ou avertissement (fixtures de test)", () => {
    const high = byId(facts({ tree: ok({ analysis: analyzeTree([".env", "package.json", "package-lock.json"]), truncated: false }) }));
    expect(high["SEC-01"].state).toBe("fail");
    const low = byId(facts({ tree: ok({ analysis: analyzeTree(["tests/fixtures/k.pem", "package.json", "package-lock.json"]), truncated: false }) }));
    expect(low["SEC-01"].state).toBe("warning");
    const trunc = byId(facts({ tree: ok({ analysis: analyzeTree(["package.json"]), truncated: true }) }));
    expect(trunc["SEC-01"].state).toBe("unknown");
  });
  it("clés de déploiement en écriture, webhook HTTP, collaborateur externe admin", () => {
    const r = byId(facts({
      deployKeys: ok([{ title: "ci", readOnly: false }]),
      webhooks: ok([{ url: "http://hooks.example.com/x", insecureSsl: false, hasSecret: true }]),
      outsideAdmins: ok(["mallory"]),
    }));
    expect(r["ACC-01"].state).toBe("fail");
    expect(r["ACC-02"].state).toBe("fail");
    expect(r["ACC-03"].state).toBe("fail");
    expect(r["ACC-02"].items?.[0]).not.toMatch(/\/x/); // le chemin du webhook (peut contenir un jeton) n'est pas affiché
  });
});

describe("scoreResults", () => {
  it("exclut « non évaluable » et « sans objet » et pondère par sévérité", () => {
    const s = scoreResults([
      { id: "a", family: "ci", severity: "high", title: "", state: "pass", evidence: "" },
      { id: "b", family: "ci", severity: "high", title: "", state: "fail", evidence: "" },
      { id: "c", family: "ci", severity: "medium", title: "", state: "warning", evidence: "" },
      { id: "d", family: "ci", severity: "critical", title: "", state: "unknown", evidence: "" },
      { id: "e", family: "ci", severity: "low", title: "", state: "na", evidence: "" },
    ]);
    expect(s.score).toBe(Math.round(((6 + 1.5) / 15) * 100));
    expect(s).toMatchObject({ evaluated: 3, unknown: 1, na: 1, failed: 1 });
    expect(s.failedBySeverity.high).toBe(1);
  });
});

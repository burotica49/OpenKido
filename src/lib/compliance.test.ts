import { describe, expect, it } from "vitest";
import { evaluateFramework, frameworks, type EvalContext } from "./compliance";
import type { ScanResult } from "./scan";

const scan = (over: Partial<ScanResult> = {}): ScanResult => ({
  owner: "o", repo: "r", branch: "main", scannedAt: new Date().toISOString(), riskScore: 0, level: "ok", total: 10, vulnerable: 0,
  components: [], severityBreakdown: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }, status: "complete", warnings: [], unscanned: 0, ...over,
});
const ctx = (over: Partial<EvalContext> = {}): EvalContext => ({ totalRepos: 1, secrets: null, ...over });
const soc2 = frameworks.find((f) => f.id === "soc2")!;
const statusOf = (report: ReturnType<typeof evaluateFramework>, id: string) => report.controls.find((c) => c.id === id)!.status;

describe("conformité : jamais de « conforme » sans preuve", () => {
  it("sans aucun scan, rien n'est conforme", () => {
    const r = evaluateFramework(soc2, [], ctx({ totalRepos: 3 }));
    expect(r.controls.some((c) => c.status === "pass" || c.status === "warning")).toBe(false);
    expect(r.passCount).toBe(0);
  });
  it("les contrôles non implémentés restent « non évalués » même avec des scans propres", () => {
    const r = evaluateFramework(soc2, [scan()], ctx());
    expect(statusOf(r, "CC7.3")).toBe("unknown");
    expect(r.unknownCount).toBeGreaterThan(0);
  });
  it("la couverture se mesure sur le total réel des dépôts, pas sur les seuls dépôts scannés", () => {
    const r = evaluateFramework(soc2, [scan()], ctx({ totalRepos: 4 }));
    expect(statusOf(r, "CC7.2")).toBe("fail"); // 1 dépôt analysé sur 4
    expect(statusOf(evaluateFramework(soc2, [scan()], ctx({ totalRepos: 1 })), "CC7.2")).toBe("pass");
  });
  it("un scan partiel ne prouve pas la couverture", () => {
    expect(statusOf(evaluateFramework(soc2, [scan({ status: "partial" })], ctx()), "CC7.2")).toBe("warning");
  });
  it("secrets : alerte = échec ; actif partout = conforme ; actif sur une partie = non concluant ; pas d'audit = non évalué", () => {
    expect(statusOf(evaluateFramework(soc2, [scan()], ctx({ secrets: { alerts: 2, coveredRepos: 1 } })), "CC6.1")).toBe("fail");
    expect(statusOf(evaluateFramework(soc2, [scan()], ctx({ secrets: { alerts: 0, coveredRepos: 1 } })), "CC6.1")).toBe("pass");
    expect(statusOf(evaluateFramework(soc2, [scan()], ctx({ totalRepos: 3, secrets: { alerts: 0, coveredRepos: 1 } })), "CC6.1")).toBe("unknown");
    expect(statusOf(evaluateFramework(soc2, [scan()], ctx()), "CC6.1")).toBe("unknown");
  });
  it("les contrôles non évalués sont exclus du score", () => {
    const r = evaluateFramework(soc2, [scan()], ctx());
    const scoreable = r.controls.length - r.naCount - r.unknownCount;
    expect(r.score).toBe(Math.round(((r.passCount + r.warnCount * 0.5) / scoreable) * 100));
  });
});

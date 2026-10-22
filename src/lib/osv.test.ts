import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { computeRiskScore, scanDependencies } from "./osv";

beforeAll(() => {
  process.env.OSV_RETRY_BASE_MS = "1";
});
afterEach(() => vi.unstubAllGlobals());

const dep = (name: string, version = "1.0.0") => ({ name, version, ecosystem: "npm" as const, resolved: true });
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const advisory = (id: string, severity = "HIGH") => ({
  id, summary: `Avis ${id}`, database_specific: { severity },
  affected: [{ package: { name: "a", ecosystem: "npm" }, ranges: [{ type: "GIT", events: [{ fixed: "deadbeef" }] }, { type: "SEMVER", events: [{ fixed: "9.9.9" }] }] }],
});

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function mock(handler: Handler) {
  const calls = { batch: 0, detail: 0, query: 0 };
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url.includes("querybatch")) calls.batch++;
    else if (url.includes("/v1/vulns/")) calls.detail++;
    else calls.query++;
    return handler(url, init);
  });
  return calls;
}
const queries = (init?: RequestInit) => JSON.parse(String(init?.body)).queries as { package: { name: string } }[];

describe("scanDependencies", () => {
  it("nominal : sévérité, version corrigée (plages GIT ignorées), composant sain", async () => {
    mock((url, init) => (url.includes("querybatch") ? json({ results: queries(init).map((q) => (q.package.name === "a" ? { vulns: [{ id: "GHSA-N1" }] } : {})) }) : json(advisory("GHSA-N1"))));
    const r = await scanDependencies([dep("a"), dep("b")]);
    expect(r.status).toBe("complete");
    expect(r.components[0].vulns[0]).toMatchObject({ severity: "HIGH", fixedVersion: "9.9.9" });
    expect(r.components[1].unscanned).toBeUndefined();
    expect(r.components[1].vulns).toEqual([]);
  });

  it("OSV en panne : failed, tous non analysés — jamais « sain »", async () => {
    const calls = mock(() => json({}, 500));
    const r = await scanDependencies([dep("a"), dep("b")]);
    expect(r.status).toBe("failed");
    expect(r.components.every((c) => c.unscanned)).toBe(true);
    expect(r.unscanned).toBe(2);
    expect(calls.batch).toBe(3); // 3 tentatives
  });

  it("fiche d'avis indisponible : l'avis reste compté (UNKNOWN), statut partial", async () => {
    mock((url, init) => (url.includes("querybatch") ? json({ results: queries(init).map(() => ({ vulns: [{ id: "GHSA-M1" }] })) }) : json({}, 500)));
    const r = await scanDependencies([dep("a")]);
    expect(r.status).toBe("partial");
    expect(r.components[0].vulns).toHaveLength(1);
    expect(r.components[0].vulns[0].severity).toBe("UNKNOWN");
    expect(r.warnings.join()).toMatch(/indisponible/);
  });

  it("entrée rejetée (400) : bissection, seule la fautive est non analysée", async () => {
    mock((url, init) => {
      if (!url.includes("querybatch")) return json(advisory("x"));
      const qs = queries(init);
      return qs.some((q) => q.package.name === "BAD") ? json({}, 400) : json({ results: qs.map(() => ({})) });
    });
    const r = await scanDependencies(["x1", "x2", "BAD", "x4", "x5"].map((n) => dep(n)));
    expect(r.status).toBe("partial");
    expect(r.components.filter((c) => c.unscanned).map((c) => c.name)).toEqual(["BAD"]);
  });

  it("pagination des avis d'un composant très exposé", async () => {
    const calls = mock((url) =>
      url.includes("querybatch") ? json({ results: [{ vulns: [{ id: "GHSA-P1" }], next_page_token: "T" }] })
      : url.includes("/v1/query") ? json({ vulns: [{ id: "GHSA-P2" }, { id: "GHSA-P3" }] })
      : json(advisory("x")));
    const r = await scanDependencies([dep("a")]);
    expect(r.components[0].vulns).toHaveLength(3);
    expect(calls.query).toBe(1);
  });

  it("met les fiches en cache (6 h)", async () => {
    const calls = mock((url, init) => (url.includes("querybatch") ? json({ results: queries(init).map(() => ({ vulns: [{ id: "GHSA-C1" }] })) }) : json(advisory("GHSA-C1"))));
    await scanDependencies([dep("c")]);
    const first = calls.detail;
    await scanDependencies([dep("d")]);
    expect(first).toBe(1);
    expect(calls.detail).toBe(first);
  });

  it("429 puis succès : complete", async () => {
    let n = 0;
    mock((url, init) => (url.includes("querybatch") ? (n++ === 0 ? json({}, 429, { "retry-after": "0" }) : json({ results: queries(init).map(() => ({})) })) : json(advisory("x"))));
    const r = await scanDependencies([dep("z")]);
    expect(r.status).toBe("complete");
    expect(n).toBe(2);
  });

  it("dédoublonne les requêtes mais rend un composant par dépendance", async () => {
    const sizes: number[] = [];
    mock((url, init) => { if (url.includes("querybatch")) sizes.push(queries(init).length); return url.includes("querybatch") ? json({ results: queries(init).map(() => ({})) }) : json(advisory("x")); });
    const r = await scanDependencies([dep("q"), dep("q"), dep("q", "2.0.0")]);
    expect(r.components).toHaveLength(3);
    expect(sizes[0]).toBe(2);
  });

  it("découpe en lots de 500 en gardant l'alignement", async () => {
    const sizes: number[] = [];
    mock((url, init) => {
      if (!url.includes("querybatch")) return json(advisory("GHSA-L1", "CRITICAL"));
      const qs = queries(init);
      sizes.push(qs.length);
      return json({ results: qs.map((q) => (q.package.name === "p777" ? { vulns: [{ id: "GHSA-L1" }] } : {})) });
    });
    const r = await scanDependencies(Array.from({ length: 1200 }, (_, i) => dep("p" + i)));
    expect(sizes).toEqual([500, 500, 200]);
    expect(r.components.filter((c) => c.vulns.length)).toHaveLength(1);
    expect(r.components[777].vulns[0].severity).toBe("CRITICAL");
  });

  it("un lot sur deux en panne : partial (et non failed)", async () => {
    let k = 0;
    mock((url, init) => {
      if (!url.includes("querybatch")) return json(advisory("x"));
      k++;
      return k >= 2 && k <= 4 ? json({}, 503) : json({ results: queries(init).map(() => ({})) });
    });
    const r = await scanDependencies(Array.from({ length: 1000 }, (_, i) => dep("m" + i)));
    expect(r.status).toBe("partial");
    expect(r.unscanned).toBe(500);
  });
});

describe("computeRiskScore", () => {
  it("pondère par sévérité et plafonne à 100", () => {
    const c = (severity: "CRITICAL" | "LOW") => ({ name: "a", version: "1", ecosystem: "npm" as const, resolved: true, vulns: [{ id: "x", summary: "", severity, cvssScore: null, fixedVersion: null }] });
    expect(computeRiskScore([c("LOW")])).toBe(2);
    expect(computeRiskScore([c("CRITICAL"), c("CRITICAL"), c("CRITICAL")])).toBe(100);
  });
});

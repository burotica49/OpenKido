import { describe, expect, it } from "vitest";
import { normalizeSitecheck } from "./sucuri-core";

// Réponse réelle (abrégée) de https://sitecheck.sucuri.net/api/v3/?scan=<site Joomla/PHP 7.2>
const real = {
  site: { input: "http://x/", domain: "x", final_url: "https://x/", ip: ["164.132.235.17"], hosting: ["OVH SAS"], running_on: ["Apache"], powered_by: ["PHP/7.2"] },
  scan: { duration: 1.8, last_scan: "2026-10-23T07:23:49Z", version: "2.15" },
  warnings: { outdated: [{ name: "PHP", version: "7.2", safe_version: "7.2.31", upgrade_text: "Vulnerabilities on PHP 7.2", upgrade_url: "http://php.net/ChangeLog-7.php#7.2.31" }] },
  software: { cms: [{ name: "Joomla", version: "3.9.19-3.9.21" }], language: [{ name: "PHP", version: "7.2", safe_version: "7.2.31" }], server: [{ name: "Apache" }] },
  recommendations: { security_minor: { needs_waf: {} }, headers_minor: { csp: { details: "script-src, object-src" }, leaked_php_version: {}, no_csp: {} }, tls_minor: { no_stapled_ocsp: {} } },
  tls: { cert_expires: "24 Nov 2026", cert_issuer: "Let's Encrypt" },
  ratings: { total: { rating: "C" }, security: { rating: "C", passed: "5/6" }, domain: { rating: "A", passed: "1/1" }, tls: { rating: "A", passed: "6/6" } },
};

describe("normalizeSitecheck", () => {
  it("lit une réponse réelle", () => {
    const r = normalizeSitecheck(real)!;
    expect(r.ratings).toEqual({ total: "C", security: "C", domain: "A", tls: "A" });
    expect(r.passed.security).toBe("5/6");
    expect(r.site).toMatchObject({ ips: ["164.132.235.17"], hosting: ["OVH SAS"], server: ["Apache"], poweredBy: ["PHP/7.2"] });
    expect(r.cms).toEqual([{ name: "Joomla", version: "3.9.19-3.9.21" }]);
    expect(r.outdated).toEqual([{ name: "PHP", version: "7.2", safeVersion: "7.2.31", url: "http://php.net/ChangeLog-7.php#7.2.31" }]);
    expect(r.tls).toEqual({ issuer: "Let's Encrypt", expires: "24 Nov 2026" });
    expect(r.alerts).toEqual([]);
  });
  it("traduit et classe les recommandations", () => {
    const r = normalizeSitecheck(real)!;
    const ids = r.recommendations.map((x) => x.id).sort();
    expect(ids).toEqual(["csp", "leaked_php_version", "needs_waf", "no_csp", "no_stapled_ocsp"]);
    expect(r.recommendations.find((x) => x.id === "csp")).toMatchObject({ area: "headers", level: "minor", details: "script-src, object-src" });
    expect(r.recommendations.find((x) => x.id === "needs_waf")?.title).toMatch(/pare-feu/);
  });
  it("identifiant inconnu : libellé lisible ; identifiant suspect : ignoré", () => {
    const r = normalizeSitecheck({ ...real, recommendations: { tls_major: { weird_new_check: {}, "bad id!": {} } } })!;
    expect(r.recommendations).toEqual([{ id: "weird_new_check", area: "tls", level: "major", title: "Weird new check" }]);
  });
  it("relève malware et listes noires quand ils sont présents", () => {
    const r = normalizeSitecheck({ ...real, warnings: { ...real.warnings, scan_failed: [{ msg: "Malware found", details: "http://x/a.js" }] }, blacklists: [{ name: "Google" }] })!;
    expect(r.alerts.map((a) => a.kind)).toEqual(["other", "blacklist"]);
    const m = normalizeSitecheck({ ...real, warnings: { malware: [{ msg: "Injected spam" }] } })!;
    expect(m.alerts[0]).toMatchObject({ kind: "malware", title: "Injected spam" });
  });
  it("rejette ce qui n'est pas un résultat", () => {
    expect(normalizeSitecheck(null)).toBeNull();
    expect(normalizeSitecheck("x")).toBeNull();
    expect(normalizeSitecheck({})).toBeNull();
    expect(normalizeSitecheck({ site: {}, ratings: {} })).toBeNull();
  });
  it("nettoie les textes et n'accepte que des URL http(s)", () => {
    const r = normalizeSitecheck({ ...real, warnings: { outdated: [{ name: "PHP\u0000\n", upgrade_url: "javascript:alert(1)" }] } })!;
    expect(r.outdated[0].name).toBe("PHP");
    expect(r.outdated[0].url).toBeUndefined();
  });
});

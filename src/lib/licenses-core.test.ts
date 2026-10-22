import { describe, expect, it } from "vitest";
import { classifyLicense } from "./licenses-core";

const r = (e: string) => classifyLicense(e);

describe("classifyLicense", () => {
  it("permissives = ok", () => {
    for (const e of ["MIT", "Apache-2.0", "BSD-3-Clause", "ISC", "0BSD", "Unlicense", "CC0-1.0", "(MIT OR CC0-1.0)"]) expect(r(e), e).toEqual({ risk: "ok" });
  });
  it("copyleft fort et réseau", () => {
    expect(r("GPL-3.0")).toMatchObject({ risk: "restricted", severity: "medium", label: "GPL" });
    expect(r("GPL-2.0-only")).toMatchObject({ severity: "medium" });
    expect(r("AGPL-3.0-or-later")).toMatchObject({ severity: "high", label: "AGPL" });
    expect(r("SSPL-1.0")).toMatchObject({ severity: "high" });
  });
  it("LGPL et MPL = faible, pas confondus avec GPL", () => {
    expect(r("LGPL-2.1")).toMatchObject({ severity: "low", label: "LGPL" });
    expect(r("MPL-2.0")).toMatchObject({ severity: "low" });
  });
  it("OR : choisit l'alternative la moins contraignante", () => {
    expect(r("MIT OR GPL-3.0")).toEqual({ risk: "ok" });
    expect(r("(GPL-3.0 OR AGPL-3.0)")).toMatchObject({ severity: "medium" });
  });
  it("AND : retient la plus contraignante", () => {
    expect(r("MIT AND GPL-3.0")).toMatchObject({ severity: "medium" });
    expect(r("MIT AND AGPL-3.0")).toMatchObject({ severity: "high" });
  });
  it("exception de licence", () => {
    expect(r("GPL-2.0 WITH Classpath-exception-2.0")).toMatchObject({ severity: "low" });
  });
  it("aucune licence / non reconnue", () => {
    expect(r("NONE")).toMatchObject({ risk: "none", severity: "medium" });
    expect(r("UNLICENSED")).toMatchObject({ risk: "none" });
    expect(r("SEE LICENSE IN LICENSE.md")).toEqual({ risk: "unknown" });
    expect(r("NOASSERTION")).toEqual({ risk: "unknown" });
    expect(r("Weird-Custom-1.0")).toEqual({ risk: "unknown" });
    expect(r("")).toEqual({ risk: "unknown" });
  });
  it("non commercial et source disponible", () => {
    expect(r("CC-BY-NC-4.0")).toMatchObject({ severity: "high" });
    expect(r("BUSL-1.1")).toMatchObject({ severity: "medium" });
  });
});

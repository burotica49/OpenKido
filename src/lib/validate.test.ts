import { describe, expect, it } from "vitest";
import { MAX_REPOS_PER_CALL, assertRepoList, assertRepoRef, isValidRepoRef } from "./validate";

describe("validation des entrées", () => {
  it("accepte des références GitHub usuelles", () => {
    expect(assertRepoRef("burotica49", "Open-kido_v2.1")).toEqual({ owner: "burotica49", repo: "Open-kido_v2.1" });
    expect(isValidRepoRef("vercel", "next.js")).toBe(true);
  });
  it.each([["../etc", "passwd"], ["a/b", "c"], ["a", "b c"], ["", "x"], ["a", ""], [".", "x"], ["x", ".."], [null, "x"], ["x", 42], ["a".repeat(101), "x"]])(
    "refuse %j / %j", (owner, repo) => expect(isValidRepoRef(owner, repo)).toBe(false));
  it("borne la taille des listes et valide chaque élément", () => {
    expect(() => assertRepoList(Array.from({ length: MAX_REPOS_PER_CALL + 1 }, () => ({ owner: "o", name: "r" })))).toThrow(/Trop de dépôts/);
    expect(() => assertRepoList([{ owner: "o", name: "r" }, { owner: "../x", name: "r" }])).toThrow(/Propriétaire invalide/);
    expect(() => assertRepoList("pas un tableau")).toThrow();
    expect(assertRepoList([{ owner: "o", name: "r" }])).toHaveLength(1);
  });
});

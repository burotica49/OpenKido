import { describe, expect, it } from "vitest";
import {
  dedupeDeps, isExactVersion, npmRangeLowerBound, parseCargoLock, parseComposerLock, parseGemfileLock, parseGoMod,
  parsePackageJson, parsePackageLock, parsePipfileLock, parsePnpmLock, parsePoetryLock, parseRequirements, parseSbom, parseYarnLock,
} from "./lockfiles";

describe("npmRangeLowerBound", () => {
  it("prend la borne basse des plages courantes", () => {
    expect(npmRangeLowerBound("^4.17.0")).toBe("4.17.0");
    expect(npmRangeLowerBound("~1.2")).toBe("1.2.0");
    expect(npmRangeLowerBound(">=2")).toBe("2.0.0");
    expect(npmRangeLowerBound("1.0.0-beta.2")).toBe("1.0.0-beta.2");
  });
  it("ignore ce qui n'est pas une version (workspace, git, tag)", () => {
    for (const v of ["workspace:*", "github:a/b", "latest", "*", "file:../x", "npm:other@1.0.0"]) expect(npmRangeLowerBound(v)).toBeNull();
  });
});

describe("isExactVersion", () => {
  it("distingue versions exactes et plages", () => {
    expect(isExactVersion("1.2.3")).toBe(true);
    expect(isExactVersion("v2.0.0-rc.1")).toBe(true);
    expect(isExactVersion("^1.2.3")).toBe(false);
    expect(isExactVersion(">=1")).toBe(false);
    expect(isExactVersion(undefined)).toBe(false);
  });
});

describe("package-lock.json", () => {
  const v3 = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": { name: "app", dependencies: { next: "^16.0.0" }, devDependencies: { vitest: "^5.0.0" } },
      "node_modules/next": { version: "16.4.2" },
      "node_modules/vitest": { version: "5.0.5", dev: true },
      "node_modules/next/node_modules/postcss": { version: "8.4.31" },
      "node_modules/@babel/core": { version: "7.0.0", dev: true },
      "node_modules/sibling": { version: "1.0.0", link: true },
      "node_modules/alias": { name: "real-name", version: "2.0.0" },
    },
  });
  const deps = parsePackageLock(v3, "package-lock.json");
  const get = (name: string) => deps.find((d) => d.name === name);

  it("lit les versions exactes, transitifs inclus", () => {
    expect(deps.map((d) => d.name).sort()).toEqual(["@babel/core", "next", "postcss", "real-name", "vitest"].sort());
    expect(deps.every((d) => d.resolved)).toBe(true);
  });
  it("distingue direct/transitif et prod/dev", () => {
    expect(get("next")).toMatchObject({ direct: true, scope: "prod", version: "16.4.2" });
    expect(get("vitest")).toMatchObject({ direct: true, scope: "dev" });
    expect(get("postcss")?.direct).toBe(false);
    expect(get("@babel/core")?.direct).toBe(false);
  });
  it("utilise le vrai nom d'un paquet aliasé et ignore les liens de workspace", () => {
    expect(get("real-name")).toBeDefined();
    expect(get("sibling")).toBeUndefined();
  });
  it("lit le format v1 (dépendances imbriquées)", () => {
    const v1 = parsePackageLock(JSON.stringify({ lockfileVersion: 1, dependencies: { a: { version: "1.0.0", dependencies: { b: { version: "2.0.0", dev: true } } } } }), "p.json");
    expect(v1.map((d) => `${d.name}@${d.version}`)).toEqual(["a@1.0.0", "b@2.0.0"]);
    expect(v1[1].scope).toBe("dev");
  });
  it("signale un JSON invalide", () => {
    expect(() => parsePackageLock("{", "package-lock.json")).toThrow(/JSON invalide/);
  });
});

describe("yarn.lock", () => {
  it("lit le format classique (v1) et dédoublonne", () => {
    const text = `# yarn lockfile v1\n\n"@babel/code-frame@^7.0.0", "@babel/code-frame@^7.10.4":\n  version "7.12.13"\n  resolved "https://x"\n\nlodash@^4.17.0, lodash@^4.17.21:\n  version "4.17.21"\n`;
    expect(parseYarnLock(text, "yarn.lock").map((d) => `${d.name}@${d.version}`)).toEqual(["@babel/code-frame@7.12.13", "lodash@4.17.21"]);
  });
  it("lit Berry, ignore workspace et __metadata", () => {
    const text = `__metadata:\n  version: 6\n\n"@babel/core@npm:^7.0.0, @babel/core@npm:^7.1.0":\n  version: 7.12.13\n  resolution: "@babel/core@npm:7.12.13"\n\n"app@workspace:.":\n  version: 0.0.0-use.local\n`;
    const out = parseYarnLock(text, "yarn.lock");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: "@babel/core", version: "7.12.13" });
  });
});

describe("pnpm-lock.yaml", () => {
  it("lit les formats v9 et v5 sans suffixe de peer", () => {
    const v9 = `lockfileVersion: '9.0'\n\npackages:\n\n  next@16.4.2(react-dom@19.2.4(react@19.2.4))(react@19.2.4):\n    resolution: {integrity: x}\n\n  '@scope/pkg@1.2.3':\n    resolution: {integrity: y}\n\nsnapshots:\n  ignored@9.9.9:\n    dependencies: {}\n`;
    expect(parsePnpmLock(v9, "pnpm-lock.yaml").map((d) => `${d.name}@${d.version}`)).toEqual(["next@16.4.2", "@scope/pkg@1.2.3"]);
    const v5 = `lockfileVersion: 5.4\n\npackages:\n\n  /react-dom/18.2.0_react@18.2.0:\n    dev: false\n\n  /@types/node/20.1.0:\n    dev: true\n`;
    const out = parsePnpmLock(v5, "pnpm-lock.yaml");
    expect(out.map((d) => `${d.name}@${d.version}`)).toEqual(["react-dom@18.2.0", "@types/node@20.1.0"]);
    expect(out.map((d) => d.scope)).toEqual(["prod", "dev"]);
  });
});

describe("package.json", () => {
  it("renvoie des versions non résolues (plages) avec direct/scope", () => {
    const out = parsePackageJson(JSON.stringify({ dependencies: { a: "^1.2.3", b: "2.0.0", w: "workspace:*" }, devDependencies: { t: "~3.1" } }), "package.json");
    expect(out.map((d) => [d.name, d.version, d.resolved, d.scope, d.direct])).toEqual([
      ["a", "1.2.3", false, "prod", true], ["b", "2.0.0", true, "prod", true], ["t", "3.1.0", false, "dev", true],
    ]);
  });
});

describe("Python", () => {
  it("requirements.txt : ==, bornes, extras, marqueurs, options ignorées, noms normalisés", () => {
    const out = parseRequirements(`# c\nrequests==2.31.0\nDjango>=3.2,<4.0 ; python_version>"3"\nFlask[async]~=2.0.1\n-r base.txt\ngit+https://x/y.git\nnumpy==1.*\npkg_with.dots>=1.0\nbad==\n`, "r.txt");
    expect(out.map((d) => [d.name, d.version, d.resolved])).toEqual([["requests", "2.31.0", true], ["django", "3.2", false], ["flask", "2.0.1", false], ["pkg-with-dots", "1.0", false]]);
  });
  it("Pipfile.lock : default → prod, develop → dev", () => {
    const out = parsePipfileLock(JSON.stringify({ default: { Requests: { version: "==2.0.0" } }, develop: { pytest: { version: "==8.0.0" }, nogit: {} } }), "Pipfile.lock");
    expect(out.map((d) => [d.name, d.version, d.scope])).toEqual([["requests", "2.0.0", "prod"], ["pytest", "8.0.0", "dev"]]);
  });
  it("poetry.lock", () => {
    const out = parsePoetryLock(`[[package]]\nname = "Flask"\nversion = "2.0.1"\ncategory = "main"\n\n[[package]]\nname = "pytest"\nversion = "8.0.0"\ncategory = "dev"\n`, "poetry.lock");
    expect(out.map((d) => [d.name, d.version, d.scope])).toEqual([["flask", "2.0.1", "prod"], ["pytest", "8.0.0", "dev"]]);
  });
});

describe("Go, Rust, PHP, Ruby", () => {
  it("go.mod : retire le « v », distingue indirect", () => {
    const out = parseGoMod(`module x\n\ngo 1.21\n\nrequire (\n\tgithub.com/a/b v1.2.3\n\tgithub.com/c/d v0.0.0-2020 // indirect\n)\nrequire github.com/e/f v2.0.0\n`, "go.mod");
    expect(out.map((d) => [d.name, d.version, d.direct])).toEqual([["github.com/a/b", "1.2.3", true], ["github.com/c/d", "0.0.0-2020", false], ["github.com/e/f", "2.0.0", true]]);
  });
  it("Cargo.lock : ignore les membres du workspace (sans source)", () => {
    const out = parseCargoLock(`[[package]]\nname = "mycrate"\nversion = "0.1.0"\n\n[[package]]\nname = "serde"\nversion = "1.0.1"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n`, "Cargo.lock");
    expect(out.map((d) => d.name)).toEqual(["serde"]);
  });
  it("composer.lock : prod + dev, retire le « v »", () => {
    const out = parseComposerLock(JSON.stringify({ packages: [{ name: "a/b", version: "v1.0.0" }, { name: "c/d", version: "dev-main" }], "packages-dev": [{ name: "e/f", version: "2.0.0" }] }), "composer.lock");
    expect(out.map((d) => [d.name, d.version, d.scope])).toEqual([["a/b", "1.0.0", "prod"], ["e/f", "2.0.0", "dev"]]);
  });
  it("Gemfile.lock : specs uniquement, suffixe de plateforme retiré", () => {
    const out = parseGemfileLock(`GEM\n  remote: https://rubygems.org/\n  specs:\n    rails (7.0.0)\n      actionpack (= 7.0.0)\n    nokogiri (1.15.0-x86_64-linux)\n\nPLATFORMS\n  ruby\n`, "Gemfile.lock");
    expect(out.map((d) => `${d.name}@${d.version}`)).toEqual(["rails@7.0.0", "nokogiri@1.15.0"]);
  });
});

describe("SBOM GitHub (SPDX)", () => {
  const packages = [
    { SPDXID: "R" },
    { SPDXID: "A", versionInfo: "1.2.3", externalRefs: [{ referenceType: "purl", referenceLocator: "pkg:npm/%40babel/core@1.2.3" }] },
    { SPDXID: "B", versionInfo: "^2.0.0", externalRefs: [{ referenceType: "purl", referenceLocator: "pkg:npm/fresh@%5E2.0.0" }] },
    { SPDXID: "C", versionInfo: "3.0.0", externalRefs: [{ referenceType: "purl", referenceLocator: "pkg:maven/org.apache.logging.log4j/log4j-core@2.14.1" }] },
  ];
  const relationships = [
    { spdxElementId: "SPDXRef-DOCUMENT", relatedSpdxElement: "R", relationshipType: "DESCRIBES" },
    { spdxElementId: "R", relatedSpdxElement: "A", relationshipType: "DEPENDS_ON" },
  ];
  it("forme synchrone (sous `sbom`) et asynchrone (à la racine) donnent le même résultat", () => {
    const a = parseSbom({ sbom: { packages, relationships } });
    const b = parseSbom({ packages, relationships });
    expect(b).toEqual(a);
    expect(a.map((d) => [d.name, d.ecosystem, d.direct, d.resolved])).toEqual([
      ["@babel/core", "npm", true, true], ["fresh", "npm", false, false], ["org.apache.logging.log4j:log4j-core", "maven", false, true],
    ]);
  });
});

describe("dedupeDeps", () => {
  it("fusionne : prod > dev, exact > plage, sources cumulées", () => {
    const out = dedupeDeps([
      { name: "a", version: "1.0.0", ecosystem: "npm", source: "x", scope: "dev", resolved: false },
      { name: "a", version: "1.0.0", ecosystem: "npm", source: "y", scope: "prod", direct: true, resolved: true },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ scope: "prod", resolved: true, direct: true, source: "x, y" });
  });
});

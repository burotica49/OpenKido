import { describe, expect, it } from "vitest";
import { assessQuality, qualityScore } from "./quality-rules";

describe("assessQuality", () => {
  it("projet JS complet : tout est détecté par la configuration réelle", () => {
    const f = assessQuality(
      [".github/workflows/ci.yml", "README.md", "CHANGELOG.md", ".editorconfig", "tsconfig.json", "eslint.config.mjs", "prettier.config.js", "src/a.test.ts", "package.json"],
      { scripts: { test: "vitest run", lint: "eslint" }, devDependencies: { vitest: "^5", eslint: "^9", prettier: "^3", typescript: "^5" } }, null);
    expect(f).toMatchObject({ hasCi: true, hasTests: true, hasLint: true, hasFormat: true, hasTypes: true, hasReadme: true, hasChangelog: true, hasEditorconfig: true });
    expect(qualityScore(f)).toBe(100);
  });
  it("pyproject.toml seul ne vaut PAS lint + format + tests", () => {
    const f = assessQuality(["pyproject.toml", "README.md"], null, '[project]\nname = "x"\n');
    expect(f).toMatchObject({ hasLint: false, hasFormat: false, hasTests: false, hasTypes: false });
  });
  it("pyproject.toml avec les sections d'outils les déclare", () => {
    const f = assessQuality(["pyproject.toml"], null, "[tool.ruff]\nline-length = 100\n[tool.black]\n[tool.pytest.ini_options]\n[tool.mypy]\n");
    expect(f).toMatchObject({ hasLint: true, hasFormat: true, hasTests: true, hasTypes: true });
  });
  it("le script « test » par défaut de npm n'est pas un test", () => {
    expect(assessQuality(["package.json"], { scripts: { test: 'echo "Error: no test specified" && exit 1' } }, null).hasTests).toBe(false);
  });
  it("un workflow est de la CI, un dossier de tests vide ne l'est pas ; node_modules est ignoré", () => {
    expect(assessQuality([".github/workflows/deploy.yml"], null, null).hasCi).toBe(true);
    expect(assessQuality(["node_modules/x/test/a.js", "node_modules/x/eslint.config.js"], null, null)).toMatchObject({ hasTests: false, hasLint: false });
    expect(assessQuality(["tests/test_api.py"], null, null).hasTests).toBe(true);
  });
  it("lint via la clé eslintConfig et format via la clé prettier de package.json", () => {
    const f = assessQuality(["package.json"], { eslintConfig: {}, prettier: {} }, null);
    expect(f).toMatchObject({ hasLint: true, hasFormat: true });
  });
});

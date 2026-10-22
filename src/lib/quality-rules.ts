// Évaluation pure de la qualité d'un dépôt : arborescence + contenu de package.json / pyproject.toml.
// Un indicateur n'est vrai que si l'outil est réellement configuré (et non par simple présence d'un fichier générique).

export interface PackageJsonLike {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  eslintConfig?: unknown;
  prettier?: unknown;
}

export interface QualityFindings {
  hasCi: boolean;
  hasTests: boolean;
  hasLint: boolean;
  hasFormat: boolean;
  hasTypes: boolean;
  hasReadme: boolean;
  hasChangelog: boolean;
  hasEditorconfig: boolean;
  ciFiles: string[];
  testFiles: string[];
  lintFiles: string[];
}

export const QUALITY_WEIGHTS = { ci: 25, tests: 25, lint: 15, format: 10, types: 10, readme: 10, changelog: 3, editorconfig: 2 } as const;

export function qualityScore(f: QualityFindings): number {
  return (
    (f.hasCi ? QUALITY_WEIGHTS.ci : 0) + (f.hasTests ? QUALITY_WEIGHTS.tests : 0) + (f.hasLint ? QUALITY_WEIGHTS.lint : 0) +
    (f.hasFormat ? QUALITY_WEIGHTS.format : 0) + (f.hasTypes ? QUALITY_WEIGHTS.types : 0) + (f.hasReadme ? QUALITY_WEIGHTS.readme : 0) +
    (f.hasChangelog ? QUALITY_WEIGHTS.changelog : 0) + (f.hasEditorconfig ? QUALITY_WEIGHTS.editorconfig : 0)
  );
}

const IGNORED = new Set(["node_modules", "vendor", ".git", "dist", "build", ".next", "target", "venv", ".venv", "__pycache__", "site-packages"]);
const TEST_DIRS = new Set(["__tests__", "test", "tests", "spec", "specs", "e2e"]);

const CI_ROOT = /^(\.gitlab-ci\.ya?ml|jenkinsfile|\.travis\.ya?ml|bitbucket-pipelines\.ya?ml|\.drone\.ya?ml|azure-pipelines\.ya?ml|cloudbuild\.ya?ml|\.circleci\/config\.ya?ml|\.github\/workflows\/[^/]+\.ya?ml)$/i;
const TEST_FILE = /(\.(test|spec)\.[cm]?[jt]sx?$)|((^|\/)test_[^/]+\.py$)|(_test\.(py|go|rb)$)|(_spec\.rb$)|(Tests?\.(java|cs|kt)$)/;
const TEST_CONFIG = /^(jest\.config\.[cm]?[jt]s|vitest\.config\.[cm]?[jt]s|pytest\.ini|tox\.ini|\.mocharc(\.[a-z]+)?|karma\.conf\.[cm]?js|cypress\.config\.[cm]?[jt]s|playwright\.config\.[cm]?[jt]s|phpunit\.xml(\.dist)?)$/i;
const TEST_DEPS = /^(jest|vitest|mocha|ava|tap|uvu|jasmine|karma|cypress|playwright|@playwright\/test|supertest|@testing-library\/.+)$/;
const LINT_CONFIG = /^(eslint\.config\.[cm]?[jt]s|\.eslintrc(\.[a-z]+)?|biome\.jsonc?|\.pylintrc|\.flake8|ruff\.toml|\.ruff\.toml|\.rubocop\.ya?ml|\.golangci\.(ya?ml|toml)|\.stylelintrc(\.[a-z]+)?|oxlintrc\.json|phpcs\.xml(\.dist)?|checkstyle\.xml|\.hlint\.ya?ml)$/i;
const LINT_DEPS = /^(eslint|@biomejs\/biome|oxlint|xo|tslint|standard)$/;
const FORMAT_CONFIG = /^(\.prettierrc(\.[a-z]+)?|prettier\.config\.[cm]?[jt]s|biome\.jsonc?|rustfmt\.toml|\.rustfmt\.toml|\.clang-format|dprint\.json)$/i;
const FORMAT_DEPS = /^(prettier|@biomejs\/biome|dprint)$/;
const TYPES_CONFIG = /^(tsconfig(\.[a-z0-9-]+)?\.json|mypy\.ini|pyrightconfig\.json|\.flowconfig)$/i;

const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const isIgnored = (p: string) => p.split("/").some((s) => IGNORED.has(s));

/** Évalue la qualité à partir des chemins du dépôt et des manifestes lus. */
export function assessQuality(allPaths: string[], pkg: PackageJsonLike | null, pyproject: string | null): QualityFindings {
  const paths = allPaths.filter((p) => !isIgnored(p));
  const root = paths.filter((p) => !p.includes("/")).map((p) => p.toLowerCase());
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const depNames = Object.keys(deps);
  const scripts = pkg?.scripts ?? {};
  const py = pyproject ?? "";

  const ciFiles = paths.filter((p) => CI_ROOT.test(p));

  // Tests : fichiers de test, dossier de tests non vide, configuration, framework déclaré ou script « test » réel
  const testEvidence = new Set<string>();
  for (const p of paths) {
    if (TEST_FILE.test(p)) testEvidence.add(p.split("/").slice(0, 3).join("/"));
    else if (p.split("/").slice(0, -1).some((s) => TEST_DIRS.has(s.toLowerCase()))) testEvidence.add(p.split("/").slice(0, p.split("/").findIndex((s) => TEST_DIRS.has(s.toLowerCase())) + 1).join("/"));
    if (TEST_CONFIG.test(base(p))) testEvidence.add(p);
  }
  const testDep = depNames.find((d) => TEST_DEPS.test(d));
  if (testDep) testEvidence.add(`package.json : ${testDep}`);
  if (scripts.test && !/no test specified/i.test(scripts.test)) testEvidence.add("package.json : script « test »");
  if (/\[tool\.pytest|\[pytest\]/.test(py) || /pytest/i.test(py)) testEvidence.add("pyproject.toml : pytest");

  // Lint
  const lintEvidence = new Set<string>();
  for (const p of paths) if (LINT_CONFIG.test(base(p)) && p.split("/").length <= 3) lintEvidence.add(p);
  if (pkg?.eslintConfig) lintEvidence.add("package.json : eslintConfig");
  const lintDep = depNames.find((d) => LINT_DEPS.test(d));
  if (lintDep) lintEvidence.add(`package.json : ${lintDep}`);
  if (scripts.lint) lintEvidence.add("package.json : script « lint »");
  if (/\[tool\.(ruff|pylint|flake8)/.test(py)) lintEvidence.add("pyproject.toml : linter Python");

  const hasFormat =
    paths.some((p) => FORMAT_CONFIG.test(base(p)) && p.split("/").length <= 3) ||
    !!pkg?.prettier ||
    depNames.some((d) => FORMAT_DEPS.test(d)) ||
    /\[tool\.(black|ruff\.format|isort)/.test(py);

  const hasTypes =
    paths.some((p) => TYPES_CONFIG.test(base(p)) && p.split("/").length <= 3) ||
    depNames.includes("typescript") ||
    /\[tool\.(mypy|pyright)/.test(py);

  return {
    hasCi: ciFiles.length > 0,
    hasTests: testEvidence.size > 0,
    hasLint: lintEvidence.size > 0,
    hasFormat,
    hasTypes,
    hasReadme: root.some((f) => /^readme(\.[a-z]+)?$/.test(f)),
    hasChangelog: root.some((f) => /^(changelog|changes|history|news)(\.[a-z]+)?$/.test(f)),
    hasEditorconfig: root.includes(".editorconfig"),
    ciFiles: ciFiles.slice(0, 20),
    testFiles: [...testEvidence].slice(0, 20),
    lintFiles: [...lintEvidence].slice(0, 20),
  };
}

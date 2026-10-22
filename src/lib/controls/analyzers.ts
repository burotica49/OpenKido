// Analyseurs purs (aucun réseau) : workflows GitHub Actions et arborescence d'un dépôt.
// Testés isolément ; le moteur (engine.ts) leur fournit les données lues sur GitHub.

// ─── Workflows GitHub Actions ─────────────────────────────────────────────────

export interface ActionUse {
  /** « owner/repo[/chemin] » */
  action: string;
  /** Référence après « @ » (tag, branche ou SHA). */
  ref: string;
  line: number;
  /** Épinglée sur un commit complet (40 caractères hexadécimaux). */
  pinned: boolean;
  /** actions/* ou github/* */
  firstParty: boolean;
}

export interface WorkflowAnalysis {
  path: string;
  uses: ActionUse[];
  /** `permissions:` déclaré au niveau du workflow, ou dans CHAQUE job. */
  hasPermissions: boolean;
  /** `permissions: write-all` quelque part. */
  writeAll: boolean;
  usesPullRequestTarget: boolean;
  /** pull_request_target + récupération du code de la PR (exécution de code non fiable avec secrets). */
  checksOutPullRequestHead: boolean;
  injections: { line: number; expression: string }[];
  selfHosted: boolean;
}

const stripComment = (line: string) => line.replace(/(^|\s)#.*$/, "");
const indentOf = (line: string) => line.length - line.trimStart().length;
const isBlank = (line: string) => stripComment(line).trim() === "";

// Contextes contrôlables par un tiers (titre/corps de PR ou d'issue, nom de branche, message de commit…).
const DANGEROUS_EXPRESSION =
  /github\.event\.(issue\.(title|body)|pull_request\.(title|body|head\.ref|head\.label|head\.repo\.default_branch)|comment\.body|review\.body|review_comment\.body|discussion\.(title|body)|pages\.[^}]*page_name|commits\.[^}]*(message|author\.(email|name))|head_commit\.(message|author\.(email|name))|workflow_run\.(head_branch|head_commit\.(message|author\.(email|name))|head_repository\.[^}\s]*))|github\.head_ref/;

export function analyzeWorkflow(path: string, text: string): WorkflowAnalysis {
  const lines = text.split(/\r?\n/);

  // Blocs de premier niveau (on:, permissions:, jobs:…)
  const topKeys: { key: string; start: number; end: number }[] = [];
  lines.forEach((line, i) => {
    const m = line.match(/^["']?([A-Za-z_][\w-]*|true)["']?\s*:/);
    if (m && indentOf(line) === 0) topKeys.push({ key: m[1], start: i, end: lines.length });
  });
  topKeys.forEach((k, idx) => { if (topKeys[idx + 1]) k.end = topKeys[idx + 1].start; });
  const block = (key: string) => topKeys.find((k) => k.key === key);

  // Déclencheurs
  const on = block("on") ?? block("true");
  const onText = on ? lines.slice(on.start, on.end).map(stripComment).join("\n") : "";
  const usesPullRequestTarget = /\bpull_request_target\b/.test(onText);

  // Permissions
  const topPermissions = block("permissions");
  const jobsBlock = block("jobs");
  let everyJobHasPermissions = false;
  let writeAll = !!topPermissions && /^permissions:\s*write-all\b/.test(stripComment(lines[topPermissions.start]).trim());
  if (jobsBlock) {
    const body = lines.slice(jobsBlock.start + 1, jobsBlock.end);
    const first = body.find((l) => !isBlank(l));
    const jobIndent = first ? indentOf(first) : 2;
    const jobStarts = body
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => !isBlank(l) && indentOf(l) === jobIndent && /^\s*["']?[\w-]+["']?\s*:/.test(l));
    if (jobStarts.length > 0) {
      everyJobHasPermissions = jobStarts.every((job, idx) => {
        const end = jobStarts[idx + 1]?.i ?? body.length;
        const jobLines = body.slice(job.i + 1, end);
        const permLine = jobLines.find((l) => indentOf(l) === jobIndent + 2 && /^\s*permissions\s*:/.test(l));
        if (permLine && /permissions:\s*write-all\b/.test(stripComment(permLine))) writeAll = true;
        return !!permLine;
      });
    }
  }

  // Actions tierces
  const uses: ActionUse[] = [];
  lines.forEach((line, i) => {
    const m = stripComment(line).match(/^\s*(?:-\s+)?uses:\s*["']?([^"'\s]+)["']?/);
    if (!m) return;
    const full = m[1];
    if (full.startsWith("./") || full.startsWith("docker://")) return;
    const at = full.lastIndexOf("@");
    if (at <= 0) return;
    const action = full.slice(0, at);
    const ref = full.slice(at + 1);
    uses.push({ action, ref, line: i + 1, pinned: /^[0-9a-f]{40}$/i.test(ref), firstParty: /^(actions|github)\//i.test(action) });
  });

  // Scripts `run:` (inline ou bloc) : injection par expression ${{ … }}
  const injections: { line: number; expression: string }[] = [];
  const scriptLines: { n: number; text: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*(?:-\s+)?)run:\s*(.*)$/);
    if (!m) continue;
    const keyCol = lines[i].indexOf("run:");
    const rest = stripComment(m[2]).trim();
    if (/^[|>][+-]?\d*$/.test(rest)) {
      for (let j = i + 1; j < lines.length && (isBlank(lines[j]) || indentOf(lines[j]) > keyCol); j++) {
        scriptLines.push({ n: j + 1, text: lines[j] });
      }
    } else {
      scriptLines.push({ n: i + 1, text: m[2] });
    }
  }
  for (const { n, text } of scriptLines) {
    for (const expr of text.matchAll(/\$\{\{\s*([^}]+?)\s*\}\}/g)) {
      if (DANGEROUS_EXPRESSION.test(expr[1])) injections.push({ line: n, expression: expr[1].trim() });
    }
  }

  // pull_request_target + récupération du code de la PR
  const checksOutPullRequestHead =
    usesPullRequestTarget &&
    (lines.some((l) => /^\s*(?:-\s+)?(ref|repository)\s*:/.test(l) && /github\.event\.pull_request\.head|github\.head_ref|refs\/pull\//.test(l)) ||
      scriptLines.some(({ text }) => /gh pr checkout|git\s+(fetch|checkout)[^\n]*(refs\/pull|github\.head_ref|pull_request\.head)/.test(text)));

  // Runners auto-hébergés
  let selfHosted = false;
  lines.forEach((line, i) => {
    if (!/^\s*runs-on\s*:/.test(line)) return;
    const window = [line, ...lines.slice(i + 1, i + 4).filter((l) => /^\s*-|^\s{2,}\S/.test(l) && indentOf(l) > indentOf(line))];
    if (window.some((l) => /self-hosted/.test(stripComment(l)))) selfHosted = true;
  });

  return {
    path,
    uses,
    hasPermissions: !!topPermissions || everyJobHasPermissions,
    writeAll,
    usesPullRequestTarget,
    checksOutPullRequestHead,
    injections,
    selfHosted,
  };
}

// ─── Arborescence ─────────────────────────────────────────────────────────────

export interface SensitiveFile {
  path: string;
  label: string;
  /** low = dossier de tests/exemples (clé factice probable). */
  confidence: "high" | "low";
}

export interface LockfileGap {
  path: string;
  ecosystem: string;
  missing: string;
  /** Concerne la racine du dépôt. */
  root: boolean;
}

export interface TreeAnalysis {
  sensitive: SensitiveFile[];
  /** Binaires exécutables et dossiers de dépendances versionnés. */
  artifacts: string[];
  has: { securityPolicy: boolean; codeowners: boolean; license: boolean; dependabot: boolean; renovate: boolean };
  lockfileGaps: LockfileGap[];
  workflowFiles: string[];
  /** Le dépôt contient au moins un manifeste de dépendances (package.json, go.mod, pom.xml…). */
  hasDependencyManifest: boolean;
}

const MANIFEST_RE = /(^|\/)(package\.json|requirements[^/]*\.txt|Pipfile|pyproject\.toml|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(\.kts)?|composer\.json|Gemfile|[^/]+\.csproj|packages\.config)$/;

const SAMPLE_SUFFIX = /\.(example|sample|template|dist|defaults|schema|tpl)$/i;
const LOW_CONFIDENCE_DIRS = new Set(["test", "tests", "__tests__", "spec", "fixtures", "__fixtures__", "testdata", "test-data", "examples", "example", "samples", "sample", "docs", "demo", "e2e", "mocks", "__mocks__"]);
const IGNORED_DIRS = new Set(["node_modules", "vendor", ".git", "bower_components", "site-packages"]);
const BINARY_EXT = /\.(exe|dll|so|dylib|jar|war|ear|class|bin|o|a|lib|msi|dmg|apk|ipa)$/i;

const SENSITIVE_RULES: { test: (base: string, path: string) => boolean; label: string }[] = [
  { test: (b) => /^\.env(\..+)?$/i.test(b) && !SAMPLE_SUFFIX.test(b), label: "Fichier d'environnement (.env)" },
  { test: (b) => /\.pem$/i.test(b), label: "Certificat / clé PEM" },
  { test: (b) => /\.key$/i.test(b), label: "Fichier de clé (.key)" },
  { test: (b) => /^id_(rsa|dsa|ecdsa|ed25519)$/.test(b), label: "Clé SSH privée" },
  { test: (b) => /\.(p12|pfx|jks|keystore|kdbx)$/i.test(b), label: "Magasin de clés / mots de passe" },
  { test: (b) => /^(credentials\.json|client_secrets?.*\.json|service[-_]?account.*\.json|serviceAccountKey\.json)$/i.test(b), label: "Identifiants cloud (JSON)" },
  { test: (b) => /\.tfstate(\.backup)?$/i.test(b), label: "État Terraform (contient des secrets)" },
  { test: (b) => /\.tfvars$/i.test(b) && !SAMPLE_SUFFIX.test(b), label: "Variables Terraform" },
  { test: (b) => /^(\.netrc|\.pypirc|\.htpasswd|\.git-credentials|\.dockercfg)$/.test(b), label: "Fichier d'identifiants" },
  { test: (b) => /\.(sqlite3?|db)$/i.test(b), label: "Base de données versionnée" },
  { test: (b) => /^wp-config\.php$/.test(b), label: "Configuration WordPress" },
  { test: (b) => /^(secrets\.(ya?ml|json)|\.secrets)$/i.test(b), label: "Fichier de secrets" },
];

const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const baseOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);

export function analyzeTree(paths: string[]): TreeAnalysis {
  const sensitive: SensitiveFile[] = [];
  const artifacts: string[] = [];
  const workflowFiles: string[] = [];
  const lower = new Set(paths.map((p) => p.toLowerCase()));
  const has = (...candidates: string[]) => candidates.some((c) => lower.has(c));
  const rootFiles = paths.filter((p) => !p.includes("/"));

  const committedDepDirs = new Set<string>();
  for (const path of paths) {
    const segments = path.split("/");
    const ignoredAt = segments.findIndex((s) => IGNORED_DIRS.has(s));
    if (ignoredAt !== -1) {
      if (segments[ignoredAt] === "node_modules" || segments[ignoredAt] === "vendor") committedDepDirs.add(segments.slice(0, ignoredAt + 1).join("/"));
      continue;
    }
    const base = baseOf(path);

    if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) workflowFiles.push(path);

    const rule = SENSITIVE_RULES.find((r) => r.test(base, path));
    if (rule) {
      const confidence = segments.slice(0, -1).some((s) => LOW_CONFIDENCE_DIRS.has(s.toLowerCase())) ? "low" : "high";
      sensitive.push({ path, label: rule.label, confidence });
    }
    if (BINARY_EXT.test(base) && !/gradle-wrapper\.jar$/i.test(base)) artifacts.push(path);
  }
  for (const dir of committedDepDirs) artifacts.unshift(`${dir}/ (dépendances versionnées)`);

  // Lockfiles manquants (hors dossiers de tests/exemples)
  const dirs = new Map<string, Set<string>>();
  for (const p of paths) {
    const d = dirOf(p);
    if (!dirs.has(d)) dirs.set(d, new Set());
    dirs.get(d)!.add(baseOf(p));
  }
  const npmLocks = ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb"];
  const npmLockDirs = [...dirs].filter(([, f]) => npmLocks.some((l) => f.has(l))).map(([d]) => d);
  const lockfileGaps: LockfileGap[] = [];
  for (const [dir, files] of dirs) {
    if (dir.split("/").some((s) => IGNORED_DIRS.has(s) || LOW_CONFIDENCE_DIRS.has(s.toLowerCase()))) continue;
    const at = dir || "racine";
    if (files.has("package.json") && !npmLockDirs.some((d) => d === "" || dir === d || dir.startsWith(d + "/"))) {
      lockfileGaps.push({ path: at, ecosystem: "npm", missing: "package-lock.json / yarn.lock / pnpm-lock.yaml", root: dir === "" });
    }
    if (files.has("go.mod") && !files.has("go.sum")) lockfileGaps.push({ path: at, ecosystem: "Go", missing: "go.sum", root: dir === "" });
    if (files.has("composer.json") && !files.has("composer.lock")) lockfileGaps.push({ path: at, ecosystem: "PHP", missing: "composer.lock", root: dir === "" });
    if (files.has("Gemfile") && !files.has("Gemfile.lock")) lockfileGaps.push({ path: at, ecosystem: "Ruby", missing: "Gemfile.lock", root: dir === "" });
    if (files.has("Pipfile") && !files.has("Pipfile.lock")) lockfileGaps.push({ path: at, ecosystem: "Python", missing: "Pipfile.lock", root: dir === "" });
  }

  return {
    sensitive,
    artifacts,
    has: {
      securityPolicy: has("security.md", ".github/security.md", "docs/security.md"),
      codeowners: has("codeowners", ".github/codeowners", "docs/codeowners"),
      license: rootFiles.some((f) => /^(license|licence|copying|unlicense)(\.(md|txt|rst))?$/i.test(f)),
      dependabot: has(".github/dependabot.yml", ".github/dependabot.yaml"),
      renovate: has("renovate.json", "renovate.json5", ".renovaterc", ".renovaterc.json", ".github/renovate.json", ".github/renovate.json5"),
    },
    lockfileGaps,
    workflowFiles,
    hasDependencyManifest: paths.some((p) => !p.split("/").some((seg) => IGNORED_DIRS.has(seg)) && MANIFEST_RE.test(p)),
  };
}

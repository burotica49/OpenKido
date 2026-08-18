"use server";

import { getOctokit } from "./github";
import { db } from "./db";

export interface QualityResult {
  owner: string;
  repo: string;
  defaultBranch: string;
  score: number;
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

const CI_PATTERNS = [
  ".github/workflows",
  ".circleci/config.yml",
  ".gitlab-ci.yml",
  "Jenkinsfile",
  ".travis.yml",
  "bitbucket-pipelines.yml",
  ".drone.yml",
];

const LINT_FILES = [
  "eslint.config.js", "eslint.config.mjs", "eslint.config.ts",
  ".eslintrc", ".eslintrc.js", ".eslintrc.json", ".eslintrc.yml",
  ".pylintrc", "pyproject.toml", ".flake8", "ruff.toml",
  ".rubocop.yml", "golangci.yml", ".golangci.yml",
];

const FORMAT_FILES = [
  ".prettierrc", ".prettierrc.js", ".prettierrc.json", ".prettierrc.yml",
  "prettier.config.js", ".editorconfig",
  "pyproject.toml", ".black",
];

const TEST_DIRS = [
  "__tests__", "test", "tests", "spec", "specs",
  "src/__tests__", "src/test", "src/tests",
];

const TEST_CONFIG = [
  "jest.config.js", "jest.config.ts", "jest.config.mjs",
  "vitest.config.js", "vitest.config.ts",
  "pytest.ini", "setup.cfg", "pyproject.toml",
  "karma.conf.js", "mocha.opts", ".mocharc.js",
  "cypress.config.js", "playwright.config.ts",
];

async function fileExists(octokit: ReturnType<typeof getOctokit>, owner: string, repo: string, path: string): Promise<boolean> {
  try {
    await octokit.repos.getContent({ owner, repo, path });
    return true;
  } catch {
    return false;
  }
}

async function listDir(octokit: ReturnType<typeof getOctokit>, owner: string, repo: string, path: string): Promise<string[]> {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path });
    if (Array.isArray(data)) return data.map((f) => f.name);
    return [];
  } catch {
    return [];
  }
}

export async function analyzeRepo(token: string, owner: string, repo: string, branch: string): Promise<QualityResult> {
  const octokit = getOctokit(token);

  // Run all checks in parallel
  const [
    rootFiles,
    githubWorkflows,
  ] = await Promise.all([
    listDir(octokit, owner, repo, ""),
    listDir(octokit, owner, repo, ".github/workflows"),
  ]);

  const rootSet = new Set(rootFiles.map((f) => f.toLowerCase()));

  // CI/CD
  const ciFiles: string[] = [];
  if (githubWorkflows.length > 0) ciFiles.push(...githubWorkflows.map((f) => `.github/workflows/${f}`));
  for (const pat of CI_PATTERNS.slice(1)) {
    const file = pat.split("/").pop()!;
    if (rootSet.has(file.toLowerCase())) ciFiles.push(pat);
  }
  const hasCi = ciFiles.length > 0;

  // Linting
  const lintFiles = LINT_FILES.filter((f) => rootSet.has(f.toLowerCase()));
  const hasLint = lintFiles.length > 0;

  // Formatting
  const hasFormat = FORMAT_FILES.some((f) => rootSet.has(f.toLowerCase()));

  // TypeScript
  const hasTypes = rootSet.has("tsconfig.json") || rootSet.has("tsconfig.base.json");

  // README
  const hasReadme = rootSet.has("readme.md") || rootSet.has("readme") || rootSet.has("readme.rst");

  // Changelog
  const hasChangelog = rootSet.has("changelog.md") || rootSet.has("changelog") || rootSet.has("history.md");

  // EditorConfig
  const hasEditorconfig = rootSet.has(".editorconfig");

  // Tests — check test dirs + test config files
  const testFiles: string[] = [];
  const testConfigFound = TEST_CONFIG.filter((f) => rootSet.has(f.toLowerCase()));
  testFiles.push(...testConfigFound);

  // Check test directories in parallel (limit to avoid rate limiting)
  const testDirResults = await Promise.allSettled(
    TEST_DIRS.map(async (dir) => {
      const files = await listDir(octokit, owner, repo, dir);
      return files.length > 0 ? dir : null;
    })
  );
  for (const r of testDirResults) {
    if (r.status === "fulfilled" && r.value) testFiles.push(r.value);
  }
  const hasTests = testFiles.length > 0;

  // Score: each check is weighted
  const checks = [
    { value: hasCi,          weight: 25 },
    { value: hasTests,       weight: 25 },
    { value: hasLint,        weight: 15 },
    { value: hasFormat,      weight: 10 },
    { value: hasTypes,       weight: 10 },
    { value: hasReadme,      weight: 10 },
    { value: hasChangelog,   weight: 3  },
    { value: hasEditorconfig,weight: 2  },
  ];
  const score = checks.reduce((acc, c) => acc + (c.value ? c.weight : 0), 0);

  const result: QualityResult = {
    owner, repo, defaultBranch: branch, score,
    hasCi, hasTests, hasLint, hasFormat, hasTypes,
    hasReadme, hasChangelog, hasEditorconfig,
    ciFiles, testFiles, lintFiles,
  };

  await db.repoQuality.upsert({
    where: { owner_repo: { owner, repo } },
    create: {
      owner, repo, defaultBranch: branch, score,
      hasCi, hasTests, hasLint, hasFormat, hasTypes,
      hasReadme, hasChangelog, hasEditorconfig,
      ciFiles: JSON.stringify(ciFiles),
      testFiles: JSON.stringify(testFiles),
      lintFiles: JSON.stringify(lintFiles),
    },
    update: {
      checkedAt: new Date(), defaultBranch: branch, score,
      hasCi, hasTests, hasLint, hasFormat, hasTypes,
      hasReadme, hasChangelog, hasEditorconfig,
      ciFiles: JSON.stringify(ciFiles),
      testFiles: JSON.stringify(testFiles),
      lintFiles: JSON.stringify(lintFiles),
    },
  });

  console.log(`[quality] ${owner}/${repo}: score=${score} CI=${hasCi} tests=${hasTests} lint=${hasLint}`);
  return result;
}

export async function analyzeAllRepos(token: string, repos: { owner: string; name: string; branch: string }[]) {
  const CONCURRENCY = 3;
  let done = 0;
  for (let i = 0; i < repos.length; i += CONCURRENCY) {
    const batch = repos.slice(i, i + CONCURRENCY);
    await Promise.allSettled(batch.map((r) => analyzeRepo(token, r.owner, r.name, r.branch)));
    done += batch.length;
  }
  return done;
}

export async function getQualitySummaries(repos: { owner: string; name: string }[]) {
  const rows = await db.repoQuality.findMany({
    where: { OR: repos.map((r) => ({ owner: r.owner, repo: r.name })) },
  });
  const map = new Map(rows.map((r) => [`${r.owner}/${r.repo}`, r]));
  return map;
}

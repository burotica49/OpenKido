import "server-only";

import { getSilentOctokit, describeGithubError } from "./github";
import { db } from "./db";
import { assessQuality, qualityScore, type PackageJsonLike } from "./quality-rules";

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

/**
 * Analyse la qualité d'un dépôt à partir de son arborescence git (1 appel) et du contenu de
 * package.json / pyproject.toml. Une erreur GitHub fait échouer l'analyse : elle n'est jamais
 * enregistrée comme « aucun outil détecté ».
 */
export async function analyzeRepo(token: string, owner: string, repo: string, branch: string): Promise<QualityResult> {
  const octokit = getSilentOctokit(token);

  let entries: { path?: string; type?: string; sha?: string }[];
  try {
    const { data } = await octokit.git.getTree({ owner, repo, tree_sha: branch, recursive: "true" });
    entries = data.tree.filter((t) => t.type === "blob");
  } catch (error) {
    if ((error as { status?: number })?.status === 409) entries = []; // dépôt vide
    else throw new Error(`lecture de l'arborescence impossible (${describeGithubError(error)})`);
  }

  const read = async (name: string): Promise<string | null> => {
    const entry = entries.find((e) => e.path === name);
    if (!entry?.sha) return null;
    try {
      const { data } = await octokit.git.getBlob({ owner, repo, file_sha: entry.sha });
      return Buffer.from(data.content, data.encoding === "base64" ? "base64" : "utf8").toString("utf8");
    } catch (error) {
      throw new Error(`lecture de ${name} impossible (${describeGithubError(error)})`);
    }
  };

  const [pkgText, pyproject] = await Promise.all([read("package.json"), read("pyproject.toml")]);
  let pkg: PackageJsonLike | null = null;
  try {
    pkg = pkgText ? (JSON.parse(pkgText) as PackageJsonLike) : null;
  } catch {
    pkg = null;
  }

  const findings = assessQuality(entries.map((e) => e.path ?? ""), pkg, pyproject);
  const score = qualityScore(findings);
  const { ciFiles, testFiles, lintFiles, ...flags } = findings;

  const data = {
    defaultBranch: branch,
    score,
    ...flags,
    ciFiles: JSON.stringify(ciFiles),
    testFiles: JSON.stringify(testFiles),
    lintFiles: JSON.stringify(lintFiles),
  };
  await db.repoQuality.upsert({
    where: { owner_repo: { owner, repo } },
    create: { owner, repo, ...data },
    update: { ...data, checkedAt: new Date() },
  });

  console.log(`[quality] ${owner}/${repo}: score=${score} CI=${flags.hasCi} tests=${flags.hasTests} lint=${flags.hasLint}`);
  return { owner, repo, defaultBranch: branch, score, ...flags, ciFiles, testFiles, lintFiles };
}

export async function getQualitySummaries(repos: { owner: string; name: string }[]) {
  const rows = await db.repoQuality.findMany({
    where: { OR: repos.map((r) => ({ owner: r.owner, repo: r.name })) },
  });
  const map = new Map(rows.map((r) => [`${r.owner}/${r.repo}`, r]));
  return map;
}

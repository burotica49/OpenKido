import "server-only";
import { Readable } from "node:stream";
import { createGunzip } from "node:zlib";
import { db } from "./db";
import { readTar, TarLimitError } from "./tar";
import { isScannablePath, looksBinary, scanText, type SecretFinding } from "./secret-rules";

const MAX_COMPRESSED_BYTES = 120 * 1024 * 1024;
const MAX_TOTAL_BYTES = 600 * 1024 * 1024;
const MAX_FILE_BYTES = 300 * 1024;
const MAX_FILES = 20_000;
const MAX_FINDINGS = 500;

export class SecretScanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretScanError";
  }
}

export interface SecretScanResult {
  status: "complete" | "partial";
  filesScanned: number;
  filesSkipped: number;
  findings: SecretFinding[];
  note: string | null;
}

/** Télécharge l'archive du dépôt (branche par défaut) et y cherche des secrets. Aucune valeur n'est conservée. */
export async function scanRepoSecrets(token: string, owner: string, repo: string): Promise<SecretScanResult> {
  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${owner}/${repo}/tarball`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "openkido" },
      redirect: "follow",
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    throw new SecretScanError(`téléchargement impossible (${e instanceof Error ? e.message : "réseau"})`);
  }
  if (res.status === 404 || res.status === 403) throw new SecretScanError(`dépôt inaccessible (HTTP ${res.status})`);
  if (!res.ok || !res.body) throw new SecretScanError(`GitHub a répondu HTTP ${res.status}`);

  let compressed = 0;
  const source = Readable.fromWeb(res.body as never);
  source.on("data", (chunk: Buffer) => {
    compressed += chunk.length;
    if (compressed > MAX_COMPRESSED_BYTES) source.destroy(new TarLimitError("archive trop volumineuse"));
  });
  const gunzip = createGunzip();
  source.on("error", (err) => gunzip.destroy(err));
  source.pipe(gunzip);

  const findings: SecretFinding[] = [];
  let scanned = 0;
  let skipped = 0;
  let partial = false;
  let note: string | null = null;

  try {
    await readTar(gunzip, {
      maxTotalBytes: MAX_TOTAL_BYTES,
      wants: (path, size) => {
        if (!isScannablePath(path)) return false;
        if (size > MAX_FILE_BYTES) {
          skipped++;
          partial = true;
          return false;
        }
        if (scanned >= MAX_FILES) {
          skipped++;
          partial = true;
          return false;
        }
        return true;
      },
      onFile: (path, content) => {
        if (looksBinary(content)) return;
        scanned++;
        if (findings.length >= MAX_FINDINGS) return;
        findings.push(...scanText(path, content.toString("utf8")).slice(0, MAX_FINDINGS - findings.length));
      },
    });
  } catch (e) {
    if (e instanceof TarLimitError) {
      partial = true;
      note = "Archive trop volumineuse : analyse partielle.";
    } else {
      throw new SecretScanError(`lecture de l'archive impossible (${e instanceof Error ? e.message : "erreur"})`);
    }
  }

  if (skipped > 0 && !note) note = `${skipped} fichier(s) trop volumineux ou en surnombre non analysé(s).`;
  if (findings.length >= MAX_FINDINGS) note = `${note ? note + " " : ""}Résultats limités à ${MAX_FINDINGS} détections.`;
  return { status: partial ? "partial" : "complete", filesScanned: scanned, filesSkipped: skipped, findings, note };
}

const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const;

/**
 * Analyse puis enregistre. Un échec ne remplace jamais un résultat précédent ; un résultat partiel
 * ne remplace pas un résultat complet.
 */
export async function scanAndStoreSecrets(token: string, owner: string, repo: string): Promise<{ stored: boolean; result: SecretScanResult }> {
  const result = await scanRepoSecrets(token, owner, repo);
  const findings = [...result.findings].sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || a.path.localeCompare(b.path));
  const count = (s: SecretFinding["severity"]) => findings.filter((f) => f.severity === s).length;
  const previous = await db.repoSecrets.findUnique({ where: { owner_repo: { owner, repo } }, select: { status: true } });
  if (result.status === "partial" && previous?.status === "complete") return { stored: false, result };

  const data = {
    checkedAt: new Date(),
    status: result.status,
    filesScanned: result.filesScanned,
    filesSkipped: result.filesSkipped,
    total: findings.length,
    critical: count("critical"),
    high: count("high"),
    medium: count("medium"),
    low: count("low"),
    findings: JSON.stringify(findings),
    note: result.note,
  };
  await db.repoSecrets.upsert({ where: { owner_repo: { owner, repo } }, create: { owner, repo, ...data }, update: data });
  console.log(`[secrets] ${owner}/${repo}: ${findings.length} détection(s) dans ${result.filesScanned} fichiers (${result.status})`);
  return { stored: true, result };
}

export interface SecretSummary {
  owner: string;
  repo: string;
  checkedAt: Date;
  status: string;
  filesScanned: number;
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  note: string | null;
}

export async function getSecretSummaries(repos: { owner: string; name: string }[]): Promise<Map<string, SecretSummary>> {
  if (repos.length === 0) return new Map();
  const rows = await db.repoSecrets.findMany({
    where: { OR: repos.map((r) => ({ owner: r.owner, repo: r.name })) },
    select: { owner: true, repo: true, checkedAt: true, status: true, filesScanned: true, total: true, critical: true, high: true, medium: true, low: true, note: true },
  });
  return new Map(rows.map((r) => [`${r.owner}/${r.repo}`, r]));
}

export async function getSecretFindings(owner: string, repo: string): Promise<SecretFinding[]> {
  const row = await db.repoSecrets.findUnique({ where: { owner_repo: { owner, repo } }, select: { findings: true } });
  if (!row) return [];
  try {
    return JSON.parse(row.findings) as SecretFinding[];
  } catch {
    return [];
  }
}

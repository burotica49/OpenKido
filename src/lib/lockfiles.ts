// Extraction des dépendances depuis les fichiers de verrouillage (lockfiles) et manifestes.
// Module volontairement pur (aucun accès réseau ni disque) pour être testé isolément.

export type Ecosystem = "npm" | "pip" | "go" | "cargo" | "composer" | "gem" | "maven" | "nuget";

export interface ParsedDependencies {
  name: string;
  version: string;
  ecosystem: Ecosystem;
  /** Fichier d'origine (ex. « package-lock.json », « apps/web/yarn.lock »). */
  source?: string;
  /** Absent = inconnu. */
  scope?: "prod" | "dev";
  /** Dépendance directe du projet ; absent = inconnu. */
  direct?: boolean;
  /** true = version exacte (lockfile) ; false = borne d'une plage déclarée (manifeste seul). */
  resolved: boolean;
}

const EXACT_VERSION_RE = /^v?\d+(\.\d+){0,3}([-+][0-9A-Za-z.+_-]+)?$/;

export function isExactVersion(version: unknown): version is string {
  return typeof version === "string" && EXACT_VERSION_RE.test(version.trim());
}

const stripV = (v: string) => v.trim().replace(/^v/, "");

// ─── npm ──────────────────────────────────────────────────────────────────────

interface NpmLockEntry {
  name?: string;
  version?: string;
  dev?: boolean;
  devOptional?: boolean;
  link?: boolean;
  dependencies?: Record<string, string | NpmLockV1Dep>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}
interface NpmLockV1Dep {
  version?: string;
  dev?: boolean;
  dependencies?: Record<string, NpmLockV1Dep>;
}

/** package-lock.json / npm-shrinkwrap.json (formats v1, v2 et v3). */
export function parsePackageLock(text: string, source: string): ParsedDependencies[] {
  let json: { packages?: Record<string, NpmLockEntry>; dependencies?: Record<string, NpmLockV1Dep> };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${source} : JSON invalide`);
  }
  const out: ParsedDependencies[] = [];

  if (json.packages) {
    const direct = new Set<string>();
    for (const [key, info] of Object.entries(json.packages)) {
      // La racine ("") et les espaces de travail (workspaces) déclarent des dépendances directes.
      if (key === "" || !key.includes("node_modules/")) {
        for (const group of [info.dependencies, info.devDependencies, info.optionalDependencies, info.peerDependencies]) {
          for (const name of Object.keys(group ?? {})) direct.add(name);
        }
      }
    }
    for (const [key, info] of Object.entries(json.packages)) {
      const idx = key.lastIndexOf("node_modules/");
      if (key === "" || idx === -1 || info.link) continue;
      const name = info.name ?? key.slice(idx + "node_modules/".length);
      if (!isExactVersion(info.version)) continue;
      out.push({
        name,
        version: stripV(info.version),
        ecosystem: "npm",
        source,
        scope: info.dev || info.devOptional ? "dev" : "prod",
        direct: key === `node_modules/${name}` && direct.has(name),
        resolved: true,
      });
    }
    return out;
  }

  const walk = (deps: Record<string, NpmLockV1Dep> | undefined) => {
    for (const [name, info] of Object.entries(deps ?? {})) {
      if (isExactVersion(info.version)) {
        out.push({ name, version: stripV(info.version), ecosystem: "npm", source, scope: info.dev ? "dev" : "prod", resolved: true });
      }
      walk(info.dependencies);
    }
  };
  walk(json.dependencies);
  return out;
}

/** yarn.lock (classique v1 et Berry). */
export function parseYarnLock(text: string, source: string): ParsedDependencies[] {
  const out: ParsedDependencies[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const header = lines[i];
    if (!header || header.startsWith("#") || /^\s/.test(header) || !header.endsWith(":")) continue;

    const first = header.slice(0, -1).split(",")[0].trim().replace(/^"|"$/g, "");
    const at = first.indexOf("@", 1);
    if (at === -1) continue;
    const name = first.slice(0, at);
    const range = first.slice(at + 1);
    if (/^(workspace|file|link|portal|patch|git|github|http|https|exec):/.test(range.replace(/^npm:/, "")) && !range.startsWith("npm:")) continue;

    for (let j = i + 1; j < lines.length && /^\s/.test(lines[j]); j++) {
      const m = lines[j].match(/^\s+version:?\s+"?([^"\s]+)"?\s*$/);
      if (m) {
        if (isExactVersion(m[1])) {
          const key = `${name}@${m[1]}`;
          if (!seen.has(key)) {
            seen.add(key);
            out.push({ name, version: stripV(m[1]), ecosystem: "npm", source, resolved: true });
          }
        }
        break;
      }
    }
  }
  return out;
}

/** pnpm-lock.yaml (v5, v6 et v9) — lecture de la section `packages:`. */
export function parsePnpmLock(text: string, source: string): ParsedDependencies[] {
  const out: ParsedDependencies[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  let inPackages = false;
  let current: ParsedDependencies | null = null;

  for (const line of lines) {
    if (/^\S/.test(line)) {
      inPackages = line.startsWith("packages:");
      current = null;
      continue;
    }
    if (!inPackages) continue;

    const entry = line.match(/^ {2}(\S.*):\s*$/);
    if (entry) {
      current = null;
      const key = entry[1].replace(/^['"]|['"]$/g, "").replace(/^\//, "");
      // v5 : name/1.2.3_peer (à tester en premier : le suffixe de peer contient aussi un « @ »)
      // v6/v9 : name@1.2.3(peer…)
      const m =
        key.match(/^(@[^/]+\/[^/]+|[^/@]+)\/(\d[^_(\s]*)/) ?? key.match(/^(@?[^@/]+(?:\/[^@/]+)?)@(\d[^(\s]*)/);
      if (!m) continue;
      const version = m[2].replace(/_.*$/, "");
      if (!isExactVersion(version)) continue;
      const dedupe = `${m[1]}@${version}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      current = { name: m[1], version, ecosystem: "npm", source, resolved: true };
      out.push(current);
      continue;
    }
    if (current) {
      const dev = line.match(/^ {4}dev:\s*(true|false)\s*$/);
      if (dev) current.scope = dev[1] === "true" ? "dev" : "prod";
    }
  }
  return out;
}

/** package.json : dépendances déclarées (plages) — à n'utiliser qu'en l'absence de lockfile. */
export function parsePackageJson(text: string, source: string): ParsedDependencies[] {
  let json: { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${source} : JSON invalide`);
  }
  const out: ParsedDependencies[] = [];
  const add = (group: Record<string, string> | undefined, scope: "prod" | "dev") => {
    for (const [name, raw] of Object.entries(group ?? {})) {
      const version = npmRangeLowerBound(raw);
      if (version) out.push({ name, version, ecosystem: "npm", source, scope, direct: true, resolved: isExactVersion(String(raw).trim()) });
    }
  };
  add(json.dependencies, "prod");
  add(json.optionalDependencies, "prod");
  add(json.devDependencies, "dev");
  return out;
}

/** Borne basse d'une plage npm (« ^4.17.0 » → 4.17.0). null = non analysable (git, fichier, tag…). */
export function npmRangeLowerBound(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s || /^(workspace:|file:|link:|portal:|catalog:|git\+|git:|github:|http:|https:|npm:|latest$|next$|\*$|x$)/i.test(s)) return null;
  const m = s.match(/(\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?)/);
  if (!m) return null;
  const parts = m[1].split(/[-]/)[0].split(".");
  while (parts.length < 3) parts.push("0");
  return parts.join(".") + (m[1].includes("-") ? "-" + m[1].split("-").slice(1).join("-") : "");
}

// ─── Python ───────────────────────────────────────────────────────────────────

const normalizePypi = (name: string) => name.toLowerCase().replace(/[-_.]+/g, "-");

/** requirements*.txt */
export function parseRequirements(text: string, source: string): ParsedDependencies[] {
  const out: ParsedDependencies[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].split(";")[0].trim();
    if (!line || line.startsWith("-") || /^(https?|git\+|file:)/i.test(line)) continue;
    const m = line.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(.*)$/);
    if (!m) continue;
    const spec = m[2];
    const pinned = spec.match(/(?:^|,)\s*===?\s*([0-9][0-9A-Za-z.+!_-]*)(?=\s*(?:,|$))/);
    if (pinned && !pinned[1].includes("*")) {
      out.push({ name: normalizePypi(m[1]), version: pinned[1], ecosystem: "pip", source, direct: true, resolved: true });
      continue;
    }
    const bound = spec.match(/(?:~=|>=|>)\s*([0-9][0-9A-Za-z.+!_-]*)/);
    if (bound) out.push({ name: normalizePypi(m[1]), version: bound[1], ecosystem: "pip", source, direct: true, resolved: false });
  }
  return out;
}

/** Pipfile.lock */
export function parsePipfileLock(text: string, source: string): ParsedDependencies[] {
  let json: { default?: Record<string, { version?: string }>; develop?: Record<string, { version?: string }> };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${source} : JSON invalide`);
  }
  const out: ParsedDependencies[] = [];
  for (const [group, scope] of [["default", "prod"], ["develop", "dev"]] as const) {
    for (const [name, info] of Object.entries(json[group] ?? {})) {
      const version = info.version?.replace(/^==/, "");
      if (isExactVersion(version)) out.push({ name: normalizePypi(name), version, ecosystem: "pip", source, scope, resolved: true });
    }
  }
  return out;
}

/** poetry.lock (TOML) */
export function parsePoetryLock(text: string, source: string): ParsedDependencies[] {
  const out: ParsedDependencies[] = [];
  for (const block of text.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const name = block.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    const version = block.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
    const category = block.match(/^category\s*=\s*"([^"]+)"/m)?.[1];
    if (name && isExactVersion(version)) {
      out.push({ name: normalizePypi(name), version, ecosystem: "pip", source, scope: category === "dev" ? "dev" : category === "main" ? "prod" : undefined, resolved: true });
    }
  }
  return out;
}

// ─── Go, Rust, PHP, Ruby ──────────────────────────────────────────────────────

/** go.mod */
export function parseGoMod(text: string, source: string): ParsedDependencies[] {
  const out: ParsedDependencies[] = [];
  let inBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^require\s*\($/.test(line)) { inBlock = true; continue; }
    if (inBlock && line === ")") { inBlock = false; continue; }
    const m = (inBlock ? line : line.startsWith("require ") ? line.slice(8).trim() : "").match(/^(\S+)\s+(v\S+)(\s*\/\/\s*indirect)?/);
    if (m) out.push({ name: m[1], version: stripV(m[2]), ecosystem: "go", source, direct: !m[3], resolved: true });
  }
  return out;
}

/** Cargo.lock (les paquets sans `source` sont les membres du workspace : ignorés). */
export function parseCargoLock(text: string, source: string): ParsedDependencies[] {
  const out: ParsedDependencies[] = [];
  for (const block of text.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const name = block.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
    const version = block.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
    const hasSource = /^source\s*=/m.test(block);
    if (name && hasSource && isExactVersion(version)) out.push({ name, version, ecosystem: "cargo", source, resolved: true });
  }
  return out;
}

/** composer.lock */
export function parseComposerLock(text: string, source: string): ParsedDependencies[] {
  let json: { packages?: { name: string; version: string }[]; "packages-dev"?: { name: string; version: string }[] };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${source} : JSON invalide`);
  }
  const out: ParsedDependencies[] = [];
  for (const [list, scope] of [[json.packages, "prod"], [json["packages-dev"], "dev"]] as const) {
    for (const p of list ?? []) {
      if (isExactVersion(p.version)) out.push({ name: p.name, version: stripV(p.version), ecosystem: "composer", source, scope, resolved: true });
    }
  }
  return out;
}

/** Gemfile.lock */
export function parseGemfileLock(text: string, source: string): ParsedDependencies[] {
  const out: ParsedDependencies[] = [];
  let inSpecs = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) { inSpecs = false; continue; }
    if (/^ {2}specs:\s*$/.test(line)) { inSpecs = true; continue; }
    if (!inSpecs) continue;
    const m = line.match(/^ {4}([A-Za-z0-9_.-]+) \((\d[^)]*)\)\s*$/);
    if (m) {
      const version = m[2].match(/^\d+(?:\.\d+)*(?:\.[A-Za-z0-9]+)*/)?.[0];
      if (version) out.push({ name: m[1], version, ecosystem: "gem", source, resolved: true });
    }
  }
  return out;
}

// ─── SBOM GitHub (SPDX) ───────────────────────────────────────────────────────

const PURL_ECOSYSTEM: Record<string, Ecosystem> = {
  npm: "npm", pypi: "pip", golang: "go", cargo: "cargo", composer: "composer", gem: "gem", maven: "maven", nuget: "nuget",
};

interface SpdxPackage {
  SPDXID: string;
  name?: string;
  versionInfo?: string;
  externalRefs?: { referenceType?: string; referenceLocator?: string }[];
}
interface SpdxBody {
  packages?: SpdxPackage[];
  relationships?: { spdxElementId: string; relatedSpdxElement: string; relationshipType: string }[];
}
/** Ancienne API synchrone : document sous `sbom` ; nouvelle API asynchrone : document à la racine. */
export type SpdxDocument = SpdxBody & { sbom?: SpdxBody };

/** Document SPDX renvoyé par l'API SBOM de GitHub (formes synchrone et asynchrone). */
export function parseSbom(doc: SpdxDocument, source = "SBOM GitHub"): ParsedDependencies[] {
  const body: SpdxBody = doc.sbom ?? doc;
  const packages = body.packages ?? [];
  const relationships = body.relationships ?? [];
  const described = new Set(relationships.filter((r) => r.relationshipType === "DESCRIBES").map((r) => r.relatedSpdxElement));
  const directIds = new Set(relationships.filter((r) => r.relationshipType === "DEPENDS_ON" && described.has(r.spdxElementId)).map((r) => r.relatedSpdxElement));

  const out: ParsedDependencies[] = [];
  for (const p of packages) {
    if (described.has(p.SPDXID)) continue; // le dépôt lui-même
    const locator = p.externalRefs?.find((r) => r.referenceType === "purl")?.referenceLocator;
    if (!locator) continue;
    let decoded: string;
    try {
      decoded = decodeURIComponent(locator);
    } catch {
      continue;
    }
    const m = decoded.match(/^pkg:([a-z]+)\/(.+?)(?:@([^@?#]+))?(?:[?#].*)?$/);
    if (!m) continue;
    const ecosystem = PURL_ECOSYSTEM[m[1]];
    const version = m[3];
    if (!ecosystem || !version) continue;
    const name = ecosystem === "maven" ? m[2].replace("/", ":") : m[2];
    out.push({ name, version: stripV(version), ecosystem, source, direct: directIds.has(p.SPDXID), resolved: isExactVersion(version) });
  }
  return out;
}

// ─── Fusion ───────────────────────────────────────────────────────────────────

/** Fusionne les doublons (même écosystème, nom, version) ; une source « exacte » prime sur une plage. */
export function dedupeDeps(deps: ParsedDependencies[]): ParsedDependencies[] {
  const map = new Map<string, ParsedDependencies>();
  for (const dep of deps) {
    const key = `${dep.ecosystem}:${dep.name}@${dep.version}`;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...dep });
      continue;
    }
    const sources = new Set([...(existing.source?.split(", ") ?? []), ...(dep.source?.split(", ") ?? [])].filter(Boolean));
    existing.source = [...sources].join(", ") || undefined;
    existing.resolved = existing.resolved || dep.resolved;
    existing.direct = existing.direct || dep.direct || undefined;
    // « prod » l'emporte sur « dev » (la dépendance est livrée dès qu'un chemin l'est)
    if (existing.scope === "dev" && dep.scope === "prod") existing.scope = "prod";
    else if (!existing.scope) existing.scope = dep.scope;
  }
  return [...map.values()];
}

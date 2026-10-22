// Détection de secrets dans le texte des fichiers d'un dépôt. Module pur (aucun accès réseau ni disque).
// Une valeur détectée n'est JAMAIS conservée : seuls un aperçu masqué et une empreinte (hachage tronqué) le sont.
import { createHash } from "node:crypto";

export type SecretSeverity = "critical" | "high" | "medium" | "low";

export interface SecretFinding {
  ruleId: string;
  name: string;
  severity: SecretSeverity;
  path: string;
  line: number;
  /** Aperçu masqué : jamais la valeur complète. */
  preview: string;
  /** Empreinte stable (règle + chemin + valeur) pour ignorer/reporter sans stocker le secret. */
  fingerprint: string;
}

interface Rule {
  id: string;
  name: string;
  severity: SecretSeverity;
  regex: RegExp;
  /** Groupe de capture contenant la valeur (0 = toute la correspondance). */
  group?: number;
  /** Entropie de Shannon minimale de la valeur (règles génériques). */
  minEntropy?: number;
  /** Format propre à un fournisseur (peu de faux positifs) ; sinon règle générique, ignorée dans les tests/docs. */
  specific: boolean;
}

const RULES: Rule[] = [
  { id: "aws-access-key", name: "Clé d'accès AWS", severity: "critical", regex: /\b((?:AKIA|ASIA)[0-9A-Z]{16})\b/g, group: 1, specific: true },
  { id: "aws-secret-key", name: "Clé secrète AWS", severity: "critical", regex: /aws[_-]?secret[_-]?access[_-]?key["']?\s*[:=]\s*["']?([A-Za-z0-9/+=]{40})\b/gi, group: 1, specific: true },
  { id: "github-token", name: "Jeton GitHub", severity: "critical", regex: /\b(gh[pousr]_[A-Za-z0-9]{36,255})\b/g, group: 1, specific: true },
  { id: "github-pat", name: "Jeton GitHub (fine-grained)", severity: "critical", regex: /\b(github_pat_[A-Za-z0-9_]{50,255})\b/g, group: 1, specific: true },
  { id: "private-key", name: "Clé privée", severity: "critical", regex: /(-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----)/g, group: 1, specific: true },
  { id: "slack-token", name: "Jeton Slack", severity: "high", regex: /\b(xox[baprs]-[A-Za-z0-9-]{10,72})\b/g, group: 1, specific: true },
  { id: "slack-webhook", name: "Webhook Slack", severity: "high", regex: /(https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{20,})/g, group: 1, specific: true },
  { id: "stripe-live-key", name: "Clé Stripe (production)", severity: "critical", regex: /\b((?:sk|rk)_live_[0-9a-zA-Z]{20,99})\b/g, group: 1, specific: true },
  { id: "google-api-key", name: "Clé d'API Google", severity: "high", regex: /\b(AIza[0-9A-Za-z_-]{35})\b/g, group: 1, specific: true },
  { id: "anthropic-key", name: "Clé d'API Anthropic", severity: "critical", regex: /\b(sk-ant-[A-Za-z0-9_-]{30,200})\b/g, group: 1, specific: true },
  { id: "openai-key", name: "Clé d'API OpenAI", severity: "critical", regex: /\b(sk-(?:proj-)?[A-Za-z0-9_-]{40,200})\b/g, group: 1, minEntropy: 3.5, specific: true },
  { id: "npm-token", name: "Jeton npm", severity: "critical", regex: /\b(npm_[A-Za-z0-9]{36})\b/g, group: 1, specific: true },
  { id: "sendgrid-key", name: "Clé SendGrid", severity: "high", regex: /\b(SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})\b/g, group: 1, specific: true },
  { id: "supabase-token", name: "Jeton d'accès Supabase", severity: "high", regex: /\b(sbp_[0-9a-f]{40})\b/g, group: 1, specific: true },
  { id: "db-connection", name: "Identifiants dans une URL de base de données", severity: "high", regex: /\b((?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqps?):\/\/[^\s:/@'"`<>]+:([^\s@'"`<>]{4,})@[^\s'"`<>]+)/gi, group: 2, specific: true },
  {
    id: "generic-secret",
    name: "Secret potentiel (mot de passe, clé ou jeton en clair)",
    severity: "medium",
    regex: /\b[A-Za-z0-9_.-]*(?:secret|passwd|password|pwd|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|private[_-]?key|client[_-]?secret)[A-Za-z0-9_.-]*["']?\s*[:=]\s*["']([^"'\s]{12,})["']/gi,
    group: 1,
    minEntropy: 3.6,
    specific: false,
  },
];

const PLACEHOLDER = /example|placeholder|change[-_]?me|your[-_ ]|<[^>]*>|x{4,}|\*{3,}|dummy|sample|fake|todo|lorem|redacted|\$\{|\{\{|%\(|process\.env|os\.environ|getenv|env\[|secrets\.|\bnull\b|undefined|password123|random|#{3}|^(?:true|false|postgres|root|admin|password|secret|mysql|redis|guest|user|test|pass|123456)$/i;

export function shannonEntropy(s: string): number {
  if (!s) return 0;
  const freq = new Map<string, number>();
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of freq.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

export function looksLikePlaceholder(value: string): boolean {
  if (PLACEHOLDER.test(value)) return true;
  // Une seule lettre répétée ou une suite triviale
  if (/^(.)\1+$/.test(value) || /^(?:0123456789|abcdef|123456)/i.test(value)) return true;
  return false;
}

/** Chemins de tests, documentation et exemples : les secrets y sont presque toujours factices. */
export function isTestOrDocPath(path: string): boolean {
  return /(^|\/)(tests?|__tests__|spec|specs|fixtures?|mocks?|__mocks__|examples?|samples?|docs?|e2e|cypress)(\/|$)|\.(test|spec|stories)\.[a-z]+$|\.(md|mdx|rst|txt)$|\.example$|\.sample$|\.template$/i.test(path);
}

const SKIP_DIR = /(^|\/)(node_modules|vendor|dist|build|out|\.next|\.nuxt|\.git|coverage|__snapshots__|\.venv|venv|site-packages|\.gradle|Pods|target\/(debug|release))(\/|$)/;
const SKIP_FILE = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Cargo\.lock|poetry\.lock|Pipfile\.lock|Gemfile\.lock|go\.sum)$|\.min\.(js|css)$|\.map$|\.(png|jpe?g|gif|webp|ico|icns|svg|bmp|tiff?|pdf|zip|gz|tgz|bz2|xz|7z|rar|jar|war|class|so|dylib|dll|exe|bin|wasm|woff2?|ttf|otf|eot|mp[34]|mov|avi|webm|ogg|wav|psd|sketch|db|sqlite3?|pyc|o|a)$/i;

/** Faut-il lire ce fichier ? (hors dépendances, artefacts de build, binaires et lockfiles). */
export function isScannablePath(path: string): boolean {
  return !SKIP_DIR.test(path) && !SKIP_FILE.test(path);
}

export function looksBinary(buf: Uint8Array): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

const MAX_LINE_LENGTH = 2000;

function mask(rule: Rule, value: string, match: string): string {
  if (rule.id === "private-key") return value;
  if (rule.id === "db-connection") return match.replace(value, "••••").slice(0, 120);
  return `${value.slice(0, 4)}••••••••`;
}

/** Cherche des secrets dans le texte d'un fichier. */
export function scanText(path: string, text: string): SecretFinding[] {
  const out: SecretFinding[] = [];
  const testPath = isTestOrDocPath(path);
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > MAX_LINE_LENGTH) continue;
    for (const rule of RULES) {
      if (rule.specific === false && testPath) continue;
      rule.regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rule.regex.exec(line)) !== null) {
        const value = m[rule.group ?? 0];
        if (!value) continue;
        if (looksLikePlaceholder(value)) continue;
        if (rule.minEntropy && shannonEntropy(value) < rule.minEntropy) continue;
        const fingerprint = createHash("sha256").update(`${rule.id}\0${path}\0${value}`).digest("hex").slice(0, 12);
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);
        // Les formats propres à un fournisseur trouvés dans des tests/docs restent signalés, mais moins fort.
        const severity: SecretSeverity = testPath && rule.severity !== "low" ? (rule.severity === "critical" ? "high" : "medium") : rule.severity;
        out.push({ ruleId: rule.id, name: rule.name, severity, path, line: i + 1, preview: mask(rule, value, m[0]), fingerprint });
      }
    }
  }
  return out;
}

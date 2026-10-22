import "server-only";
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

/** Cible refusée : nom invalide, adresse non publique, schéma/port interdit… */
export class UnsafeTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeTargetError";
  }
}

// Plages qui ne doivent jamais être jointes depuis le serveur (loopback, privé, link-local /
// métadonnées cloud, CGNAT, documentation, multicast, réservé, IPv6 locaux et mappés/traduits).
const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(addr, prefix, "ipv4");
// Attention : ne PAS ajouter ::ffff:0:0/96 ici. net.BlockList compare les IPv4 comme des
// adresses IPv4-mappées, cette règle bloquerait donc toutes les IPv4. Les adresses
// IPv4-mappées sont traitées explicitement dans isPublicAddress().
for (const [addr, prefix] of [
  ["::", 96], ["64:ff9b::", 96], ["100::", 64], ["2001::", 32], ["2001:db8::", 32],
  ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(addr, prefix, "ipv6");

/** Octets d'une adresse IPv6 textuelle (formes compressées et suffixe IPv4 « ::ffff:1.2.3.4 »). */
function parseIpv6(input: string): number[] | null {
  let ip = input.split("%")[0];
  let tail4: number[] | null = null;
  const dotted = ip.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const octets = dotted[2].split(".").map(Number);
    if (octets.some((n) => n > 255)) return null;
    tail4 = octets;
    ip = `${dotted[1]}0:0`;
  }
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  const groups = [...head, ...Array<string>(fill).fill("0"), ...rest];
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    const v = parseInt(g, 16);
    bytes.push(v >> 8, v & 0xff);
  }
  if (tail4) bytes.splice(12, 4, ...tail4);
  return bytes;
}

/** `::ffff:a.b.c.d` (ou `::ffff:7f00:1`) → `a.b.c.d`, sinon null. */
function mappedIpv4(ip: string): string | null {
  const b = parseIpv6(ip);
  if (!b) return null;
  for (let i = 0; i < 10; i++) if (b[i] !== 0) return null;
  if (b[10] !== 0xff || b[11] !== 0xff) return null;
  return `${b[12]}.${b[13]}.${b[14]}.${b[15]}`;
}

export function isPublicAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 0) return false;
  if (family === 6) {
    const v4 = mappedIpv4(ip);
    if (v4) return isPublicAddress(v4);
  }
  return !blocked.check(ip, family === 4 ? "ipv4" : "ipv6");
}

const LABEL_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const FORBIDDEN_SUFFIXES = [".local", ".localhost", ".internal", ".lan", ".home", ".corp", ".intranet"];

/** Nettoie une saisie (« https://Exemple.com/chemin ») et ne garde qu'un nom DNS valide. */
export function normalizeHostname(input: string): string {
  if (typeof input !== "string") throw new UnsafeTargetError("Domaine invalide");
  let host = input.trim().toLowerCase().replace(/^https?:\/\//, "");
  host = host.split(/[/?#]/)[0];
  if (host.endsWith(".")) host = host.slice(0, -1);

  if (!host || host.length > 253) throw new UnsafeTargetError("Domaine invalide");
  if (host.includes("@") || host.includes(":") || host.includes("[")) {
    throw new UnsafeTargetError("Identifiants et ports ne sont pas autorisés");
  }
  if (net.isIP(host)) throw new UnsafeTargetError("Les adresses IP ne sont pas autorisées");

  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL_RE.test(l))) {
    throw new UnsafeTargetError("Domaine invalide");
  }
  const tld = labels[labels.length - 1];
  if (!/^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld)) throw new UnsafeTargetError("Domaine invalide");
  if (FORBIDDEN_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new UnsafeTargetError("Domaine interne non autorisé");
  }
  return host;
}

export interface ResolvedTarget {
  hostname: string;
  address: string;
  family: 4 | 6;
}

/** Résout le DNS et refuse la cible si UNE SEULE des adresses est non publique. */
export async function resolvePublicTarget(input: string): Promise<ResolvedTarget> {
  const hostname = normalizeHostname(input);
  const addrs = await dns.lookup(hostname, { all: true, verbatim: true });
  if (addrs.length === 0) throw new UnsafeTargetError("Aucune adresse pour ce domaine");
  for (const a of addrs) {
    if (!isPublicAddress(a.address)) {
      throw new UnsafeTargetError("Ce domaine pointe vers une adresse non publique");
    }
  }
  return { hostname, address: addrs[0].address, family: addrs[0].family as 4 | 6 };
}

export interface PinnedResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  address: string;
}

/**
 * Une requête, sans suivre les redirections, connectée directement à l'IP validée
 * (SNI et en-tête Host = nom d'origine) : aucune seconde résolution DNS n'est possible.
 */
export async function pinnedRequest(
  urlString: string,
  opts: { timeoutMs?: number } = {}
): Promise<PinnedResponse> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new UnsafeTargetError("URL invalide");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeTargetError("Schéma interdit");
  if (url.username || url.password) throw new UnsafeTargetError("Identifiants non autorisés");
  if (url.port) throw new UnsafeTargetError("Port non autorisé");

  const target = await resolvePublicTarget(url.hostname);
  const lib = url.protocol === "https:" ? https : http;
  const timeoutMs = opts.timeoutMs ?? 8000;

  return new Promise<PinnedResponse>((resolve, reject) => {
    const req = lib.request(
      {
        host: target.address,
        family: target.family,
        port: url.protocol === "https:" ? 443 : 80,
        method: "GET",
        path: `${url.pathname}${url.search}`,
        headers: { Host: target.hostname, "User-Agent": "Openkido-DomainCheck/1.0", Accept: "*/*" },
        ...(url.protocol === "https:" ? { servername: target.hostname } : {}),
      },
      (res) => {
        // Seuls les en-têtes nous intéressent : on ne télécharge jamais le corps.
        const result = { status: res.statusCode ?? 0, headers: res.headers, address: target.address };
        res.destroy();
        req.destroy();
        resolve(result);
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

/** GET avec au plus `maxRedirects` redirections, chaque saut étant revalidé. */
export async function fetchHeadersFollowing(
  urlString: string,
  maxRedirects = 3
): Promise<PinnedResponse> {
  let current = urlString;
  for (let hop = 0; ; hop++) {
    const res = await pinnedRequest(current);
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location && hop < maxRedirects) {
      current = new URL(location, current).toString();
      continue;
    }
    return res;
  }
}

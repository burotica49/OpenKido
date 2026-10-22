import "server-only";
import * as tls from "node:tls";
import { db } from "./db";
import {
  UnsafeTargetError,
  fetchHeadersFollowing,
  normalizeHostname,
  pinnedRequest,
  resolvePublicTarget,
  type ResolvedTarget,
} from "./net-guard";

export interface DomainCheckResult {
  domain: string;
  checkedAt: Date;
  httpStatus: number | null;
  httpsRedirect: boolean;
  ipAddress: string | null;
  sslValid: boolean | null;
  sslExpiry: Date | null;
  sslIssuer: string | null;
  sslDaysLeft: number | null;
  hasHsts: boolean;
  hasCsp: boolean;
  hasXFrame: boolean;
  hasXContent: boolean;
  hasRp: boolean;
}

interface SslInfo {
  valid: boolean;
  expiry: Date | null;
  issuer: string | null;
  daysLeft: number | null;
}

const SSL_UNKNOWN: SslInfo = { valid: false, expiry: null, issuer: null, daysLeft: null };

// On se connecte à l'IP déjà validée (anti-rebinding) avec le nom d'hôte en SNI.
// `rejectUnauthorized: false` sert uniquement à pouvoir inspecter un certificat invalide ;
// la validité est ensuite jugée sur `socket.authorized` (chaîne de confiance + nom d'hôte).
function checkSsl(target: ResolvedTarget): Promise<SslInfo> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host: target.address, port: 443, servername: target.hostname, rejectUnauthorized: false },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          const authorized = socket.authorized;
          socket.destroy();
          if (!cert || !cert.valid_to) {
            resolve(SSL_UNKNOWN);
            return;
          }
          const expiry = new Date(cert.valid_to);
          const daysLeft = Math.floor((expiry.getTime() - Date.now()) / 86400000);
          const rawO = cert.issuer?.O;
          const rawCN = cert.issuer?.CN;
          const issuer =
            (Array.isArray(rawO) ? rawO[0] : rawO) ?? (Array.isArray(rawCN) ? rawCN[0] : rawCN) ?? null;
          resolve({ valid: authorized && daysLeft >= 0, expiry, issuer, daysLeft });
        } catch {
          socket.destroy();
          resolve(SSL_UNKNOWN);
        }
      }
    );
    socket.setTimeout(8000, () => {
      socket.destroy();
      resolve(SSL_UNKNOWN);
    });
    socket.on("error", () => resolve(SSL_UNKNOWN));
  });
}

/** Vérifie un domaine (SSL, redirection HTTPS, en-têtes de sécurité) et enregistre le résultat. */
export async function checkDomain(domain: string): Promise<DomainCheckResult> {
  const hostname = normalizeHostname(domain);

  let target: ResolvedTarget | null = null;
  try {
    target = await resolvePublicTarget(hostname);
  } catch (error) {
    // Une cible dangereuse est refusée ; un simple échec DNS est enregistré comme « injoignable ».
    if (error instanceof UnsafeTargetError) throw error;
  }

  let ssl = SSL_UNKNOWN;
  let httpStatus: number | null = null;
  let httpsRedirect = false;
  let hasHsts = false;
  let hasCsp = false;
  let hasXFrame = false;
  let hasXContent = false;
  let hasRp = false;

  if (target) {
    ssl = await checkSsl(target);

    try {
      const res = await pinnedRequest(`http://${hostname}`);
      const location = res.headers.location ?? "";
      httpsRedirect = res.status >= 300 && res.status < 400 && location.startsWith("https://");
    } catch {}

    try {
      const res = await fetchHeadersFollowing(`https://${hostname}`);
      httpStatus = res.status;
      hasHsts = "strict-transport-security" in res.headers;
      hasCsp = "content-security-policy" in res.headers;
      hasXFrame = "x-frame-options" in res.headers;
      hasXContent = "x-content-type-options" in res.headers;
      hasRp = "referrer-policy" in res.headers;
    } catch {}
  }

  const result: DomainCheckResult = {
    domain: hostname,
    checkedAt: new Date(),
    httpStatus,
    httpsRedirect,
    ipAddress: target?.address ?? null,
    sslValid: target ? ssl.valid : null,
    sslExpiry: ssl.expiry,
    sslIssuer: ssl.issuer,
    sslDaysLeft: ssl.daysLeft,
    hasHsts,
    hasCsp,
    hasXFrame,
    hasXContent,
    hasRp,
  };

  const { domain: _d, ...rest } = result;
  await db.domain.upsert({
    where: { domain: hostname },
    create: { domain: hostname, ...rest },
    update: { ...rest },
  });

  return result;
}

export async function listDomains() {
  return db.domain.findMany({ orderBy: { addedAt: "desc" } });
}

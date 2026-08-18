"use server";

import * as tls from "tls";
import * as dns from "dns/promises";
import { db } from "./db";

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

async function checkSsl(hostname: string): Promise<{
  valid: boolean;
  expiry: Date | null;
  issuer: string | null;
  daysLeft: number | null;
}> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host: hostname, port: 443, servername: hostname, rejectUnauthorized: false },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          socket.destroy();
          if (!cert || !cert.valid_to) {
            resolve({ valid: false, expiry: null, issuer: null, daysLeft: null });
            return;
          }
          const expiry = new Date(cert.valid_to);
          const daysLeft = Math.floor((expiry.getTime() - Date.now()) / 86400000);
          const rawO = cert.issuer?.O;
          const rawCN = cert.issuer?.CN;
          const issuer = (Array.isArray(rawO) ? rawO[0] : rawO) ?? (Array.isArray(rawCN) ? rawCN[0] : rawCN) ?? null;
          resolve({ valid: socket.authorized || daysLeft > 0, expiry, issuer, daysLeft });
        } catch {
          socket.destroy();
          resolve({ valid: false, expiry: null, issuer: null, daysLeft: null });
        }
      }
    );
    socket.setTimeout(8000, () => {
      socket.destroy();
      resolve({ valid: false, expiry: null, issuer: null, daysLeft: null });
    });
    socket.on("error", () => {
      resolve({ valid: false, expiry: null, issuer: null, daysLeft: null });
    });
  });
}

async function resolveIp(hostname: string): Promise<string | null> {
  try {
    const addrs = await dns.resolve4(hostname);
    return addrs[0] ?? null;
  } catch {
    return null;
  }
}

export async function checkDomain(domain: string): Promise<DomainCheckResult> {
  const hostname = domain.replace(/^https?:\/\//, "").split("/")[0];

  const [ssl, ip] = await Promise.all([
    checkSsl(hostname),
    resolveIp(hostname),
  ]);

  let httpStatus: number | null = null;
  let httpsRedirect = false;
  let hasHsts = false;
  let hasCsp = false;
  let hasXFrame = false;
  let hasXContent = false;
  let hasRp = false;

  // Check HTTP → HTTPS redirect
  try {
    const httpRes = await fetch(`http://${hostname}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    const location = httpRes.headers.get("location") ?? "";
    httpsRedirect = httpRes.status >= 300 && httpRes.status < 400 && location.startsWith("https://");
  } catch {}

  // Check HTTPS headers
  try {
    const res = await fetch(`https://${hostname}`, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    httpStatus = res.status;
    hasHsts    = res.headers.has("strict-transport-security");
    hasCsp     = res.headers.has("content-security-policy");
    hasXFrame  = res.headers.has("x-frame-options");
    hasXContent = res.headers.has("x-content-type-options");
    hasRp      = res.headers.has("referrer-policy");
  } catch {}

  const result: DomainCheckResult = {
    domain: hostname,
    checkedAt: new Date(),
    httpStatus,
    httpsRedirect,
    ipAddress: ip,
    sslValid: ssl.valid,
    sslExpiry: ssl.expiry,
    sslIssuer: ssl.issuer,
    sslDaysLeft: ssl.daysLeft,
    hasHsts,
    hasCsp,
    hasXFrame,
    hasXContent,
    hasRp,
  };

  // Persist
  const { domain: _d, ...rest } = result;
  await db.domain.upsert({
    where: { domain: hostname },
    create: { domain: hostname, ...rest },
    update: { ...rest },
  });

  return result;
}

export async function addDomain(domain: string) {
  const hostname = domain.replace(/^https?:\/\//, "").split("/")[0].toLowerCase().trim();
  if (!hostname || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(hostname)) {
    throw new Error("Domaine invalide");
  }
  await db.domain.upsert({
    where: { domain: hostname },
    create: { domain: hostname },
    update: {},
  });
  return checkDomain(hostname);
}

export async function deleteDomain(domain: string) {
  await db.domain.delete({ where: { domain } }).catch(() => {});
}

export async function recheckDomain(domain: string) {
  return checkDomain(domain);
}

export async function listDomains() {
  return db.domain.findMany({ orderBy: { addedAt: "desc" } });
}

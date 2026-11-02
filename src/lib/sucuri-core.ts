// Normalisation de la réponse de Sucuri SiteCheck (https://sitecheck.sucuri.net/api/v3/). Module pur.
// L'API n'est pas documentée officiellement : la structure ci-dessous a été relevée sur des sites réels, et
// tout champ inattendu est ignoré plutôt que d'échouer. Une réponse illisible n'est jamais présentée comme « saine ».

export interface SitecheckRecommendation {
  id: string;
  /** Domaine concerné : tls, headers, security… */
  area: string;
  level: "major" | "minor";
  title: string;
  details?: string;
}

export interface SitecheckOutdated {
  name: string;
  version?: string;
  safeVersion?: string;
  url?: string;
}

export interface SitecheckAlert {
  kind: "malware" | "blacklist" | "other";
  title: string;
  details?: string;
}

export interface SitecheckResult {
  scannedAt: string;
  ratings: { total?: string; security?: string; domain?: string; tls?: string };
  passed: { security?: string; domain?: string; tls?: string };
  site: { ips: string[]; hosting: string[]; server: string[]; poweredBy: string[]; finalUrl?: string };
  cms: { name: string; version?: string }[];
  language: { name: string; version?: string }[];
  outdated: SitecheckOutdated[];
  recommendations: SitecheckRecommendation[];
  /** Malware, listes noires et autres avertissements remontés par Sucuri. */
  alerts: SitecheckAlert[];
  tls: { issuer?: string; expires?: string };
}

const LABELS: Record<string, string> = {
  csp: "Directives CSP manquantes",
  no_csp: "En-tête Content-Security-Policy manquant",
  x_frame_options: "X-Frame-Options manquant (protection contre le clickjacking)",
  x_content_type_options: "X-Content-Type-Options manquant",
  strict_transport_security: "Strict-Transport-Security (HSTS) manquant",
  referrer_policy: "Referrer-Policy manquant",
  leaked_php_version: "Version de PHP divulguée dans les en-têtes HTTP (désactiver expose_php)",
  no_redirect_to_https: "Pas de redirection automatique vers HTTPS",
  needs_waf: "Aucun pare-feu applicatif (WAF) détecté",
  no_stapled_ocsp: "OCSP stapling non activé",
};

const clean = (v: unknown, max = 200): string | undefined => {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
  return s || undefined;
};
const strings = (v: unknown, max = 10): string[] => (Array.isArray(v) ? v.map((x) => clean(x)).filter((x): x is string => !!x).slice(0, max) : []);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const humanize = (id: string) => { const t = id.replace(/_/g, " ").trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
const letter = (v: unknown) => { const s = clean(v, 3); return s && /^[A-F][+-]?$/.test(s) ? s : undefined; };

function recommendations(raw: unknown): SitecheckRecommendation[] {
  if (!isObj(raw)) return [];
  const out: SitecheckRecommendation[] = [];
  for (const [group, items] of Object.entries(raw)) {
    const m = /^(.+)_(major|minor)$/.exec(group);
    if (!m || !isObj(items)) continue;
    for (const [id, value] of Object.entries(items)) {
      if (!/^[a-z0-9_]{1,60}$/.test(id)) continue;
      const details = isObj(value) ? clean(value.details) : undefined;
      out.push({ id, area: m[1], level: m[2] as "major" | "minor", title: LABELS[id] ?? humanize(id), ...(details ? { details } : {}) });
    }
  }
  // Majeures d'abord
  return out.sort((a, b) => Number(a.level === "minor") - Number(b.level === "minor")).slice(0, 40);
}

function alertKind(key: string): SitecheckAlert["kind"] {
  if (/malware|infect|injected|defac|spam|phish/i.test(key)) return "malware";
  if (/black/i.test(key)) return "blacklist";
  return "other";
}

/** Avertissements autres que « logiciel obsolète » : malware, listes noires… (relevés seulement quand présents). */
function alerts(raw: Record<string, unknown>): SitecheckAlert[] {
  const out: SitecheckAlert[] = [];
  const push = (key: string, value: unknown) => {
    const kind = alertKind(key);
    const items = Array.isArray(value) ? value : value ? [value] : [];
    for (const item of items.slice(0, 10)) {
      const o = isObj(item) ? item : {};
      const title = clean(o.msg) ?? clean(o.message) ?? clean(o.title) ?? clean(o.name) ?? clean(item) ?? humanize(key);
      const details = clean(o.details) ?? clean(o.url) ?? clean(o.info);
      out.push({ kind, title: title as string, ...(details && details !== title ? { details } : {}) });
    }
  };
  if (isObj(raw.warnings)) for (const [key, value] of Object.entries(raw.warnings)) if (key !== "outdated") push(key, value);
  for (const key of ["malware", "blacklists", "blacklist"]) if (raw[key] && (!Array.isArray(raw[key]) || (raw[key] as unknown[]).length > 0)) push(key, raw[key]);
  return out.slice(0, 20);
}

/** Convertit la réponse brute en résultat typé ; `null` si elle ne ressemble pas à un résultat SiteCheck. */
export function normalizeSitecheck(raw: unknown): SitecheckResult | null {
  if (!isObj(raw) || !isObj(raw.site) && !isObj(raw.ratings)) return null;
  const site = isObj(raw.site) ? raw.site : {};
  const ratings = isObj(raw.ratings) ? raw.ratings : {};
  const rate = (k: string) => (isObj(ratings[k]) ? letter((ratings[k] as Record<string, unknown>).rating) : undefined);
  const passed = (k: string) => (isObj(ratings[k]) ? clean((ratings[k] as Record<string, unknown>).passed, 12) : undefined);
  const software = isObj(raw.software) ? raw.software : {};
  const named = (v: unknown) => (Array.isArray(v) ? v.filter(isObj).map((o) => ({ name: clean(o.name), version: clean(o.version, 40) })).filter((x): x is { name: string; version: string | undefined } => !!x.name).slice(0, 10) : []);
  const warnings = isObj(raw.warnings) ? raw.warnings : {};
  const outdated = Array.isArray(warnings.outdated)
    ? warnings.outdated.filter(isObj).map((o) => {
        const url = clean(o.upgrade_url, 300);
        return { name: clean(o.name) ?? "Logiciel", version: clean(o.version, 40), safeVersion: clean(o.safe_version, 40), ...(url && /^https?:\/\//.test(url) ? { url } : {}) };
      }).slice(0, 10)
    : [];
  const tls = isObj(raw.tls) ? raw.tls : {};
  const scan = isObj(raw.scan) ? raw.scan : {};

  const result: SitecheckResult = {
    scannedAt: clean(scan.last_scan, 40) ?? new Date().toISOString(),
    ratings: { total: rate("total"), security: rate("security"), domain: rate("domain"), tls: rate("tls") },
    passed: { security: passed("security"), domain: passed("domain"), tls: passed("tls") },
    site: { ips: strings(site.ip), hosting: strings(site.hosting), server: strings(site.running_on), poweredBy: strings(site.powered_by), finalUrl: clean(site.final_url, 300) },
    cms: named(software.cms),
    language: named(software.language),
    outdated,
    recommendations: recommendations(raw.recommendations),
    alerts: alerts(raw),
    tls: { issuer: clean(tls.cert_issuer), expires: clean(tls.cert_expires, 40) },
  };
  // Aucune information exploitable : on ne la présente pas comme un résultat.
  const hasData = Object.values(result.ratings).some(Boolean) || result.outdated.length > 0 || result.recommendations.length > 0 || result.cms.length > 0;
  return hasData ? result : null;
}

// Classification des licences de dépendances (expressions SPDX). Module pur.
import type { IssueSeverity } from "./issues-core";

export type LicenseVerdict =
  | { risk: "ok" }
  /** Licence non reconnue ou non renseignée dans la source : on ne juge pas. */
  | { risk: "unknown" }
  /** Le paquet ne déclare aucune licence : tous droits réservés par défaut. */
  | { risk: "none"; severity: IssueSeverity; label: string; why: string }
  | { risk: "restricted"; severity: IssueSeverity; label: string; why: string };

const RANK: Record<IssueSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

interface Family {
  test: RegExp;
  severity: IssueSeverity | null; // null = permissive
  label: string;
  why: string;
}

// Ordre : du plus restrictif au plus permissif (la première règle qui correspond l'emporte).
const FAMILIES: Family[] = [
  { test: /^AGPL/i, severity: "high", label: "AGPL", why: "Copyleft réseau : si le logiciel est proposé en service en ligne, son code source complet doit être publié." },
  { test: /^SSPL/i, severity: "high", label: "SSPL", why: "Licence non libre : proposer le logiciel en service impose de publier toute l'infrastructure associée." },
  { test: /^(CC-BY-NC|CC-BY-NC-|POLYFORM-NONCOMMERCIAL|COMMONS-CLAUSE)/i, severity: "high", label: "Usage non commercial", why: "L'usage commercial est interdit ou restreint." },
  { test: /^(BUSL|ELASTIC|CONFLUENT|BUSINESS-SOURCE)/i, severity: "medium", label: "Source disponible", why: "Licence non open source : l'usage en production ou en service peut être restreint." },
  { test: /^LGPL/i, severity: "low", label: "LGPL", why: "Copyleft faible : modifier la bibliothèque oblige à publier ces modifications ; l'utiliser telle quelle est en général permis." },
  { test: /^GPL/i, severity: "medium", label: "GPL", why: "Copyleft fort : un logiciel qui l'intègre et est distribué doit lui-même être publié sous GPL." },
  { test: /^(MPL|EPL|CDDL|CPL|EUPL|OSL)/i, severity: "low", label: "Copyleft faible", why: "Les modifications des fichiers concernés doivent être partagées." },
  { test: /^(MIT|ISC|BSD|APACHE|0BSD|UNLICENSE|CC0|ZLIB|PYTHON|PSF|BLUEOAK|WTFPL|ARTISTIC|OFL|W3C|X11|CC-BY|NCSA|BOOST|BSL-1|UPL|HPND|LIBPNG|JSON|PUBLIC)/i, severity: null, label: "Permissive", why: "" },
];

function normalizeId(id: string): string {
  return id.trim().replace(/^\(+|\)+$/g, "").replace(/\+$/, "").replace(/-(only|or-later)$/i, "");
}

function classifyId(raw: string): { severity: IssueSeverity | null; label: string; why: string } | "unknown" {
  const id = normalizeId(raw.split(/\s+WITH\s+/i)[0]);
  const withException = /\s+WITH\s+/i.test(raw) || /classpath-exception/i.test(raw);
  const family = FAMILIES.find((f) => f.test.test(id));
  if (!family) return "unknown";
  // « GPL avec exception classpath » autorise l'usage dans un logiciel sous autre licence.
  if (withException && family.severity) return { severity: "low", label: `${family.label} + exception`, why: "Une exception de licence autorise l'usage dans un logiciel sous une autre licence." };
  return family;
}

/** Évalue une expression SPDX : « A OR B » → le choix le moins contraignant, « A AND B » → le plus contraignant. */
export function classifyLicense(expression: string): LicenseVerdict {
  const expr = expression.trim();
  if (!expr) return { risk: "unknown" };
  if (/^(NONE|UNLICENSED)$/i.test(expr)) {
    return { risk: "none", severity: "medium", label: "Aucune licence", why: "Sans licence, le code reste protégé par défaut : vous n'avez pas le droit de l'utiliser librement." };
  }
  if (/^(NOASSERTION|SEE LICENSE|NON-STANDARD|OTHER)/i.test(expr)) return { risk: "unknown" };

  type Eval = { severity: IssueSeverity | null; label: string; why: string };
  const evaluated: (Eval | "unknown")[] = expr.replace(/[()]/g, " ").split(/\s+OR\s+/i).map((alt) => {
    let worst: Eval = { severity: null, label: "Permissive", why: "" };
    for (const p of alt.split(/\s+AND\s+/i).map((x) => x.trim()).filter(Boolean)) {
      const c = classifyId(p);
      if (c === "unknown") return "unknown";
      if (c.severity && (!worst.severity || RANK[c.severity] < RANK[worst.severity])) worst = c;
    }
    return worst;
  });
  // Choix le moins contraignant parmi les alternatives reconnues.
  const known = evaluated.filter((e): e is Eval => e !== "unknown");
  const best: Eval | null = known.length === 0 ? null : known.reduce((a, b) => ((b.severity ? RANK[b.severity] : 99) > (a.severity ? RANK[a.severity] : 99) ? b : a));
  if (best === null) return { risk: "unknown" };
  if (!best.severity) return { risk: "ok" };
  return { risk: "restricted", severity: best.severity, label: best.label, why: best.why };
}

// Types partagés du moteur de contrôles de posture. Module pur (importable côté client pour les types).

export type Severity = "critical" | "high" | "medium" | "low";

/**
 *  pass     : le contrôle est satisfait, preuve à l'appui
 *  fail     : écart constaté
 *  warning  : partiellement satisfait / à examiner
 *  unknown  : NON ÉVALUABLE (droits insuffisants, fonction indisponible, erreur API) — jamais compté comme réussi
 *  na       : sans objet pour ce dépôt
 */
export type ControlState = "pass" | "fail" | "warning" | "unknown" | "na";

export type Family = "branches" | "security" | "ci" | "secrets" | "governance" | "access";

export const FAMILY_LABEL: Record<Family, string> = {
  branches: "Branches et revues",
  security: "Fonctions de sécurité GitHub",
  ci: "CI/CD (GitHub Actions)",
  secrets: "Secrets et fichiers sensibles",
  governance: "Gouvernance et chaîne d'approvisionnement",
  access: "Accès et intégrations",
};

export const FAMILY_ORDER: Family[] = ["branches", "security", "ci", "secrets", "governance", "access"];

export interface ControlResult {
  id: string;
  family: Family;
  severity: Severity;
  title: string;
  state: ControlState;
  /** Preuve : ce qui a été observé. */
  evidence: string;
  /** Éléments en cause (fichiers, actions, clés…), 10 maximum. */
  items?: string[];
  /** Comment corriger (affiché si le contrôle n'est pas réussi). */
  remediation?: string;
  /** Nom du contrôle OpenSSF Scorecard correspondant, le cas échéant. */
  scorecard?: string;
}

export const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 10, high: 6, medium: 3, low: 1 };

export interface PostureScore {
  /** 0-100, calculé sur les seuls contrôles évaluables. */
  score: number;
  total: number;
  /** Contrôles évalués (ni « non évaluable » ni « sans objet »). */
  evaluated: number;
  passed: number;
  failed: number;
  warning: number;
  unknown: number;
  na: number;
  failedBySeverity: Record<Severity, number>;
}

export function scoreResults(results: ControlResult[]): PostureScore {
  const failedBySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  let earned = 0;
  let possible = 0;
  const count = { pass: 0, fail: 0, warning: 0, unknown: 0, na: 0 };

  for (const r of results) {
    count[r.state]++;
    if (r.state === "fail") failedBySeverity[r.severity]++;
    if (r.state === "unknown" || r.state === "na") continue;
    const w = SEVERITY_WEIGHT[r.severity];
    possible += w;
    if (r.state === "pass") earned += w;
    else if (r.state === "warning") earned += w / 2;
  }

  return {
    score: possible > 0 ? Math.round((earned / possible) * 100) : 0,
    total: results.length,
    evaluated: count.pass + count.fail + count.warning,
    passed: count.pass,
    failed: count.fail,
    warning: count.warning,
    unknown: count.unknown,
    na: count.na,
    failedBySeverity,
  };
}

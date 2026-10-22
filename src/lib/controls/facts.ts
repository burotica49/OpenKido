// Faits collectés sur un dépôt (lecture de l'API GitHub) et consommés par l'évaluation pure.
import type { TreeAnalysis, WorkflowAnalysis } from "./analyzers";

/**
 * Résultat d'une lecture GitHub. Un échec n'est jamais assimilé à « tout va bien » :
 *  plan      : fonction indisponible sur l'offre du dépôt (ex. protection de branche d'un dépôt privé gratuit)
 *  forbidden : droits insuffisants ou fonction désactivée
 *  notfound  : ressource absente
 *  error     : panne, quota, réponse inattendue
 */
export type Fetched<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "plan" | "forbidden" | "notfound" | "error"; message: string };

export interface ProtectionData {
  requiredReviews: number | null;
  allowForcePushes: boolean | null;
  allowDeletions: boolean | null;
  requiredStatusChecks: boolean;
  enforceAdmins: boolean | null;
}

export interface RuleData {
  type: string;
  requiredApprovals?: number;
}

export interface RepoFacts {
  owner: string;
  repo: string;
  meta: Fetched<{
    defaultBranch: string;
    isPrivate: boolean;
    archived: boolean;
    admin: boolean;
    /** null = champ absent de la réponse (droits admin manquants ou fonction indisponible). */
    secretScanning: "enabled" | "disabled" | null;
    pushProtection: "enabled" | "disabled" | null;
  }>;
  tree: Fetched<{ analysis: TreeAnalysis; truncated: boolean }>;
  /** SECURITY.md hérité du dépôt « .github » du propriétaire (politique commune à tous ses dépôts). */
  inheritedSecurityPolicy: Fetched<boolean>;
  /** `data: null` = branche explicitement non protégée. */
  protection: Fetched<ProtectionData | null>;
  rules: Fetched<RuleData[]>;
  workflows: Fetched<WorkflowAnalysis[]>;
  workflowPermissions: Fetched<{ defaultPermissions: "read" | "write"; canApprovePullRequests: boolean }>;
  codeScanning: Fetched<{ analyses: number; lastAnalysisAt: string | null }>;
  privateReporting: Fetched<boolean>;
  dependabotAlerts: Fetched<boolean>;
  mergedPullRequests: Fetched<{ sampled: number; reviewed: number }>;
  commits: Fetched<{ sampled: number; verified: number }>;
  deployKeys: Fetched<{ title: string; readOnly: boolean }[]>;
  webhooks: Fetched<{ url: string; insecureSsl: boolean; hasSecret: boolean }[]>;
  outsideAdmins: Fetched<string[]>;
}

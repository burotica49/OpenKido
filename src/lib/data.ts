export type RiskLevel = "critical" | "warning" | "ok";

export type ComponentStatus = "sain" | "vulnerable" | "malveillant" | "obsolete";

export interface FeedItem {
  icon: string;
  tone: "danger" | "warning" | "success" | "neutral";
  text: string;
  meta: string;
}

export interface RepoComponent {
  id: string;
  name: string;
  version: string;
  status: ComponentStatus;
  trust: "eleve" | "moyen" | "faible" | "critique";
  license: string;
  cve?: string;
  severity?: "Critique" | "Élevée" | "Moyenne" | "Faible";
  fixedVersion?: string;
  whyAtRisk?: string;
  maintainer?: {
    activelyMaintained: boolean;
    lastCommit: string;
    cveHistory: string;
    popularity: string;
  };
}

export interface Repo {
  id: string;
  org: string;
  name: string;
  branch: string;
  risk: number;
  level: RiskLevel;
  vulnerable: number;
  malicious: number;
  secrets: number;
  total: number;
  lastScan: string;
  triagedNoise: number;
  severityBreakdown: { critical: number; high: number; medium: number };
  feed: FeedItem[];
  components: RepoComponent[];
}

export const repos: Repo[] = [
  {
    id: "api-backend",
    org: "acme-corp",
    name: "api-backend",
    branch: "main",
    risk: 62,
    level: "critical",
    vulnerable: 14,
    malicious: 2,
    secrets: 0,
    total: 312,
    lastScan: "il y a 6 min",
    triagedNoise: 47,
    severityBreakdown: { critical: 3, high: 5, medium: 6 },
    feed: [
      {
        icon: "ti-shield-x",
        tone: "danger",
        text: "Paquet malveillant `crypto-helper-js@1.2.0` bloqué avant installation",
        meta: "il y a 12 min · pipeline CI",
      },
      {
        icon: "ti-alert-triangle",
        tone: "warning",
        text: "Nouvelle CVE critique sur `axios`, déjà installé",
        meta: "il y a 1 h",
      },
      {
        icon: "ti-git-pull-request",
        tone: "success",
        text: "PR d'autofix créée pour `jsonwebtoken` → 9.0.2",
        meta: "il y a 3 h",
      },
    ],
    components: [
      {
        id: "axios",
        name: "axios",
        version: "0.21.1",
        status: "vulnerable",
        trust: "faible",
        license: "MIT",
        cve: "CVE-2023-45857",
        severity: "Critique",
        fixedVersion: "1.6.0",
        whyAtRisk:
          "Fuite de l'en-tête XSRF-TOKEN vers un domaine absolu lors d'une redirection. Le code appelle axios.get avec une URL construite à partir d'une entrée utilisateur dans api-backend/src/proxy.ts, ce qui rend le chemin d'exploitation atteignable. Le triage IA a confirmé l'usage réel du composant, pas seulement sa présence dans l'arbre de dépendances.",
        maintainer: {
          activelyMaintained: true,
          lastCommit: "il y a 5 jours",
          cveHistory: "3 corrigées en 18 mois",
          popularity: "52M téléchargements/sem.",
        },
      },
      {
        id: "crypto-helper-js",
        name: "crypto-helper-js",
        version: "1.2.0",
        status: "malveillant",
        trust: "critique",
        license: "inconnue",
        severity: "Critique",
        whyAtRisk:
          "Comportement de mainteneur suspect détecté lors d'une mise à jour mineure : exfiltration de variables d'environnement vers un domaine externe. Bloqué automatiquement avant installation, jamais entré dans l'arbre de dépendances.",
        maintainer: {
          activelyMaintained: false,
          lastCommit: "compte suspendu",
          cveHistory: "n/a",
          popularity: "12K téléchargements/sem.",
        },
      },
      {
        id: "jsonwebtoken",
        name: "jsonwebtoken",
        version: "8.5.1",
        status: "vulnerable",
        trust: "moyen",
        license: "MIT",
        cve: "CVE-2022-23529",
        severity: "Élevée",
        fixedVersion: "9.0.2",
        whyAtRisk:
          "Falsification de payload possible si la clé secrète provient d'une source non fiable. Le service auth-service appelle jwt.verify avec une clé chargée dynamiquement.",
        maintainer: {
          activelyMaintained: true,
          lastCommit: "il y a 2 semaines",
          cveHistory: "2 corrigées en 24 mois",
          popularity: "18M téléchargements/sem.",
        },
      },
      {
        id: "express",
        name: "express",
        version: "4.18.2",
        status: "sain",
        trust: "eleve",
        license: "MIT",
      },
    ],
  },
  {
    id: "web-frontend",
    org: "acme-corp",
    name: "web-frontend",
    branch: "main",
    risk: 48,
    level: "warning",
    vulnerable: 9,
    malicious: 1,
    secrets: 0,
    total: 198,
    lastScan: "il y a 22 min",
    triagedNoise: 28,
    severityBreakdown: { critical: 1, high: 3, medium: 5 },
    feed: [
      {
        icon: "ti-alert-triangle",
        tone: "warning",
        text: "CVE moyenne sur `lodash`, version 4.17.15",
        meta: "il y a 20 min",
      },
      {
        icon: "ti-file-check",
        tone: "neutral",
        text: "SBOM régénéré pour `web-frontend`",
        meta: "il y a 2 h",
      },
    ],
    components: [
      {
        id: "lodash",
        name: "lodash",
        version: "4.17.15",
        status: "vulnerable",
        trust: "moyen",
        license: "MIT",
        cve: "CVE-2021-23337",
        severity: "Moyenne",
        fixedVersion: "4.17.21",
        whyAtRisk:
          "Injection de commande via template() si une entrée utilisateur atteint la fonction. Usage confirmé dans web-frontend/src/utils/format.ts.",
        maintainer: {
          activelyMaintained: true,
          lastCommit: "il y a 1 mois",
          cveHistory: "5 corrigées en 36 mois",
          popularity: "44M téléchargements/sem.",
        },
      },
      {
        id: "react",
        name: "react",
        version: "18.2.0",
        status: "sain",
        trust: "eleve",
        license: "MIT",
      },
    ],
  },
  {
    id: "mobile-app",
    org: "acme-corp",
    name: "mobile-app",
    branch: "develop",
    risk: 34,
    level: "warning",
    vulnerable: 5,
    malicious: 0,
    secrets: 0,
    total: 140,
    lastScan: "il y a 1 h",
    triagedNoise: 11,
    severityBreakdown: { critical: 0, high: 2, medium: 3 },
    feed: [
      {
        icon: "ti-clock-exclamation",
        tone: "neutral",
        text: "`moment` marqué obsolète, alternative recommandée : day.js",
        meta: "il y a 1 h",
      },
    ],
    components: [
      {
        id: "moment",
        name: "moment",
        version: "2.29.4",
        status: "obsolete",
        trust: "faible",
        license: "MIT",
        whyAtRisk: "Projet en mode maintenance, plus de nouvelles fonctionnalités. Migration vers day.js recommandée.",
        maintainer: {
          activelyMaintained: false,
          lastCommit: "il y a 14 mois",
          cveHistory: "aucune connue",
          popularity: "20M téléchargements/sem.",
        },
      },
      {
        id: "left-pad",
        name: "left-pad",
        version: "1.3.0",
        status: "obsolete",
        trust: "faible",
        license: "MIT",
      },
    ],
  },
  {
    id: "payments-service",
    org: "acme-corp",
    name: "payments-service",
    branch: "main",
    risk: 8,
    level: "ok",
    vulnerable: 0,
    malicious: 0,
    secrets: 0,
    total: 87,
    lastScan: "il y a 3 h",
    triagedNoise: 4,
    severityBreakdown: { critical: 0, high: 0, medium: 0 },
    feed: [
      { icon: "ti-check", tone: "success", text: "Scan complet terminé, aucun problème détecté", meta: "il y a 3 h" },
    ],
    components: [
      { id: "stripe-node", name: "stripe-node", version: "14.5.0", status: "sain", trust: "eleve", license: "MIT" },
    ],
  },
  {
    id: "internal-cli",
    org: "acme-corp",
    name: "internal-cli",
    branch: "main",
    risk: 15,
    level: "ok",
    vulnerable: 1,
    malicious: 0,
    secrets: 0,
    total: 52,
    lastScan: "il y a 5 h",
    triagedNoise: 2,
    severityBreakdown: { critical: 0, high: 0, medium: 1 },
    feed: [
      { icon: "ti-check", tone: "success", text: "Scan complet terminé, 1 dépendance mineure obsolète", meta: "il y a 5 h" },
    ],
    components: [
      { id: "commander", name: "commander", version: "9.4.0", status: "sain", trust: "eleve", license: "MIT" },
    ],
  },
  {
    id: "docs-site",
    org: "acme-corp",
    name: "docs-site",
    branch: "main",
    risk: 5,
    level: "ok",
    vulnerable: 0,
    malicious: 0,
    secrets: 0,
    total: 64,
    lastScan: "hier",
    triagedNoise: 0,
    severityBreakdown: { critical: 0, high: 0, medium: 0 },
    feed: [{ icon: "ti-check", tone: "success", text: "Scan complet terminé, aucun problème détecté", meta: "hier" }],
    components: [
      { id: "next", name: "next", version: "14.2.3", status: "sain", trust: "eleve", license: "MIT" },
    ],
  },
];

export function getRepo(id: string): Repo | undefined {
  return repos.find((r) => r.id === id);
}

export function getComponent(repoId: string, componentId: string): RepoComponent | undefined {
  return getRepo(repoId)?.components.find((c) => c.id === componentId);
}

export const levelMeta: Record<RiskLevel, { label: string; badge: string; bar: string }> = {
  critical: { label: "Risque critique", badge: "bg-red-500/10 text-red-600 dark:text-red-400", bar: "bg-red-500" },
  warning: { label: "Risque modéré", badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400", bar: "bg-amber-500" },
  ok: { label: "Sain", badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400", bar: "bg-emerald-500" },
};

export const statusMeta: Record<ComponentStatus, { label: string; badge: string }> = {
  sain: { label: "Sain", badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  vulnerable: { label: "Vulnérable", badge: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  malveillant: { label: "Malveillant", badge: "bg-red-500/10 text-red-600 dark:text-red-400" },
  obsolete: { label: "Obsolète", badge: "bg-muted text-muted-foreground" },
};

export const trustMeta: Record<RepoComponent["trust"], { label: string; className: string }> = {
  eleve: { label: "Élevé", className: "text-emerald-600 dark:text-emerald-400" },
  moyen: { label: "Moyen", className: "text-amber-600 dark:text-amber-400" },
  faible: { label: "Faible", className: "text-muted-foreground" },
  critique: { label: "Critique", className: "text-red-600 dark:text-red-400" },
};

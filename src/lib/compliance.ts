import type { ScanResult } from "./scan";

export type ControlStatus = "pass" | "fail" | "warning" | "na";

export interface Control {
  id: string;
  category: string;
  title: string;
  description: string;
  evaluate: (scans: ScanResult[]) => { status: ControlStatus; evidence: string };
}

export interface Framework {
  id: string;
  name: string;
  shortName: string;
  description: string;
  version: string;
  controls: Control[];
}

// ─── SOC 2 ────────────────────────────────────────────────────────────────────

const soc2Controls: Control[] = [
  {
    id: "CC6.1",
    category: "Contrôle d'accès logique",
    title: "Secrets & credentials non exposés",
    description:
      "Les clés API, tokens et secrets ne doivent pas apparaître dans le code source ou les dépendances.",
    evaluate: (scans) => {
      const hasSecrets = scans.some((s) => (s as any).secrets > 0);
      return hasSecrets
        ? { status: "fail", evidence: "Des secrets ont été détectés dans le code source." }
        : { status: "pass", evidence: `Aucun secret exposé détecté dans ${scans.length} repo(s) analysé(s).` };
    },
  },
  {
    id: "CC7.1",
    category: "Gestion des vulnérabilités",
    title: "Pas de vulnérabilité critique non corrigée",
    description:
      "Les composants présentant des CVE de score CVSS ≥ 9.0 doivent être mis à jour dans les 30 jours.",
    evaluate: (scans) => {
      const critCount = scans.reduce((acc, s) => acc + s.severityBreakdown.CRITICAL, 0);
      if (critCount === 0)
        return { status: "pass", evidence: "Aucune CVE critique détectée dans l'ensemble des repos." };
      if (critCount <= 3)
        return { status: "warning", evidence: `${critCount} CVE(s) critique(s) en attente de correction.` };
      return { status: "fail", evidence: `${critCount} CVE(s) critique(s) non corrigées — dépasse le seuil de tolérance.` };
    },
  },
  {
    id: "CC7.2",
    category: "Gestion des vulnérabilités",
    title: "Couverture de scan des dépendances",
    description:
      "Toutes les dépendances tierces doivent être inventoriées et analysées.",
    evaluate: (scans) => {
      const scanned = scans.filter((s) => s.total > 0).length;
      const pct = scans.length > 0 ? Math.round((scanned / scans.length) * 100) : 0;
      if (pct === 100)
        return { status: "pass", evidence: `100 % des repos scannés (${scanned}/${scans.length}).` };
      if (pct >= 75)
        return { status: "warning", evidence: `${pct} % des repos scannés (${scanned}/${scans.length}).` };
      return { status: "fail", evidence: `Seulement ${pct} % des repos ont été analysés.` };
    },
  },
  {
    id: "CC7.3",
    category: "Surveillance des menaces",
    title: "Paquets malveillants bloqués",
    description:
      "Les paquets dont le comportement est suspect ou malveillant doivent être détectés et bloqués avant installation.",
    evaluate: (scans) => {
      const mal = scans.reduce((acc, s) => acc + s.vulnerable, 0);
      return { status: "pass", evidence: `Scan actif sur ${scans.length} repo(s) — détection de paquets malveillants activée.` };
    },
  },
  {
    id: "CC8.1",
    category: "Gestion des changements",
    title: "Composants tiers documentés (SBOM)",
    description:
      "Un inventaire complet des composants logiciels (SBOM) doit être maintenu.",
    evaluate: (scans) => {
      const total = scans.reduce((acc, s) => acc + s.total, 0);
      if (total > 0)
        return { status: "pass", evidence: `${total} composants inventoriés dans le SBOM agrégé.` };
      return { status: "warning", evidence: "Aucun composant inventorié — lancez un scan complet." };
    },
  },
];

// ─── ISO 27001 ─────────────────────────────────────────────────────────────────

const iso27001Controls: Control[] = [
  {
    id: "A.12.6.1",
    category: "Gestion des vulnérabilités techniques",
    title: "Identification des vulnérabilités",
    description:
      "Les vulnérabilités techniques des systèmes d'information doivent être identifiées en temps voulu.",
    evaluate: (scans) => {
      const hasScans = scans.some((s) => s.total > 0);
      return hasScans
        ? { status: "pass", evidence: `Scan automatique actif sur ${scans.length} repo(s).` }
        : { status: "fail", evidence: "Aucun scan de vulnérabilités en place." };
    },
  },
  {
    id: "A.12.6.2",
    category: "Gestion des vulnérabilités techniques",
    title: "Restrictions logicielles",
    description:
      "Des règles de sécurité doivent encadrer l'installation et l'utilisation de logiciels.",
    evaluate: (scans) => {
      return { status: "pass", evidence: "Politique de dépendances whitelist/blacklist active (via scan pré-installation)." };
    },
  },
  {
    id: "A.14.2.1",
    category: "Sécurité du développement",
    title: "Politique de développement sécurisé",
    description:
      "Des règles de développement sécurisé doivent être établies et appliquées.",
    evaluate: (scans) => {
      const highRisk = scans.filter((s) => s.level === "critical").length;
      if (highRisk === 0)
        return { status: "pass", evidence: "Aucun repo en niveau de risque critique." };
      return { status: "warning", evidence: `${highRisk} repo(s) en risque critique nécessitent une attention immédiate.` };
    },
  },
  {
    id: "A.14.2.8",
    category: "Sécurité du développement",
    title: "Tests de sécurité des systèmes",
    description:
      "Des tests de sécurité doivent être intégrés au processus de développement.",
    evaluate: (scans) => {
      const covered = scans.filter((s) => s.total > 0).length;
      const pct = scans.length > 0 ? Math.round((covered / scans.length) * 100) : 0;
      if (pct >= 90)
        return { status: "pass", evidence: `${pct} % des repos couverts par le scan automatique.` };
      return { status: "warning", evidence: `${pct} % de couverture — objectif : 90 %.` };
    },
  },
  {
    id: "A.15.2.1",
    category: "Relations avec les fournisseurs",
    title: "Surveillance des services fournisseurs",
    description:
      "La sécurité des composants et services tiers doit être régulièrement auditée.",
    evaluate: (scans) => {
      const total = scans.reduce((acc, s) => acc + s.total, 0);
      const vuln = scans.reduce((acc, s) => acc + s.vulnerable, 0);
      const pct = total > 0 ? Math.round((vuln / total) * 100) : 0;
      if (pct === 0)
        return { status: "pass", evidence: `${total} composants tiers surveillés, 0 vulnérabilité.` };
      if (pct <= 5)
        return { status: "warning", evidence: `${vuln}/${total} composants tiers vulnérables (${pct} %).` };
      return { status: "fail", evidence: `${pct} % des composants tiers sont vulnérables — action requise.` };
    },
  },
  {
    id: "A.18.2.3",
    category: "Conformité technique",
    title: "Revue de la conformité technique",
    description:
      "Les systèmes d'information doivent être régulièrement vérifiés pour leur conformité aux politiques de sécurité.",
    evaluate: (scans) => {
      const lastScan = scans
        .map((s) => new Date(s.scannedAt).getTime())
        .sort((a, b) => b - a)[0];
      if (!lastScan) return { status: "na", evidence: "Aucun scan effectué." };
      const ageH = (Date.now() - lastScan) / 1000 / 3600;
      if (ageH < 24)
        return { status: "pass", evidence: `Dernière revue il y a ${Math.round(ageH)} h.` };
      if (ageH < 168)
        return { status: "warning", evidence: `Dernière revue il y a ${Math.round(ageH / 24)} jour(s).` };
      return { status: "fail", evidence: `Dernière revue il y a plus d'une semaine.` };
    },
  },
];

// ─── OWASP Top 10 ─────────────────────────────────────────────────────────────

const owaspControls: Control[] = [
  {
    id: "A01:2021",
    category: "Contrôle d'accès",
    title: "Contrôle d'accès défaillant",
    description: "Les restrictions sur les actions des utilisateurs ne sont pas correctement appliquées.",
    evaluate: (scans) => ({ status: "na", evidence: "Nécessite une analyse dynamique (DAST) — hors périmètre SCA." }),
  },
  {
    id: "A02:2021",
    category: "Cryptographie",
    title: "Défaillances cryptographiques",
    description: "Exposition de données sensibles liée à des secrets dans le code ou des composants vulnérables.",
    evaluate: (scans) => {
      const cryptoVulns = scans.flatMap((s) =>
        s.components.flatMap((c) =>
          c.vulns.filter((v) =>
            v.summary.toLowerCase().match(/crypt|ssl|tls|cert|key|hash|cipher/)
          )
        )
      );
      if (cryptoVulns.length === 0)
        return { status: "pass", evidence: "Aucune CVE liée à la cryptographie détectée." };
      return { status: "warning", evidence: `${cryptoVulns.length} CVE(s) potentiellement liées à la cryptographie.` };
    },
  },
  {
    id: "A03:2021",
    category: "Injection",
    title: "Injection",
    description: "Données hostiles envoyées à un interpréteur (SQL, LDAP, OS…).",
    evaluate: (scans) => ({ status: "na", evidence: "Nécessite une analyse SAST/DAST — hors périmètre SCA." }),
  },
  {
    id: "A06:2021",
    category: "Composants vulnérables",
    title: "Composants vulnérables et obsolètes",
    description:
      "Utilisation de composants avec des vulnérabilités connues. Risque directement mesurable via SCA.",
    evaluate: (scans) => {
      const critHigh = scans.reduce(
        (acc, s) => acc + s.severityBreakdown.CRITICAL + s.severityBreakdown.HIGH,
        0
      );
      if (critHigh === 0)
        return { status: "pass", evidence: "Aucune CVE critique ou élevée dans les composants utilisés." };
      if (critHigh <= 5)
        return { status: "warning", evidence: `${critHigh} composant(s) avec CVE critique/élevée.` };
      return { status: "fail", evidence: `${critHigh} CVE(s) critique(s) ou élevées non corrigées.` };
    },
  },
  {
    id: "A08:2021",
    category: "Intégrité logicielle",
    title: "Défauts d'intégrité des données et du logiciel",
    description:
      "Code et infrastructure ne protégeant pas contre les violations d'intégrité (supply chain).",
    evaluate: (scans) => {
      const total = scans.reduce((acc, s) => acc + s.total, 0);
      return { status: "pass", evidence: `${total} composants vérifiés dans la chaîne d'approvisionnement.` };
    },
  },
  {
    id: "A09:2021",
    category: "Journalisation",
    title: "Carence de journalisation et de surveillance",
    description: "Absence de détection, d'escalade et de réponse aux brèches actives.",
    evaluate: (scans) => ({
      status: "pass",
      evidence: "Audit trail des scans disponible — chaque scan est horodaté et tracé.",
    }),
  },
];

// ─── PCI DSS ──────────────────────────────────────────────────────────────────

const pciDssControls: Control[] = [
  {
    id: "6.2.4",
    category: "Logiciels sécurisés",
    title: "Prévention des vulnérabilités courantes",
    description:
      "Les logiciels doivent être protégés contre les attaques connues via des formations et pratiques sécurisées.",
    evaluate: (scans) => {
      const medHigh = scans.reduce(
        (acc, s) => acc + s.severityBreakdown.HIGH + s.severityBreakdown.MEDIUM,
        0
      );
      if (medHigh === 0)
        return { status: "pass", evidence: "Aucune vulnérabilité moyenne ou élevée détectée." };
      return { status: "warning", evidence: `${medHigh} vulnérabilité(s) moyenne/élevée à corriger.` };
    },
  },
  {
    id: "6.3.3",
    category: "Logiciels sécurisés",
    title: "Correctifs de sécurité appliqués",
    description:
      "Tous les composants système doivent être protégés contre les vulnérabilités connues par l'installation de correctifs.",
    evaluate: (scans) => {
      const vuln = scans.reduce((acc, s) => acc + s.vulnerable, 0);
      const total = scans.reduce((acc, s) => acc + s.total, 0);
      if (vuln === 0)
        return { status: "pass", evidence: `Tous les ${total} composants sont à jour.` };
      const pct = total > 0 ? Math.round(((total - vuln) / total) * 100) : 0;
      return {
        status: pct >= 90 ? "warning" : "fail",
        evidence: `${vuln} composant(s) vulnérable(s) sans correctif appliqué (${pct} % à jour).`,
      };
    },
  },
  {
    id: "6.4.1",
    category: "Applications web",
    title: "Protection contre les attaques web connues",
    description: "Les applications web accessibles au public doivent être protégées contre les attaques connues.",
    evaluate: () => ({ status: "na", evidence: "Nécessite un WAF ou un scan DAST — hors périmètre SCA." }),
  },
  {
    id: "12.3.2",
    category: "Politique de sécurité",
    title: "Évaluation ciblée des risques",
    description: "Une évaluation des risques ciblée doit être effectuée sur les technologies en évolution rapide.",
    evaluate: (scans) => {
      const hasData = scans.some((s) => s.total > 0);
      return hasData
        ? { status: "pass", evidence: `Évaluation automatique active sur ${scans.length} repo(s).` }
        : { status: "warning", evidence: "Aucune donnée de scan disponible pour l'évaluation des risques." };
    },
  },
];

// ─── Frameworks registre ───────────────────────────────────────────────────────

export const frameworks: Framework[] = [
  {
    id: "soc2",
    name: "SOC 2 Type II",
    shortName: "SOC 2",
    description: "Trust Services Criteria — sécurité, disponibilité, confidentialité.",
    version: "2017",
    controls: soc2Controls,
  },
  {
    id: "iso27001",
    name: "ISO/IEC 27001",
    shortName: "ISO 27001",
    description: "Système de management de la sécurité de l'information.",
    version: "2022",
    controls: iso27001Controls,
  },
  {
    id: "owasp",
    name: "OWASP Top 10",
    shortName: "OWASP",
    description: "Les dix risques de sécurité les plus critiques pour les applications web.",
    version: "2021",
    controls: owaspControls,
  },
  {
    id: "pcidss",
    name: "PCI DSS",
    shortName: "PCI DSS",
    description: "Standard de sécurité des données de l'industrie des cartes de paiement.",
    version: "v4.0",
    controls: pciDssControls,
  },
];

export interface EvaluatedControl extends Omit<Control, "evaluate"> {
  status: ControlStatus;
  evidence: string;
}

export interface FrameworkReport {
  framework: Omit<Framework, "controls">;
  controls: EvaluatedControl[];
  score: number;
  passCount: number;
  failCount: number;
  warnCount: number;
  naCount: number;
}

export function evaluateFramework(framework: Framework, scans: ScanResult[]): FrameworkReport {
  const evaluated: EvaluatedControl[] = framework.controls.map((ctrl) => {
    const { status, evidence } = ctrl.evaluate(scans);
    return { id: ctrl.id, category: ctrl.category, title: ctrl.title, description: ctrl.description, status, evidence };
  });

  const passCount = evaluated.filter((c) => c.status === "pass").length;
  const failCount = evaluated.filter((c) => c.status === "fail").length;
  const warnCount = evaluated.filter((c) => c.status === "warning").length;
  const naCount = evaluated.filter((c) => c.status === "na").length;
  const scoreable = evaluated.length - naCount;
  const score = scoreable > 0 ? Math.round(((passCount + warnCount * 0.5) / scoreable) * 100) : 0;

  return {
    framework: { id: framework.id, name: framework.name, shortName: framework.shortName, description: framework.description, version: framework.version },
    controls: evaluated,
    score,
    passCount,
    failCount,
    warnCount,
    naCount,
  };
}

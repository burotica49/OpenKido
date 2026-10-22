"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { PageHeader } from "@/components/app/sidebar";
import { HelpPanel, Term } from "@/components/app/help-panel";
import { IssuesWorkspace, SeverityHeader } from "@/components/app/issues-workspace";
import { coverageGaps, type ResolvedIssue, type ResolvedItem } from "@/lib/issues-core";
import type { FeedCoverage } from "@/lib/issues";

export function IssuesClient({ issues, coverage, login, resolved, historyDirty }: { issues: ResolvedIssue[]; coverage: FeedCoverage; login: string; resolved: ResolvedItem[]; historyDirty: boolean }) {
  const gaps = coverageGaps(coverage);

  return (
    <div className="flex flex-col flex-1 bg-background">
      <PageHeader title="Issues" subtitle="Tous les problèmes de sécurité de vos dépôts et domaines, au même endroit" />

      <HelpPanel>
        <p>Cette page réunit en une seule liste ce que détectent les autres pages : <Term>dépendances vulnérables</Term>, <Term>paquets malveillants</Term>, <Term>licences à risque</Term>, <Term>secrets trouvés dans le code</Term>, <Term>alertes GitHub</Term>, <Term>mauvaises configurations</Term> des dépôts (Posture) et <Term>problèmes de domaines</Term>. Elle est triée par gravité : traitez le haut de la liste en premier.</p>
        <p><Term>Détail</Term> : cliquez sur une ligne pour ouvrir le panneau de droite : explication en clair, liste des failles (avec la version à atteindre), commande de correction à copier et actions. Échap ferme le panneau.</p>
        <p><Term>Moins de bruit</Term> : les dépendances de <Term>développement</Term> (tests, outils de build) ne sont pas livrées en production, leur risque est bien plus faible : elles sont masquées par défaut et exclues des compteurs. Les failles <Term>sans correctif</Term> sont signalées et placées après celles que vous pouvez corriger tout de suite.</p>
        <p><Term>Regroupement, temps et statut</Term> : un même paquet présent dans plusieurs dépôts n&apos;apparaît qu&apos;une fois (case « Regrouper par paquet »). Le <Term>temps de correction</Term> est une estimation indicative (par exemple 30 min pour une mise à jour directe, plus si la version majeure change ou si la dépendance est indirecte). <Term>Nouveau</Term> = apparue depuis moins de 7 jours ; <Term>Résolues</Term> = n&apos;est plus détectée par un nouveau scan. Le suivi commence à votre première visite : les alertes déjà présentes à ce moment ne comptent pas comme nouvelles.</p>
        <p><Term>Gérer une alerte</Term> (survolez une ligne) : <Term>Ignorer</Term> avec un motif (faux positif, risque accepté…), <Term>Reporter</Term> pendant 7, 30 ou 90 jours (elle revient seule), <Term>Assigner</Term> à quelqu&apos;un. Rien n&apos;est supprimé : l&apos;onglet « Ignorées » permet de tout rouvrir, et le motif reste visible pour un audit.</p>
        <p>Les alertes Dependabot ne sont listées que pour les dépôts sans scan complet des dépendances, pour éviter les doublons. Ces choix restent personnels : ils ne modifient rien sur GitHub.</p>
      </HelpPanel>

      {gaps.length > 0 && (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-2.5 text-[12px] text-amber-900 flex items-start gap-2">
          <IconAlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span><span className="font-medium">Couverture incomplète — « aucune alerte » ne veut pas dire « sain » : </span>{gaps.join(" · ")}. Lancez les scans et audits depuis les pages correspondantes.</span>
        </div>
      )}

      <IssuesWorkspace
        issues={issues}
        login={login}
        fullyCovered={gaps.length === 0}
        resolved={resolved}
        historyDirty={historyDirty}
        header={(api) => <SeverityHeader api={api} showHints />}
      />
    </div>
  );
}

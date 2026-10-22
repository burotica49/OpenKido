// Explications en langage courant des contrôles de posture (pour les lecteurs non spécialistes).
// Module pur, importable côté client et serveur.
import type { ControlState, Severity } from "./types";

/** Pourquoi le contrôle compte, en une ou deux phrases sans jargon. */
export const CONTROL_WHY: Record<string, string> = {
  "BP-01": "Sans protection, n'importe quel développeur (ou un compte piraté) peut modifier directement le code de production, sans aucune validation.",
  "BP-02": "Quand une seconde personne relit chaque changement, une erreur ou un code malveillant a bien plus de chances d'être repéré avant d'arriver en production.",
  "BP-03": "Le « force-push » réécrit l'historique : il permet d'effacer des traces ou des changements. Supprimer la branche principale ferait perdre le projet.",
  "BP-04": "Sans ces vérifications, on peut fusionner du code dont les tests automatiques échouent, et casser ou fragiliser l'application.",
  "BP-05": "Si les administrateurs peuvent contourner les règles, le compte d'un seul administrateur piraté suffit à les annuler toutes.",
  "REV-01": "Une règle de relecture ne sert à rien si, en pratique, les changements sont fusionnés sans que personne ne les ait regardés.",
  "SIG-01": "Un commit « signé » prouve que son auteur est bien celui qu'il prétend être : on évite l'usurpation d'identité dans l'historique.",
  "SF-01": "Dependabot prévient quand une bibliothèque utilisée contient une faille connue. Sans lui, on peut rester exposé pendant des mois sans le savoir.",
  "SF-02": "Détecte les mots de passe, clés d'API et jetons envoyés par erreur dans le code : c'est l'une des causes de piratage les plus courantes.",
  "SF-03": "Bloque l'envoi d'un secret (clé, mot de passe) avant qu'il ne soit publié, au lieu de le détecter après coup quand il est déjà exposé.",
  "SF-04": "CodeQL analyse automatiquement le code à la recherche de failles de programmation (injections, etc.) avant qu'elles n'arrivent en production.",
  "SF-05": "Donne aux chercheurs en sécurité un canal confidentiel pour signaler une faille, sans la rendre publique avant qu'elle soit corrigée.",
  "SF-06": "Maintenir les dépendances à jour réduit le risque d'utiliser une version vulnérable. Un outil automatique le fait sans effort manuel.",
  "CI-01": "Une action GitHub « épinglée » est figée sur une version précise. Sinon, si son auteur est piraté, du code malveillant s'exécute dans vos pipelines.",
  "CI-02": "Par défaut, le jeton des workflows peut avoir trop de droits. Le limiter réduit les dégâts si un workflow est détourné.",
  "CI-03": "Ce déclencheur donne accès aux secrets du dépôt à du code venant de pull requests externes : un attaquant peut les voler. C'est une faille grave.",
  "CI-04": "Si un workflow insère du texte non contrôlé (titre de PR, nom de branche…) dans une commande, un attaquant peut y exécuter ses propres commandes.",
  "CI-05": "Un serveur d'exécution auto-hébergé sur un dépôt public peut être pris en main par n'importe qui via une pull request.",
  "SEC-01": "Des fichiers comme .env, des clés privées ou des certificats versionnés restent dans l'historique et peuvent être lus par toute personne ayant accès au dépôt.",
  "SEC-02": "Les fichiers binaires et dossiers de dépendances versionnés ne peuvent pas être relus ni analysés et peuvent cacher du code malveillant.",
  "GOV-01": "Le fichier SECURITY.md indique comment signaler une faille et qui contacter. Sans lui, les signalements se perdent ou sont publiés.",
  "GOV-02": "CODEOWNERS désigne qui doit relire quelle partie du code : les zones sensibles ne sont pas modifiées sans l'accord des bonnes personnes.",
  "GOV-03": "Sans licence, personne ne sait ce qu'il a le droit de faire avec le code (utiliser, modifier, redistribuer).",
  "GOV-04": "Un fichier lockfile fige les versions exactes des dépendances : on installe toujours les mêmes, ce qui évite qu'une version piégée s'y glisse.",
  "ACC-01": "Une clé de déploiement en écriture permet de modifier le code depuis un serveur : si ce serveur est piraté, le code l'est aussi.",
  "ACC-02": "Un webhook sans HTTPS ou sans secret peut être espionné ou falsifié : n'importe qui pourrait envoyer de faux événements.",
  "ACC-03": "Un collaborateur extérieur à l'organisation avec les droits d'administrateur peut tout modifier : ces droits doivent rester limités à l'équipe.",
};

export const SEVERITY_HELP: Record<Severity, string> = {
  critical: "À corriger tout de suite : une faille exploitable est probable.",
  high: "À corriger rapidement : le risque est réel.",
  medium: "À planifier : affaiblit la sécurité sans être urgent.",
  low: "Bonne pratique : à faire quand vous avez le temps.",
};

export const STATE_HELP: Record<ControlState, string> = {
  pass: "Le contrôle est respecté.",
  fail: "Le contrôle n'est pas respecté : un risque existe.",
  warning: "Respecté en partie : à examiner.",
  unknown: "Impossible à vérifier (droits insuffisants ou fonction indisponible). N'entre pas dans le score.",
  na: "Ne s'applique pas à ce dépôt.",
};

/** Phrase de verdict à partir du score et des échecs, pour un lecteur pressé. */
export function verdict(s: { score: number; failCritical: number; failHigh: number; failed: number; unknown: number; evaluated: number }): { tone: "good" | "ok" | "bad"; text: string } {
  if (s.failCritical > 0) {
    return { tone: "bad", text: `Ce dépôt a ${s.failCritical} problème(s) critique(s) : c'est la priorité absolue, car une faille peut déjà être exploitable.` };
  }
  if (s.failHigh > 0) {
    return { tone: "bad", text: `Ce dépôt a ${s.failHigh} problème(s) de gravité élevée à corriger rapidement.` };
  }
  if (s.failed > 0) {
    return { tone: "ok", text: `Pas de problème grave, mais ${s.failed} point(s) de sécurité à améliorer.` };
  }
  if (s.evaluated === 0) {
    return { tone: "ok", text: "Aucun contrôle n'a pu être évalué : vérifiez que l'application a les droits nécessaires sur ce dépôt." };
  }
  return { tone: "good", text: "Aucun problème détecté sur les contrôles évalués. Bon travail." };
}

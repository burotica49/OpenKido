// Évaluation pure des contrôles de posture à partir des faits collectés (aucun accès réseau).
import type { ControlResult, ControlState, Family, Severity } from "./types";
import type { Fetched, RepoFacts } from "./facts";

type Base = { id: string; family: Family; severity: Severity; title: string; scorecard?: string };

const settings = (f: RepoFacts, path: string) => `https://github.com/${f.owner}/${f.repo}/settings/${path}`;

function result(base: Base, state: ControlState, evidence: string, extra: { items?: string[]; remediation?: string } = {}): ControlResult {
  return { ...base, state, evidence, ...(extra.items?.length ? { items: extra.items.slice(0, 10) } : {}), ...(extra.remediation && state !== "pass" && state !== "na" ? { remediation: extra.remediation } : {}) };
}

/** Raison lisible d'une lecture impossible. */
function why(fetched: Extract<Fetched<unknown>, { ok: false }>, what: string): string {
  switch (fetched.kind) {
    case "plan": return `${what} : indisponible sur l'offre GitHub actuelle du dépôt`;
    case "forbidden": return `${what} : droits insuffisants ou fonction désactivée (${fetched.message})`;
    case "notfound": return `${what} : introuvable (${fetched.message})`;
    default: return `${what} : lecture impossible (${fetched.message})`;
  }
}

function ago(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return days <= 0 ? "aujourd'hui" : days === 1 ? "hier" : `il y a ${days} jours`;
}

export function evaluateControls(f: RepoFacts): ControlResult[] {
  const out: ControlResult[] = [];
  const meta = f.meta.ok ? f.meta.data : null;
  const isPrivate = meta?.isPrivate ?? false;
  const archived = meta?.archived ?? false;
  const branch = meta?.defaultBranch ?? "la branche par défaut";

  // ═══ Branches et revues ═══════════════════════════════════════════════════════
  const protection = f.protection.ok ? f.protection.data : undefined; // undefined = illisible, null = non protégée
  const rules = f.rules.ok ? f.rules.data : undefined;
  const ruleTypes = new Set((rules ?? []).map((r) => r.type));
  const planBlocked = (!f.protection.ok && f.protection.kind === "plan") || (!f.rules.ok && f.rules.kind === "plan");

  let protectedBranch: boolean | null;
  if (protection || ruleTypes.size > 0) protectedBranch = true;
  else if (planBlocked) protectedBranch = false;
  else if (protection === null && rules !== undefined) protectedBranch = false;
  else protectedBranch = null;

  // La protection classique est illisible sans droits administrateur : sans elle on ne peut conclure à
  // un échec que si elle est prouvée absente (lue, ou impossible sur l'offre du dépôt).
  const canConclude = f.protection.ok || planBlocked;
  const classicUnreadable = "La protection classique n'est pas lisible (droits administrateur requis) : impossible de conclure.";

  const bp01: Base = { id: "BP-01", family: "branches", severity: "high", title: "Branche par défaut protégée", scorecard: "Branch-Protection" };
  const dependsOnBp01 = (base: Base): ControlResult | null =>
    protectedBranch === false ? result(base, "na", "Dépend de BP-01 : aucune protection de branche à évaluer.") : null;

  if (archived) {
    out.push(result(bp01, "na", "Dépôt archivé (lecture seule)."));
  } else if (protectedBranch === true) {
    out.push(result(bp01, "pass", `${branch} est protégée${protection ? " (protection classique)" : ""}${ruleTypes.size > 0 ? ` (ruleset : ${[...ruleTypes].join(", ")})` : ""}.`));
  } else if (protectedBranch === false) {
    out.push(result(bp01, "fail",
      planBlocked
        ? `La protection de branche n'est pas disponible sur l'offre actuelle (dépôt privé, plan gratuit) : rien n'empêche un push direct ou forcé sur ${branch}.`
        : `Aucune protection de branche ni ruleset sur ${branch} : push direct, force-push et suppression possibles.`,
      { remediation: `Activer une règle de protection sur ${branch} : ${settings(f, "branches")}.${planBlocked ? " Sur un dépôt privé il faut GitHub Pro/Team, ou rendre le dépôt public." : ""}` }));
  } else {
    out.push(result(bp01, "unknown", f.protection.ok ? "Protection non déterminée." : why(f.protection, "Protection de branche")));
  }

  const reviewBase: Base = { id: "BP-02", family: "branches", severity: "high", title: "Relecture obligatoire avant fusion", scorecard: "Code-Review" };
  const reviewRules = (f.rules.ok ? f.rules.data : []).filter((r) => r.type === "pull_request");
  const requiredReviews = Math.max(protection?.requiredReviews ?? 0, ...reviewRules.map((r) => r.requiredApprovals ?? 0));
  // requiredReviews === null : la protection n'exige pas de PR du tout ; 0 : PR exigée sans approbation.
  const hasPullRequestRule = (protection?.requiredReviews !== null && protection?.requiredReviews !== undefined) || reviewRules.length > 0;
  out.push(
    dependsOnBp01(reviewBase) ??
      (protectedBranch === null
        ? result(reviewBase, "unknown", "Protection illisible : impossible de vérifier les relectures obligatoires.")
        : requiredReviews >= 1
          ? result(reviewBase, "pass", `${requiredReviews} approbation(s) requise(s) avant fusion.`)
          : !canConclude
            ? result(reviewBase, "unknown", classicUnreadable)
            : result(reviewBase, "fail", hasPullRequestRule ? "Une PR est exigée mais sans approbation obligatoire." : "Aucune relecture obligatoire avant fusion.", { remediation: `Exiger au moins 1 approbation : ${settings(f, "branches")}.` }))
  );

  const forceBase: Base = { id: "BP-03", family: "branches", severity: "medium", title: "Force-push et suppression de branche interdits", scorecard: "Branch-Protection" };
  const blocksForce = protection ? protection.allowForcePushes === false : ruleTypes.has("non_fast_forward");
  const blocksDelete = protection ? protection.allowDeletions === false : ruleTypes.has("deletion");
  const blocksForceAny = blocksForce || ruleTypes.has("non_fast_forward");
  const blocksDeleteAny = blocksDelete || ruleTypes.has("deletion");
  out.push(
    dependsOnBp01(forceBase) ??
      (protectedBranch === null
        ? result(forceBase, "unknown", "Protection illisible.")
        : blocksForceAny && blocksDeleteAny
          ? result(forceBase, "pass", "Force-push et suppression bloqués.")
          : !canConclude
            ? result(forceBase, "unknown", classicUnreadable)
            : result(forceBase, "fail", `${!blocksForceAny ? "Force-push autorisé. " : ""}${!blocksDeleteAny ? "Suppression de la branche autorisée." : ""}`.trim(), { remediation: `Désactiver « Allow force pushes » et « Allow deletions » : ${settings(f, "branches")}.` }))
  );

  const checksBase: Base = { id: "BP-04", family: "branches", severity: "medium", title: "Contrôles de statut (CI) requis avant fusion", scorecard: "Branch-Protection" };
  out.push(
    dependsOnBp01(checksBase) ??
      (protectedBranch === null
        ? result(checksBase, "unknown", "Protection illisible.")
        : protection?.requiredStatusChecks || ruleTypes.has("required_status_checks")
          ? result(checksBase, "pass", "Des contrôles de statut sont requis.")
          : !canConclude
            ? result(checksBase, "unknown", classicUnreadable)
            : result(checksBase, "fail", "Aucun contrôle de statut requis : une PR peut être fusionnée sans que la CI passe.", { remediation: `Exiger les checks de CI : ${settings(f, "branches")}.` }))
  );

  const adminsBase: Base = { id: "BP-05", family: "branches", severity: "low", title: "Règles appliquées aussi aux administrateurs", scorecard: "Branch-Protection" };
  out.push(
    dependsOnBp01(adminsBase) ??
      (protection
        ? protection.enforceAdmins === true
          ? result(adminsBase, "pass", "Les administrateurs sont soumis aux mêmes règles.")
          : result(adminsBase, "fail", "Les administrateurs peuvent contourner la protection.", { remediation: `Activer « Do not allow bypassing the above settings » : ${settings(f, "branches")}.` })
        : result(adminsBase, "unknown", "Protection par rulesets : les contournements autorisés ne sont pas évalués."))
  );

  const revBase: Base = { id: "REV-01", family: "branches", severity: "medium", title: "Relectures effectives des PR fusionnées", scorecard: "Code-Review" };
  if (!f.mergedPullRequests.ok) out.push(result(revBase, "unknown", why(f.mergedPullRequests, "Historique des PR")));
  else {
    const { sampled, reviewed } = f.mergedPullRequests.data;
    if (sampled === 0) {
      out.push(result(revBase, "warning", "Aucune PR fusionnée récemment : les changements semblent poussés directement, donc sans relecture.", { remediation: "Passer par des pull requests relues pour tout changement de code." }));
    } else {
      const ratio = reviewed / sampled;
      const text = `${reviewed}/${sampled} PR fusionnées récentes ont reçu une approbation d'un autre utilisateur.`;
      out.push(result(revBase, ratio >= 0.8 ? "pass" : ratio >= 0.5 ? "warning" : "fail", text, { remediation: "Exiger des relectures (BP-02) et ne pas fusionner ses propres PR sans approbation." }));
    }
  }

  const sigBase: Base = { id: "SIG-01", family: "branches", severity: "low", title: "Commits signés (Verified)" };
  if (!f.commits.ok) out.push(result(sigBase, "unknown", why(f.commits, "Commits")));
  else {
    const { sampled, verified } = f.commits.data;
    const text = `${verified}/${sampled} commits récents sont signés et vérifiés.`;
    out.push(sampled === 0 ? result(sigBase, "na", "Aucun commit à examiner.") : result(sigBase, verified / sampled >= 0.8 ? "pass" : verified === 0 ? "fail" : "warning", text, { remediation: "Signer les commits (SSH ou GPG) et activer « Require signed commits » : https://docs.github.com/authentication/managing-commit-signature-verification" }));
  }

  // ═══ Fonctions de sécurité GitHub ═════════════════════════════════════════════
  const depBase: Base = { id: "SF-01", family: "security", severity: "high", title: "Alertes Dependabot activées", scorecard: "Vulnerabilities" };
  out.push(!f.dependabotAlerts.ok
    ? result(depBase, "unknown", why(f.dependabotAlerts, "Alertes Dependabot"))
    : f.dependabotAlerts.data
      ? result(depBase, "pass", "Les alertes Dependabot sont activées.")
      : result(depBase, "fail", "Les alertes Dependabot sont désactivées : GitHub ne signale pas les dépendances vulnérables.", { remediation: `Activer le dependency graph et les alertes Dependabot : ${settings(f, "security_analysis")}.` }));

  const ssBase: Base = { id: "SF-02", family: "security", severity: "high", title: "Secret Scanning actif" };
  let secretScanningOff = false;
  if (!meta) {
    out.push(result(ssBase, "unknown", why(f.meta as Extract<Fetched<unknown>, { ok: false }>, "Dépôt")));
  } else if (meta.secretScanning === "enabled") {
    out.push(result(ssBase, "pass", "Secret Scanning est activé."));
  } else if (meta.secretScanning === "disabled" || meta.admin) {
    secretScanningOff = true;
    out.push(result(ssBase, "fail", meta.secretScanning === "disabled" ? "Secret Scanning est désactivé." : "Secret Scanning n'est pas disponible pour ce dépôt (dépôt privé sans GitHub Secret Protection) : les secrets commités ne sont pas détectés.", { remediation: `Activer Secret Scanning (${settings(f, "security_analysis")}), ou à défaut un scan de secrets en CI / pré-commit (gitleaks).` }));
  } else {
    out.push(result(ssBase, "unknown", "Statut non lisible : droits administrateur requis."));
  }

  const ppBase: Base = { id: "SF-03", family: "security", severity: "medium", title: "Push protection (blocage des secrets au push)" };
  out.push(secretScanningOff
    ? result(ppBase, "na", "Dépend de SF-02 : Secret Scanning n'est pas actif.")
    : !meta
      ? result(ppBase, "unknown", "Dépôt illisible.")
      : meta.pushProtection === "enabled"
        ? result(ppBase, "pass", "La push protection est activée.")
        : meta.pushProtection === "disabled"
          ? result(ppBase, "fail", "La push protection est désactivée.", { remediation: `Activer la push protection : ${settings(f, "security_analysis")}.` })
          : result(ppBase, "unknown", "Statut non lisible : droits administrateur requis."));

  const csBase: Base = { id: "SF-04", family: "security", severity: "medium", title: "Analyse de code statique (CodeQL) active", scorecard: "SAST" };
  // Un outil d'analyse statique appelé par un workflow est visible sans droit particulier.
  const sastWorkflow = (f.workflows.ok ? f.workflows.data : []).find((w) =>
    w.uses.some((u) => /^(github\/codeql-action\/(analyze|init)|semgrep\/|returntocorp\/semgrep|sonarsource\/sonar|snyk\/actions|aquasecurity\/trivy-action)/i.test(u.action))
  );
  const analysesRecorded = f.codeScanning.ok && f.codeScanning.data.analyses > 0;
  if (!analysesRecorded && sastWorkflow) {
    out.push(result(csBase, "pass", `Analyse statique exécutée par ${sastWorkflow.path}${f.codeScanning.ok ? " (aucune analyse encore enregistrée)" : " (résultats non lisibles avec ce jeton)"}.`));
  } else if (!f.codeScanning.ok) {
    out.push(/not enabled|disabled/i.test(f.codeScanning.message)
      ? result(csBase, "fail", "Code scanning n'est pas activé : aucune analyse statique du code.", { remediation: `Activer CodeQL (configuration par défaut) : ${settings(f, "security_analysis")}.` })
      : result(csBase, "unknown", why(f.codeScanning, "Code scanning")));
  } else if (f.codeScanning.data.analyses === 0) {
    out.push(result(csBase, "fail", "Code scanning est actif mais aucune analyse n'a été enregistrée.", { remediation: "Lancer une première analyse CodeQL." }));
  } else {
    const last = f.codeScanning.data.lastAnalysisAt;
    const stale = last ? Date.now() - new Date(last).getTime() > 90 * 86400000 : false;
    out.push(result(csBase, stale ? "warning" : "pass", `Dernière analyse ${last ? ago(last) : "récente"}.`, { remediation: "L'analyse date de plus de 90 jours : vérifier qu'elle s'exécute à chaque push/PR." }));
  }

  const pvrBase: Base = { id: "SF-05", family: "security", severity: "low", title: "Signalement privé des vulnérabilités activé" };
  out.push(isPrivate
    ? result(pvrBase, "na", "Sans objet pour un dépôt privé.")
    : !f.privateReporting.ok
      ? result(pvrBase, "unknown", why(f.privateReporting, "Signalement privé"))
      : f.privateReporting.data
        ? result(pvrBase, "pass", "Les signalements privés de vulnérabilités sont activés.")
        : result(pvrBase, "fail", "Les chercheurs n'ont pas de canal privé pour signaler une vulnérabilité.", { remediation: `Activer « Private vulnerability reporting » : ${settings(f, "security_analysis")}.` }));

  const tree = f.tree.ok ? f.tree.data : null;
  const updBase: Base = { id: "SF-06", family: "security", severity: "medium", title: "Mises à jour automatiques des dépendances", scorecard: "Dependency-Update-Tool" };
  out.push(!tree
    ? result(updBase, "unknown", why(f.tree as Extract<Fetched<unknown>, { ok: false }>, "Arborescence"))
    : !tree.analysis.hasDependencyManifest
      ? result(updBase, "na", "Aucun manifeste de dépendances détecté.")
      : tree.analysis.has.dependabot || tree.analysis.has.renovate
        ? result(updBase, "pass", `${tree.analysis.has.dependabot ? "Dependabot" : "Renovate"} est configuré.`)
        : result(updBase, "fail", "Ni .github/dependabot.yml ni Renovate : les dépendances ne sont pas mises à jour automatiquement.", { remediation: "Ajouter .github/dependabot.yml (écosystèmes npm/pip/github-actions…) : https://docs.github.com/code-security/dependabot/dependabot-version-updates" }));

  // ═══ CI/CD — GitHub Actions ═══════════════════════════════════════════════════
  const workflows = f.workflows.ok ? f.workflows.data : null;
  const ciBases: Base[] = [
    { id: "CI-01", family: "ci", severity: "medium", title: "Actions tierces épinglées par SHA", scorecard: "Pinned-Dependencies" },
    { id: "CI-02", family: "ci", severity: "high", title: "Permissions minimales du GITHUB_TOKEN", scorecard: "Token-Permissions" },
    { id: "CI-03", family: "ci", severity: "critical", title: "Pas de pull_request_target exécutant du code de PR", scorecard: "Dangerous-Workflow" },
    { id: "CI-04", family: "ci", severity: "high", title: "Pas d'injection de script dans les workflows", scorecard: "Dangerous-Workflow" },
    { id: "CI-05", family: "ci", severity: "medium", title: "Runners auto-hébergés maîtrisés" },
  ];
  if (!workflows) {
    const reason = why(f.workflows as Extract<Fetched<unknown>, { ok: false }>, "Workflows");
    for (const b of ciBases) out.push(result(b, "unknown", reason));
  } else if (workflows.length === 0) {
    for (const b of ciBases) out.push(result(b, "na", "Aucun workflow GitHub Actions dans ce dépôt."));
  } else {
    const uses = workflows.flatMap((w) => w.uses.map((u) => ({ ...u, file: w.path })));
    const thirdParty = uses.filter((u) => !u.pinned && !u.firstParty);
    const firstParty = uses.filter((u) => !u.pinned && u.firstParty);
    const fmt = (u: (typeof uses)[number]) => `${u.action}@${u.ref} (${u.file}:${u.line})`;
    out.push(thirdParty.length > 0
      ? result(ciBases[0], "fail", `${thirdParty.length} action(s) tierce(s) référencée(s) par tag ou branche : un tag peut être déplacé vers du code malveillant (cf. compromission de tj-actions/changed-files en 2025).`, { items: thirdParty.map(fmt), remediation: "Épingler chaque action sur le SHA complet du commit (`uses: org/action@<sha> # v1.2.3`) et laisser Dependabot les mettre à jour." })
      : firstParty.length > 0
        ? result(ciBases[0], "warning", `${firstParty.length} action(s) officielle(s) (actions/*, github/*) non épinglée(s) ; aucune action tierce non épinglée.`, { items: firstParty.map(fmt), remediation: "Épingler aussi les actions officielles sur leur SHA." })
        : result(ciBases[0], "pass", `${uses.length} action(s) toutes épinglées par SHA.`));

    const missingPerms = workflows.filter((w) => !w.hasPermissions);
    const writeAll = workflows.filter((w) => w.writeAll);
    const defaultRead = f.workflowPermissions.ok && f.workflowPermissions.data.defaultPermissions === "read";
    if (writeAll.length > 0) {
      out.push(result(ciBases[1], "fail", `${writeAll.length} workflow(s) déclarent « permissions: write-all ».`, { items: writeAll.map((w) => w.path), remediation: "Remplacer write-all par les seules permissions nécessaires (`permissions: contents: read`…)." }));
    } else if (missingPerms.length === 0) {
      out.push(result(ciBases[1], "pass", `Permissions explicites dans les ${workflows.length} workflow(s).`));
    } else if (defaultRead) {
      out.push(result(ciBases[1], "pass", `${missingPerms.length}/${workflows.length} workflow(s) sans bloc permissions, mais le défaut du dépôt est en lecture seule.`));
    } else {
      out.push(result(ciBases[1], f.workflowPermissions.ok ? "fail" : "warning",
        `${missingPerms.length}/${workflows.length} workflow(s) sans bloc permissions ; ${f.workflowPermissions.ok ? "le défaut du dépôt donne un accès en écriture au jeton" : "le défaut du dépôt n'est pas lisible"}.`,
        { items: missingPerms.map((w) => w.path), remediation: `Ajouter \`permissions: contents: read\` en tête de workflow et passer le défaut du dépôt en lecture seule : ${settings(f, "actions")}.` }));
    }

    const dangerous = workflows.filter((w) => w.checksOutPullRequestHead);
    const prTarget = workflows.filter((w) => w.usesPullRequestTarget);
    out.push(dangerous.length > 0
      ? result(ciBases[2], "fail", "pull_request_target récupère le code de la PR : du code non fiable s'exécute avec accès aux secrets et au jeton en écriture.", { items: dangerous.map((w) => w.path), remediation: "Ne jamais checkout le head d'une PR sous pull_request_target ; utiliser `pull_request`, ou séparer en deux workflows (build non privilégié puis workflow_run)." })
      : prTarget.length > 0
        ? result(ciBases[2], "warning", "pull_request_target est utilisé sans récupération du code de la PR : à vérifier manuellement.", { items: prTarget.map((w) => w.path) })
        : result(ciBases[2], "pass", "Aucun pull_request_target dangereux."));

    const injections = workflows.flatMap((w) => w.injections.map((i) => `${w.path}:${i.line}  \${{ ${i.expression} }}`));
    out.push(injections.length > 0
      ? result(ciBases[3], "fail", `${injections.length} expression(s) contrôlable(s) par un tiers insérée(s) directement dans un script \`run:\` (injection de commande).`, { items: injections, remediation: "Passer la valeur par une variable d'environnement (`env: TITLE: ${{ … }}` puis `\"$TITLE\"`) au lieu de l'interpoler dans le script." })
      : result(ciBases[3], "pass", "Aucune interpolation dangereuse dans les scripts `run:`."));

    const selfHosted = workflows.filter((w) => w.selfHosted);
    out.push(selfHosted.length === 0
      ? result(ciBases[4], "pass", "Aucun runner auto-hébergé.")
      : !isPrivate
        ? result(ciBases[4], "fail", "Runners auto-hébergés sur un dépôt public : une PR de fork peut y exécuter du code arbitraire.", { items: selfHosted.map((w) => w.path), remediation: "Utiliser des runners hébergés par GitHub pour les dépôts publics, ou exiger l'approbation des workflows de fork." })
        : result(ciBases[4], "warning", "Runners auto-hébergés : vérifier qu'ils sont éphémères et isolés.", { items: selfHosted.map((w) => w.path) }));
  }

  // ═══ Secrets et fichiers sensibles ════════════════════════════════════════════
  const secBase: Base = { id: "SEC-01", family: "secrets", severity: "high", title: "Aucun fichier sensible versionné" };
  const artBase: Base = { id: "SEC-02", family: "secrets", severity: "low", title: "Aucun binaire ni dépendance versionnés", scorecard: "Binary-Artifacts" };
  if (!tree) {
    const reason = why(f.tree as Extract<Fetched<unknown>, { ok: false }>, "Arborescence");
    out.push(result(secBase, "unknown", reason), result(artBase, "unknown", reason));
  } else {
    const high = tree.analysis.sensitive.filter((s) => s.confidence === "high");
    const low = tree.analysis.sensitive.filter((s) => s.confidence === "low");
    const fmt = (s: { path: string; label: string }) => `${s.path} — ${s.label}`;
    out.push(high.length > 0
      ? result(secBase, "fail", `${high.length} fichier(s) sensible(s) dans la branche par défaut : un secret versionné reste lisible dans tout l'historique même après suppression.`, { items: high.map(fmt), remediation: "Retirer le fichier (`git rm --cached`), l'ajouter au .gitignore, RÉVOQUER/renouveler les secrets concernés, puis purger l'historique si le dépôt est ou sera partagé (git filter-repo)." })
      : low.length > 0
        ? result(secBase, "warning", `${low.length} fichier(s) de ce type dans des dossiers de tests/exemples (clés factices probables).`, { items: low.map(fmt) })
        : tree.truncated
          ? result(secBase, "unknown", "Arborescence tronquée par GitHub : analyse incomplète, aucun fichier sensible vu.")
          : result(secBase, "pass", "Aucun fichier sensible détecté dans l'arborescence (le contenu des fichiers n'est pas analysé)."));
    out.push(tree.analysis.artifacts.length > 0
      ? result(artBase, "warning", `${tree.analysis.artifacts.length} binaire(s) ou dossier(s) de dépendances versionné(s).`, { items: tree.analysis.artifacts, remediation: "Ne pas commiter d'exécutables ni de node_modules/vendor : les produire au build." })
      : result(artBase, "pass", "Aucun binaire exécutable ni dossier de dépendances versionné."));
  }

  // ═══ Gouvernance et chaîne d'approvisionnement ════════════════════════════════
  const govBases: Base[] = [
    { id: "GOV-01", family: "governance", severity: "medium", title: "Politique de sécurité (SECURITY.md)", scorecard: "Security-Policy" },
    { id: "GOV-02", family: "governance", severity: "low", title: "Propriétaires du code (CODEOWNERS)" },
    { id: "GOV-03", family: "governance", severity: "low", title: "Licence déclarée", scorecard: "License" },
    { id: "GOV-04", family: "governance", severity: "medium", title: "Lockfiles présents (versions reproductibles)", scorecard: "Pinned-Dependencies" },
  ];
  if (!tree) {
    const reason = why(f.tree as Extract<Fetched<unknown>, { ok: false }>, "Arborescence");
    for (const b of govBases) out.push(result(b, "unknown", reason));
  } else {
    const a = tree.analysis;
    const inherited = f.inheritedSecurityPolicy.ok && f.inheritedSecurityPolicy.data;
    out.push(isPrivate ? result(govBases[0], "na", "Sans objet pour un dépôt privé.") : a.has.securityPolicy ? result(govBases[0], "pass", "SECURITY.md présent.") : inherited ? result(govBases[0], "pass", `Politique héritée du dépôt ${f.owner}/.github (commune à tous les dépôts du propriétaire).`) : !f.inheritedSecurityPolicy.ok ? result(govBases[0], "unknown", why(f.inheritedSecurityPolicy, "Politique héritée")) : result(govBases[0], "fail", "Aucune politique de sécurité : les chercheurs ne savent pas comment signaler une faille.", { remediation: "Ajouter SECURITY.md (versions supportées, contact, délais) : https://docs.github.com/code-security/getting-started/adding-a-security-policy-to-your-repository" }));
    out.push(a.has.codeowners ? result(govBases[1], "pass", "CODEOWNERS présent.") : result(govBases[1], "fail", "Pas de CODEOWNERS : aucun relecteur désigné automatiquement.", { remediation: "Ajouter .github/CODEOWNERS et exiger la revue des propriétaires (BP-02)." }));
    out.push(isPrivate ? result(govBases[2], "na", "Sans objet pour un dépôt privé.") : a.has.license ? result(govBases[2], "pass", "Licence présente.") : result(govBases[2], "fail", "Aucune licence : le code public n'est pas réutilisable légalement.", { remediation: "Ajouter un fichier LICENSE (https://choosealicense.com)." }));
    const rootGaps = a.lockfileGaps.filter((g) => g.root);
    const fmt = (g: { ecosystem: string; path: string; missing: string }) => `${g.ecosystem} : ${g.path} — manque ${g.missing}`;
    out.push(!a.hasDependencyManifest
      ? result(govBases[3], "na", "Aucun manifeste de dépendances.")
      : rootGaps.length > 0
        ? result(govBases[3], "fail", "Manifeste à la racine sans lockfile : les versions installées changent d'un build à l'autre.", { items: a.lockfileGaps.map(fmt), remediation: "Committer le lockfile (`npm install` → package-lock.json) et installer avec `npm ci`." })
        : a.lockfileGaps.length > 0
          ? result(govBases[3], "warning", `${a.lockfileGaps.length} sous-projet(s) sans lockfile.`, { items: a.lockfileGaps.map(fmt) })
          : result(govBases[3], "pass", "Tous les manifestes ont leur lockfile."));
  }

  // ═══ Accès et intégrations (droits administrateur) ════════════════════════════
  const accBases: Base[] = [
    { id: "ACC-01", family: "access", severity: "medium", title: "Clés de déploiement en lecture seule" },
    { id: "ACC-02", family: "access", severity: "medium", title: "Webhooks sécurisés (HTTPS + secret)", scorecard: "Webhooks" },
    { id: "ACC-03", family: "access", severity: "medium", title: "Pas de collaborateur externe administrateur" },
  ];
  out.push(!f.deployKeys.ok
    ? result(accBases[0], "unknown", why(f.deployKeys, "Clés de déploiement"))
    : (() => {
        const rw = f.deployKeys.data.filter((k) => !k.readOnly);
        return rw.length > 0
          ? result(accBases[0], "fail", `${rw.length} clé(s) de déploiement avec accès en écriture : sa compromission permet de modifier le code.`, { items: rw.map((k) => k.title), remediation: `Passer les clés en lecture seule ou les supprimer : ${settings(f, "keys")}.` })
          : result(accBases[0], "pass", f.deployKeys.data.length === 0 ? "Aucune clé de déploiement." : `${f.deployKeys.data.length} clé(s), toutes en lecture seule.`);
      })());
  out.push(!f.webhooks.ok
    ? result(accBases[1], "unknown", why(f.webhooks, "Webhooks"))
    : (() => {
        const bad = f.webhooks.data.filter((h) => h.url.startsWith("http://") || h.insecureSsl);
        const noSecret = f.webhooks.data.filter((h) => !h.hasSecret && !bad.includes(h));
        const fmt = (h: { url: string }) => h.url.replace(/(\/\/[^/]+).*/, "$1/…");
        return bad.length > 0
          ? result(accBases[1], "fail", `${bad.length} webhook(s) en HTTP ou sans vérification TLS.`, { items: bad.map(fmt), remediation: `Utiliser HTTPS avec vérification TLS : ${settings(f, "hooks")}.` })
          : noSecret.length > 0
            ? result(accBases[1], "warning", `${noSecret.length} webhook(s) sans secret : le destinataire ne peut pas vérifier l'origine des appels.`, { items: noSecret.map(fmt), remediation: "Définir un secret et vérifier la signature X-Hub-Signature-256." })
            : result(accBases[1], "pass", f.webhooks.data.length === 0 ? "Aucun webhook." : `${f.webhooks.data.length} webhook(s) en HTTPS avec secret.`);
      })());
  out.push(!f.outsideAdmins.ok
    ? result(accBases[2], "unknown", why(f.outsideAdmins, "Collaborateurs externes"))
    : f.outsideAdmins.data.length > 0
      ? result(accBases[2], "fail", `${f.outsideAdmins.data.length} collaborateur(s) externe(s) avec les droits administrateur.`, { items: f.outsideAdmins.data, remediation: `Réduire à « write » ou retirer : ${settings(f, "access")}.` })
      : result(accBases[2], "pass", "Aucun collaborateur externe administrateur."));

  return out;
}

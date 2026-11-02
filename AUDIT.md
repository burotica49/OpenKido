# Audit Openkido — sécurité, fonctionnel, et feuille de route « audit approfondi »

**Date :** 2026-10-21 · **Périmètre :** code source, dépendances (`npm audit`), build Next.js (manifeste des Server Actions), packaging Electron/DMG, Dockerfile, historique git.
**Méthode :** lecture du code + inspection du build. Aucun test destructif ni appel réseau offensif n'a été exécuté (en particulier `revokeGithubSession`, qui vide la base).
**Contexte retenu :** deux modes de déploiement — desktop (Electron, serveur lié à `127.0.0.1`) et web (Dokploy, exposé sur Internet). Plusieurs constats ont une gravité très différente selon le mode ; elle est précisée à chaque fois.

---

## 1. Synthèse

L'application fonctionne et le modèle de sécurité de base est correct (cookies de session chiffrés par Auth.js, `contextIsolation` activé, `nodeIntegration` désactivé, toutes les pages vérifient la session, conteneur non-root, `.env*` exclus de git et de l'image Docker). Mais trois sujets dominent :

1. **Les Server Actions sont des endpoints publics non protégés** et le **jeton GitHub (scope `repo`, lecture + écriture) est envoyé au navigateur**. En mode web, c'est le problème n°1.
2. **Les dépendances embarquent des failles critiques** : Next.js 16.3.1 (RCE) et Electron 43.1.0 (4 failles « high »).
3. **Le scanner peut afficher « sain » alors qu'il a échoué**, et la page Conformité affiche des « conforme » sans preuve. Pour un outil de sécurité, c'est le risque produit majeur (faux sentiment de sécurité).

---

## 2. Sécurité

### Critique

**C1 — Jeton GitHub exposé au navigateur et accepté en paramètre par des actions serveur**
- `src/lib/auth.ts:38` copie `accessToken` dans la session ; `useSession()` le rend disponible dans le JS du client (`src/app/code-audit/audit-client.tsx:102`, `src/app/code-quality/quality-client.tsx:87`), qui le renvoie à `auditRepo(token, …)`, `auditAllRepos(token, …)`, `analyzeRepo(token, …)`, `analyzeAllRepos(token, …)`.
- Conséquence : une seule XSS (ou une extension de navigateur malveillante) = lecture **et écriture** sur tous les dépôts privés de l'utilisateur (le scope est `repo`, voir H1).
- Correctif : ne jamais exposer `accessToken` dans le callback `session` ; les actions appellent `auth()` côté serveur (c'est déjà fait dans `src/lib/scan.ts` avec `requireAccessToken()` — il faut généraliser).

**C2 — Server Actions exposées sans authentification**
- Le manifeste du build (`.next/server/server-reference-manifest.json`) liste **toutes** les fonctions exportées des fichiers `"use server"` comme endpoints : `addDomain`, `deleteDomain`, `recheckDomain`, `checkDomain`, `listDomains`, `auditRepo`, `auditAllRepos`, `getAuditAlerts`, `getAuditSummaries`, `analyzeRepo`, `analyzeAllRepos`, `getQualitySummaries`, `scanRepo`, `getRepoScanSummaries`, `getScanTrend`, `getStaleRepos`, `saveSelectedOrg`, `revokeGithubSession`… Aucune de `domain-check.ts`, `audit.ts`, `quality.ts` ne vérifie la session.
- **`revokeGithubSession` (`src/lib/logout.ts:25`) appelle `clearLocalData()` sans condition** : un POST non authentifié suffit à vider toutes les tables (`deleteMany()` global). Les identifiants d'action des fonctions importées côté client sont publics (dans le JS statique). La protection Origin de Next ne bloque que les requêtes cross-site de navigateur, pas un `curl` portant l'en-tête `Next-Action`.
- Sont aussi atteignables : lecture de `getAuditAlerts(owner, repo)` (alertes de secrets et de code scanning de n'importe quel dépôt), ajout/suppression de domaines, et le SSRF décrit en H2.
- Gravité : **critique en mode web, faible en desktop** (serveur lié à 127.0.0.1).
- Correctif : un helper `requireSession()` appelé en première ligne de **chaque** action ; déplacer les fonctions de lecture (`get*`, `list*`) dans des modules `import "server-only"` hors des fichiers `"use server"` pour qu'elles ne deviennent pas des endpoints.

**C3 — Dépendances : failles critiques dans ce qui est livré**
- `next` 16.3.1 (`package.json`) : RCE non authentifiée dans l'API d'optimisation d'images avec AVIF (corrigé en 16.3.3), RCE dans `next/og` (16.3.6), SSRF dans l'optimisation d'images, empoisonnement de cache ISR/SSG (16.3.8). Correctif : **16.4.2** (indiqué par `npm audit`). L'app active l'optimiseur via `images.remotePatterns` (`next.config.ts:5`) : exposé sur la version web.
- `electron` 43.1.0 : 4 failles « high » (fenêtres non sandboxées héritées, lecture cross-origin via protocoles file/http, cache de code du preload empoisonnable, `<webview>` + Node dans les workers). Correctif : **≥ 43.5.0**.
- `npm audit` : 41 avis au total (4 critiques : `next`, `concurrently`, `proxy-addr`, `shell-quote` ; 23 « high »), la plupart dans l'outillage de build (electron-builder, shadcn) donc non livrés. `prisma` et `shadcn` sont en `dependencies` alors que ce sont des outils de build : à passer en `devDependencies`.

### Élevé

**H1 — Scope OAuth trop large (`src/lib/auth.ts:16`)**
`repo` donne l'écriture sur le code de tous les dépôts privés ; l'app ne fait que lire. Une OAuth App ne permet pas mieux. Cible : une **GitHub App** avec permissions en lecture seule (Metadata, Contents, Pull requests, Actions, Administration, Dependabot/Code scanning/Secret scanning alerts), jetons expirants (8 h + refresh), et Device Flow pour le desktop (plus de secret client à embarquer — voir H3).

**H2 — SSRF dans la vérification de domaines (`src/lib/domain-check.ts`)**
`checkDomain` et `recheckDomain` (lignes 72, 157) n'appliquent **aucune validation** (seul `addDomain` en a une, ligne 140) ; `fetch(..., redirect: "follow")` (ligne 101) suit les redirections ; aucun blocage des IP privées/loopback/link-local (`169.254.169.254`, `10.x`, `localhost:port`). Un nom de domaine public pointant vers `127.0.0.1` passe la regex. Sur Dokploy : scan de ports et du réseau interne, accès aux métadonnées cloud (réponse partiellement lisible via les en-têtes testés).
Correctif : résoudre le DNS d'abord, refuser tout sauf les IP publiques, **épingler l'IP résolue** pour la connexion (anti-rebinding), limiter les redirections, valider le format dans toutes les fonctions.

**H3 — Secrets embarqués dans le DMG**
`scripts/after-pack.js:33` copie `.env.local` dans l'app : `GITHUB_CLIENT_SECRET` et `AUTH_SECRET` sont extractibles par quiconque reçoit le DMG. Si le même `AUTH_SECRET` sert sur Dokploy, un tiers peut **forger des cookies de session** pour l'instance web. Le secret client permet d'usurper l'application OAuth. OK pour un usage strictement interne ; à corriger avant toute distribution (Device Flow + `AUTH_SECRET` généré aléatoirement au premier lancement, stocké via `safeStorage`/Keychain).

**H4 — Aucun contrôle d'accès ni isolation multi-utilisateur (mode web)**
- N'importe quel compte GitHub peut se connecter à l'instance : pas de liste blanche dans un callback `signIn`.
- Les tables n'ont pas de dimension « utilisateur » : `Domain` est global (`listDomains()` renvoie les domaines de tous), `RepoScan` est indexé par `owner/repo` uniquement, et `clearLocalData()` (`logout.ts:7`) fait des `deleteMany()` **globaux** : la déconnexion d'un utilisateur efface les données de tous les autres.
- Correctif rapide : variable `ALLOWED_GITHUB_LOGINS`/`ALLOWED_GITHUB_ORGS` vérifiée dans `signIn`, et documenter que l'instance web est mono-tenant. Correctif propre : colonne `githubLogin` (ou `installationId`) sur toutes les tables + filtrage systématique.

**H5 — Faux « sain » quand le scan échoue**
- `src/lib/osv.ts:184` : si OSV est injoignable ou renvoie une erreur, `data` reste `null` et **toutes** les dépendances sortent avec `vulns: []` → « sain ». `fetchVulnDetails` (l.140-160) supprime silencieusement les failles dont le détail n'a pas pu être récupéré.
- `src/lib/github.ts:258` et `:319` (`catch {}`) : une erreur GitHub (limite de débit, 403, 5xx) donne « aucune dépendance ».
- `scanRepo` (`scan.ts:165`) **persiste** ce résultat vide (upsert + ligne `ScanHistory`) : l'ancien bon résultat est écrasé et le graphique de tendance montre une amélioration artificielle.
- Correctif : un résultat porte un état (`complete | partial | failed`) ; en cas d'échec on ne persiste pas, on conserve le dernier bon scan et on affiche l'erreur.

**H6 — Page Conformité : contrôles qui passent sans preuve (`src/lib/compliance.ts`)**
- l.32 : `(s as any).secrets` n'existe jamais → CC6.1 « Aucun secret exposé » est **toujours conforme**.
- l.77 « Paquets malveillants bloqués… détection activée », l.118 « Politique whitelist/blacklist active », l.247 « composants vérifiés dans la chaîne d'approvisionnement », l.256 « Audit trail disponible » : retournent `pass` inconditionnellement — la fonctionnalité décrite n'existe pas.
- Présenter SOC 2 / ISO 27001 / PCI DSS comme « conformes » sur cette base est trompeur (et engage la responsabilité de l'éditeur). Correctif : un contrôle sans donnée = `unknown` (jamais `pass`), preuves issues des vrais contrôles (voir §4), mention « aide à la préparation, pas une certification ».

### Moyen

- **M1 — Bases SQLite versionnées malgré `.gitignore`** : `prisma/openkido.db` (270 Ko, 25 scans de `burotica49`), `build/template.db`, `dev.db`, ainsi que `src/generated/prisma` (13 fichiers) et deux `.DS_Store` sont suivis. Le dépôt est privé aujourd'hui (vérifié), donc risque limité, mais ces fichiers sont dans l'historique. `git rm --cached` ; réécrire l'historique seulement si le dépôt devait devenir public.
- **M2 — Dockerfile** : `npx prisma migrate deploy` au démarrage (l.60) alors que le paquet `prisma` n'est **pas** dans l'image runner → `npx` télécharge « la dernière version » depuis npm à chaque démarrage (risque supply chain, échec hors ligne). Reprendre l'approche du desktop (base pré-migrée) ou embarquer `prisma` épinglé. Les `ARG` de secrets (l.13-16) sont inutiles pour `next build` et visibles dans `docker history` du stage builder. Images non épinglées par digest, pas de `HEALTHCHECK`.
- **M3 — Aucun en-tête de sécurité** (`next.config.ts` n'a pas de `headers()`) : ni CSP, ni `X-Frame-Options`/`frame-ancestors`, ni HSTS, `Referrer-Policy`, `Permissions-Policy`. L'app vérifie ces en-têtes chez les autres mais pas chez elle. À ajouter (la CSP est aussi la meilleure parade à C1).
- **M4 — Durcissement Electron** (`electron/main.ts`) : `shell.openExternal(url)` sans filtre de schéma (l.193 — n'autoriser que `https:`), aucun garde `will-navigate`/`will-redirect` (limiter aux origines `localhost` et `github.com`), pas de `setPermissionRequestHandler` (refuser tout), handler IPC sans vérification de l'origine de l'appelant (l.45), l'API de preload est exposée aussi aux pages `github.com` chargées dans la même fenêtre. DMG **non notarisé** (Gatekeeper bloquera les autres utilisateurs) ; l'entitlement `allow-unsigned-executable-memory` est probablement superflu.
- **M5 — `trustHost: true` sans `AUTH_URL` explicite** (`auth.ts:9`) : l'URL de callback est dérivée des en-têtes `Host`/`X-Forwarded-Host`. Définir `AUTH_URL` sur Dokploy.
- **M6 — Hygiène projet** : aucun test, aucun CI (`.github/` absent), pas de Dependabot/Renovate, pas de `SECURITY.md`, pas de `LICENSE`. `next-auth` est en bêta (`5.0.0-beta.32`) : surveiller les mises à jour.
- **M7 — Abus et validation** : `scanAllRepos(repos[])` accepte un tableau non borné fourni par le client (consommation du quota GitHub, déni de service) ; aucun rate limiting ; `owner`/`repo`/`branch` jamais validés par un schéma (zod).

### Faible / informatif

- Les pages détail (`repos/[owner]/[repoName]/page.tsx:30`, `inventory/page.tsx:36`, `components/[componentId]/page.tsx:28`) **lancent un scan complet à chaque affichage** (écritures en base sur un GET, trois scans en naviguant, consommation du quota GitHub). Lire la base et proposer un bouton « Rescanner ».
- `settings/page.tsx` affiche le chemin complet de la base (diagnostic) — à masquer en mode web.
- Pas de purge de `ScanHistory` (croissance illimitée) ; pas de chiffrement de la base au repos (libsql supporte une clé de chiffrement ; clé dans le Keychain via `safeStorage`).
- Code mort : `src/lib/data.ts` (345 lignes, jamais importé), `repo-card.tsx`, `metric-card.tsx`.

---

## 3. Fonctionnel

### Exactitude du scanner (impacte directement la confiance)

| Problème | Où | Effet |
|---|---|---|
| Versions non résolues : `^4.17.0` devient `4.17.0` | `github.ts:238` | Faux positifs (failles déjà corrigées dans la version réellement installée) |
| Aucun lockfile lu → **dépendances transitives absentes** | `getDependencies` | La majorité des failles réelles est invisible |
| devDependencies traitées comme les dépendances de prod | `parsePackageJson` | Score gonflé par l'outillage de build |
| Seuls `package.json` et `requirements.txt` | `github.ts` | Pas de `go.mod`, `Cargo.lock`, `pom.xml`, `composer.lock`, `Gemfile.lock`, `poetry.lock`/`pyproject.toml`… |
| Regex `requirements.txt` ignore `~=`, extras, marqueurs | `parseRequirements` | Dépendances Python ignorées silencieusement |
| Plafond `MAX_MANIFESTS = 40` | `github.ts:231` | Gros monorepos tronqués sans avertissement |
| Dependabot/Code scanning : 100 alertes max, sans pagination | `audit.ts:69,96,122` | Sous-comptage |
| 403/404 → `[]` affiché « Aucune ✓ » | `audit.ts:84,110,136` | « Fonction désactivée » confondu avec « dépôt sain » |
| Qualité : `pyproject.toml` compte comme lint **et** format **et** tests | `quality.ts` (`LINT_FILES`, `FORMAT_FILES`, `TEST_CONFIG`) | +50 points pour tout projet Python |
| Qualité : n'importe quel fichier dans `.github/workflows` = « CI » | `quality.ts` | Un simple workflow de déploiement vaut « CI + tests » |
| SSL « valide » si `socket.authorized \|\| daysLeft > 0` avec `rejectUnauthorized: false` | `domain-check.ts:32-45` | Certificat auto-signé ou au mauvais nom d'hôte affiché « valide » |

### Fonctionnalités manquantes (par valeur décroissante)

1. **Corrections actionnables** : la version corrigée est déjà extraite (`fixedVersion`) mais pas exploitée → bouton « Ouvrir une PR de mise à jour ».
2. **Notifications** : nouvelle CVE critique, certificat expirant (< 15 j), secret détecté (notification macOS en desktop, webhook Slack/Discord en web).
3. **Priorisation par exploitabilité** : EPSS (api.first.org) et catalogue CISA KEV, au lieu du seul CVSS.
4. **Gestion des alertes** : ignorer/accepter un risque avec justification et échéance, assignation, filtres.
5. **Exports** : SBOM (CycloneDX/SPDX), CSV, PDF (le bouton « Exporter PDF » de Conformité ne fait rien).
6. **Domaines** : sous-domaines (Certificate Transparency/crt.sh), SPF/DKIM/DMARC/CAA/DNSSEC, versions TLS, drapeaux des cookies, expiration du nom de domaine, **re-vérification automatique** (les domaines ne sont pas dans `AutoScan`).
7. **Tableau de bord d'accueil** (score global, alertes récentes), recherche globale, état d'ignorance des alertes.
8. Barre supérieure : recherche/notifications/réglages sont commentés ; page Paramètres minimale.

---

## 4. Auditer les dépôts GitHub en profondeur

### 4.1 Principe d'architecture : un moteur de contrôles

Aujourd'hui : 3 sources (CVE de dépendances, alertes GitHub, qualité par présence de fichiers). Proposition : un registre de **contrôles** homogènes.

```ts
type Control = {
  id: string;                    // ex. "BP-001"
  family: "posture" | "ci" | "secrets" | "supply-chain" | "governance" | "access";
  severity: "critical" | "high" | "medium" | "low";
  standards: string[];           // ["Scorecard:Branch-Protection", "CIS-SSC:1.1.3", "SOC2:CC8.1"]
  evaluate(ctx): Result;
};
type Result =
  | { state: "pass"; evidence: string }
  | { state: "fail"; evidence: string; remediation: Remediation }
  | { state: "unknown"; reason: "no-permission" | "feature-off" | "api-error" }   // JAMAIS traité comme pass
  | { state: "n/a" };
```

Règles : **tri-état** (un contrôle non évaluable n'est jamais vert), **couverture affichée** (« 31/38 contrôles évalués »), **preuve** attachée à chaque résultat (réutilisable pour la page Conformité et l'export PDF — fini les `pass` codés en dur), **cache par ETag** (`If-None-Match` : les réponses 304 ne consomment pas le quota GitHub).

L'arbre du dépôt (`git/trees/{branch}?recursive=1`, **déjà appelé** pour les manifestes) fournit gratuitement la liste de tous les fichiers : workflows, lockfiles, Dockerfile, fichiers sensibles… un seul appel pour de nombreux contrôles.

### 4.2 Catalogue de contrôles

**A. Posture du dépôt (protection, paramètres)**

| Contrôle | Source (API GitHub) | Règle |
|---|---|---|
| Protection de branche par défaut | `GET /repos/{o}/{r}/branches/{b}/protection` + `GET /repos/{o}/{r}/rules/branches/{b}` (rulesets) | fail si 404 ; vérifier : PR obligatoire, ≥ 1 relecture, rejet des revues obsolètes, CODEOWNERS requis, checks de statut requis, force-push et suppression interdits, règles appliquées aux admins |
| Fonctions de sécurité activées | `GET /repos/{o}/{r}` → `security_and_analysis` | secret scanning, push protection, Dependabot security updates |
| CodeQL actif | `GET /repos/{o}/{r}/code-scanning/default-setup` + `…/code-scanning/analyses` | distingue « désactivé » de « aucune alerte » ; analyse récente < 30 j |
| Signalement privé de vulnérabilités | `GET /repos/{o}/{r}/private-vulnerability-reporting` | enabled |
| Revues effectives | échantillon de PR fusionnées (`pulls?state=closed`, `pulls/{n}/reviews`) | fusionnées sans revue, ou par leur auteur |
| Commits signés | `GET /repos/{o}/{r}/commits` → `commit.verification.verified` | taux de commits vérifiés |
| Dépôt archivé/inactif, forks autorisés, visibilité | `GET /repos/{o}/{r}` | informatif / dépôt privé forkable |

**B. CI/CD — GitHub Actions** (le vecteur d'attaque supply chain le plus actif)

| Contrôle | Source | Règle |
|---|---|---|
| Actions non épinglées par SHA | parse `.github/workflows/*.yml` | `uses: org/action@v4` → fail ; `@<sha 40 car.>` → pass |
| Permissions du `GITHUB_TOKEN` | YAML + `GET /repos/{o}/{r}/actions/permissions/workflow` | pas de bloc `permissions:` ou défaut « write » → fail ; cible : `contents: read` |
| Workflows dangereux | YAML | `pull_request_target` + checkout du code de la PR ; injection `${{ github.event.*.title/body/head_ref }}` dans un `run:` ; `secrets: inherit` ; `runs-on: self-hosted` sur dépôt public |
| Politique des actions autorisées | `GET /repos/{o}/{r}/actions/permissions` | `allowed_actions: all` → avertir ; préférer `selected` |
| Secrets de dépôt / environnements | `GET /repos/{o}/{r}/actions/secrets` (noms seulement), environnements avec relecteurs requis | déploiement prod sans approbation |

Référence : mêmes règles que OpenSSF Scorecard (`Token-Permissions`, `Pinned-Dependencies`, `Dangerous-Workflow`) et les linters `zizmor` / `actionlint`.

**C. Secrets**

| Contrôle | Source | Règle |
|---|---|---|
| Alertes GitHub (déjà fait) | `…/secret-scanning/alerts` | + paginer, + indiquer si le secret est encore **valide** (`validity`) |
| **Fichiers sensibles versionnés** | arbre git (aucun téléchargement) | `.env*`, `*.pem`, `*.p12`, `id_rsa*`, `*.keystore`, `terraform.tfstate`, `credentials.json`, `.npmrc` avec jeton, `*.sqlite`/`*.db`, `*.sql` — **détecterait immédiatement les `.db` de ce projet** |
| Motifs de secrets dans le contenu | téléchargement ciblé des fichiers de config + règles type gitleaks (AKIA…, `-----BEGIN … PRIVATE KEY-----`, `sk_live_…`, jetons Slack/GitHub) + entropie | fail avec fichier:ligne |
| **Historique git** | clone « bare » superficiel + gitleaks/trufflehog (moteur local optionnel) | un secret supprimé reste valide tant qu'il n'est pas révoqué |

**D. Chaîne d'approvisionnement**

| Contrôle | Source | Règle |
|---|---|---|
| **SBOM complet avec transitifs** | `GET /repos/{o}/{r}/dependency-graph/sbom` (SPDX, versions *résolues* issues des lockfiles) | alimente `OSV querybatch` à la place de `package.json` — règle d'un coup les faux positifs de versions et les dépendances transitives manquantes (si le dependency graph est actif ; sinon repli : parser les lockfiles) |
| Lockfile présent et cohérent | arbre git | `package-lock.json`/`pnpm-lock.yaml`/`yarn.lock`… absent → fail |
| Outil de mise à jour automatique | `.github/dependabot.yml` / `renovate.json` | présent **et** couvre les écosystèmes réellement détectés |
| Licences à risque | champ `licenseConcluded` du SBOM | GPL/AGPL/SSPL dans un produit propriétaire |
| Santé des paquets | registre npm/PyPI + Scorecard des dépendances | paquet déprécié, non maintenu, scripts `postinstall` |
| Binaires versionnés | arbre git | `.exe/.dll/.jar/.so/.dylib/.class` (Scorecard `Binary-Artifacts`) |
| Priorisation | EPSS + CISA KEV | tri par probabilité d'exploitation, pas seulement CVSS |

**E. Conteneurs, IaC, SAST** (moteurs locaux optionnels, voir 4.4)

| Contrôle | Outil | Règle |
|---|---|---|
| Dockerfile | règles hadolint (ou parsing maison) | `latest`/image non épinglée, exécution en root, `ADD` d'URL, secrets en `ARG`/`ENV` |
| IaC (Terraform, K8s, Compose) | Trivy config / Checkov | buckets publics, ports ouverts, privilèges excessifs |
| Code | CodeQL (si activé) ou Semgrep sur clone | proposer d'activer CodeQL en ouvrant une PR avec `codeql.yml` |

**F. Gouvernance et accès**

| Contrôle | Source | Règle |
|---|---|---|
| Fichiers de gouvernance | arbre git + `GET /repos/{o}/{r}/community/profile` | `SECURITY.md`, `CODEOWNERS` (racine, `docs/`, `.github/`), `LICENSE`, modèles d'issue/PR |
| Clés de déploiement | `GET /repos/{o}/{r}/keys` | clés en écriture, anciennes, non utilisées |
| Webhooks | `GET /repos/{o}/{r}/hooks` | URL `http://`, `insecure_ssl`, absence de secret |
| Collaborateurs externes | `GET /repos/{o}/{r}/collaborators?affiliation=outside` | admins externes |
| Organisation | `GET /orgs/{org}` (`two_factor_requirement_enabled`, `default_repository_permission`, `members_can_create_public_repositories`) ; `GET /orgs/{org}/members?filter=2fa_disabled` | 2FA non imposée, permission par défaut trop large |
| Applications OAuth/GitHub installées | paramètres d'organisation | applications avec accès large |

### 4.3 Remédiation guidée (transformer le constat en action)

- **PR automatiques** (créer une branche, committer via l'API Contents, ouvrir la PR) : `.github/dependabot.yml`, `SECURITY.md`, `CODEOWNERS`, `codeql.yml`, durcissement des workflows (`permissions: contents: read`, épinglage SHA), montée de version d'une dépendance vulnérable (`fixedVersion` déjà disponible).
- **Actions API en un clic** (avec confirmation) : `PUT /repos/{o}/{r}/vulnerability-alerts`, `PUT /repos/{o}/{r}/automated-security-fixes`, `PATCH /repos/{o}/{r}` (`security_and_analysis`), `PUT …/branches/{b}/protection`. Certaines fonctions (secret scanning, push protection, CodeQL sur dépôt privé) sont **payantes** hors Enterprise — l'indiquer avant de proposer l'action.
- Ces écritures doivent être **optionnelles et séparées** de la lecture (permissions d'écriture demandées uniquement quand l'utilisateur active « Appliquer les correctifs »).

### 4.4 Permissions, limites, déploiement

- **GitHub App** en lecture seule par défaut. Permissions à demander (à confirmer endpoint par endpoint dans la doc) : Metadata, Contents, Pull requests, Actions, Administration (protection de branche, clés, hooks, collaborateurs), Dependabot alerts, Code scanning alerts, Secret scanning alerts ; côté organisation : Members (2FA). Écriture (Contents, Pull requests, Administration) uniquement pour le mode correction.
- **Quota** : 5 000 requêtes/h par jeton. Compter ~25 à 40 appels par dépôt pour le catalogue complet → échelonner (file d'attente avec budget), ETag, et ne ré-évaluer que ce qui a changé (`pushed_at`, `updated_at`).
- **Moteurs locaux** (gitleaks, semgrep, trivy, osv-scanner, git) : possibles en desktop **hors App Store** (DMG notarisé) et en Docker (conteneur auxiliaire). **Incompatibles avec la sandbox du Mac App Store** (pas de sous-processus arbitraires, pas de clone) : c'est un critère de choix de distribution — la lecture via API reste compatible.
- **Notation** : aligner la grille sur **OpenSSF Scorecard** et le **CIS Software Supply Chain Security Guide** (crédibilité + correspondance directe avec la page Conformité). Pour les dépôts publics, `https://api.securityscorecards.dev/projects/github.com/{o}/{r}` fournit un score de référence gratuit.

---

## 5. Plan d'action recommandé

**Étape 0 — Immédiat (≈ ½ journée)**
1. Mettre à jour `next` → 16.4.2 et `electron` → ≥ 43.5.0 ; `prisma` et `shadcn` en `devDependencies` ; reconstruire le DMG et l'image.
2. `git rm --cached` sur `prisma/openkido.db`, `build/template.db`, `dev.db`, `src/generated/prisma`, `.DS_Store`.
3. Dockerfile : retirer les `ARG` de secrets ; remplacer `npx prisma migrate deploy` par une base pré-migrée.
4. Retirer les contrôles de conformité codés en dur (`unknown` à la place de `pass`).

**Étape 1 — Sécurité applicative (≈ 1-2 jours)**
5. Retirer `accessToken` de la session client ; `requireSession()` dans toutes les actions ; sortir les lecteurs dans des modules `server-only` (C1, C2).
6. Rendre `clearLocalData` non global (ou strictement desktop) ; `ALLOWED_GITHUB_LOGINS` dans `signIn` (H4).
7. Garde anti-SSRF dans `domain-check.ts` ; en-têtes de sécurité + CSP ; durcissement Electron (H2, M3, M4).

**Étape 2 — Fiabilité du scanner (≈ 2-3 jours)**
8. États `complete/partial/failed`, aucune persistance d'un échec, pagination des alertes, `unknown` vs `pass` (H5).
9. Source SBOM GitHub (+ repli lockfiles), séparation prod/dev, plus d'écosystèmes.
10. Pages détail : lire la base au lieu de rescanner à chaque visite.

**Étape 3 — Audit approfondi (itératif)**
11. v1 : moteur de contrôles + familles A (posture), B (workflows), F (gouvernance) + fichiers sensibles via l'arbre git — tout en lecture API, sans moteur externe.
12. v2 : remédiation par PR, notifications, EPSS/KEV, exports SBOM/PDF.
13. v3 : migration vers une GitHub App + Device Flow ; moteurs locaux optionnels (gitleaks, semgrep, trivy).
14. Mettre en place le CI (typecheck, lint, tests des fonctions pures : parsers, scoring, évaluation des contrôles), Dependabot, `SECURITY.md`.

---

## 6. Statut des correctifs (étapes 0 et 1 appliquées le 2026-10-21)

| Constat | Statut | Ce qui a été fait / vérifié |
|---|---|---|
| C1 Jeton GitHub exposé au navigateur | **Corrigé** | `/api/auth/session` ne renvoie plus `accessToken` (wrapper dans `api/auth/[...nextauth]/route.ts`) ; plus aucun composant client ne manipule le jeton ; les actions lisent la session côté serveur. Vérifié sur le serveur de production avec un cookie de session simulé : le navigateur reçoit l'utilisateur sans jeton, le serveur transmet bien le jeton à GitHub. |
| C2 Server Actions sans authentification | **Corrigé** | `src/lib/actions/*.ts` : `requireSession()` + validation des entrées + vérification d'accès au dépôt (`getRepoAccess`) dans chaque action. Les fichiers `scan.ts`, `audit.ts`, `quality.ts`, `domain-check.ts` sont devenus des modules `server-only`. Endpoints exposés : **20 → 11**. `revokeGithubSession` ne vide plus rien sans session. 19 attaques simulées bloquées (voir ci-dessous). |
| C3 Dépendances critiques | **Corrigé** | `next` 16.3.1 → 16.4.2, `electron` 43.1.0 → 43.8.3, `@prisma/*` alignés en 7.10.1, `npm audit fix` : **0 critique** (4 avant) et **0 vulnérabilité en production**. Restent 18 avis dans l'outillage de build (electron-builder, shadcn, eslint-config-next) dont le « correctif » proposé par npm est une rétrogradation. |
| H2 SSRF (domaines) | **Corrigé** | `src/lib/net-guard.ts` : validation stricte du nom, résolution DNS, refus de toute adresse non publique (IPv4, IPv6, IPv4-mappées), connexion sur l'IP validée (anti-rebinding), redirections limitées et revalidées. Validé avec de vrais noms pointant vers 127.0.0.1 et 169.254.169.254. Au passage : un test a révélé et corrigé un bug de blocage de toutes les IPv4 ; la validité SSL n'est plus « vraie » pour un certificat auto-signé ou au mauvais nom. |
| H3 Secrets dans le DMG | **Non corrigé** | Nécessite le Device Flow / GitHub App (étape 3). |
| H4 Accès et isolation (web) | **Partiel** | `ALLOWED_GITHUB_LOGINS` / `ALLOWED_GITHUB_ORGS` ajoutés (à renseigner sur Dokploy) ; la déconnexion ne purge plus les données des autres utilisateurs (purge complète réservée au desktop via `OPENKIDO_DESKTOP=1`). La table `Domain` reste partagée : l'instance web doit rester mono-tenant. |
| H6 Conformité sans preuve | **Corrigé** | Nouvel état « Non évalué » (exclu du score) ; contrôles inventés retirés ; couverture calculée sur le total réel des dépôts ; contrôle « secrets » alimenté par le Code Audit. |
| M1 Bases dans git | **Corrigé** | `prisma/openkido.db`, `build/template.db`, `dev.db`, `src/generated/prisma`, `.DS_Store` retirés de l'index (fichiers conservés sur disque, rien commité). L'historique contient encore les anciennes versions (dépôt privé). |
| M2 Dockerfile | **Corrigé** | Plus de `ARG` de secrets, plus de `npx prisma` au démarrage (migrations appliquées par `src/instrumentation.ts`, qui met aussi à jour les bases existantes), `HEALTHCHECK`, `HOSTNAME`/`DATABASE_URL` explicites. Une ligne `COPY node_modules/.prisma` héritée cassait déjà le build (Prisma 7) : retirée. Image construite et lancée pour de vrai. |
| M3 En-têtes / CSP | **Corrigé** | `src/proxy.ts` (CSP à nonce, `strict-dynamic`) + en-têtes statiques dans `next.config.ts`. Vérifié : 21/21 scripts avec nonce, unique par requête, page et OAuth fonctionnels dans un navigateur réel sans violation. |
| M4 Électron | **Corrigé (sauf notarisation)** | Liens externes limités à `https:`, garde `will-navigate`/`will-redirect` (app + github.com), permissions refusées, IPC limité à l'origine de l'app, `sandbox: true`, `<webview>` interdit, API de preload non exposée aux pages github.com. Non fait : notarisation (identifiants Apple requis). |
| M5 `AUTH_URL` | **Détecté** | Avertissement au démarrage si absent ; à définir sur Dokploy. |
| M7 Abus / validation | **Corrigé** | 300 dépôts max par appel, formats `owner`/`repo` validés, branche lue sur GitHub (jamais fournie par le client). |
| H1, H5, M6, tout le §3 et §4 | **À faire** | Étapes 2 et 3 : scope OAuth (GitHub App), états `complete/partial/failed` du scanner, SBOM GitHub, CI/tests, moteur de contrôles. |

### Tests exécutés
- **Migrateur** : 9 contrôles (base vide, mise à jour d'une ancienne base avec conservation des données, idempotence, base sans historique ignorée, rollback d'une migration défectueuse, compatibilité `prisma migrate status`).
- **Garde SSRF** : 45 contrôles dont résolution DNS réelle et requête réelle vers `example.com` par IP épinglée.
- **Serveur de production** (base temporaire) : en-têtes, CSP, session sans jeton, et 19 scénarios d'attaque (actions sans session, SSRF vers loopback/métadonnées/IP/ports/identifiants, entrées invalides, 301 dépôts) — tous bloqués, aucune écriture.
- **Navigateur réel** : page d'accueil sans erreur de console, redirection OAuth vers GitHub fonctionnelle sous CSP.
- **Docker** : build sans secret, démarrage sur volume vide, migrations, utilisateur non-root, healthcheck, redémarrage idempotent.
- **Non testé** : parcours connecté complet avec un vrai compte GitHub (retour OAuth, pages avec données) et comportement graphique de l'app Electron durcie — à valider manuellement.

---

## 7. Étapes 2 et 3 (v1) appliquées — fiabilité du scanner et audit approfondi

### Fiabilité du scanner (H5 corrigé)
- **Plus jamais de faux « sain »** : OSV/GitHub injoignable → composants `non-analysé`, scan `partial` ou `failed`. Un scan `failed` n'écrit rien ; un scan `partial` n'écrase **jamais** un scan complet et n'alimente pas l'historique (la courbe de tendance ne ment plus). Tentatives avec attente (429/5xx), bissection des lots rejetés, pagination OSV, cache 6 h des fiches ; un avis dont la fiche est indisponible reste compté.
- **Versions réelles** : lecture directe des lockfiles (npm v1/v2/v3, yarn classique et Berry, pnpm v5-v9, Pipfile.lock, poetry.lock, Cargo.lock, go.mod, composer.lock, Gemfile.lock) via l'API Git (sans limite de taille), transitifs inclus, avec direct/transitif et prod/dev. Repli sur `package.json`/`requirements.txt` marqué « plage ». Maven/NuGet via le SBOM GitHub. Contrôle croisé : le parseur npm retrouve exactement les 1 067 paquets de `npm ls --all`.
- **API SBOM** : l'API synchrone de GitHub est **supprimée le 13 novembre 2026** ; le code utilise déjà le flux asynchrone (`generate-report` + `fetch-report`) avec repli temporaire.
- **Pages détail** : lisent la base (plus de scan ni d'écriture à l'affichage), bandeaux « incomplet », filtres de l'inventaire, version déclarée vs installée, paquets scopés (`@babel/core`) et paquets présents en plusieurs versions corrigés.
- **Code Audit** : états `ok / désactivé / accès refusé` par source (la copie d'écran « Aucune ✓ » des fonctions désactivées n'existe plus), pagination des alertes, page de détail par dépôt (le lien existait mais renvoyait 404). La conformité « secrets » repose maintenant sur la couverture réelle de Secret Scanning.
- **Code Quality** : analyse sur l'arborescence git et le contenu de `package.json`/`pyproject.toml` (un `pyproject.toml` ne vaut plus lint + format + tests ; un workflow de déploiement ne vaut plus « CI + tests »).

### Moteur de contrôles de posture (nouveau, lecture seule)
- 27 contrôles en 6 familles (branches et revues, fonctions de sécurité GitHub, GitHub Actions, secrets/fichiers sensibles, gouvernance/lockfiles, accès), page « Posture » avec détail par dépôt, preuves, éléments en cause et comment corriger.
- **Tri-état** : conforme / échec / à examiner / **non évaluable** (jamais compté comme réussi, exclu du score, couverture affichée) / sans objet. Un contrôle dépendant d'un échec racine (ex. protection de branche impossible) est « sans objet » : pas de double comptage.
- Validé sur de vrais dépôts et comparé à OpenSSF Scorecard (`express` : Code-Review, Token-Permissions, Dependency-Update-Tool, Binary-Artifacts, Dangerous-Workflow, License concordants). Deux écarts trouvés et corrigés grâce à cette comparaison : politique de sécurité héritée du dépôt `.github` de l'organisation, et SAST visible dans les workflows quand le jeton ne peut pas lire le code scanning.

### Constats sur vos propres dépôts (premiers résultats réels)
- **Protection de branche et rulesets indisponibles** sur l'offre gratuite pour un dépôt privé (« Upgrade to GitHub Pro ») : rien n'empêche un push direct sur `main`.
- **Dependabot, Secret Scanning et CodeQL sont désactivés** sur `Openkido`, et l'ancienne interface les affichait « Aucune ✓ ».
- `main` contient encore côté GitHub les fichiers `dev.db`, `prisma/openkido.db` et `build/template.db` (retirés de l'index local, non commités).
- Commits non signés, aucune PR fusionnée (poussées directes).

### Socle qualité du projet
- 140 tests (Vitest) : parseurs, scanner OSV avec injection de pannes, garde SSRF, migrateur, analyseurs et évaluation de posture, qualité, conformité, validation. `npm test`, `npm run typecheck`.
- `.github/workflows/ci.yml` (actions épinglées par SHA, permissions en lecture seule, `npm audit --omit=dev`), `.github/dependabot.yml`, `.github/CODEOWNERS`, `SECURITY.md`.

### Reste à faire
- **H1/H3** : GitHub App + Device Flow (supprime le secret client du DMG et le scope `repo`).
- Notarisation du DMG (identifiants Apple), `LICENSE` (décision du propriétaire), correction de l'unique erreur ESLint (`org-selector.tsx`) pour rendre le lint bloquant en CI.
- Posture v2 : PR de remédiation automatiques, contrôles au niveau organisation (2FA, applications installées), scan du contenu des fichiers et de l'historique (gitleaks), EPSS/CISA KEV, export PDF/SBOM, intégration des résultats de posture dans la page Conformité.
- Pin des images Docker par digest ; garde d'authentification centralisée dans `proxy.ts`.

// Mode démo : `OPENKIDO_DEMO=1` remplace les appels à GitHub par des données fictives (aucun réseau, aucun jeton).
// Sert à produire les captures d'écran de la documentation (`npm run demo:screenshots`).
// Ne jamais activer sur une vraie instance : les dépôts affichés n'existent pas.
import type { GithubOrg, GithubPR, GithubRepo } from "./github";

export const isDemo = (): boolean => process.env.OPENKIDO_DEMO === "1";

export const DEMO_LOGIN = "alex-martin";

const day = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * day).toISOString();

const repo = (id: number, owner: string, name: string, language: string | null, isPrivate: boolean, pushedDaysAgo: number): GithubRepo => ({
  id, name, owner, full_name: `${owner}/${name}`, private: isPrivate, default_branch: "main", language,
  updated_at: ago(pushedDaysAgo), pushed_at: ago(pushedDaysAgo),
});

export const DEMO_REPOS: GithubRepo[] = [
  repo(1, "acme-corp", "web-store", "TypeScript", true, 1),
  repo(2, "acme-corp", "api-gateway", "Go", true, 2),
  repo(3, "acme-corp", "billing-service", "Python", true, 3),
  repo(4, "acme-corp", "mobile-app", "TypeScript", true, 4),
  repo(5, "acme-corp", "auth-service", "TypeScript", true, 6),
  repo(6, "acme-corp", "data-pipeline", "Python", true, 9),
  repo(7, "acme-corp", "admin-dashboard", "JavaScript", true, 12),
  repo(8, "acme-corp", "legacy-intranet", "PHP", true, 40),
  repo(9, "acme-corp", "infra-terraform", "HCL", true, 5),
  repo(10, "acme-corp", "docs-site", "TypeScript", false, 8),
  repo(11, "alex-martin", "portfolio", "TypeScript", false, 15),
  repo(12, "alex-martin", "dotfiles", "Shell", false, 60),
];

export const DEMO_ORGS: GithubOrg[] = [{ id: 100, login: "acme-corp", avatar_url: "" }];

export const DEMO_PRS: GithubPR[] = [
  { id: 9001, number: 214, title: "Mise à jour de lodash vers 4.17.21", state: "open", draft: false, repoFullName: "acme-corp/web-store", repoOwner: "acme-corp", repoName: "web-store", author: DEMO_LOGIN, authorAvatar: "", createdAt: ago(2), updatedAt: ago(1), url: "https://github.com/acme-corp/web-store/pull/214", additions: 12, deletions: 9, labels: ["dependencies", "security"] },
  { id: 9002, number: 87, title: "Activer la protection de la branche principale", state: "open", draft: true, repoFullName: "acme-corp/api-gateway", repoOwner: "acme-corp", repoName: "api-gateway", author: DEMO_LOGIN, authorAvatar: "", createdAt: ago(5), updatedAt: ago(3), url: "https://github.com/acme-corp/api-gateway/pull/87", additions: 34, deletions: 2, labels: ["infra"] },
];

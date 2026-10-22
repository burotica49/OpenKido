import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getGithubLogin } from "@/lib/github";
import { requireRepoAccess } from "@/lib/repo-page";
import { getFeed } from "@/lib/issues";
import { coverageGaps } from "@/lib/issues-core";
import { RepoIssuesClient } from "./repo-issues-client";
import { HelpPanel, Term } from "@/components/app/help-panel";
import { IconAlertTriangle } from "@tabler/icons-react";

export const dynamic = "force-dynamic";

export default async function RepoIssuesPage({ params }: { params: Promise<{ owner: string; repoName: string }> }) {
  const { owner, repoName } = await params;
  await requireRepoAccess(owner, repoName);
  const session = await auth();
  if (!session?.accessToken) redirect("/");
  const login = session.githubLogin ?? (await getGithubLogin(session.accessToken));

  const feed = await getFeed(login, [{ owner, name: repoName }]);
  const target = `${owner}/${repoName}`;
  const issues = feed.issues.filter((i) => i.target === target);
  const gaps = coverageGaps({ ...feed.coverage, domains: 0, domainsChecked: 0 });

  return (
    <div className="flex flex-col flex-1">
      <HelpPanel>
        <p>Tous les problèmes de ce dépôt réunis : <Term>dépendances vulnérables</Term>, <Term>paquets malveillants</Term>, <Term>licences à risque</Term>, <Term>secrets dans le code</Term>, <Term>alertes GitHub</Term> et <Term>mauvaises configurations</Term>. Cliquez sur une ligne pour ouvrir le détail à droite (failles, version à atteindre, commande de correction).</p>
        <p>Vous pouvez <Term>ignorer</Term> une alerte avec un motif, la <Term>reporter</Term> ou l&apos;<Term>assigner</Term> : rien n&apos;est modifié sur GitHub. Les dépendances de développement sont masquées par défaut.</p>
      </HelpPanel>

      {gaps.length > 0 && (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-2.5 text-[12px] text-amber-900 flex items-start gap-2">
          <IconAlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span><span className="font-medium">Analyses manquantes — « aucune alerte » ne veut pas dire « sain » : </span>{gaps.join(" · ")}.</span>
        </div>
      )}

      <RepoIssuesClient issues={issues} login={login} fullyCovered={gaps.length === 0} resolved={feed.resolved.filter((r) => r.target === target)} />
    </div>
  );
}

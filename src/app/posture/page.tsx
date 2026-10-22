import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listRepos, getGithubLogin } from "@/lib/github";
import { getPostureSummaries } from "@/lib/controls/engine";
import { getSelectedOrg, filterReposByOrg } from "@/lib/selected-org";
import { TopBar } from "@/components/app/sidebar";
import { PostureClient } from "./posture-client";

export const dynamic = "force-dynamic";

export default async function PosturePage() {
  const session = await auth();
  if (!session?.accessToken) redirect("/");

  const login = session.githubLogin ?? (await getGithubLogin(session.accessToken));
  const allRepos = await listRepos(session.accessToken);
  const selectedOrg = await getSelectedOrg();
  const repos = filterReposByOrg(allRepos, selectedOrg, login);

  const summaries = await getPostureSummaries(repos.map((r) => ({ owner: r.owner, name: r.name })));

  return (
    <div className="flex flex-col flex-1 bg-background">
      <TopBar breadcrumb="Posture des dépôts" />
      <PostureClient
        repos={repos}
        summaries={Object.fromEntries([...summaries].map(([k, v]) => [k, { ...v, checkedAt: v.checkedAt.toISOString() }]))}
      />
    </div>
  );
}

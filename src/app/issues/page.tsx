import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listRepos, getGithubLogin } from "@/lib/github";
import { getFeed } from "@/lib/issues";
import { getSelectedOrg, filterReposByOrg } from "@/lib/selected-org";
import { TopBar } from "@/components/app/sidebar";
import { IssuesClient } from "./issues-client";

export const dynamic = "force-dynamic";

export default async function IssuesPage() {
  const session = await auth();
  if (!session?.accessToken) redirect("/");

  const login = session.githubLogin ?? (await getGithubLogin(session.accessToken));
  const allRepos = await listRepos(session.accessToken);
  const repos = filterReposByOrg(allRepos, await getSelectedOrg(), login);
  const feed = await getFeed(login, repos.map((r) => ({ owner: r.owner, name: r.name })));

  return (
    <div className="flex flex-col flex-1 bg-background">
      <TopBar breadcrumb="Issues" />
      <IssuesClient issues={feed.issues} coverage={feed.coverage} login={login} resolved={feed.resolved} historyDirty={feed.historyDirty} />
    </div>
  );
}

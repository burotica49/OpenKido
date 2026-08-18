import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listRepos, listPullRequests, getGithubLogin } from "@/lib/github";
import { getRepoScanSummaries, getScanTrend } from "@/lib/scan";
import { getSelectedOrg, filterReposByOrg } from "@/lib/selected-org";
import { ReposClient } from "./repos-client";

export const dynamic = "force-dynamic";

export default async function ReposPage() {
  const session = await auth();
  if (!session?.accessToken) redirect("/");

  const login = session.githubLogin ?? await getGithubLogin(session.accessToken);

  const allRepos = await listRepos(session.accessToken);
  const selectedOrg = await getSelectedOrg();
  const repos = filterReposByOrg(allRepos, selectedOrg, login);

  const [pullRequests, summariesMap, trend] = await Promise.all([
    listPullRequests(session.accessToken, login),
    getRepoScanSummaries(repos.map((r) => ({ owner: r.owner, name: r.name }))),
    getScanTrend(repos.map((r) => ({ owner: r.owner, name: r.name }))),
  ]);

  return (
    <ReposClient
      repos={repos}
      pullRequests={pullRequests}
      summaries={Object.fromEntries(summariesMap)}
      trend={trend}
    />
  );
}

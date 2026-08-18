import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listRepos, getGithubLogin } from "@/lib/github";
import { getQualitySummaries } from "@/lib/quality";
import { getSelectedOrg, filterReposByOrg } from "@/lib/selected-org";
import { CodeQualityClient } from "./quality-client";

export const dynamic = "force-dynamic";

export default async function CodeQualityPage() {
  const session = await auth();
  if (!session?.accessToken) redirect("/");

  const login = session.githubLogin ?? await getGithubLogin(session.accessToken);

  const allRepos = await listRepos(session.accessToken);
  const selectedOrg = await getSelectedOrg();
  const repos = filterReposByOrg(allRepos, selectedOrg, login);
  const summaries = await getQualitySummaries(
    repos.map((r) => ({ owner: r.owner, name: r.name }))
  );

  return (
    <CodeQualityClient
      repos={repos}
      summaries={Object.fromEntries(summaries)}
    />
  );
}

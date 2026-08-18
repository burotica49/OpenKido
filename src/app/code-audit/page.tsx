import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { listRepos, getGithubLogin } from "@/lib/github";
import { getAuditSummaries } from "@/lib/audit";
import { getSelectedOrg, filterReposByOrg } from "@/lib/selected-org";
import { TopBar, PageHeader } from "@/components/app/sidebar";
import { CodeAuditClient } from "./audit-client";

export const dynamic = "force-dynamic";

export default async function CodeAuditPage() {
  const session = await auth();
  if (!session?.accessToken) redirect("/");

  const login = session.githubLogin ?? await getGithubLogin(session.accessToken);

  const allRepos = await listRepos(session.accessToken);
  const selectedOrg = await getSelectedOrg();
  const repos = filterReposByOrg(allRepos, selectedOrg, login);

  const summariesMap = await getAuditSummaries(
    repos.map((r) => ({ owner: r.owner, name: r.name }))
  );

  return (
    <div className="flex flex-col flex-1 bg-background">
      <TopBar breadcrumb="Code Audit" />
      <CodeAuditClient
        repos={repos}
        summaries={Object.fromEntries(summariesMap)}
      />
    </div>
  );
}

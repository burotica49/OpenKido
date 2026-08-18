import { IconBrandGithub } from "@tabler/icons-react";
import { TopBar } from "@/components/app/sidebar";
import { RepoNav } from "./repo-nav";

export default async function RepoLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ owner: string; repoName: string }>;
}) {
  const { owner, repoName } = await params;

  return (
    <div className="flex flex-col flex-1 bg-background">
      <TopBar breadcrumb={`Repositories / ${owner} / ${repoName}`} />
      <div className="px-6 py-5 border-b border-border bg-white">
        <div className="flex items-center gap-2">
          <IconBrandGithub size={18} className="text-muted-foreground" />
          <h1 className="text-xl font-bold">{owner} / {repoName}</h1>
        </div>
      </div>
      <RepoNav owner={owner} repoName={repoName} />
      <div className="flex-1 bg-white">{children}</div>
    </div>
  );
}

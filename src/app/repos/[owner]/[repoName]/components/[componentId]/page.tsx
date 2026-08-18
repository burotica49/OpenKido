import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getOctokit } from "@/lib/github";
import { scanRepo } from "@/lib/scan";
import { SeverityBadge } from "@/components/app/risk-badge";
import { buttonVariants } from "@/components/ui/button";
import { IconArrowLeft, IconArrowUpCircle, IconExternalLink, IconPackage } from "@tabler/icons-react";

export const dynamic = "force-dynamic";

export default async function ComponentDetailPage({
  params,
}: {
  params: Promise<{ owner: string; repoName: string; componentId: string }>;
}) {
  const { owner, repoName, componentId } = await params;
  const session = await auth();
  if (!session?.accessToken) redirect("/");

  const octokit = getOctokit(session.accessToken);
  let branch = "main";
  try {
    const { data } = await octokit.repos.get({ owner, repo: repoName });
    branch = data.default_branch;
  } catch {}

  const scan = await scanRepo(session.accessToken, owner, repoName, branch);
  const component = scan.components.find((c) => c.name === componentId);
  if (!component) notFound();

  const topFixed = component.vulns
    .filter((v) => v.fixedVersion)
    .sort((a, b) => (b.cvssScore ?? 0) - (a.cvssScore ?? 0))[0]?.fixedVersion;

  return (
    <div className="px-6 py-5 max-w-3xl">
      <Link
        href={`/repos/${owner}/${repoName}/inventory`}
        className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors mb-5"
      >
        <IconArrowLeft size={13} />
        Retour à l&apos;inventaire
      </Link>

      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">
            <IconPackage size={20} className="text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-base font-semibold font-mono">{component.name}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {component.ecosystem} · v{component.version}
              {component.source ? ` · ${component.source}` : ""}
            </p>
          </div>
        </div>
        {topFixed && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Mise à jour disponible :</span>
            <span className="badge-ok rounded px-2 py-0.5 text-[12px] font-mono">{topFixed}</span>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {component.vulns.map((v) => (
          <div key={v.id} className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-start gap-3 px-4 py-3 border-b border-border">
              <SeverityBadge severity={v.severity} />
              <span className="font-mono text-[12px] text-muted-foreground">{v.id}</span>
              {v.cvssScore !== null && (
                <span className="ml-auto text-[12px] text-muted-foreground tabular-nums">
                  CVSS {v.cvssScore.toFixed(1)}
                </span>
              )}
            </div>
            <div className="px-4 py-3">
              <p className="text-[13px] leading-relaxed text-muted-foreground">{v.summary}</p>
              <div className="flex items-center gap-3 mt-3">
                {v.fixedVersion && (
                  <span className="text-[12px] text-muted-foreground">
                    Corrigée en{" "}
                    <span className="font-mono badge-ok rounded px-1.5 py-0.5">{v.fixedVersion}</span>
                  </span>
                )}
                <a
                  href={`https://osv.dev/vulnerability/${v.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  OSV <IconExternalLink size={11} />
                </a>
              </div>
            </div>
          </div>
        ))}
      </div>

      {component.vulns.length === 0 && (
        <div className="rounded-xl border border-border bg-card px-5 py-8 text-center">
          <p className="text-sm text-muted-foreground">Aucune vulnérabilité connue pour ce composant.</p>
        </div>
      )}

      {topFixed && (
        <div className="flex items-center gap-2 mt-5">
          <button className={buttonVariants({ size: "sm" })}>
            <IconArrowUpCircle size={15} className="mr-1.5" />
            Créer une PR de mise à jour → {topFixed}
          </button>
          <Link href={`/repos/${owner}/${repoName}/inventory`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Retour
          </Link>
        </div>
      )}
    </div>
  );
}

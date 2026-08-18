import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getOctokit } from "@/lib/github";
import { scanRepo } from "@/lib/scan";
import { SevCircle } from "@/components/app/severity-badge";
import { IconPackage, IconShieldCheck } from "@tabler/icons-react";

export const dynamic = "force-dynamic";

function manifestLabel(source?: string): string {
  if (!source) return "—";
  return source
    .split(", ")
    .map((path) => {
      const trimmed = path.replace(/\/(package\.json|requirements\.txt)$/, "");
      return trimmed || "racine";
    })
    .join(", ");
}

export default async function InventoryPage({
  params,
}: { params: Promise<{ owner: string; repoName: string }> }) {
  const { owner, repoName } = await params;
  const session = await auth();
  if (!session?.accessToken) redirect("/");

  const octokit = getOctokit(session.accessToken);
  let branch = "main";
  try {
    const { data } = await octokit.repos.get({ owner, repo: repoName });
    branch = data.default_branch;
  } catch {}

  const scan = await scanRepo(session.accessToken, owner, repoName, branch);
  const sorted = [...scan.components].sort((a, b) => {
    const order = ["CRITICAL","HIGH","MEDIUM","LOW","UNKNOWN"];
    const ai = a.vulnCount > 0 ? order.indexOf(a.topSeverity) : order.length;
    const bi = b.vulnCount > 0 ? order.indexOf(b.topSeverity) : order.length;
    return ai - bi;
  });

  return (
    <div className="flex flex-col flex-1">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-muted/20">
        <p className="text-[13px] text-muted-foreground">
          <span className="font-medium text-foreground">{scan.total}</span> composants ·{" "}
          <span className="font-medium text-red-600">{scan.vulnerable}</span> vulnérables
        </p>
        <span className="text-[12px] text-muted-foreground">
          Scan du {new Date(scan.scannedAt).toLocaleDateString("fr-FR")}
        </span>
      </div>

      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="text-left px-6 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Composant</th>
            <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Version</th>
            <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Source</th>
            <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Écosystème</th>
            <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Sévérité</th>
            <th className="text-left px-4 py-2.5 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">CVEs</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sorted.map((c) => (
            <tr key={`${c.name}@${c.version}:${c.source ?? ""}`} className="hover:bg-muted/20 transition-colors">
              <td className="px-6 py-2.5">
                <div className="flex items-center gap-2">
                  {c.vulnCount > 0
                    ? <IconPackage size={13} className="text-muted-foreground shrink-0" />
                    : <IconShieldCheck size={13} className="text-green-500 shrink-0" />
                  }
                  {c.vulnCount > 0 ? (
                    <Link href={`/repos/${owner}/${repoName}/components/${c.name}`}
                      className="font-mono text-xs font-medium hover:text-violet-600 transition-colors">
                      {c.name}
                    </Link>
                  ) : (
                    <span className="font-mono text-xs">{c.name}</span>
                  )}
                </div>
              </td>
              <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{c.version}</td>
              <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground">
                {manifestLabel(c.source)}
              </td>
              <td className="px-4 py-2.5 text-xs text-muted-foreground capitalize">{c.ecosystem}</td>
              <td className="px-4 py-2.5">
                {c.vulnCount > 0
                  ? <SevCircle severity={c.topSeverity} count={1} />
                  : <span className="badge-ok text-[11px] rounded-full px-2 py-0.5">Sain</span>
                }
              </td>
              <td className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums">
                {c.vulnCount > 0 ? c.vulnCount : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { auth, signOut } from "@/lib/auth";
import { isGithubUnauthorized, listRepos } from "@/lib/github";
import { db } from "@/lib/db";
import { getStaleRepos } from "@/lib/scan";
import { filterReposByOrg, getSelectedOrg } from "@/lib/selected-org";
import { revokeGithubSession } from "@/lib/logout";
import { Sidebar } from "@/components/app/sidebar";
import { AuthSessionProvider } from "@/components/app/session-provider";
import { AutoScan } from "@/components/app/auto-scan";
import pkg from "../../package.json";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Openkido — Sécurité applicative",
  description: "SCA, CVE scanning, SBOM pour vos repos GitHub.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();

  let repoCount: number | undefined;
  let domainCount: number | undefined;
  let selectedOrg: string | null = null;
  let staleRepos: { owner: string; name: string; branch: string }[] = [];
  if (session?.accessToken) {
    try {
      const login = session.githubLogin;
      const [repos, domains, org] = await Promise.all([
        listRepos(session.accessToken),
        db.domain.count(),
        getSelectedOrg(),
      ]);
      selectedOrg = org;
      const visible = login ? filterReposByOrg(repos, org, login) : repos;
      repoCount = visible.length;
      domainCount = domains;
      staleRepos = await getStaleRepos(
        visible.map((r) => ({ owner: r.owner, name: r.name, branch: r.default_branch }))
      );
    } catch (error) {
      console.error("[layout] GitHub/DB:", error);
      if (isGithubUnauthorized(error)) {
        await revokeGithubSession();
        await signOut({ redirectTo: "/" });
      }
    }
  }

  return (
    <html lang="fr" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-background text-foreground">
        <AuthSessionProvider>
          <TooltipProvider>
            <div className="flex min-h-screen">
              {session?.user && (
                <Sidebar
                  user={session.user}
                  githubLogin={session.githubLogin}
                  selectedOrg={selectedOrg}
                  repoCount={repoCount}
                  domainCount={domainCount}
                  version={pkg.version}
                />
              )}
              <div className="flex-1 min-w-0 flex flex-col">{children}</div>
              {session?.user && staleRepos.length > 0 && <AutoScan staleRepos={staleRepos} />}
            </div>
          </TooltipProvider>
        </AuthSessionProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { auth, signOut } from "@/lib/auth";
import { isGithubUnauthorized, listRepos } from "@/lib/github";
import { db } from "@/lib/db";
import { getStaleRepos } from "@/lib/scan";
import { Sidebar } from "@/components/app/sidebar";
import { AuthSessionProvider } from "@/components/app/session-provider";
import { AutoScan } from "@/components/app/auto-scan";

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
  let staleRepos: { owner: string; name: string; branch: string }[] = [];
  if (session?.accessToken) {
    try {
      const [repos, domains] = await Promise.all([
        listRepos(session.accessToken),
        db.domain.count(),
      ]);
      repoCount = repos.length;
      domainCount = domains;
      staleRepos = await getStaleRepos(
        repos.map((r) => ({ owner: r.owner, name: r.name, branch: r.default_branch }))
      );
    } catch (error) {
      if (isGithubUnauthorized(error)) {
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
              {session?.user && <Sidebar user={session.user} repoCount={repoCount} domainCount={domainCount} />}
              <div className="flex-1 min-w-0 flex flex-col">{children}</div>
              {session?.user && staleRepos.length > 0 && <AutoScan staleRepos={staleRepos} />}
            </div>
          </TooltipProvider>
        </AuthSessionProvider>
      </body>
    </html>
  );
}

import { redirect } from "next/navigation";
import Image from "next/image";
import { auth } from "@/lib/auth";
import { TopBar, PageHeader } from "@/components/app/sidebar";
import { buttonVariants } from "@/components/ui/button";
import { SignOutButton } from "@/components/app/sign-out-button";
import { IconLogout } from "@tabler/icons-react";
import { getSelectedOrg } from "@/lib/selected-org";
import path from "path";
import { pathToFileURL } from "url";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/");

  const selectedOrg = await getSelectedOrg();
  const dbUrl =
    process.env.DATABASE_URL ??
    pathToFileURL(path.join(process.cwd(), "prisma", "openkido.db")).href;
  const dbLabel = dbUrl.startsWith("file:")
    ? decodeURIComponent(dbUrl.replace(/^file:\/\//, "").replace(/^file:/, ""))
    : dbUrl;
  const filterLabel =
    selectedOrg === "@me"
      ? "Compte personnel"
      : selectedOrg
        ? selectedOrg
        : "Tous les dépôts";

  return (
    <div className="flex flex-col flex-1 bg-background">
      <TopBar breadcrumb="Paramètres" />
      <PageHeader title="Paramètres" subtitle="Compte GitHub et session." />

      <div className="px-6 py-6 max-w-xl space-y-4">
        <div className="rounded-lg border border-border bg-white px-5 py-4">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-3">Compte</p>
          <div className="flex items-center gap-3">
            {session.user.image ? (
              <Image
                src={session.user.image}
                alt=""
                width={40}
                height={40}
                className="rounded-full shrink-0"
              />
            ) : (
              <div className="h-10 w-10 rounded-full bg-violet-700 flex items-center justify-center text-sm text-white font-medium shrink-0">
                {session.user.name?.[0]?.toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{session.user.name}</p>
              <p className="text-xs text-muted-foreground truncate">
                {session.githubLogin ? `@${session.githubLogin}` : session.user.email}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-white px-5 py-4 space-y-2">
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider">Diagnostic</p>
          <p className="text-xs text-muted-foreground">
            Filtre : <span className="font-medium text-foreground">{filterLabel}</span>
          </p>
          <p className="text-[11px] font-mono text-muted-foreground break-all">
            Base : {dbLabel}
          </p>
        </div>

        <SignOutButton className={buttonVariants({ variant: "outline", size: "sm" })}>
          <IconLogout />
          Se déconnecter
        </SignOutButton>
      </div>
    </div>
  );
}

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { IconShieldBolt } from "@tabler/icons-react";
import { SignInButton } from "@/components/auth/sign-in-button";

export default async function Home() {
  const session = await auth();
  if (session) redirect("/issues");

  const ua = (await headers()).get("user-agent") ?? "";
  const isElectron = /Electron/i.test(ua);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-8 px-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-2">
          <IconShieldBolt size={28} />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Openkido</h1>
        <p className="text-muted-foreground text-sm max-w-sm">
          Scannez vos dépendances, détectez les CVE réelles, recevez des PR d&apos;autofix.
          Branché directement sur vos repos GitHub.
        </p>
      </div>

      <SignInButton electronHint={isElectron} />

      <p className="text-[11px] text-muted-foreground">Permissions demandées : lecture des repos et des organisations</p>
    </div>
  );
}

import { auth, signIn } from "@/lib/auth";
import { redirect } from "next/navigation";
import { IconBrandGithub, IconShieldBolt } from "@tabler/icons-react";

export default async function Home() {
  const session = await auth();
  if (session) redirect("/repos");

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

      <form
        action={async () => {
          "use server";
          await signIn("github", { redirectTo: "/repos" });
        }}
      >
        <button
          type="submit"
          className="inline-flex items-center gap-2.5 rounded-lg bg-foreground text-background px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-80"
        >
          <IconBrandGithub size={17} />
          Continuer avec GitHub
        </button>
      </form>

      <p className="text-[11px] text-muted-foreground">Permissions demandées : lecture des repos · lecture des dépendances</p>
    </div>
  );
}

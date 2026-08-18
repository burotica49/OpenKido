"use client";

import { signOut } from "next-auth/react";
import { IconAlertTriangle, IconBrandGithub, IconRefresh } from "@tabler/icons-react";
import { TopBar } from "@/components/app/sidebar";
import { Button } from "@/components/ui/button";

export default function Error({
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  return (
    <div className="flex flex-col flex-1 bg-background">
      <TopBar />
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
          <IconAlertTriangle size={22} />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Impossible de charger GitHub</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Votre session GitHub a peut-être expiré, ou l’API est indisponible.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => unstable_retry()}>
            <IconRefresh />
            Réessayer
          </Button>
          <Button onClick={() => signOut({ redirectTo: "/" })}>
            <IconBrandGithub />
            Se reconnecter
          </Button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useTransition } from "react";
import { signOut } from "next-auth/react";
import { revokeGithubSession } from "@/lib/logout";

export function SignOutButton({
  className,
  children,
  title,
  style,
}: {
  className?: string;
  children: React.ReactNode;
  title?: string;
  style?: React.CSSProperties;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      title={title}
      disabled={pending}
      className={className}
      style={style}
      onClick={() => {
        startTransition(async () => {
          try {
            await revokeGithubSession();
          } catch {
            // On déconnecte quand même localement
          }
          try {
            await window.electronAPI?.clearGithubSession?.();
          } catch {
            // Hors Electron, ou IPC indisponible
          }
          await signOut({ redirectTo: "/" });
        });
      }}
    >
      {children}
    </button>
  );
}

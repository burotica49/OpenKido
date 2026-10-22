"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { IconBrandGithub, IconLoader2 } from "@tabler/icons-react";

export function SignInButton({ electronHint }: { electronHint?: boolean }) {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    if (pending) return;
    setPending(true);
    try {
      // Electron a son propre cookie jar GitHub, distinct de Chrome.
      // On le vide pour forcer l’écran de connexion / choix de compte.
      await window.electronAPI?.clearGithubSession?.();
      await signIn("github", { callbackUrl: "/issues" });
    } catch {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="inline-flex items-center gap-2.5 rounded-lg bg-foreground text-background px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-80 disabled:opacity-60"
      >
        {pending ? <IconLoader2 size={17} className="animate-spin" /> : <IconBrandGithub size={17} />}
        Continuer avec GitHub
      </button>
      {electronHint && (
        <p className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 max-w-sm text-center">
          Electron n’utilise pas la session GitHub de Chrome. Choisissez le
          même compte que dans le navigateur (vérifiez le <span className="font-medium">@login</span>{" "}
          après connexion).
        </p>
      )}
    </div>
  );
}

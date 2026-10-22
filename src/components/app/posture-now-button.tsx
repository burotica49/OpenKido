"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconLoader2, IconRefresh } from "@tabler/icons-react";
import { auditPostureRepo } from "@/lib/actions/posture";

export function PostureNowButton({ owner, repo, label = "Relancer l'audit" }: { owner: string; repo: string; label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const r = await auditPostureRepo(owner, repo);
            if (!r.ok) setError(r.error);
            router.refresh();
          });
        }}
        className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-violet-700 transition-colors disabled:opacity-60"
      >
        {pending ? <IconLoader2 size={13} className="animate-spin" /> : <IconRefresh size={13} />}
        {pending ? "Audit en cours…" : label}
      </button>
      {error && <span className="max-w-md text-right text-[11px] text-red-600">{error}</span>}
    </div>
  );
}

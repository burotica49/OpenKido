"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IconLoader2, IconRefresh } from "@tabler/icons-react";
import { triggerScan } from "@/lib/actions/scan";
import { cn } from "@/lib/utils";

export function ScanNowButton({
  owner,
  repo,
  label = "Rescanner",
  primary = false,
}: {
  owner: string;
  repo: string;
  label?: string;
  primary?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "error" | "warning"; text: string } | null>(null);

  function run() {
    setMessage(null);
    startTransition(async () => {
      const r = await triggerScan(owner, repo);
      if (!r.ok) setMessage({ kind: "error", text: r.error });
      else if (r.status === "partial") {
        setMessage({ kind: "warning", text: `Scan incomplet — ${r.warnings.join(" ; ")}${r.persisted ? "" : " (dernier scan complet conservé)"}` });
      }
      router.refresh();
    });
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        onClick={run}
        disabled={pending}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-60",
          primary
            ? "bg-violet-600 text-white hover:bg-violet-700"
            : "border border-violet-200 text-violet-600 hover:bg-violet-50"
        )}
      >
        {pending ? <IconLoader2 size={13} className="animate-spin" /> : <IconRefresh size={13} />}
        {pending ? "Scan en cours…" : label}
      </button>
      {message && (
        <span className={cn("max-w-md text-right text-[11px]", message.kind === "error" ? "text-red-600" : "text-amber-700")}>
          {message.text}
        </span>
      )}
    </div>
  );
}

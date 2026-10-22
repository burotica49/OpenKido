"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { IconLoader2, IconShieldCheck } from "@tabler/icons-react";
import { scanAllRepos } from "@/lib/actions/scan";

const FLAG = "ok_autoscan_done";
const REFRESH_INTERVAL_H = 6; // rescan périodique tant que l'app reste ouverte

export function AutoScan({
  staleRepos,
}: {
  staleRepos: { owner: string; name: string; branch: string }[];
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "scanning" | "done">("idle");

  useEffect(() => {
    if (staleRepos.length === 0) return;
    // Une seule exécution par session de navigation (survit au StrictMode et aux navigations)
    if (sessionStorage.getItem(FLAG)) return;
    sessionStorage.setItem(FLAG, "1");

    let cancelled = false;

    async function run() {
      setState("scanning");
      try {
        const BATCH = 5;
        for (let i = 0; i < staleRepos.length && !cancelled; i += BATCH) {
          const batch = staleRepos.slice(i, i + BATCH);
          await scanAllRepos(batch);
        }
      } finally {
        if (!cancelled) {
          setState("done");
          router.refresh();
          setTimeout(() => setState("idle"), 5000);
        }
      }
    }
    run();

    // Rescan périodique tant que la fenêtre reste ouverte
    const interval = setInterval(() => {
      sessionStorage.removeItem(FLAG);
      router.refresh(); // le layout recalcule staleRepos → nouveau cycle si nécessaire
    }, REFRESH_INTERVAL_H * 3600 * 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staleRepos.length]);

  if (state === "idle") return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg bg-slate-900 text-white px-3.5 py-2.5 text-[12px] shadow-lg">
      {state === "scanning" ? (
        <>
          <IconLoader2 size={14} className="animate-spin text-violet-400" />
          <span>Scan automatique en cours… ({staleRepos.length} repos)</span>
        </>
      ) : (
        <>
          <IconShieldCheck size={14} className="text-green-400" />
          <span>Scan automatique terminé</span>
        </>
      )}
    </div>
  );
}

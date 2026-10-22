"use client";

import { useState } from "react";
import { IconFileTypePdf, IconLoader2 } from "@tabler/icons-react";

/** Application de bureau : enregistre le PDF directement ; navigateur : ouvre l'impression (« Enregistrer en PDF »). */
export function ExportButton() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onClick() {
    setMessage(null);
    const api = window.electronAPI;
    if (api?.exportPdf) {
      setBusy(true);
      try {
        const r = await api.exportPdf();
        if (r.saved) setMessage("PDF enregistré.");
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Export impossible");
      } finally {
        setBusy(false);
      }
    } else {
      window.print();
    }
  }

  return (
    <div className="inline-flex flex-col items-end gap-1 print:hidden">
      <button
        onClick={onClick}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 text-[13px] font-medium transition-colors disabled:opacity-60"
      >
        {busy ? <IconLoader2 size={14} className="animate-spin" /> : <IconFileTypePdf size={14} />}
        Exporter en PDF
      </button>
      {message && <span className="text-[11px] text-muted-foreground">{message}</span>}
    </div>
  );
}

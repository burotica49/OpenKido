"use client";

import { useEffect } from "react";
import { IconX } from "@tabler/icons-react";

/**
 * Panneau de détail qui s'ouvre à droite (Feed, inventaire, audits…). Même présentation partout :
 * en-tête avec fermeture, corps défilant, pied d'actions. Échap ferme le panneau.
 */
export function DetailDrawer({ onClose, label, headerRight, footer, width = 520, children }: {
  onClose: () => void;
  label: string;
  headerRight?: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside
      role="dialog"
      aria-label={label}
      style={{ maxWidth: width }}
      className="fixed top-0 right-0 z-30 h-screen w-full bg-white border-l border-border shadow-2xl flex flex-col"
    >
      <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-border">
        <button onClick={onClose} aria-label="Fermer" className="rounded p-1.5 hover:bg-muted"><IconX size={16} /></button>
        <div className="flex items-center gap-2">{headerRight}</div>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">{children}</div>
      {footer && <div className="flex items-center gap-2 px-5 py-3 border-t border-border">{footer}</div>}
    </aside>
  );
}

/** Titre de section d'un panneau de détail. */
export function DrawerSection({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1.5">
        {title}
        {count !== undefined && <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums normal-case">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

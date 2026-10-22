import type { ReactNode } from "react";

/** Encart repliable « Comment lire cette page ? », commun à toutes les pages. */
export function HelpPanel({ children, title = "Comment lire cette page ?" }: { children: ReactNode; title?: string }) {
  return (
    <details className="bg-white border-b border-border px-6 py-3 text-[12px] text-muted-foreground">
      <summary className="cursor-pointer text-[13px] font-medium text-foreground">{title}</summary>
      <div className="mt-3 space-y-2 max-w-3xl">{children}</div>
    </details>
  );
}

/** Terme en gras dans un paragraphe d'aide. */
export function Term({ children }: { children: ReactNode }) {
  return <span className="font-medium text-foreground">{children}</span>;
}

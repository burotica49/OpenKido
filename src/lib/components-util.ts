import type { ScannedComponent } from "./scan";

/** Toutes les versions présentes dans le dépôt, pour les seuls paquets de `rows` (données du panneau de détail). */
export function versionsByName(all: ScannedComponent[], rows: ScannedComponent[]): Record<string, ScannedComponent[]> {
  const wanted = new Set(rows.map((r) => r.name));
  const out: Record<string, ScannedComponent[]> = {};
  for (const c of all) {
    if (!wanted.has(c.name)) continue;
    (out[c.name] ??= []).push(c);
  }
  return out;
}

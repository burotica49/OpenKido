import Link from "next/link";
import { loadRepoScan } from "@/lib/repo-page";
import type { ScannedComponent } from "@/lib/scan";
import { ComponentsTable } from "@/components/app/components-table";
import { versionsByName } from "@/lib/components-util";
import { ScanStatusBanner } from "@/components/app/scan-status-banner";
import { NeverScanned } from "@/components/app/never-scanned";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const FILTERS = [
  { id: "all", label: "Tous" },
  { id: "vulnerable", label: "Vulnérables" },
  { id: "direct", label: "Directs" },
  { id: "prod", label: "Production" },
  { id: "unscanned", label: "Non analysés" },
] as const;
type FilterId = (typeof FILTERS)[number]["id"];

const MAX_ROWS = 500;
const SEVERITY_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "UNKNOWN"];

function rank(c: ScannedComponent): number {
  if (c.status === "vulnerable") return SEVERITY_ORDER.indexOf(c.topSeverity);
  if (c.status === "non-analysé") return SEVERITY_ORDER.length;
  return SEVERITY_ORDER.length + 1;
}

function matches(c: ScannedComponent, filter: FilterId): boolean {
  switch (filter) {
    case "vulnerable": return c.status === "vulnerable";
    case "direct": return c.direct === true;
    case "prod": return c.scope !== "dev";
    case "unscanned": return c.status === "non-analysé";
    default: return true;
  }
}

export default async function InventoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repoName: string }>;
  searchParams: Promise<{ q?: string; f?: string }>;
}) {
  const { owner, repoName } = await params;
  const { q = "", f = "all" } = await searchParams;
  const filter: FilterId = FILTERS.some((x) => x.id === f) ? (f as FilterId) : "all";

  const { scan } = await loadRepoScan(owner, repoName);
  if (!scan) {
    return (
      <div className="px-6 py-5">
        <NeverScanned owner={owner} repo={repoName} />
      </div>
    );
  }

  const needle = q.trim().toLowerCase();
  const filtered = scan.components
    .filter((c) => matches(c, filter) && (!needle || c.name.toLowerCase().includes(needle)))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const shown = filtered.slice(0, MAX_ROWS);

  const href = (next: Partial<{ q: string; f: string }>) => {
    const params = new URLSearchParams();
    const nq = next.q ?? q;
    const nf = next.f ?? filter;
    if (nq) params.set("q", nq);
    if (nf !== "all") params.set("f", nf);
    const qs = params.toString();
    return `/repos/${owner}/${repoName}/inventory${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="flex flex-col flex-1">
      {(scan.status === "partial" || scan.legacy) && (
        <div className="px-6 pt-4">
          <ScanStatusBanner scan={scan} />
        </div>
      )}

      <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-muted/20">
        <p className="text-[13px] text-muted-foreground">
          <span className="font-medium text-foreground">{scan.total}</span> composants ·{" "}
          <span className="font-medium text-red-600">{scan.vulnerable}</span> vulnérables
          {scan.unscanned > 0 && <> · <span className="font-medium text-amber-700">{scan.unscanned}</span> non analysés</>}
        </p>
        <span className="text-[12px] text-muted-foreground">
          Scan du {new Date(scan.scannedAt).toLocaleDateString("fr-FR")}
        </span>
      </div>

      <div className="flex items-center gap-3 px-6 py-2.5 border-b border-border bg-white">
        <form action={`/repos/${owner}/${repoName}/inventory`} className="flex items-center gap-2">
          {filter !== "all" && <input type="hidden" name="f" value={filter} />}
          <input
            name="q"
            defaultValue={q}
            placeholder="Rechercher un composant…"
            className="h-8 w-64 rounded-md border border-border bg-muted/40 px-3 text-[13px] outline-none focus:border-violet-400"
          />
        </form>
        {FILTERS.map((x) => (
          <Link
            key={x.id}
            href={href({ f: x.id })}
            className={cn(
              "text-[12px] px-2.5 py-1 rounded-md transition-colors",
              filter === x.id ? "bg-violet-100 text-violet-700 font-medium" : "text-muted-foreground hover:bg-muted"
            )}
          >
            {x.label}
          </Link>
        ))}
        <span className="ml-auto text-[12px] text-muted-foreground tabular-nums">
          {filtered.length > MAX_ROWS ? `${MAX_ROWS} affichés sur ${filtered.length}` : `${filtered.length} résultat(s)`}
        </span>
      </div>

      <ComponentsTable owner={owner} repo={repoName} rows={shown} versionsByName={versionsByName(scan.components, shown)} variant="inventory" />

      {shown.length === 0 && (
        <div className="py-16 text-center text-sm text-muted-foreground">Aucun composant ne correspond à ce filtre.</div>
      )}
    </div>
  );
}

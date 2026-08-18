import { cn } from "@/lib/utils";

type Level = "critical" | "warning" | "ok";
type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

const levelMap: Record<Level, { label: string; cls: string; dot: string }> = {
  critical: { label: "Critique", cls: "badge-critical", dot: "bg-red-500" },
  warning:  { label: "Modéré",   cls: "badge-warning",  dot: "bg-amber-500" },
  ok:       { label: "Sain",     cls: "badge-ok",       dot: "bg-emerald-500" },
};

const severityMap: Record<Severity, { label: string; cls: string }> = {
  CRITICAL: { label: "Critique", cls: "badge-critical" },
  HIGH:     { label: "Élevée",   cls: "badge-warning" },
  MEDIUM:   { label: "Moyenne",  cls: "badge-info" },
  LOW:      { label: "Faible",   cls: "badge-muted" },
  UNKNOWN:  { label: "Inconnue", cls: "badge-muted" },
};

export function RiskBadge({ level }: { level: Level }) {
  const m = levelMap[level];
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium", m.cls)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", m.dot)} />
      {m.label}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const m = severityMap[severity];
  return (
    <span className={cn("inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium", m.cls)}>
      {m.label}
    </span>
  );
}

export function RiskBar({ score, level }: { score: number; level: Level }) {
  const color = { critical: "bg-red-500", warning: "bg-amber-500", ok: "bg-emerald-500" }[level];
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums w-12 text-right">{score}/100</span>
    </div>
  );
}

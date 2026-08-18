import { cn } from "@/lib/utils";

export function MetricCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "danger" | "warning" | "success";
}) {
  const toneClass = {
    default: "text-foreground",
    danger: "text-red-600 dark:text-red-400",
    warning: "text-amber-600 dark:text-amber-400",
    success: "text-emerald-600 dark:text-emerald-400",
  }[tone];

  return (
    <div className="rounded-lg bg-card border border-border px-4 py-3.5">
      <p className="text-xs text-muted-foreground mb-1.5">{label}</p>
      <p className={cn("text-2xl font-medium leading-none", toneClass)}>{value}</p>
      {hint ? <p className="text-xs text-muted-foreground mt-1.5">{hint}</p> : null}
    </div>
  );
}

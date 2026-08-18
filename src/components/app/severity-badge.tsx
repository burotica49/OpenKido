import { cn } from "@/lib/utils";

type Sev = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

const sevClass: Record<Sev, string> = {
  CRITICAL: "sev-critical",
  HIGH:     "sev-high",
  MEDIUM:   "sev-medium",
  LOW:      "sev-low",
  UNKNOWN:  "sev-none",
};

export function SevCircle({ severity, count }: { severity: Sev; count: number }) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center h-7 w-7 rounded-full text-[12px] font-semibold tabular-nums",
        sevClass[severity]
      )}
    >
      {count}
    </span>
  );
}

export function SevRow({ critical = 0, high = 0, medium = 0, low = 0 }: {
  critical?: number;
  high?: number;
  medium?: number;
  low?: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <SevCircle severity="CRITICAL" count={critical} />
      <SevCircle severity="HIGH"     count={high} />
      <SevCircle severity="MEDIUM"   count={medium} />
      <SevCircle severity="LOW"      count={low} />
    </div>
  );
}

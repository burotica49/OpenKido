"use client";

import { useState } from "react";
import type { TrendPoint } from "@/lib/scan";
import { cn } from "@/lib/utils";

const SERIES: { key: keyof Omit<TrendPoint, "date" | "vulnerable">; label: string; color: string }[] = [
  { key: "critical", label: "Critiques", color: "#ef4444" },
  { key: "high",     label: "Élevées",   color: "#f97316" },
  { key: "medium",   label: "Moyennes",  color: "#f59e0b" },
  { key: "low",      label: "Faibles",   color: "#3b82f6" },
];

export function TrendChart({ points }: { points: TrendPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) {
    return (
      <div className="px-6 py-4 text-[12px] text-muted-foreground italic">
        Pas encore assez d'historique — les tendances apparaîtront après quelques scans.
      </div>
    );
  }

  const W = 900;
  const H = 160;
  const PAD = { top: 12, right: 8, bottom: 22, left: 34 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const maxY = Math.max(1, ...points.map((p) => Math.max(p.critical, p.high, p.medium, p.low)));
  const x = (i: number) => PAD.left + (i / (points.length - 1)) * innerW;
  const y = (v: number) => PAD.top + innerH - (v / maxY) * innerH;

  const linePath = (key: (typeof SERIES)[number]["key"]) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(" ");

  // Y ticks (entiers)
  const tickCount = Math.min(4, maxY);
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => Math.round((maxY / tickCount) * i));

  const hovered = hover !== null ? points[hover] : null;
  const first = points[0];
  const last = points[points.length - 1];
  const delta = (last.critical + last.high) - (first.critical + first.high);

  return (
    <div className="px-6 py-4 border-b border-border">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-4">
          <p className="text-[13px] font-medium">Évolution des vulnérabilités</p>
          <span className={cn("text-[11px] px-1.5 py-0.5 rounded font-semibold tabular-nums",
            delta > 0 ? "bg-red-100 text-red-700" : delta < 0 ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground")}>
            {delta > 0 ? `+${delta}` : delta} critique/élevée sur la période
          </span>
        </div>
        <div className="flex items-center gap-3">
          {SERIES.map((s) => (
            <span key={s.key} className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="none"
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - rect.left) / rect.width) * W;
            const i = Math.round(((px - PAD.left) / innerW) * (points.length - 1));
            setHover(Math.max(0, Math.min(points.length - 1, i)));
          }}>
          {/* Grid + Y labels */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} y1={y(t)} x2={W - PAD.right} y2={y(t)} stroke="#e5e7eb" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" fontSize={9} fill="#9ca3af">{t}</text>
            </g>
          ))}

          {/* X labels : premier, milieu, dernier */}
          {[0, Math.floor((points.length - 1) / 2), points.length - 1].map((i) => (
            <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize={9} fill="#9ca3af">
              {new Date(points[i].date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
            </text>
          ))}

          {/* Lines */}
          {SERIES.map((s) => (
            <path key={s.key} d={linePath(s.key)} fill="none" stroke={s.color} strokeWidth={1.8}
              strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          ))}

          {/* Hover */}
          {hover !== null && (
            <g>
              <line x1={x(hover)} y1={PAD.top} x2={x(hover)} y2={PAD.top + innerH} stroke="#9ca3af" strokeWidth={1} strokeDasharray="3 3" />
              {SERIES.map((s) => (
                <circle key={s.key} cx={x(hover)} cy={y(points[hover][s.key])} r={3} fill={s.color} />
              ))}
            </g>
          )}
        </svg>

        {hovered && (
          <div className="absolute top-0 right-0 rounded-md bg-slate-900 text-white px-2.5 py-1.5 text-[11px] pointer-events-none">
            <p className="font-medium mb-0.5">
              {new Date(hovered.date).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}
            </p>
            <div className="flex gap-2 tabular-nums">
              {SERIES.map((s) => (
                <span key={s.key} style={{ color: s.color }}>{s.label[0]} {hovered[s.key]}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

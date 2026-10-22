"use client";

import { useState } from "react";
import Link from "next/link";
import {
  IconCheck,
  IconX,
  IconAlertTriangle,
  IconMinus,
  IconHelpCircle,
  IconDownload,
  IconShieldCheck,
  IconBuilding,
} from "@tabler/icons-react";
import { HelpPanel, Term } from "@/components/app/help-panel";
import type { FrameworkReport, ControlStatus } from "@/lib/compliance";
import { DetailDrawer, DrawerSection } from "@/components/app/detail-drawer";
import { cn } from "@/lib/utils";

// ─── Status helpers ────────────────────────────────────────────────────────────

const statusConfig: Record<ControlStatus, { icon: React.ReactNode; label: string; cls: string }> = {
  pass:    { icon: <IconCheck size={13} />,        label: "Conforme",    cls: "badge-ok" },
  fail:    { icon: <IconX size={13} />,            label: "Non conforme", cls: "badge-critical" },
  warning: { icon: <IconAlertTriangle size={13} />, label: "Partiel",     cls: "badge-warning" },
  na:      { icon: <IconMinus size={13} />,        label: "N/A",         cls: "badge-muted" },
  unknown: { icon: <IconHelpCircle size={13} />,   label: "Non évalué",  cls: "badge-muted" },
};

// ─── Score ring SVG ────────────────────────────────────────────────────────────

function ScoreRing({ score, size = 72 }: { score: number; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (score / 100) * circ;
  const color = score >= 75 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444";

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={6} className="text-muted opacity-20" />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={color} strokeWidth={6}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.5s ease" }}
      />
    </svg>
  );
}

// ─── Framework tab button ──────────────────────────────────────────────────────

function FrameworkTab({ report, active, onClick }: { report: FrameworkReport; active: boolean; onClick: () => void }) {
  const { framework, score, failCount } = report;
  return (
    <button onClick={onClick}
      className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all w-full",
        active ? "bg-violet-50 text-violet-700" : "hover:bg-muted text-foreground")}>
      <div className="relative shrink-0">
        <ScoreRing score={score} size={44} />
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold">
          {score}%
        </span>
      </div>
      <div className="min-w-0">
        <p className="text-[13px] font-medium truncate">{framework.shortName}</p>
        <p className={cn("text-[11px]", active ? "text-violet-500" : "text-muted-foreground")}>
          {failCount > 0
            ? `${failCount} non conforme${failCount > 1 ? "s" : ""}`
            : report.unknownCount > 0
              ? `Aucun écart · ${report.unknownCount} non évalué${report.unknownCount > 1 ? "s" : ""}`
              : "Conforme"}
        </p>
      </div>
    </button>
  );
}

// ─── Controls table ────────────────────────────────────────────────────────────

function ControlsTable({ report }: { report: FrameworkReport }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const openCtrl = report.controls.find((c) => c.id === openId);
  const categories = [...new Set(report.controls.map((c) => c.category))];

  return (
    <div className="overflow-hidden">
      <div className="px-6 py-3.5 border-b border-border flex items-center justify-between bg-muted/20">
        <p className="text-[13px] font-medium">{report.framework.name} — contrôles évalués</p>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />{report.passCount} conformes</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" />{report.warnCount} partiels</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" />{report.failCount} non conformes</span>
          {report.naCount > 0 && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-muted" />{report.naCount} N/A</span>}
          {report.unknownCount > 0 && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-muted-foreground/40" />{report.unknownCount} non évalué{report.unknownCount > 1 ? "s" : ""}</span>}
        </div>
      </div>

      {categories.map((cat) => (
        <div key={cat}>
          <div className="px-6 py-2 bg-muted/20 border-b border-border">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{cat}</p>
          </div>
          {report.controls
            .filter((c) => c.category === cat)
            .map((ctrl) => {
              const sc = statusConfig[ctrl.status];
              const active = openId === ctrl.id;
              return (
                <button
                  key={ctrl.id}
                  className={cn("w-full flex items-start gap-4 px-6 py-3 hover:bg-muted/20 transition-colors text-left border-b border-border border-l-2", active ? "border-l-violet-600 bg-violet-50/40" : "border-l-transparent")}
                  onClick={() => setOpenId(active ? null : ctrl.id)}
                >
                  <span className="font-mono text-[11px] text-muted-foreground w-20 shrink-0 pt-0.5">{ctrl.id}</span>
                  <span className="flex-1 text-[13px] min-w-0">{ctrl.title}</span>
                  <span className={cn("inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium shrink-0", sc.cls)}>
                    {sc.icon}
                    {sc.label}
                  </span>
                </button>
              );
            })}
        </div>
      ))}
      {openCtrl && (
        <DetailDrawer onClose={() => setOpenId(null)} label={`Détail du contrôle ${openCtrl.id}`}>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className={cn("inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-medium", statusConfig[openCtrl.status].cls)}>
                {statusConfig[openCtrl.status].icon}{statusConfig[openCtrl.status].label}
              </span>
            </div>
            <p className="font-mono text-[11px] text-muted-foreground">{report.framework.shortName} · {openCtrl.id} · {openCtrl.category}</p>
            <h2 className="text-lg font-semibold mt-0.5">{openCtrl.title}</h2>
          </div>
          <DrawerSection title="Exigence"><p className="text-[13px] leading-relaxed">{openCtrl.description}</p></DrawerSection>
          <DrawerSection title="Constat"><p className="text-[13px] leading-relaxed break-words">{openCtrl.evidence}</p></DrawerSection>
          <DrawerSection title="À savoir">
            <p className="text-[12px] text-muted-foreground">Ce contrôle est évalué à partir des résultats de vos scans de dépendances. Il aide à préparer un audit, il ne remplace pas une certification.</p>
          </DrawerSection>
        </DetailDrawer>
      )}
    </div>
  );
}

// ─── Main client ───────────────────────────────────────────────────────────────

export function ComplianceClient({
  reports,
  globalScore,
  scannedRepos,
  totalComponents,
  totalVuln,
  totalCritical,
}: {
  reports: FrameworkReport[];
  globalScore: number;
  scannedRepos: number;
  totalComponents: number;
  totalVuln: number;
  totalCritical: number;
}) {
  const [activeId, setActiveId] = useState(reports[0]?.framework.id ?? "");
  const activeReport = reports.find((r) => r.framework.id === activeId) ?? reports[0];

  const globalLevel = globalScore >= 75 ? "ok" : globalScore >= 50 ? "warning" : "critical";
  const globalColor = { ok: "text-emerald-500", warning: "text-amber-500", critical: "text-red-500" }[globalLevel];

  return (
    <div className="flex flex-col flex-1 bg-white">

      <HelpPanel>
        <p>Cette page traduit les vulnérabilités trouvées dans vos dépendances en <Term>référentiels de conformité</Term> reconnus (SOC 2, ISO 27001, OWASP Top 10, PCI DSS). Elle sert à préparer un audit ou à répondre à un client, elle ne remplace pas une certification.</p>
        <p><Term>Contrôle</Term> : une exigence du référentiel (par exemple « gérer les vulnérabilités connues »). Chaque exigence est évaluée à partir des résultats de vos scans.</p>
        <p><Term>Conforme</Term> = exigence respectée ; <Term>Partiel</Term> = respectée en partie ou scan incomplet ; <Term>Non conforme</Term> = des vulnérabilités empêchent de la satisfaire ; <Term>Non évalué</Term> = pas assez de données (scannez d&apos;abord vos dépôts) ; <Term>N/A</Term> = ne s&apos;applique pas.</p>
        <p><Term>Score</Term> : pourcentage de contrôles conformes. Vert à partir de 75 %, orange de 50 à 74 %, rouge en dessous.</p>
      </HelpPanel>

      {/* Stats bar */}
      <div className="grid grid-cols-4 divide-x divide-border border-b border-border bg-white">
        <div className="flex items-center gap-4 px-6 py-4">
          <div className="relative shrink-0">
            <ScoreRing score={globalScore} size={56} />
            <span className={cn("absolute inset-0 flex items-center justify-center text-[13px] font-bold", globalColor)}>
              {globalScore}%
            </span>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground uppercase tracking-wider mb-0.5">Score global</p>
            <p className="text-[13px] font-semibold">
              {globalScore >= 75 ? "Conforme" : globalScore >= 50 ? "Partiel" : "Non conforme"}
            </p>
          </div>
        </div>
        <StatCell label="Repos analysés" value={scannedRepos} icon={<IconBuilding size={14} />} />
        <StatCell label="Composants vulnérables" value={totalVuln}
          icon={<IconAlertTriangle size={14} />}
          tone={totalVuln > 0 ? "warning" : "ok"}
          sub={`sur ${totalComponents} scannés`} />
        <StatCell label="CVE critiques" value={totalCritical}
          icon={<IconX size={14} />}
          tone={totalCritical > 0 ? "critical" : "ok"}
          sub={totalCritical === 0 ? "Aucune détectée" : "Action immédiate requise"} />
      </div>

      {/* Framework selector + controls */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar frameworks */}
        <div className="w-64 shrink-0 border-r border-border flex flex-col gap-1 p-3">
          {reports.map((r) => (
            <FrameworkTab
              key={r.framework.id}
              report={r}
              active={r.framework.id === activeId}
              onClick={() => setActiveId(r.framework.id)}
            />
          ))}
          <Link href="/report" className="mt-auto flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-[12px] text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <IconDownload size={13} />
            Rapport PDF
          </Link>
        </div>

        {/* Controls */}
        <div className="flex-1 min-w-0 overflow-y-auto">
          {activeReport && <ControlsTable report={activeReport} />}
        </div>
      </div>
    </div>
  );
}

function StatCell({ label, value, icon, tone = "default", sub }: {
  label: string; value: number; icon: React.ReactNode;
  tone?: "ok" | "warning" | "critical" | "default"; sub?: string;
}) {
  const toneClass = { ok: "text-green-600", warning: "text-amber-500", critical: "text-red-600", default: "text-foreground" }[tone];
  return (
    <div className="px-6 py-4">
      <div className="flex items-center gap-1.5 mb-1.5 text-muted-foreground">{icon}<p className="text-[11px] uppercase tracking-wider">{label}</p></div>
      <p className={cn("text-2xl font-semibold tabular-nums", toneClass)}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

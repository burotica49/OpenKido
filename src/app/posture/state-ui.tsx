import { IconAlertTriangle, IconCheck, IconHelpCircle, IconMinus, IconX } from "@tabler/icons-react";
import type { ControlState } from "@/lib/controls/types";

// Module partagé (serveur et client) : libellés et styles des états et gravités des contrôles de posture.
export const STATE: Record<ControlState, { label: string; icon: React.ReactNode; cls: string }> = {
  pass: { label: "Conforme", icon: <IconCheck size={14} />, cls: "text-green-600" },
  fail: { label: "Échec", icon: <IconX size={14} />, cls: "text-red-600" },
  warning: { label: "À examiner", icon: <IconAlertTriangle size={14} />, cls: "text-amber-600" },
  unknown: { label: "Non évaluable", icon: <IconHelpCircle size={14} />, cls: "text-muted-foreground" },
  na: { label: "Sans objet", icon: <IconMinus size={14} />, cls: "text-muted-foreground" },
};
export const SEV: Record<string, string> = {
  critical: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-blue-100 text-blue-700",
};
export const SEV_LABEL: Record<string, string> = { critical: "Critique", high: "Élevée", medium: "Moyenne", low: "Faible" };

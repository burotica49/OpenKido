"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { IconChevronDown, IconCheck, IconLoader2, IconStack2 } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { PERSONAL_ORG } from "@/lib/org-constants";
import { saveSelectedOrg } from "@/lib/save-selected-org";

interface Org {
  id: number;
  login: string;
  avatar_url: string;
}

export function OrgSelector({
  user,
  githubLogin,
  selectedOrg,
}: {
  user?: { name?: string | null; image?: string | null };
  githubLogin?: string | null;
  selectedOrg?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(selectedOrg ?? null);
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSelected(selectedOrg ?? null);
  }, [selectedOrg]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  async function handleOpen() {
    setOpen((v) => !v);
    if (orgs.length === 0) {
      setLoading(true);
      try {
        const res = await fetch("/api/orgs");
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data)) setOrgs(data);
      } catch {
        // GitHub indisponible — le sélecteur reste utilisable
      } finally {
        setLoading(false);
      }
    }
  }

  function handleSelect(login: string | null) {
    setSelected(login);
    setOpen(false);
    startTransition(async () => {
      await saveSelectedOrg(login);
      router.refresh();
    });
  }

  const personalLabel = githubLogin || user?.name || "Compte personnel";
  const selectedOrgData = orgs.find((o) => o.login === selected);
  const displayName =
    selected === PERSONAL_ORG
      ? personalLabel
      : selectedOrgData?.login || selected || "Tous les dépôts";
  const displayInitial = (displayName[0] ?? "U").toUpperCase();

  return (
    <div ref={ref} className="relative mx-2 my-6">
      <button
        onClick={handleOpen}
        className="flex w-full items-center justify-between px-3 py-2 rounded-md cursor-pointer text-[13px] transition-colors"
        style={{ color: "var(--sidebar-text-strong)", background: "var(--sidebar-hover)" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {selectedOrgData ? (
            <Image src={selectedOrgData.avatar_url} alt="" width={20} height={20} className="rounded shrink-0" />
          ) : selected === PERSONAL_ORG && user?.image ? (
            <Image src={user.image} alt="" width={20} height={20} className="rounded-full shrink-0" />
          ) : (
            <div className="h-5 w-5 rounded bg-violet-700 flex items-center justify-center text-[10px] text-white font-bold shrink-0">
              {selected ? displayInitial : <IconStack2 size={11} />}
            </div>
          )}
          <span className="truncate max-w-[110px]">{displayName}</span>
        </div>
        <IconChevronDown
          size={13}
          className={cn("transition-transform shrink-0", open && "rotate-180")}
          style={{ color: "var(--sidebar-text)" }}
        />
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-50 rounded-lg border shadow-lg py-1 overflow-hidden"
          style={{ background: "var(--sidebar-bg)", borderColor: "var(--sidebar-border)" }}
        >
          <button
            onClick={() => handleSelect(null)}
            className="flex w-full items-center gap-2 px-3 py-2 text-[13px] hover:bg-white/10 transition-colors"
            style={{ color: "var(--sidebar-text-strong)" }}
          >
            <IconStack2 size={16} className="shrink-0" />
            <span className="flex-1 text-left truncate">Tous les dépôts</span>
            {!selected && <IconCheck size={12} className="text-violet-400 shrink-0" />}
          </button>

          <button
            onClick={() => handleSelect(PERSONAL_ORG)}
            className="flex w-full items-center gap-2 px-3 py-2 text-[13px] hover:bg-white/10 transition-colors"
            style={{ color: "var(--sidebar-text-strong)" }}
          >
            {user?.image ? (
              <Image src={user.image} alt="" width={18} height={18} className="rounded-full shrink-0" />
            ) : (
              <div className="h-[18px] w-[18px] rounded-full bg-violet-700 flex items-center justify-center text-[10px] text-white font-bold shrink-0">
                {personalLabel[0]?.toUpperCase() ?? "U"}
              </div>
            )}
            <span className="flex-1 text-left truncate">{personalLabel}</span>
            {selected === PERSONAL_ORG && <IconCheck size={12} className="text-violet-400 shrink-0" />}
          </button>

          {(loading || orgs.length > 0) && (
            <div className="my-1 border-t" style={{ borderColor: "var(--sidebar-border)" }} />
          )}

          {loading ? (
            <div className="flex items-center justify-center py-3">
              <IconLoader2 size={14} className="animate-spin" style={{ color: "var(--sidebar-text)" }} />
            </div>
          ) : (
            orgs.map((org) => (
              <button
                key={org.id}
                onClick={() => handleSelect(org.login)}
                className="flex w-full items-center gap-2 px-3 py-2 text-[13px] hover:bg-white/10 transition-colors"
                style={{ color: "var(--sidebar-text-strong)" }}
              >
                <Image src={org.avatar_url} alt="" width={18} height={18} className="rounded shrink-0" />
                <span className="flex-1 text-left truncate">{org.login}</span>
                {selected === org.login && <IconCheck size={12} className="text-violet-400 shrink-0" />}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

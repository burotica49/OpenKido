"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { IconChevronDown, IconCheck, IconLoader2 } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

export const ORG_COOKIE = "ok_selected_org";

interface Org {
  id: number;
  login: string;
  avatar_url: string;
}

function getSelectedOrg(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${ORG_COOKIE}=([^;]*)`));
  const value = match ? decodeURIComponent(match[1]) : "";
  return value || null;
}

function setSelectedOrg(login: string) {
  document.cookie = `${ORG_COOKIE}=${encodeURIComponent(login)}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
}

export function OrgSelector({
  user,
}: {
  user?: { name?: string | null; image?: string | null };
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Read cookie on mount
  useEffect(() => {
    setSelected(getSelectedOrg());
  }, []);

  // Close on outside click
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
    const value = login ?? "";
    setSelected(value || null);
    setSelectedOrg(value);
    setOpen(false);
    router.refresh();
  }

  const displayName = selected || user?.name || "Organisation";
  const displayInitial = (displayName[0] ?? "U").toUpperCase();
  const selectedOrg = orgs.find((o) => o.login === selected);

  return (
    <div ref={ref} className="relative mx-2 my-6">
      <button
        onClick={handleOpen}
        className="flex w-full items-center justify-between px-3 py-2 rounded-md cursor-pointer text-[13px] transition-colors"
        style={{ color: "var(--sidebar-text-strong)", background: "var(--sidebar-hover)" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {selectedOrg ? (
            <Image src={selectedOrg.avatar_url} alt="" width={20} height={20} className="rounded shrink-0" />
          ) : user?.image && !selected ? (
            <Image src={user.image} alt="" width={20} height={20} className="rounded-full shrink-0" />
          ) : (
            <div className="h-5 w-5 rounded bg-violet-700 flex items-center justify-center text-[10px] text-white font-bold shrink-0">
              {displayInitial}
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
          {/* Personal account */}
          <button
            onClick={() => handleSelect(null)}
            className="flex w-full items-center gap-2 px-3 py-2 text-[13px] hover:bg-white/10 transition-colors"
            style={{ color: "var(--sidebar-text-strong)" }}
          >
            {user?.image ? (
              <Image src={user.image} alt="" width={18} height={18} className="rounded-full shrink-0" />
            ) : (
              <div className="h-[18px] w-[18px] rounded-full bg-violet-700 flex items-center justify-center text-[10px] text-white font-bold shrink-0">
                {user?.name?.[0]?.toUpperCase() ?? "U"}
              </div>
            )}
            <span className="flex-1 text-left truncate">{user?.name ?? "Compte personnel"}</span>
            {!selected && <IconCheck size={12} className="text-violet-400 shrink-0" />}
          </button>

          {/* Divider */}
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

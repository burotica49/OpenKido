"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  IconBrandGithub,
  IconShieldBolt,
  IconFileCertificate,
  IconSettings,
  IconWorld,
  IconSword,
  IconBug,
  IconCode,
  IconSearch,
  IconBell,
  IconLogout,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { OrgSelector } from "./org-selector";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; stroke?: number; className?: string }>;
  count?: number;
}

interface NavSection {
  label?: string;
  items: NavItem[];
}

const navSections: NavSection[] = [
  {
    label: "Assets",
    items: [
      { href: "/repos",   label: "Repositories", icon: IconBrandGithub },
      { href: "/domains", label: "Domaines",       icon: IconWorld },
    ],
  },
  {
    label: "Attack",
    items: [
      { href: "/code-audit", label: "Code Audit", icon: IconBug },
    ],
  },
  {
    label: "Quality & Compliance",
    items: [
      { href: "/code-quality", label: "Code Qualité", icon: IconCode },
      { href: "/compliance",   label: "Conformité",   icon: IconFileCertificate },
    ],
  },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors"
      style={{
        background: active ? "var(--sidebar-active)" : undefined,
        color: active ? "var(--sidebar-active-text)" : "var(--sidebar-text)",
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = "var(--sidebar-hover)"; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = ""; }}
    >
      <Icon size={15} stroke={1.75} />
      <span className="flex-1">{item.label}</span>
      {item.count !== undefined && (
        <span
          className="text-[11px] px-1.5 py-0.5 rounded-full tabular-nums min-w-[20px] text-center"
          style={{ background: "var(--sidebar-badge)", color: "var(--sidebar-text)" }}
        >
          {item.count}
        </span>
      )}
    </Link>
  );
}

export function Sidebar({
  user,
  repoCount,
  domainCount,
}: {
  user?: { name?: string | null; image?: string | null; email?: string | null };
  repoCount?: number;
  domainCount?: number;
}) {
  const pathname = usePathname();

  const sections = navSections.map((section) => ({
    ...section,
    items: section.items.map((item) => {
      if (item.href === "/repos" && repoCount !== undefined) return { ...item, count: repoCount };
      if (item.href === "/domains" && domainCount !== undefined) return { ...item, count: domainCount };
      return item;
    }),
  }));

  return (
    <aside
      className="hidden md:flex w-56 shrink-0 flex-col"
      style={{ background: "var(--sidebar-bg)", borderRight: "1px solid var(--sidebar-border)" }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-6 mt-8" style={{ borderBottom: "1px solid var(--sidebar-border)" }}>
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600">
          <IconShieldBolt size={15} className="text-white" />
        </div>
        <span className="text-[22px] font-light text-white">Open<span className="text-violet-600 uppercase font-black">kido</span></span>
      </div>

      {/* Org selector */}
      <OrgSelector user={user} />

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-6 space-y-5">
        {sections.map((section, si) => (
          <div key={si}>
            {section.label && (
              <p
                className="px-2.5 mb-1 text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: "var(--sidebar-section)" }}
              >
                {section.label}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink key={item.href} item={item} active={pathname.startsWith(item.href)} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Settings + user footer */}
      <div style={{ borderTop: "1px solid var(--sidebar-border)" }}>
        <div className="px-2 pt-2">
          <NavLink item={{ href: "/settings", label: "Paramètres", icon: IconSettings }} active={pathname.startsWith("/settings")} />
        </div>

        {user && (
          <div className="px-2 pb-3 pt-1">
            <div className="flex items-center gap-2 rounded-md px-2.5 py-2">
              {user.image ? (
                <Image src={user.image} alt="" width={24} height={24} className="rounded-full shrink-0" />
              ) : (
                <div className="h-6 w-6 rounded-full bg-violet-700 flex items-center justify-center text-[11px] text-white font-medium shrink-0">
                  {user.name?.[0]?.toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-medium" style={{ color: "var(--sidebar-text-strong)" }}>{user.name}</p>
                <p className="truncate text-[11px]" style={{ color: "var(--sidebar-text)" }}>{user.email}</p>
              </div>
              <form action="/api/auth/signout" method="POST">
                <button type="submit" className="hover:text-white transition-colors" style={{ color: "var(--sidebar-text)" }}>
                  <IconLogout size={13} />
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

export function TopBar({
  breadcrumb,
  children,
}: {
  breadcrumb?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border bg-white px-6 py-2.5 sticky top-0 z-10">
      {/* <span className="text-[13px] text-muted-foreground">{breadcrumb}</span> */}
      <div className="flex items-center gap-1">
        {/* <button className="rounded-md p-1.5 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
          <IconSearch size={16} />
        </button>
        <button className="rounded-md p-1.5 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
          <IconBell size={16} />
        </button>
        <button className="rounded-md p-1.5 hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
          <IconSettings size={16} />
        </button> */}
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-6 py-5 border-b border-border bg-white">
      <div>
        {title && <h1 className="text-2xl font-bold text-foreground uppercase">{title}</h1>}
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
    </div>
  );
}

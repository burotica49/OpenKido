"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function RepoNav({ owner, repoName }: { owner: string; repoName: string }) {
  const pathname = usePathname();
  const base = `/repos/${owner}/${repoName}`;

  const tabs = [
    { href: base, label: "Overview", match: (p: string) => p === base },
    { href: `${base}/issues`, label: "Issues", match: (p: string) => p.startsWith(`${base}/issues`) },
    { href: `${base}/inventory`, label: "Inventory", match: (p: string) => p.startsWith(`${base}/inventory`) },
  ];

  return (
    <div className="flex items-center gap-0 bg-white border-b border-border px-6">
      {tabs.map((tab) => {
        const active = tab.match(pathname);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "px-4 py-2.5 text-[13px] border-b-2 -mb-px transition-colors",
              active
                ? "border-violet-600 text-violet-600 font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}

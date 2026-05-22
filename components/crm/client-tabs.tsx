"use client";

/**
 * Sticky tab bar below the Profile header. Phase 1 v1 surface (per
 * docs/crm/20-technical-specs.md §7.1):
 *
 *   Overview · Portfolio · Workflow · Notes · Timeline · Tasks · Documents · Contacts
 *
 * Each tab is a Next.js Link to /app/crm/[id]/[tab]. Active tab is detected
 * from `usePathname()`. Tabs whose content isn't built yet (everything but
 * Overview in Phase 1) still navigate to the placeholder route.
 *
 * Spec: docs/crm/20-technical-specs.md §5.3.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

type Tab = {
  id: string;
  label: string;
  badge?: number | null;
};

const TABS: Tab[] = [
  { id: "overview", label: "Overview" },
  { id: "portfolio", label: "Portfolio" },
  { id: "workflow", label: "Workflow" },
  { id: "drippers", label: "Drippers" },
  { id: "notes", label: "Notes" },
  { id: "timeline", label: "Timeline" },
  { id: "tasks", label: "Tasks" },
  { id: "documents", label: "Documents" },
  { id: "contacts", label: "Contacts" },
];

export type ClientTabsProps = {
  clientId: string;
  /** Optional badges by tab id — Phase 2 wires the open-task count etc. */
  badges?: Partial<Record<string, number>>;
};

export function ClientTabs({ clientId, badges }: ClientTabsProps) {
  const pathname = usePathname() ?? "";
  const activeId = activeTabFromPath(pathname);

  return (
    <nav
      aria-label="Client tabs"
      className="sticky top-0 z-10 flex flex-shrink-0 items-end gap-0 overflow-x-auto px-6 print:hidden"
      style={{
        backgroundColor: "#FFFFFF",
        borderBottom: "1px solid var(--ap-border)",
      }}
    >
      {TABS.map((tab) => {
        const active = tab.id === activeId;
        const badge = badges?.[tab.id];
        return (
          <Link
            key={tab.id}
            href={`/app/crm/${clientId}/${tab.id}`}
            aria-current={active ? "page" : undefined}
            className="group relative flex items-center gap-1.5 px-3 py-2.5 text-[12.5px] font-medium transition-colors"
            style={{
              color: active ? "var(--ap-navy)" : "var(--ap-gray)",
            }}
          >
            <span>{tab.label}</span>
            {typeof badge === "number" && badge > 0 ? (
              <span
                className="px-1.5 py-px text-[10px] font-semibold"
                style={{
                  backgroundColor: "var(--ap-pilot-light)",
                  color: "var(--ap-navy)",
                }}
              >
                {badge}
              </span>
            ) : null}
            {active ? (
              <span
                aria-hidden="true"
                className="absolute bottom-[-1px] left-0 h-[2px] w-full"
                style={{ backgroundColor: "var(--ap-royal)" }}
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function activeTabFromPath(pathname: string): string {
  // Expected shape: /app/crm/[id]/[tab]/...
  const parts = pathname.split("/").filter(Boolean);
  // parts: ["app", "crm", "<id>", "<tab>", ...]
  return parts[3] ?? "overview";
}

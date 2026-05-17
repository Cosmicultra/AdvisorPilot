"use client";

/**
 * 60px vertical navigation rail — the persistent left edge of every CRM
 * route. Five items: Intake, CRM, Tasks, Reports, Settings (Settings pinned
 * at the bottom).
 *
 * Active-item detection inspects the URL pathname; the matching item gets a
 * royal background + a 3px royal left border. Hidden on print so the
 * Report tab can render at full width when the advisor prints a snapshot.
 *
 * Spec: docs/crm/00-fundamentals.md §2 (the app rail) and
 * docs/crm/20-technical-specs.md §5.1.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardList,
  FileText,
  LayoutGrid,
  ListChecks,
  Settings,
} from "lucide-react";
import { useSettingsDialog } from "./settings-dialog-provider";

type RailItem = {
  id: "intake" | "crm" | "tasks" | "reports";
  href: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
};

const TOP_ITEMS: RailItem[] = [
  { id: "intake", href: "/app/intake", icon: ClipboardList, label: "Intake" },
  { id: "crm", href: "/app/crm", icon: LayoutGrid, label: "CRM" },
  { id: "tasks", href: "/app/tasks", icon: ListChecks, label: "Tasks" },
  { id: "reports", href: "/app/reports", icon: FileText, label: "Reports" },
];

function moduleFromPathname(pathname: string): RailItem["id"] | null {
  if (pathname.startsWith("/app/intake")) return "intake";
  if (pathname.startsWith("/app/crm")) return "crm";
  if (pathname.startsWith("/app/tasks")) return "tasks";
  if (pathname.startsWith("/app/reports")) return "reports";
  return null;
}

export function AppRail() {
  const pathname = usePathname() ?? "";
  const activeModule = moduleFromPathname(pathname);
  const settingsDialog = useSettingsDialog();

  return (
    <nav
      aria-label="AdvisorPilot main navigation"
      // Hidden on mobile — mobile advisors open the same nav items via
      // the <MobileNav /> hamburger in the TopHeader. Visible (sticky
      // 60px left rail) at md+.
      className="sticky top-0 hidden h-screen w-[60px] flex-shrink-0 flex-col items-stretch text-white md:flex print:hidden"
      style={{ backgroundColor: "var(--ap-navy)" }}
    >
      <Link
        href="/app"
        aria-label="AdvisorPilot home"
        className="flex h-[60px] items-center justify-center"
        style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.08)" }}
      >
        {/* Native img: small enough for the 60px rail; falls back to "AP"
         *  monogram if the file is missing. */}
        <img
          src="/logo.png"
          alt="AdvisorPilot"
          width={32}
          height={32}
          className="block h-8 w-8 object-contain"
        />
      </Link>

      <div className="flex flex-1 flex-col items-stretch py-2">
        {TOP_ITEMS.map((item) => (
          <RailLink key={item.id} item={item} active={activeModule === item.id} />
        ))}
      </div>

      <div
        className="flex flex-col items-stretch py-2"
        style={{ borderTop: "1px solid rgba(255, 255, 255, 0.08)" }}
      >
        <RailButton
          icon={Settings}
          label="Settings"
          onClick={() => settingsDialog.open()}
        />
      </div>
    </nav>
  );
}

function RailButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="group relative flex h-[52px] w-full flex-col items-center justify-center gap-0.5 transition-colors hover:bg-white/5"
      style={{
        backgroundColor: "transparent",
        color: "rgba(255, 255, 255, 0.72)",
      }}
    >
      <Icon size={18} strokeWidth={1.75} />
      <span className="text-[9.5px] font-medium uppercase tracking-[0.06em]">
        {label}
      </span>
    </button>
  );
}

function RailLink({ item, active }: { item: RailItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-label={item.label}
      aria-current={active ? "page" : undefined}
      className="group relative flex h-[52px] w-full flex-col items-center justify-center gap-0.5 transition-colors"
      style={{
        backgroundColor: active ? "var(--ap-royal)" : "transparent",
        color: active ? "#FFFFFF" : "rgba(255, 255, 255, 0.72)",
      }}
    >
      {active ? (
        <span
          aria-hidden="true"
          className="absolute left-0 top-0 h-full w-[3px]"
          style={{ backgroundColor: "#FFFFFF" }}
        />
      ) : null}
      <Icon size={18} strokeWidth={1.75} />
      <span className="text-[9.5px] font-medium uppercase tracking-[0.06em]">
        {item.label}
      </span>
    </Link>
  );
}

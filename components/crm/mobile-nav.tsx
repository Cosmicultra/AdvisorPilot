"use client";

/**
 * <MobileNav /> — hamburger trigger + slide-out drawer for primary nav.
 *
 * Mobile (< md / 768px) chrome: the persistent 60px <AppRail /> is
 * hidden at this width because it's too much horizontal real estate
 * to give up on a phone. This component provides the equivalent
 * navigation in the standard mobile-web pattern:
 *
 *   - Hamburger button mounted in the TopHeader (left of the title)
 *   - Tap → slide-out drawer enters from the left
 *   - Drawer contains the same nav items as <AppRail /> (Intake,
 *     CRM, Tasks, Reports, Settings) plus the user's email + sign-out
 *     access via <UserMenu /> inline at the bottom
 *   - Backdrop click, Esc, or tap on a nav link all dismiss the
 *     drawer so navigation feels one-tap
 *
 * Sub-nav (wizard rail / Roster) is NOT included here on purpose:
 *   - The Roster has its own mobile entry point (inline on
 *     /app/crm/page.tsx) so adding it here would duplicate the
 *     surface and bloat the drawer for the common case of
 *     section-switching.
 *   - The Wizard rail's per-step navigation is rarely needed on
 *     mobile — the form already has Next/Back buttons within each
 *     step. If we ever need to jump steps on mobile, a step
 *     selector dropdown in the section's TopHeader is the right
 *     entry point (close to the content the advisor's looking at).
 *
 * Spec: best-practice mobile pattern for a desktop-first SaaS dash
 * (Vercel, Linear, Supabase, GitHub all use this exact pattern).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ClipboardList,
  FileText,
  LayoutGrid,
  ListChecks,
  Menu,
  Settings,
  X,
} from "lucide-react";
import { useSettingsDialog } from "./settings-dialog-provider";
import { UserMenu } from "./user-menu";

type NavItem = {
  id: "intake" | "crm" | "tasks" | "reports";
  href: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
};

// Same list as the primary AppRail so mobile and desktop nav stay
// in lockstep. If you add a primary section, add it both here AND
// in components/crm/app-rail.tsx → TOP_ITEMS.
const NAV_ITEMS: NavItem[] = [
  { id: "intake", href: "/app/intake", icon: ClipboardList, label: "Intake" },
  { id: "crm", href: "/app/crm", icon: LayoutGrid, label: "CRM" },
  { id: "tasks", href: "/app/tasks", icon: ListChecks, label: "Tasks" },
  { id: "reports", href: "/app/reports", icon: FileText, label: "Reports" },
];

function moduleFromPathname(pathname: string): NavItem["id"] | null {
  if (pathname.startsWith("/app/intake")) return "intake";
  if (pathname.startsWith("/app/crm")) return "crm";
  if (pathname.startsWith("/app/tasks")) return "tasks";
  if (pathname.startsWith("/app/reports")) return "reports";
  return null;
}

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? "";
  const activeModule = moduleFromPathname(pathname);
  const settingsDialog = useSettingsDialog();

  // Close the drawer on any route change. Without this the drawer
  // stays open when the user taps a nav link, blocking the new
  // route's content until they dismiss manually. usePathname()
  // updates on every Next.js navigation so this fires automatically.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Esc closes the drawer (standard modal/drawer behavior). Bound at
  // window so it works regardless of focus location, but only while
  // the drawer is open so we don't intercept Esc keys elsewhere.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Lock body scroll when the drawer is open so swiping inside the
  // drawer doesn't scroll the page underneath (a small but jarring
  // UX bug on iOS Safari).
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <>
      {/* Trigger — mobile only; the desktop AppRail is the
          equivalent at md+. */}
      <button
        type="button"
        aria-label="Open navigation menu"
        aria-expanded={open}
        aria-controls="mobile-nav-drawer"
        onClick={() => setOpen(true)}
        className="flex h-9 w-9 flex-shrink-0 items-center justify-center md:hidden"
        style={{
          color: "var(--ap-navy)",
          border: "1px solid var(--ap-border)",
          backgroundColor: "#FFFFFF",
        }}
      >
        <Menu size={18} strokeWidth={1.75} />
      </button>

      {open ? (
        <>
          {/* Backdrop — click anywhere outside the drawer to dismiss.
              z-index sits below the drawer (z-50) but above the rest
              of the app chrome. */}
          <button
            type="button"
            aria-label="Close navigation menu"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm md:hidden"
          />

          {/* Drawer panel — slides in from the left. 280px is wide
              enough for icon + label rows without dominating the
              phone viewport (a 375px iPhone keeps ~95px of content
              visible). z-50 so it always covers the backdrop. */}
          <aside
            id="mobile-nav-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="fixed bottom-0 left-0 top-0 z-50 flex w-[280px] flex-col md:hidden"
            style={{
              backgroundColor: "var(--ap-navy)",
              color: "#FFFFFF",
              boxShadow: "4px 0 24px rgba(12, 25, 41, 0.25)",
            }}
          >
            {/* Drawer header — logo + close button. Matches the
                AppRail's 60px brand stripe so users see the same
                identity in both layouts. */}
            <div
              className="flex h-[60px] flex-shrink-0 items-center justify-between px-3"
              style={{ borderBottom: "1px solid rgba(255, 255, 255, 0.08)" }}
            >
              <Link
                href="/app"
                aria-label="AdvisorPilot home"
                className="flex items-center gap-2"
                onClick={() => setOpen(false)}
              >
                {/* Reuses the AppRail logo asset; falls back to text
                    if the file is missing. */}
                <img
                  src="/logo.png"
                  alt="AdvisorPilot"
                  width={28}
                  height={28}
                  className="block h-7 w-7 object-contain"
                />
                <span className="text-[13px] font-semibold tracking-tight">
                  AdvisorPilot
                </span>
              </Link>
              <button
                type="button"
                aria-label="Close navigation menu"
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center text-white/70 transition-colors hover:text-white"
              >
                <X size={18} strokeWidth={1.75} />
              </button>
            </div>

            {/* Primary nav items — same list, same icons, same active
                detection as the desktop <AppRail />. */}
            <nav
              aria-label="Primary"
              className="flex flex-1 flex-col gap-px overflow-y-auto py-2"
            >
              {NAV_ITEMS.map((item) => {
                const active = activeModule === item.id;
                const Icon = item.icon;
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className="group relative flex items-center gap-3 px-4 py-3 transition-colors"
                    style={{
                      backgroundColor: active
                        ? "var(--ap-royal)"
                        : "transparent",
                      color: active ? "#FFFFFF" : "rgba(255, 255, 255, 0.84)",
                    }}
                  >
                    {/* 3px left accent bar for the active item —
                        mirrors the desktop rail's active treatment. */}
                    {active ? (
                      <span
                        aria-hidden="true"
                        className="absolute left-0 top-0 h-full w-[3px]"
                        style={{ backgroundColor: "#FFFFFF" }}
                      />
                    ) : null}
                    <Icon size={18} strokeWidth={1.75} />
                    <span className="text-[14px] font-medium">
                      {item.label}
                    </span>
                  </Link>
                );
              })}
            </nav>

            {/* Footer — Settings + UserMenu. Pinned at the bottom of
                the drawer so secondary actions stay out of the
                primary scrolling area. */}
            <div
              className="flex flex-shrink-0 flex-col gap-px py-2"
              style={{ borderTop: "1px solid rgba(255, 255, 255, 0.08)" }}
            >
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  settingsDialog.open();
                }}
                className="flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5"
                style={{ color: "rgba(255, 255, 255, 0.84)" }}
              >
                <Settings size={18} strokeWidth={1.75} />
                <span className="text-[14px] font-medium">Settings</span>
              </button>
              <div className="px-3 pt-2">
                <UserMenu />
              </div>
            </div>
          </aside>
        </>
      ) : null}
    </>
  );
}

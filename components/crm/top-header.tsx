/**
 * Top header bar — appears above every CRM route's content. Page title +
 * optional subtitle on the left, slot for right actions (search box,
 * "New client" button, bell, avatar — wired in later phases).
 *
 * Phase 0 ships the structural shell; right-action slot accepts arbitrary
 * children so pages can populate it themselves. Hidden on print so the
 * Report tab renders at full width.
 *
 * Spec: docs/crm/00-fundamentals.md §2 (the top header) and
 * docs/crm/20-technical-specs.md §5.1.
 */

import type { ReactNode } from "react";
import { MobileNav } from "./mobile-nav";
import { UserMenu } from "./user-menu";

export type TopHeaderProps = {
  title: string;
  subtitle?: string;
  /** Right-slot content. Defaults to `<UserMenu />` when omitted; pass an
   *  explicit value to replace it (or pass `<>...<UserMenu />...</>` to
   *  combine custom actions with the default menu). */
  rightActions?: ReactNode;
};

export function TopHeader({ title, subtitle, rightActions }: TopHeaderProps) {
  return (
    <header
      // Mobile leans on a smaller horizontal padding (px-4) because the
      // hamburger trigger sits to the left of the title, and the title
      // already eats most of the row; px-6 at md+ matches the rest of
      // the CRM chrome.
      className="flex h-[60px] flex-shrink-0 items-center justify-between gap-4 px-4 md:px-6 print:hidden"
      style={{
        backgroundColor: "#FFFFFF",
        borderBottom: "1px solid var(--ap-border)",
        boxShadow: "0 1px 0 rgba(12, 25, 41, 0.03)",
      }}
    >
      <div className="flex min-w-0 items-center gap-3">
        {/* Mobile-only hamburger → opens <MobileNav /> drawer with the
            same primary nav items as the desktop AppRail. <MobileNav />
            self-gates on viewport (`md:hidden`) so adding it
            unconditionally here is safe — no double-render at md+. */}
        <MobileNav />
        <div className="flex min-w-0 flex-col">
          <h1
            className="truncate font-display text-[18px] font-semibold leading-tight"
            style={{ color: "var(--ap-navy)" }}
          >
            {title}
          </h1>
          {subtitle ? (
            <p
              className="truncate text-[11.5px] leading-tight"
              style={{ color: "var(--ap-gray)" }}
            >
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-shrink-0 items-center gap-2">
        {rightActions ?? <UserMenu />}
      </div>
    </header>
  );
}

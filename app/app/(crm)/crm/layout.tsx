import type { ReactNode } from "react";
import { TopHeader } from "@/components/crm/top-header";
import { RosterList } from "@/components/crm/roster-list";

/**
 * Layout for /app/crm/* — the two-pane Roster shell. Persistent across
 * client selection so the left list doesn't re-fetch on every row click.
 *
 * Layout chain:
 *   app/layout.tsx                    → root (fonts only)
 *   app/app/(crm)/layout.tsx          → CrmShell (rail + main column)
 *   app/app/(crm)/crm/layout.tsx      → Roster two-pane (THIS FILE)
 *   app/app/(crm)/crm/page.tsx        → empty-right-pane state
 *   app/app/(crm)/crm/[id]/page.tsx   → redirects to /[id]/overview
 *   app/app/(crm)/crm/[id]/[tab]/page.tsx → tab content
 *
 * Spec: docs/crm/00-fundamentals.md §2 (the Roster).
 */

export default function CrmRosterLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <TopHeader
        title="Client roster"
        subtitle="Select a client to open their overview"
      />
      <div className="flex min-h-0 flex-1">
        {/* Sidebar Roster — hidden on mobile (mobile advisors browse
            the roster inline via /app/crm/page.tsx instead). The
            wrapper owns the responsive visibility; <RosterList />
            itself self-sizes at md and lg so it can be reused as the
            mobile inline surface without re-styling.
            The `ap-roster-sidebar` marker class triggers icon-only
            row collapse at md→lg (hides identity + AUM + filter bar
            via globals.css). Inline page usage doesn't have this
            wrapper, so its rows stay fully labeled. */}
        <div className="ap-roster-sidebar hidden md:flex">
          <RosterList />
        </div>
        <section className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          {children}
        </section>
      </div>
    </>
  );
}

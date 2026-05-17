import { RosterList } from "@/components/crm/roster-list";

/**
 * /app/crm — Roster's empty-right-pane state.
 *
 * At md+ the persistent sidebar roster (from app/app/(crm)/crm/layout.tsx)
 * is visible to the left and this page just shows a "pick one" nudge.
 *
 * On mobile (< md) the sidebar roster is `hidden md:flex` (too narrow
 * for a 360px / even 60px column on a phone), so THIS page renders the
 * roster INLINE as the main content. Tapping a client navigates to
 * /app/crm/[id]/[tab], where the client-detail view shows. To get back
 * to the roster on mobile, the advisor uses the hamburger → CRM, or
 * the browser back button — same pattern as Linear / Notion mobile.
 *
 * Layout chain renders the rail + top header + roster sidebar to the
 * left of this page on desktop (see app/app/(crm)/crm/layout.tsx).
 */
export default function CrmRosterEmptyState() {
  return (
    <>
      {/* Mobile: inline roster. The layout's sidebar RosterList is
          wrapped in `hidden md:flex` so it disappears at this width;
          this inline usage takes its place as the page's main content,
          full-bleed. <RosterList /> self-sizes (w-full at base) so it
          fills the available column without per-instance styling. */}
      <div className="flex flex-1 flex-col md:hidden">
        <RosterList />
      </div>

      {/* Desktop: empty-right-pane state — sidebar roster shows on the
          left, this nudge sits in the right pane. */}
      <div className="hidden flex-1 flex-col items-center justify-center px-6 py-12 text-center md:flex">
        <p
          className="mb-2 font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em]"
          style={{ color: "var(--ap-royal)" }}
        >
          No client selected
        </p>
        <h2
          className="mb-2 font-display text-[22px] font-semibold leading-tight"
          style={{ color: "var(--ap-navy)" }}
        >
          Pick a client on the left
        </h2>
        <p
          className="max-w-[400px] text-[13px] leading-snug"
          style={{ color: "var(--ap-gray)" }}
        >
          Select a client from the roster to open their overview, or start a
          brand-new client in <strong>Intake</strong>.
        </p>
      </div>
    </>
  );
}

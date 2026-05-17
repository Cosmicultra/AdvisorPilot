/**
 * Server-only feature flag for the CRM shell rollout.
 *
 * One env var (`CRM_SHELL`) is the rollout switch; one env var
 * (`CRM_LANDING`) controls where flag-on advisors land at /app.
 *
 * Why no `NEXT_PUBLIC_` prefix — the flag is only read in server-side
 * `redirect()` calls (legacy app/app/page.tsx + the CRM shell layout). The
 * client never reads it. Server-only env vars are runtime-readable in
 * Next.js (re-read per request), so flipping the var in Vercel takes
 * effect without a redeploy.
 *
 * Specs: docs/crm/10-implementation.md §3.3 and docs/crm/20-technical-specs.md §10.
 */

/**
 * True when the CRM shell is enabled. Production default is `off` until
 * Phase 5 cutover; local dev defaults to `on` per the Phase 0 decision.
 */
export function crmShellEnabled(): boolean {
  return process.env.CRM_SHELL === "on";
}

/**
 * Where /app should redirect when the CRM shell is enabled.
 *
 * - Phases 0-2 (intake wizard not yet extracted): default `/app/crm` so
 *   internal testers land on the most-developed surface (the Roster).
 * - Phase 3 day 1 onward (intake wizard real): flip CRM_LANDING to
 *   `/app/intake` so advisors land on the new-client wizard inside the
 *   CRM shell — same UX as today.
 *
 * Override via the `CRM_LANDING` env var. Defaults to `/app/crm` until the
 * Phase 3 flip.
 */
export function crmLandingRedirectTarget(): string {
  return process.env.CRM_LANDING?.trim() || "/app/crm";
}

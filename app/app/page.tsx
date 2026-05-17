import { redirect } from "next/navigation";
import {
  crmLandingRedirectTarget,
  crmShellEnabled,
} from "@/lib/crm/feature-flag";
import LegacyAppShell from "./legacy-app-shell";

/**
 * /app entry point.
 *
 * - Flag OFF (default in production until Phase 5): renders the legacy
 *   single-page workflow (`legacy-app-shell.tsx`) — the entire 8,279-line
 *   client component that hosts intake, upload, confirm, analysis,
 *   meeting, FIA, Roth, ret-income, fee-analysis, report. Zero behavior
 *   change vs. pre-Phase-0.
 *
 * - Flag ON: server-side redirect to `crmLandingRedirectTarget()` — the
 *   Roster (`/app/crm`) during Phases 0-2, the new-client wizard
 *   (`/app/intake`) once Phase 3 day 1 extracts it.
 *
 * Spec: docs/crm/10-implementation.md §3.3.
 */
export default function AppPage() {
  if (crmShellEnabled()) {
    redirect(crmLandingRedirectTarget());
  }
  return <LegacyAppShell />;
}

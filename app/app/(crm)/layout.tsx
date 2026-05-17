import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { CrmShell } from "@/components/crm/crm-shell";
import { crmShellEnabled } from "@/lib/crm/feature-flag";

/**
 * Layout for the CRM route group `(crm)`. Mounts every route under
 * /app/intake, /app/crm, /app/tasks, /app/reports, /app/settings inside
 * the <CrmShell />.
 *
 * Server-side flag gate: when CRM_SHELL is off, every CRM route redirects
 * to /app (the legacy single-page workflow). One env-var flip = one
 * coherent experience.
 *
 * Auth gating intentionally NOT done here. The legacy app uses client-side
 * useSession() and tolerates an unauthenticated render; the CRM follows
 * the same convention. API routes still enforce auth via
 * resolveAdvisorIdentity (returns 401), and the Roster client surface
 * shows a "Your session has expired" prompt on 401 instead of a raw error.
 *
 * Spec: docs/crm/10-implementation.md §3.3.
 */

export default function CrmGroupLayout({ children }: { children: ReactNode }) {
  if (!crmShellEnabled()) {
    redirect("/app");
  }

  return <CrmShell>{children}</CrmShell>;
}

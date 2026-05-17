/**
 * The CRM shell — wraps every CRM route with the persistent app rail and
 * leaves the main content column free for the route itself to render its
 * top header + body.
 *
 * Layout:
 *
 *   ┌────┬─────────────────────────────────────────────┐
 *   │    │  (route renders <TopHeader/> + content here)│
 *   │ AP │                                             │
 *   │ ra │                                             │
 *   │ il │                                             │
 *   │    │                                             │
 *   └────┴─────────────────────────────────────────────┘
 *
 * Each route is responsible for its own <TopHeader /> so the title +
 * subtitle + right actions reflect what the user is looking at. The shell
 * just provides the rail + the main column container.
 *
 * Spec: docs/crm/20-technical-specs.md §5.1.
 */

import type { ReactNode } from "react";
import { AppRail } from "./app-rail";
import { SettingsDialogProvider } from "./settings-dialog-provider";

export function CrmShell({ children }: { children: ReactNode }) {
  return (
    <SettingsDialogProvider>
      <div
        className="flex min-h-screen w-full"
        style={{ backgroundColor: "#F5F6F8" }}
      >
        <AppRail />
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>
    </SettingsDialogProvider>
  );
}

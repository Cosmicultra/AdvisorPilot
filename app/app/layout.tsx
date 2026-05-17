/**
 * Authenticated-app layout — wraps every route under `/app/*`.
 *
 * Responsibilities:
 *   1. Mount `<ChatLocationProvider>` so the chat widget can read the
 *      current pathname + advisor-set client override from anywhere.
 *   2. Mount `<GlobalChatLauncher>` once. It self-gates on
 *      `/api/advisor-profile` and renders the launcher button + popover
 *      panel only when the advisor is signed in.
 *
 * The chat appears on:
 *   - `/app`                  — the legacy single-page workflow
 *   - `/app/intake`           — the CRM-shelled intake wizard
 *   - `/app/crm/*`            — every CRM route (CrmShell renders inside this layout)
 *   - `/app/tasks`, `/app/reports`, `/app/settings` — peer CRM surfaces
 *
 * The chat does NOT appear on:
 *   - `/`, `/signin`, `/signin/email`, `/signup`, `/forgot-password`
 *     (these live outside `/app`)
 *   - `/api/*`                — server-only
 *
 * This layout is intentionally light — it MUST stay a server component to
 * avoid coupling the entire authenticated tree to a client root. The
 * provider + launcher are client components and run on hydration.
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.14.1 + §B.14.2.
 */

import type { ReactNode } from "react";
import { ChatLocationProvider } from "@/lib/chat/chat-location-context";
import { GlobalChatLauncher } from "@/components/chat/global-chat-launcher";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { AuthTokenResponder } from "@/components/auth/auth-token-responder";

export default function AuthenticatedAppLayout({ children }: { children: ReactNode }) {
  return (
    <ConfirmProvider>
      <ChatLocationProvider>
        {/*
         * Cross-tab Supabase token bridge. Lets ancillary tabs we open
         * via window.open() (the print tab today; more later) recover
         * the email/password JWT from any sibling /app tab on mount.
         * Renders nothing; just listens on a same-origin BroadcastChannel.
         */}
        <AuthTokenResponder />
        {children}
        <GlobalChatLauncher />
      </ChatLocationProvider>
    </ConfirmProvider>
  );
}

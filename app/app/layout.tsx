/**
 * Authenticated-app layout — wraps every route under `/app/*`.
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.14.1 + §B.14.2.
 */

import type { ReactNode } from "react";
import { AppAuthenticatedChrome } from "@/components/app-authenticated-chrome";

export default function AuthenticatedAppLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <AppAuthenticatedChrome>{children}</AppAuthenticatedChrome>;
}

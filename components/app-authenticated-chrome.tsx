"use client";

/**
 * Client-side chrome for all `/app/*` routes: shared providers, lazy chat
 * launcher, and cross-tab auth bridge. Kept out of `app/app/layout.tsx` so
 * that file stays a Server Component.
 */

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { AuthTokenResponder } from "@/components/auth/auth-token-responder";
import { ProductGuideProvider } from "@/components/product-guide-provider";
import { ConfirmProvider } from "@/components/ui/confirm-dialog";
import { AdvisorProfileProvider } from "@/lib/advisor-profile-context";
import { ChatLocationProvider } from "@/lib/chat/chat-location-context";

const GlobalChatLauncher = dynamic(
  () =>
    import("@/components/chat/global-chat-launcher").then((m) => ({
      default: m.GlobalChatLauncher,
    })),
  { ssr: false }
);

export function AppAuthenticatedChrome({ children }: { children: ReactNode }) {
  return (
    <ConfirmProvider>
      <AdvisorProfileProvider>
        <ProductGuideProvider>
          <ChatLocationProvider>
            <AuthTokenResponder />
            {children}
            <GlobalChatLauncher />
          </ChatLocationProvider>
        </ProductGuideProvider>
      </AdvisorProfileProvider>
    </ConfirmProvider>
  );
}

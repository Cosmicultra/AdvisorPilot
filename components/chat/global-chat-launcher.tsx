"use client";

/**
 * Top-level mount point for the chat launcher.
 *
 * Gates the launcher on a successful `/api/advisor-profile` fetch:
 *   - status "loading"        → render nothing (don't flash a UI bit)
 *   - status "ready"          → render <ChatLauncher /> with the resolved identity
 *   - status "unauthenticated"→ render nothing (advisor isn't signed in)
 *   - status "error"          → render nothing (silently degrade; the rest
 *                                of the app keeps working)
 *
 * This is the ONLY component mounted in `app/app/layout.tsx`. Everything
 * else (provider, widget, hook) hangs off it. Keeping the auth gate here
 * means the chat hook never runs while signed-out — saves the network call
 * + avoids the watchdog/timer noise on the landing routes.
 */

import { useAdvisorProfile } from "@/lib/chat/use-advisor-profile";
import { ChatLauncher } from "./chat-launcher";

export function GlobalChatLauncher() {
  const { profile, status } = useAdvisorProfile();
  if (status !== "ready" || !profile) return null;
  return <ChatLauncher advisor={profile} />;
}

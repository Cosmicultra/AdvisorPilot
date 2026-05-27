"use client";

/**
 * Tiny advisor-profile fetcher used by the chat launcher to:
 *
 *   1. GATE the chat widget on auth — render nothing until /api/advisor-profile
 *      returns 200 with an email. (401 → user is signed out → hide the launcher.)
 *   2. PROVIDE the advisor's email + display name + timezone so the chat hook
 *      can stamp messages and pass timezone into the system prompt.
 *
 * Mirrors the pattern in `components/crm/user-menu.tsx` — same endpoint, same
 * advisorFetch path, same "soft-fail on error" posture. Lives in `lib/chat/`
 * instead of being copy-pasted into UserMenu because the chat launcher mounts
 * GLOBALLY (in `app/app/layout.tsx`), so it runs even when UserMenu isn't on
 * the page (e.g. /app legacy shell with feature flag off).
 *
 * Returns a stable identity shape — never throws to the caller; an unloaded
 * or errored fetch surfaces as `{ profile: null, status: "loading" | "error" }`
 * and the launcher renders nothing.
 */

import { useMemo } from "react";
import {
  useAdvisorProfileContextOptional,
  type AdvisorProfileApiBody,
} from "@/lib/advisor-profile-context";

export interface AdvisorProfileForChat {
  email: string;
  displayName: string | null;
  timezone: string | null;
}

export type AdvisorProfileStatus = "loading" | "ready" | "error" | "unauthenticated";

export interface UseAdvisorProfileReturn {
  profile: AdvisorProfileForChat | null;
  status: AdvisorProfileStatus;
}

/**
 * Endpoint response shape (subset of what /api/advisor-profile returns).
 * Field names match `mapProfile` in the route handler.
 */
function toChatProfile(body: AdvisorProfileApiBody | null): AdvisorProfileForChat | null {
  const email = body?.profile?.ownerEmail?.trim() || null;
  if (!email) return null;
  return {
    email,
    displayName: body?.profile?.advisorName?.trim() || null,
    timezone: deriveBrowserTimezone(),
  };
}

export function useAdvisorProfile(): UseAdvisorProfileReturn {
  const ctx = useAdvisorProfileContextOptional();
  return useMemo(() => {
    if (!ctx) {
      return { profile: null, status: "loading" as AdvisorProfileStatus };
    }
    const profile =
      ctx.status === "ready" ? toChatProfile(ctx.body) : null;
    return { profile, status: ctx.status };
  }, [ctx]);
}

function deriveBrowserTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

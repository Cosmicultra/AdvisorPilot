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

import { useEffect, useState } from "react";
import { advisorFetch } from "@/lib/advisor-fetch";

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
interface AdvisorProfileResponse {
  profile?: {
    ownerEmail?: string | null;
    advisorName?: string | null;
    advisorTitle?: string | null;
    // The endpoint doesn't currently surface timezone — we derive from
    // Intl when the profile lacks one. Once `advisorpilot_advisor_profiles`
    // adds a `timezone` column we'll honor it here.
  } | null;
}

export function useAdvisorProfile(): UseAdvisorProfileReturn {
  const [profile, setProfile] = useState<AdvisorProfileForChat | null>(null);
  const [status, setStatus] = useState<AdvisorProfileStatus>("loading");

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await advisorFetch("/api/advisor-profile", {
          method: "GET",
          cache: "no-store",
        });
        if (cancelled) return;

        if (res.status === 401 || res.status === 403) {
          setStatus("unauthenticated");
          setProfile(null);
          return;
        }
        if (!res.ok) {
          setStatus("error");
          return;
        }

        const body = (await res.json().catch(() => null)) as AdvisorProfileResponse | null;
        if (cancelled) return;

        const email = body?.profile?.ownerEmail?.trim() || null;
        if (!email) {
          // Profile row missing — treat as unauthenticated since the chat
          // route would reject without an email anyway.
          setStatus("unauthenticated");
          setProfile(null);
          return;
        }

        setProfile({
          email,
          displayName: body?.profile?.advisorName?.trim() || null,
          // Browser-derived; safe fallback when the profile row lacks one.
          timezone: deriveBrowserTimezone(),
        });
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { profile, status };
}

function deriveBrowserTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

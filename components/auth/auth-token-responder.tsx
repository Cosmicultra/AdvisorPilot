"use client";

/**
 * <AuthTokenResponder /> — invisible client component that mounts the
 * cross-tab Supabase token responder for the duration of the
 * authenticated-app session.
 *
 * Sits inside `app/app/layout.tsx`. Any tab that opens INSIDE /app/*
 * (which is every advisor surface) will quietly respond to
 * `request_token` broadcasts from sibling tabs. Print tabs opened via
 * `window.open(/print/reports/...)` use that bridge on mount to
 * recover the Supabase JWT — without which email/password advisors
 * would get a 401 on every API call in the print tab (sessionStorage
 * is per-tab; see .cursor/rules/50-authentication.mdc).
 *
 * Renders nothing. Just owns the listener lifecycle.
 */

import { useEffect } from "react";
import { mountTokenResponder } from "@/lib/auth/token-bridge";

export function AuthTokenResponder() {
  useEffect(() => {
    const cleanup = mountTokenResponder();
    return cleanup;
  }, []);
  return null;
}

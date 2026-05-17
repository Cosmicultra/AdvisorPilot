/**
 * Shared service-role Supabase client for CRM API routes.
 *
 * The legacy advisor APIs (/api/client-database, /api/voice/*, etc.) each
 * inline `createClient` with the service-role key. The CRM routes (Phase 1+)
 * standardize on this single export so we have ONE place that:
 *
 *   - Reads SUPABASE_SERVICE_ROLE_KEY (highly privileged — server-only).
 *   - Validates the env vars at import time and throws a clear error if
 *     they're missing (better than silent NULLs propagating into queries).
 *
 * Service-role bypasses RLS by design — every CRM route MUST add the
 * appropriate `*_visible_to(...)` predicate to its WHERE clause via
 * lib/crm/visibility.ts. RLS is the safety net for direct user access; the
 * API path enforces visibility itself.
 *
 * Spec: docs/crm/20-technical-specs.md §8.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * Returns the singleton service-role client. Lazy so we don't crash imports
 * during local dev when env vars aren't set yet (the route's own missing-env
 * check returns a 500 with a clear message instead).
 */
export function getCrmSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    {
      auth: {
        // Server-only client — disable persistence + URL refresh so we don't
        // leak any client-side state into Node.
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );
  return cached;
}

/** True when either env var is missing. Routes call this early to short-
 *  circuit with a 500 + helpful message instead of cryptic Supabase errors. */
export function missingCrmSupabaseEnv(): boolean {
  return (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

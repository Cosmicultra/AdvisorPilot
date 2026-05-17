/**
 * Lazy provisioning of a personal-org-of-one for advisors who sign up AFTER
 * the Phase 0 backfill has already run.
 *
 * Phase 0's `supabase/advisorpilot_org_backfill.sql` creates a personal org
 * for every advisor that exists at deploy time. For advisors who sign up
 * later, this helper creates their personal org on the first request that
 * needs it (idempotent INSERT … ON CONFLICT DO NOTHING).
 *
 * Phase 0 has no API routes that call this yet — it ships ready for Phase 1
 * to wire into `resolveAdvisorIdentity`. The expected call site is the entry
 * of every CRM API route, after authentication succeeds:
 *
 *   const advisor = await resolveAdvisorIdentity(req);
 *   if (!advisor) return new Response(null, { status: 401 });
 *   const orgId = await ensurePersonalOrg(advisor.email);
 *
 * Spec: docs/crm/50-organizations-and-sharing.md §3.6.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

// Service-role client — LAZILY initialized so module import doesn't crash
// when env vars are missing (the Supabase JS SDK now validates URL up-front,
// which used to silently no-op on empty strings). Same pattern as
// lib/crm/supabase-admin.ts. Personal-org provisioning bypasses RLS
// deliberately (the advisor doesn't have a session yet on a brand-new
// signup, and the org row is self-attributing via
// `created_by_email = lower(advisorEmail)`).
let _supabaseAdmin: SupabaseClient | null = null;
function getSupabaseAdmin(): SupabaseClient {
  if (_supabaseAdmin) return _supabaseAdmin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "ensurePersonalOrg: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.",
    );
  }
  _supabaseAdmin = createClient(url, key);
  return _supabaseAdmin;
}

/**
 * Ensure a personal-org-of-one exists for the given advisor email. Returns
 * the org id (newly created or pre-existing).
 *
 * - Idempotent: re-running for the same email is a no-op (the unique
 *   constraint on `slug` prevents duplicate org rows; the unique constraint
 *   on `(org_id, member_email)` prevents duplicate membership rows).
 * - Lowercases the email before everything (matches the
 *   `lower(owner_email)` convention used by RLS policies and SQL helpers).
 * - The slug `personal-<md5(email)>` is deterministic so concurrent calls
 *   converge on the same org row instead of racing.
 *
 * @returns The personal org id for the given advisor email.
 * @throws If neither INSERT can be confirmed (network failure, etc.).
 */
export async function ensurePersonalOrg(advisorEmail: string): Promise<string> {
  const email = advisorEmail.trim().toLowerCase();
  if (!email) {
    throw new Error("ensurePersonalOrg: advisorEmail is empty");
  }

  const supabaseAdmin = getSupabaseAdmin();
  const slug = `personal-${md5(email)}`;
  const localPart = email.split("@")[0] ?? email;
  const name = `${localPart}'s organization`;

  // INSERT the org row; ignore conflict on the unique slug constraint.
  // `select` after upsert returns the row whether or not it was newly
  // inserted, so a single round-trip handles both cases.
  const { data: orgRow, error: orgError } = await supabaseAdmin
    .from("advisorpilot_organizations")
    .upsert(
      { name, slug, created_by_email: email },
      { onConflict: "slug", ignoreDuplicates: true }
    )
    .select("id")
    .maybeSingle();

  const orgId: string = await (async () => {
    if (orgRow?.id) return orgRow.id;

    // The `ignoreDuplicates: true` path returns null when the row already
    // existed (because the upsert RETURNING clause excludes the dup). Fetch
    // the existing row in that case.
    if (orgError) {
      throw new Error(`ensurePersonalOrg: upsert org failed — ${orgError.message}`);
    }
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from("advisorpilot_organizations")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (fetchError || !existing?.id) {
      throw new Error(
        `ensurePersonalOrg: could not resolve personal org for ${email}` +
          (fetchError ? ` — ${fetchError.message}` : "")
      );
    }
    return existing.id;
  })();

  // INSERT membership row; ignore conflict on the (org_id, member_email)
  // unique constraint. The `ignoreDuplicates: true` flag means a re-run is
  // a single round-trip with no error.
  const { error: memberError } = await supabaseAdmin
    .from("advisorpilot_organization_members")
    .upsert(
      {
        org_id: orgId,
        member_email: email,
        role: "owner",
        status: "active",
        accepted_at: new Date().toISOString(),
      },
      { onConflict: "org_id,member_email", ignoreDuplicates: true }
    );

  if (memberError) {
    throw new Error(
      `ensurePersonalOrg: upsert membership failed for ${email} — ${memberError.message}`
    );
  }

  return orgId;
}

function md5(input: string): string {
  return createHash("md5").update(input).digest("hex");
}

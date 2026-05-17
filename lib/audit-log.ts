import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Lazy-init — see lib/crm/supabase-admin.ts for the same pattern. Module
// import must not crash when env vars are missing (Supabase JS validates
// URL at construction time now).
let _supabaseAdmin: SupabaseClient | null = null;
function getSupabaseAdmin(): SupabaseClient | null {
  if (_supabaseAdmin) return _supabaseAdmin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  _supabaseAdmin = createClient(url, key);
  return _supabaseAdmin;
}

export async function writeAuditEvent(input: {
  ownerEmail: string;
  ownerUserId?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const supabaseAdmin = getSupabaseAdmin();
  if (!supabaseAdmin) return;
  try {
    await supabaseAdmin.from("advisorpilot_audit_events").insert({
      owner_email: input.ownerEmail,
      owner_user_id: input.ownerUserId || null,
      actor_email: input.actorEmail || input.ownerEmail,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId || null,
      metadata: input.metadata || {},
    });
  } catch (err) {
    console.error("AUDIT LOG ERROR:", err);
  }
}

import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

export async function writeAuditEvent(input: {
  ownerEmail: string;
  ownerUserId?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
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

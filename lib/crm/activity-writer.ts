/**
 * Helper for writing rows into advisorpilot_activity_log.
 *
 * Used by Phase 2's task/note mutations and by the POST /api/activity endpoint.
 * Best-effort — logs and swallows errors so the underlying mutation (note
 * insert, task complete) still succeeds even if the activity-log row fails to
 * write. The audit trail is a UX nicety, not a correctness invariant.
 *
 * Spec: docs/crm/20-technical-specs.md §2.1, §2.2 (side effects).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActivityType } from "./types";

export interface WriteActivityInput {
  ownerEmail: string;
  ownerUserId?: string | null;
  clientId?: string | null;
  type: ActivityType;
  title: string;
  body?: string | null;
  actorEmail?: string | null;
  metadata?: Record<string, unknown>;
}

export async function writeActivityLog(
  supabase: SupabaseClient,
  input: WriteActivityInput
): Promise<void> {
  try {
    const { error } = await supabase
      .from("advisorpilot_activity_log")
      .insert({
        owner_email: input.ownerEmail,
        owner_user_id: input.ownerUserId ?? null,
        client_id: input.clientId ?? null,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        actor_email: input.actorEmail ?? input.ownerEmail,
        metadata: input.metadata ?? {},
      });
    if (error) {
      console.error(
        `[crm:activity-writer] failed to write ${input.type} entry: ${error.message}`
      );
    }
  } catch (err) {
    console.error("[crm:activity-writer] threw", err);
  }
}

/**
 * Bumps advisorpilot_clients.last_contacted_at to NOW. Called by the notes
 * POST route — a logged note counts as a touchpoint with the client.
 *
 * Best-effort like writeActivityLog: errors are logged but don't bubble.
 */
export async function bumpLastContactedAt(
  supabase: SupabaseClient,
  clientId: string
): Promise<void> {
  try {
    const { error } = await supabase
      .from("advisorpilot_clients")
      .update({ last_contacted_at: new Date().toISOString() })
      .eq("id", clientId);
    if (error) {
      console.error(
        `[crm:activity-writer] failed to bump last_contacted_at for ${clientId}: ${error.message}`
      );
    }
  } catch (err) {
    console.error("[crm:activity-writer] bumpLastContactedAt threw", err);
  }
}

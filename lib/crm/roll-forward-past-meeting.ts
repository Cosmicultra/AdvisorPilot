/**
 * When next_meeting_at is in the past, move that touchpoint to last_contacted_at
 * and clear Next meeting until a new meeting is booked.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isNextMeetingPast,
  mergeLastContactedWithMeeting,
} from "./last-contacted-merge";
import { recordNextMeetingActivity } from "./next-meeting-activity";
import type { NextMeetingSource } from "./types";

export { isNextMeetingPast, mergeLastContactedWithMeeting } from "./last-contacted-merge";

export function buildPastMeetingRollForwardPatch(params: {
  nextMeetingAt: string;
  lastContactedAt: string | null | undefined;
}): {
  last_contacted_at: string;
  next_meeting_at: null;
  next_meeting_source: null;
  next_meeting_initiator: null;
  next_meeting_calendar_event_id: null;
} {
  return {
    last_contacted_at: mergeLastContactedWithMeeting(
      params.lastContactedAt,
      params.nextMeetingAt,
    ),
    next_meeting_at: null,
    next_meeting_source: null,
    next_meeting_initiator: null,
    next_meeting_calendar_event_id: null,
  };
}

type ClientMeetingRow = {
  id: string;
  owner_email: string;
  next_meeting_at: string | null;
  last_contacted_at?: string | null;
  next_meeting_source?: string | null;
};

/**
 * If next_meeting_at is in the past, roll it into last_contacted_at and clear Next meeting.
 * Returns true when a row was updated.
 */
export async function rollForwardPastNextMeetingIfNeeded(
  supabase: SupabaseClient,
  row: ClientMeetingRow,
  options?: { ownerUserId?: string | null; nowMs?: number },
): Promise<boolean> {
  const nextAt = row.next_meeting_at ? String(row.next_meeting_at) : null;
  if (!nextAt || !isNextMeetingPast(nextAt, options?.nowMs)) {
    return false;
  }

  const patch = buildPastMeetingRollForwardPatch({
    nextMeetingAt: nextAt,
    lastContactedAt: row.last_contacted_at,
  });

  const { error } = await supabase
    .from("advisorpilot_clients")
    .update(patch)
    .eq("id", row.id);

  if (error) {
    console.error(
      `[crm:roll-forward] failed for client ${row.id}: ${error.message}`,
    );
    return false;
  }

  const source = (row.next_meeting_source as NextMeetingSource | null) ?? "calendar";

  await recordNextMeetingActivity(supabase, {
    ownerEmail: String(row.owner_email),
    ownerUserId: options?.ownerUserId ?? null,
    clientId: row.id,
    action: "completed",
    source: source === "manual" ? "manual" : "calendar",
    nextMeetingAt: null,
    previousMeetingAt: nextAt,
  });

  return true;
}

/** Roll forward every past next_meeting_at for an advisor (all sources). */
export async function rollForwardPastMeetingsForOwner(
  supabase: SupabaseClient,
  ownerEmail: string,
): Promise<number> {
  const normalized = String(ownerEmail || "").trim().toLowerCase();
  if (!normalized) return 0;

  const nowIso = new Date().toISOString();
  const { data: rows, error } = await supabase
    .from("advisorpilot_clients")
    .select(
      "id, owner_email, next_meeting_at, last_contacted_at, next_meeting_source",
    )
    .eq("owner_email", normalized)
    .not("next_meeting_at", "is", null)
    .lt("next_meeting_at", nowIso);

  if (error) {
    console.error(`[crm:roll-forward] list failed: ${error.message}`);
    return 0;
  }

  let count = 0;
  for (const row of (rows ?? []) as ClientMeetingRow[]) {
    const updated = await rollForwardPastNextMeetingIfNeeded(supabase, row);
    if (updated) count += 1;
  }
  return count;
}

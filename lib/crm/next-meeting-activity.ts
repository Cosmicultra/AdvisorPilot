/**
 * Next-meeting provenance: activity log titles + calendar initiator inference.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { writeActivityLog } from "./activity-writer";
import type { NextMeetingInitiator, NextMeetingSource } from "./types";

export type NextMeetingActivityAction =
  | "booked"
  | "rescheduled"
  | "canceled"
  | "completed"
  | "manual_set"
  | "manual_clear";

export type CalendarEventForInitiator = {
  organizer?: { email?: string | null } | null;
  creator?: { email?: string | null } | null;
};

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

/** Infer who initiated a calendar event for the matched client. */
export function inferCalendarInitiator(
  event: CalendarEventForInitiator | null | undefined,
  advisorEmail: string,
  clientEmail: string,
): NextMeetingInitiator {
  const advisor = normalizeEmail(advisorEmail);
  const client = normalizeEmail(clientEmail);
  const organizer = normalizeEmail(event?.organizer?.email);
  const creator = normalizeEmail(event?.creator?.email);

  if (creator === client && organizer !== advisor) {
    return "client";
  }
  if (organizer === advisor || creator === advisor) {
    return "advisor";
  }
  if (creator === client) {
    return "client";
  }
  return "unknown";
}

function formatMeetingWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(ms));
}

function initiatorLabel(initiator: NextMeetingInitiator | null | undefined): string {
  if (initiator === "advisor") return "advisor initiated";
  if (initiator === "client") return "client initiated";
  return "initiator unknown";
}

/** Human-readable Timeline title for a next-meeting change. */
export function formatMeetingActivityTitle(params: {
  action: NextMeetingActivityAction;
  source: NextMeetingSource;
  initiator?: NextMeetingInitiator | null;
  nextMeetingAt?: string | null;
}): string {
  const when = formatMeetingWhen(params.nextMeetingAt);
  const whenSuffix = when ? ` — ${when}` : "";

  switch (params.action) {
    case "manual_set":
      return `Next meeting set manually${whenSuffix}`;
    case "manual_clear":
      return "Next meeting cleared manually";
    case "booked":
      if (params.source === "calendar") {
        return `Meeting booked from calendar (${initiatorLabel(params.initiator)})${whenSuffix}`;
      }
      return `Meeting booked${whenSuffix}`;
    case "rescheduled":
      return `Meeting rescheduled${whenSuffix}`;
    case "canceled":
      return "Meeting canceled";
    case "completed":
      return `Meeting completed — last contacted updated${whenSuffix}`;
    default:
      return "Meeting updated";
  }
}

export function formatMeetingActivityBody(params: {
  action: NextMeetingActivityAction;
  previousMeetingAt?: string | null;
}): string | null {
  if (params.action !== "rescheduled") return null;
  const prev = formatMeetingWhen(params.previousMeetingAt);
  if (!prev) return null;
  return `Previously scheduled for ${prev}.`;
}

export function formatNextMeetingBookingHint(
  source: NextMeetingSource | null | undefined,
  initiator: NextMeetingInitiator | null | undefined,
): string | null {
  if (!source) return null;
  if (source === "manual") {
    return "Entered in CRM";
  }
  if (initiator === "client") return "Google Calendar · Client booked";
  if (initiator === "advisor") return "Google Calendar · Advisor booked";
  return "Google Calendar";
}

export type RecordNextMeetingActivityInput = {
  ownerEmail: string;
  ownerUserId?: string | null;
  clientId: string;
  action: NextMeetingActivityAction;
  source: NextMeetingSource;
  initiator?: NextMeetingInitiator | null;
  nextMeetingAt?: string | null;
  previousMeetingAt?: string | null;
  calendarEventId?: string | null;
};

export async function recordNextMeetingActivity(
  supabase: SupabaseClient,
  input: RecordNextMeetingActivityInput,
): Promise<void> {
  const title = formatMeetingActivityTitle({
    action: input.action,
    source: input.source,
    initiator: input.initiator,
    nextMeetingAt: input.nextMeetingAt,
  });
  const body = formatMeetingActivityBody({
    action: input.action,
    previousMeetingAt: input.previousMeetingAt,
  });

  await writeActivityLog(supabase, {
    ownerEmail: input.ownerEmail,
    ownerUserId: input.ownerUserId ?? null,
    clientId: input.clientId,
    type: "meeting",
    title,
    body,
    actorEmail: input.ownerEmail,
    metadata: {
      action: input.action,
      source: input.source,
      initiator: input.initiator ?? null,
      nextMeetingAt: input.nextMeetingAt ?? null,
      previousMeetingAt: input.previousMeetingAt ?? null,
      calendarEventId: input.calendarEventId ?? null,
    },
  });
}

/** Classify a calendar-driven change for activity logging. */
export function classifyCalendarMeetingAction(params: {
  currentAt: string | null;
  currentEventId: string | null;
  desiredAt: string | null;
  desiredEventId: string | null;
}): NextMeetingActivityAction | null {
  const { currentAt, currentEventId, desiredAt, desiredEventId } = params;

  if (!desiredAt) {
    if (currentAt) return "canceled";
    return null;
  }

  if (!currentAt) {
    return "booked";
  }

  if (
    currentEventId &&
    desiredEventId &&
    currentEventId === desiredEventId &&
    currentAt !== desiredAt
  ) {
    return "rescheduled";
  }

  if (currentAt !== desiredAt || currentEventId !== desiredEventId) {
    return currentEventId === desiredEventId ? "rescheduled" : "booked";
  }

  return null;
}

export function calendarSyncMayUpdateClient(
  source: string | null | undefined,
): boolean {
  return source !== "manual";
}

/** Extend a CRM PATCH with manual next-meeting provenance columns. */
export function applyManualNextMeetingProvenance(
  patch: Record<string, unknown>,
  nextMeetingAt: string | null,
): void {
  patch.next_meeting_source = nextMeetingAt ? "manual" : null;
  patch.next_meeting_initiator = null;
  patch.next_meeting_calendar_event_id = null;
}

export function manualMeetingActivityAction(
  previousAt: string | null,
  nextAt: string | null,
): NextMeetingActivityAction | null {
  const prev = previousAt ? String(previousAt) : null;
  const next = nextAt ? String(nextAt) : null;
  if (prev === next) return null;
  if (!next) return "manual_clear";
  return "manual_set";
}

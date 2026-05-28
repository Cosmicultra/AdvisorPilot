import { google } from "googleapis";
import {
  calendarSyncMayUpdateClient,
  classifyCalendarMeetingAction,
  inferCalendarInitiator,
  recordNextMeetingActivity,
} from "@/lib/crm/next-meeting-activity";
import { rollForwardPastMeetingsForOwner } from "@/lib/crm/roll-forward-past-meeting";
import type { NextMeetingInitiator } from "@/lib/crm/types";
import { getGoogleOauthClient } from "@/lib/google/oauth";
import { getSupabaseServiceAdmin } from "@/lib/supabase-service-admin";

const EMAIL_REGEX =
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export type GoogleCalendarSyncResult = {
  ok: boolean;
  updatedClients: number;
  clearedClients: number;
  scannedEvents: number;
  message?: string;
};

export type NextMeetingCalendarMatch = {
  startIso: string;
  eventId: string;
  initiator: NextMeetingInitiator;
};

type ClientRow = {
  id: string;
  owner_email: string;
  email?: string | null;
  next_meeting_at?: string | null;
  next_meeting_source?: string | null;
  next_meeting_initiator?: string | null;
  next_meeting_calendar_event_id?: string | null;
  client?: unknown;
};

export type CalendarEvent = {
  id?: string | null;
  status?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  summary?: string | null;
  description?: string | null;
  organizer?: { email?: string | null } | null;
  creator?: { email?: string | null } | null;
  attendees?: Array<{ email?: string | null; responseStatus?: string | null }> | null;
};

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function extractClientEmail(row: ClientRow): string | null {
  const top = normalizeEmail(row.email);
  if (top) return top;
  const json = row.client && typeof row.client === "object" ? (row.client as Record<string, unknown>) : null;
  const fromJson = json ? normalizeEmail(json.advisorEmail) : "";
  return fromJson || null;
}

export function parseEventStartIso(event: CalendarEvent | null | undefined): string | null {
  const start = event?.start;
  if (!start) return null;
  const iso = typeof start.dateTime === "string" ? start.dateTime : null;
  if (iso) return iso;
  return null;
}

export function eventEmails(event: CalendarEvent | null | undefined): string[] {
  const out = new Set<string>();
  const attendees = Array.isArray(event?.attendees) ? event.attendees : [];
  for (const a of attendees) {
    const email = normalizeEmail(a?.email);
    if (email) out.add(email);
  }
  const hay = `${event?.summary ?? ""}\n${event?.description ?? ""}`;
  const matches = hay.match(EMAIL_REGEX) ?? [];
  for (const m of matches) {
    const email = normalizeEmail(m);
    if (email) out.add(email);
  }
  return [...out];
}

export function isEmailDeclinedOnEvent(
  event: CalendarEvent | null | undefined,
  email: string,
): boolean {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const attendees = Array.isArray(event?.attendees) ? event.attendees : [];
  for (const a of attendees) {
    if (normalizeEmail(a?.email) !== normalized) continue;
    return String(a?.responseStatus || "").toLowerCase() === "declined";
  }
  return false;
}

/** Earliest future calendar meeting per client email. */
export function buildNextMeetingByEmail(
  events: CalendarEvent[],
  advisorEmail: string,
): Map<string, NextMeetingCalendarMatch> {
  const nextByEmail = new Map<string, NextMeetingCalendarMatch>();

  for (const e of events) {
    if (e?.status === "cancelled") continue;
    const startIso = parseEventStartIso(e);
    if (!startIso) continue;
    const eventId = String(e?.id || "").trim();
    if (!eventId) continue;
    const emails = eventEmails(e);
    if (emails.length === 0) continue;
    for (const email of emails) {
      if (isEmailDeclinedOnEvent(e, email)) continue;
      const initiator = inferCalendarInitiator(e, advisorEmail, email);
      const prior = nextByEmail.get(email);
      if (!prior || Date.parse(startIso) < Date.parse(prior.startIso)) {
        nextByEmail.set(email, { startIso, eventId, initiator });
      }
    }
  }

  return nextByEmail;
}

export function clientShouldSync(row: ClientRow): boolean {
  return Boolean(extractClientEmail(row) || row.next_meeting_at);
}

export function resolveClientNextMeetingUpdate(params: {
  clientEmail: string | null;
  nextByEmail: Map<string, NextMeetingCalendarMatch>;
  current: string | null;
  currentEventId?: string | null;
  nowMs?: number;
}): {
  shouldUpdate: boolean;
  nextValue: string | null;
  match: NextMeetingCalendarMatch | null;
} {
  const nowMs = params.nowMs ?? Date.now();
  const match = params.clientEmail ? params.nextByEmail.get(params.clientEmail) ?? null : null;
  const desired = match?.startIso ?? null;
  const current = params.current;
  const currentEventId = params.currentEventId ? String(params.currentEventId) : null;
  const currentIsPast = current ? Date.parse(current) < nowMs : false;
  const shouldClear = Boolean(current && (currentIsPast || !desired));
  const shouldSet = Boolean(
    desired &&
      (desired !== current || (match?.eventId && match.eventId !== currentEventId)),
  );

  if (!shouldSet && !shouldClear) {
    return { shouldUpdate: false, nextValue: current, match };
  }

  return { shouldUpdate: true, nextValue: desired ?? null, match };
}

export async function syncGoogleCalendarNextMeetings(params: {
  advisorEmail: string;
  calendarId?: string;
}): Promise<GoogleCalendarSyncResult> {
  const advisorEmail = normalizeEmail(params.advisorEmail);
  if (!advisorEmail) {
    return { ok: false, updatedClients: 0, clearedClients: 0, scannedEvents: 0, message: "Missing advisorEmail." };
  }
  const calendarId = params.calendarId || "primary";

  const supabaseAdmin = getSupabaseServiceAdmin();
  if (!supabaseAdmin) {
    return { ok: false, updatedClients: 0, clearedClients: 0, scannedEvents: 0, message: "Missing Supabase service env." };
  }

  const oauth2Client = await getGoogleOauthClient(advisorEmail);
  const calendar = google.calendar({ version: "v3", auth: oauth2Client });

  const now = new Date();
  const timeMin = now.toISOString();

  const eventsRes = await calendar.events.list({
    calendarId,
    timeMin,
    maxResults: 2500,
    singleEvents: true,
    orderBy: "startTime",
    showDeleted: false,
  });

  const events = Array.isArray(eventsRes.data.items) ? eventsRes.data.items : [];
  const nextByEmail = buildNextMeetingByEmail(events as CalendarEvent[], advisorEmail);

  const { data: rows, error } = await supabaseAdmin
    .from("advisorpilot_clients")
    .select(
      "id, owner_email, email, next_meeting_at, next_meeting_source, next_meeting_initiator, next_meeting_calendar_event_id, client",
    )
    .eq("owner_email", advisorEmail);

  if (error) {
    return { ok: false, updatedClients: 0, clearedClients: 0, scannedEvents: events.length, message: error.message };
  }

  const clients = (rows ?? []) as ClientRow[];

  await rollForwardPastMeetingsForOwner(supabaseAdmin, advisorEmail);

  let updatedClients = 0;
  let clearedClients = 0;

  for (const c of clients) {
    if (!clientShouldSync(c)) continue;
    if (!calendarSyncMayUpdateClient(c.next_meeting_source)) continue;

    const email = extractClientEmail(c);
    const current = c.next_meeting_at ? String(c.next_meeting_at) : null;
    const currentEventId = c.next_meeting_calendar_event_id
      ? String(c.next_meeting_calendar_event_id)
      : null;

    const { shouldUpdate, nextValue, match } = resolveClientNextMeetingUpdate({
      clientEmail: email,
      nextByEmail,
      current,
      currentEventId,
    });

    if (!shouldUpdate) continue;

    const desiredEventId = match?.eventId ?? null;
    const activityAction = classifyCalendarMeetingAction({
      currentAt: current,
      currentEventId,
      desiredAt: nextValue,
      desiredEventId,
    });

    const updatePayload: Record<string, unknown> = {
      next_meeting_at: nextValue,
      next_meeting_source: nextValue ? "calendar" : null,
      next_meeting_initiator: nextValue ? (match?.initiator ?? "unknown") : null,
      next_meeting_calendar_event_id: nextValue ? desiredEventId : null,
    };

    const { error: updateErr } = await supabaseAdmin
      .from("advisorpilot_clients")
      .update(updatePayload)
      .eq("id", c.id)
      .eq("owner_email", advisorEmail);

    if (updateErr) {
      continue;
    }

    if (activityAction) {
      await recordNextMeetingActivity(supabaseAdmin, {
        ownerEmail: advisorEmail,
        clientId: c.id,
        action: activityAction,
        source: "calendar",
        initiator: match?.initiator ?? null,
        nextMeetingAt: nextValue,
        previousMeetingAt: current,
        calendarEventId: desiredEventId,
      });
    }

    if (nextValue) updatedClients += 1;
    else clearedClients += 1;
  }

  return {
    ok: true,
    updatedClients,
    clearedClients,
    scannedEvents: events.length,
  };
}

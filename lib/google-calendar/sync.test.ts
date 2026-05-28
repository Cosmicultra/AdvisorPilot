import { describe, expect, it } from "vitest";
import {
  buildNextMeetingByEmail,
  clientShouldSync,
  eventEmails,
  isEmailDeclinedOnEvent,
  resolveClientNextMeetingUpdate,
} from "./sync";
import {
  calendarSyncMayUpdateClient,
  classifyCalendarMeetingAction,
  inferCalendarInitiator,
} from "@/lib/crm/next-meeting-activity";

const ADVISOR = "advisor@example.com";
const CLIENT = "client@example.com";
const LATER = "2026-08-15T14:00:00.000Z";
const EARLIER = "2026-06-01T15:00:00.000Z";
const RESCHEDULED = "2026-07-10T10:00:00.000Z";
const NOW_MS = Date.parse("2026-05-27T12:00:00.000Z");

function event(
  overrides: Partial<{
    id: string;
    status: string;
    start: string;
    attendees: Array<{ email: string; responseStatus?: string }>;
    summary: string;
    description: string;
    organizer: { email: string };
    creator: { email: string };
  }> = {},
) {
  return {
    id: overrides.id ?? "evt-1",
    status: overrides.status ?? "confirmed",
    start: { dateTime: overrides.start ?? EARLIER },
    attendees: overrides.attendees,
    summary: overrides.summary,
    description: overrides.description,
    organizer: overrides.organizer,
    creator: overrides.creator,
  };
}

describe("buildNextMeetingByEmail", () => {
  it("sets earliest future start for a client email from one event", () => {
    const map = buildNextMeetingByEmail(
      [
        event({
          id: "e1",
          attendees: [{ email: CLIENT, responseStatus: "accepted" }],
          start: EARLIER,
          organizer: { email: ADVISOR },
        }),
      ],
      ADVISOR,
    );
    expect(map.get(CLIENT)?.startIso).toBe(EARLIER);
    expect(map.get(CLIENT)?.eventId).toBe("e1");
  });

  it("ignores cancelled events (clear path on sync)", () => {
    const map = buildNextMeetingByEmail(
      [event({ status: "cancelled", attendees: [{ email: CLIENT }], start: EARLIER })],
      ADVISOR,
    );
    expect(map.has(CLIENT)).toBe(false);
  });

  it("uses the new start when an event is rescheduled", () => {
    const map = buildNextMeetingByEmail(
      [event({ attendees: [{ email: CLIENT }], start: RESCHEDULED })],
      ADVISOR,
    );
    expect(map.get(CLIENT)?.startIso).toBe(RESCHEDULED);
  });

  it("picks the earliest when two future events exist", () => {
    const map = buildNextMeetingByEmail(
      [
        event({ id: "late", attendees: [{ email: CLIENT }], start: LATER }),
        event({ id: "early", attendees: [{ email: CLIENT }], start: EARLIER }),
      ],
      ADVISOR,
    );
    expect(map.get(CLIENT)?.startIso).toBe(EARLIER);
    expect(map.get(CLIENT)?.eventId).toBe("early");
  });

  it("skips events where the client attendee declined", () => {
    const map = buildNextMeetingByEmail(
      [
        event({
          attendees: [{ email: CLIENT, responseStatus: "declined" }],
          start: EARLIER,
        }),
      ],
      ADVISOR,
    );
    expect(map.has(CLIENT)).toBe(false);
  });

  it("infers advisor initiator when organizer is advisor", () => {
    const map = buildNextMeetingByEmail(
      [
        event({
          attendees: [{ email: CLIENT }],
          organizer: { email: ADVISOR },
          creator: { email: ADVISOR },
        }),
      ],
      ADVISOR,
    );
    expect(map.get(CLIENT)?.initiator).toBe("advisor");
  });

  it("infers client initiator when creator is client", () => {
    const map = buildNextMeetingByEmail(
      [
        event({
          attendees: [{ email: CLIENT }],
          organizer: { email: "calendly@calendly.com" },
          creator: { email: CLIENT },
        }),
      ],
      ADVISOR,
    );
    expect(map.get(CLIENT)?.initiator).toBe("client");
  });
});

describe("inferCalendarInitiator", () => {
  it("returns client when creator is client and organizer is not advisor", () => {
    expect(
      inferCalendarInitiator(
        { creator: { email: CLIENT }, organizer: { email: "x@y.com" } },
        ADVISOR,
        CLIENT,
      ),
    ).toBe("client");
  });
});

describe("calendarSyncMayUpdateClient", () => {
  it("skips manual-sourced rows", () => {
    expect(calendarSyncMayUpdateClient("manual")).toBe(false);
    expect(calendarSyncMayUpdateClient("calendar")).toBe(true);
    expect(calendarSyncMayUpdateClient(null)).toBe(true);
  });
});

describe("classifyCalendarMeetingAction", () => {
  it("classifies cancel, book, and reschedule", () => {
    expect(
      classifyCalendarMeetingAction({
        currentAt: EARLIER,
        currentEventId: "e1",
        desiredAt: null,
        desiredEventId: null,
      }),
    ).toBe("canceled");

    expect(
      classifyCalendarMeetingAction({
        currentAt: null,
        currentEventId: null,
        desiredAt: EARLIER,
        desiredEventId: "e1",
      }),
    ).toBe("booked");

    expect(
      classifyCalendarMeetingAction({
        currentAt: EARLIER,
        currentEventId: "e1",
        desiredAt: RESCHEDULED,
        desiredEventId: "e1",
      }),
    ).toBe("rescheduled");
  });
});

describe("resolveClientNextMeetingUpdate", () => {
  it("clears when no future match (cancelled / no events)", () => {
    const { shouldUpdate, nextValue } = resolveClientNextMeetingUpdate({
      clientEmail: CLIENT,
      nextByEmail: new Map(),
      current: EARLIER,
      nowMs: NOW_MS,
    });
    expect(shouldUpdate).toBe(true);
    expect(nextValue).toBeNull();
  });

  it("updates when rescheduled to a new start", () => {
    const { shouldUpdate, nextValue } = resolveClientNextMeetingUpdate({
      clientEmail: CLIENT,
      nextByEmail: new Map([
        [CLIENT, { startIso: RESCHEDULED, eventId: "e1", initiator: "advisor" }],
      ]),
      current: EARLIER,
      currentEventId: "e1",
      nowMs: NOW_MS,
    });
    expect(shouldUpdate).toBe(true);
    expect(nextValue).toBe(RESCHEDULED);
  });

  it("does not update when already correct", () => {
    const { shouldUpdate } = resolveClientNextMeetingUpdate({
      clientEmail: CLIENT,
      nextByEmail: new Map([
        [CLIENT, { startIso: EARLIER, eventId: "e1", initiator: "advisor" }],
      ]),
      current: EARLIER,
      currentEventId: "e1",
      nowMs: NOW_MS,
    });
    expect(shouldUpdate).toBe(false);
  });
});

describe("clientShouldSync", () => {
  it("includes rows with CRM email or existing next_meeting_at", () => {
    expect(clientShouldSync({ id: "1", owner_email: "a@x.com", email: CLIENT })).toBe(true);
    expect(
      clientShouldSync({
        id: "2",
        owner_email: "a@x.com",
        next_meeting_at: EARLIER,
      }),
    ).toBe(true);
    expect(clientShouldSync({ id: "3", owner_email: "a@x.com" })).toBe(false);
  });
});

describe("eventEmails", () => {
  it("collects attendee and description emails", () => {
    const emails = eventEmails(
      event({
        attendees: [{ email: "a@x.com" }],
        description: "Reach b@x.com",
      }),
    );
    expect(emails).toContain("a@x.com");
    expect(emails).toContain("b@x.com");
  });
});

describe("isEmailDeclinedOnEvent", () => {
  it("returns true only for declined attendees", () => {
    const e = event({ attendees: [{ email: CLIENT, responseStatus: "declined" }] });
    expect(isEmailDeclinedOnEvent(e, CLIENT)).toBe(true);
    expect(isEmailDeclinedOnEvent(e, "other@example.com")).toBe(false);
  });
});

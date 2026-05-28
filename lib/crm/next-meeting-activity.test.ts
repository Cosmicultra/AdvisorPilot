import { describe, expect, it } from "vitest";
import {
  formatMeetingActivityTitle,
  formatNextMeetingBookingHint,
  inferCalendarInitiator,
  manualMeetingActivityAction,
} from "./next-meeting-activity";

const AT = "2026-06-01T15:00:00.000Z";

describe("formatMeetingActivityTitle", () => {
  it("formats manual set and clear", () => {
    expect(
      formatMeetingActivityTitle({
        action: "manual_set",
        source: "manual",
        nextMeetingAt: AT,
      }),
    ).toContain("manually");
    expect(
      formatMeetingActivityTitle({
        action: "manual_clear",
        source: "manual",
      }),
    ).toBe("Next meeting cleared manually");
  });

  it("formats calendar booked with initiator", () => {
    const title = formatMeetingActivityTitle({
      action: "booked",
      source: "calendar",
      initiator: "client",
      nextMeetingAt: AT,
    });
    expect(title).toContain("calendar");
    expect(title).toContain("client initiated");
  });

  it("formats completed meeting roll-forward", () => {
    const title = formatMeetingActivityTitle({
      action: "completed",
      source: "calendar",
      nextMeetingAt: null,
    });
    expect(title).toContain("completed");
    expect(title).toContain("last contacted");
  });

  it("formats rescheduled and canceled", () => {
    expect(
      formatMeetingActivityTitle({
        action: "rescheduled",
        source: "calendar",
        nextMeetingAt: AT,
      }),
    ).toContain("rescheduled");
    expect(
      formatMeetingActivityTitle({
        action: "canceled",
        source: "calendar",
      }),
    ).toBe("Meeting canceled");
  });
});

describe("formatNextMeetingBookingHint", () => {
  it("returns hints for manual and calendar sources", () => {
    expect(formatNextMeetingBookingHint("manual", null)).toBe("Entered in CRM");
    expect(formatNextMeetingBookingHint("calendar", "client")).toBe(
      "Google Calendar · Client booked",
    );
    expect(formatNextMeetingBookingHint("calendar", "advisor")).toBe(
      "Google Calendar · Advisor booked",
    );
    expect(formatNextMeetingBookingHint("calendar", "unknown")).toBe("Google Calendar");
  });
});

describe("manualMeetingActivityAction", () => {
  it("detects set vs clear vs no-op", () => {
    expect(manualMeetingActivityAction(null, AT)).toBe("manual_set");
    expect(manualMeetingActivityAction(AT, null)).toBe("manual_clear");
    expect(manualMeetingActivityAction(AT, AT)).toBeNull();
  });
});

describe("inferCalendarInitiator", () => {
  it("labels advisor when organizer is advisor", () => {
    expect(
      inferCalendarInitiator(
        { organizer: { email: "a@firm.com" }, creator: { email: "a@firm.com" } },
        "a@firm.com",
        "client@x.com",
      ),
    ).toBe("advisor");
  });
});

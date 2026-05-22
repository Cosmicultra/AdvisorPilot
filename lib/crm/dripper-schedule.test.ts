import { describe, expect, it } from "vitest";
import {
  addDays,
  computeInitialNextRunAt,
  computeNextRunAfterSuccess,
  isEnrollmentDue,
  shouldDisableAfterRun,
} from "./dripper-schedule";

describe("dripper-schedule", () => {
  it("computeInitialNextRunAt uses starts_at when in the future", () => {
    const now = new Date("2026-05-01T12:00:00Z");
    const start = "2026-06-01T00:00:00Z";
    const next = computeInitialNextRunAt(start, now);
    expect(next.toISOString()).toBe(new Date(start).toISOString());
  });

  it("computeInitialNextRunAt uses now when starts_at is in the past", () => {
    const now = new Date("2026-05-01T12:00:00Z");
    const start = "2026-04-01T00:00:00Z";
    const next = computeInitialNextRunAt(start, now);
    expect(next.getTime()).toBe(now.getTime());
  });

  it("computeNextRunAfterSuccess adds frequency days", () => {
    const from = new Date("2026-05-01T12:00:00Z");
    const next = computeNextRunAfterSuccess(30, from);
    expect(next.toISOString()).toBe(addDays(from, 30).toISOString());
  });

  it("shouldDisableAfterRun when next run exceeds ends_at", () => {
    const nextRunAt = new Date("2026-07-01T00:00:00Z");
    expect(
      shouldDisableAfterRun({
        endsAt: "2026-06-15T00:00:00Z",
        nextRunAt,
      })
    ).toBe(true);
    expect(
      shouldDisableAfterRun({
        endsAt: null,
        nextRunAt,
      })
    ).toBe(false);
  });

  it("isEnrollmentDue respects enabled, starts, ends, next_run_at", () => {
    const now = new Date("2026-05-15T12:00:00Z");
    expect(
      isEnrollmentDue(
        {
          enabled: true,
          starts_at: "2026-05-01T00:00:00Z",
          ends_at: null,
          next_run_at: "2026-05-14T00:00:00Z",
        },
        now
      )
    ).toBe(true);
    expect(
      isEnrollmentDue(
        {
          enabled: false,
          starts_at: "2026-05-01T00:00:00Z",
          ends_at: null,
          next_run_at: "2026-05-14T00:00:00Z",
        },
        now
      )
    ).toBe(false);
    expect(
      isEnrollmentDue(
        {
          enabled: true,
          starts_at: "2026-06-01T00:00:00Z",
          ends_at: null,
          next_run_at: "2026-05-14T00:00:00Z",
        },
        now
      )
    ).toBe(false);
  });
});

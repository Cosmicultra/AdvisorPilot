import { describe, expect, it } from "vitest";
import {
  dueAnnuityEventsForToday,
  isReminderDue,
  listAnnuityReminderEvents,
  maturityReminderDate,
  nextReallocationAnniversary,
  parseContractDate,
  reallocationReminderDate,
  toDateKey,
} from "./annuity-reminder-dates";

describe("annuity-reminder-dates", () => {
  it("parseContractDate handles ISO and slash formats", () => {
    expect(toDateKey(parseContractDate("2024-01-01")!)).toBe("2024-01-01");
    expect(toDateKey(parseContractDate("01/01/2024")!)).toBe("2024-01-01");
  });

  it("first reallocation anniversary is one year after issue", () => {
    const issue = parseContractDate("01/01/2024")!;
    const after = parseContractDate("2024-06-01")!;
    const next = nextReallocationAnniversary(issue, after, null);
    expect(toDateKey(next!)).toBe("2025-01-01");
  });

  it("remind date is 30 days before 2025-01-01 anniversary", () => {
    const issue = parseContractDate("01/01/2024")!;
    const anniversary = nextReallocationAnniversary(issue, parseContractDate("2024-06-01")!, null)!;
    const remind = reallocationReminderDate(anniversary);
    expect(toDateKey(remind)).toBe("2024-12-02");
  });

  it("dueAnnuityEventsForToday fires on remind day for reallocation", () => {
    const today = parseContractDate("2024-12-02")!;
    const events = dueAnnuityEventsForToday("01/01/2024", undefined, today, {
      includeReallocation: true,
      includeMaturity: false,
    });
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("reallocation");
  });

  it("maturity remind is 30 days before maturity", () => {
    const maturity = parseContractDate("2029-01-01")!;
    const remind = maturityReminderDate(maturity);
    expect(toDateKey(remind)).toBe("2028-12-02");
    expect(isReminderDue(remind, parseContractDate("2028-12-02")!)).toBe(true);
  });

  it("listAnnuityReminderEvents returns multiple reallocation windows before maturity", () => {
    const events = listAnnuityReminderEvents("01/01/2024", "2027-01-01", {
      includeReallocation: true,
      includeMaturity: false,
    });
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.every((e) => e.kind === "reallocation")).toBe(true);
    expect(events[0].remindDate.getTime()).toBeLessThan(events[1].remindDate.getTime());
  });

  it("stops reallocation anniversaries at maturity", () => {
    const issue = parseContractDate("01/01/2024")!;
    const maturity = parseContractDate("2027-01-01")!;
    const after = parseContractDate("2026-06-01")!;
    expect(nextReallocationAnniversary(issue, after, maturity)).toBeNull();
  });
});

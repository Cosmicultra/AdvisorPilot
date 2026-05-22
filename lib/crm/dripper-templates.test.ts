import { describe, expect, it } from "vitest";
import { DRIPPER_TEMPLATES, getDripperTemplate } from "./dripper-templates";

describe("dripper-templates", () => {
  it("catalog has 5 templates including annuity event drippers", () => {
    expect(DRIPPER_TEMPLATES).toHaveLength(5);
    expect(DRIPPER_TEMPLATES.map((t) => t.id).sort()).toEqual([
      "annuity-maturity-reminder",
      "annuity-reallocation-reminder",
      "pre-meeting-talking-points",
      "quarterly-review-brief",
      "stale-contact-nudge",
    ]);
  });

  it("annuity templates use annuity_event schedule mode", () => {
    const reallocation = getDripperTemplate("annuity-reallocation-reminder");
    const maturity = getDripperTemplate("annuity-maturity-reminder");
    expect(reallocation?.scheduleMode).toBe("annuity_event");
    expect(reallocation?.reminderKind).toBe("reallocation");
    expect(maturity?.scheduleMode).toBe("annuity_event");
    expect(maturity?.reminderKind).toBe("maturity");
  });

  it("Closing Meeting Book has 30-day end date metadata", () => {
    const closing = getDripperTemplate("pre-meeting-talking-points");
    expect(closing?.title).toBe("Closing Meeting Book");
    expect(closing?.defaultEndDateOffsetDays).toBe(30);
    expect(closing?.endDateHelperText).toContain("30 days");
    expect(closing?.frequencyExamples.map((f) => f.days)).toEqual([7, 14]);
  });

  it("Client Review Brief has quarterly, 6-month, and annual frequencies", () => {
    const review = getDripperTemplate("quarterly-review-brief");
    expect(review?.title).toBe("Client Review Brief");
    expect(review?.frequencyExamples.map((f) => f.days)).toEqual([90, 180, 365]);
  });

  it("Closing Meeting Book and Prospect/Lead prompts require variation and no dollar amounts", () => {
    const closing = getDripperTemplate("pre-meeting-talking-points");
    const prospect = getDripperTemplate("stale-contact-nudge");
    expect(closing?.prompt).toContain("recentDripAngles");
    expect(closing?.prompt).toContain("no dollar amounts");
    expect(prospect?.prompt).toContain("recentDripAngles");
    expect(prospect?.prompt).toContain("toolsReviewed");
  });
});

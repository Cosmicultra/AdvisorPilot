import { describe, expect, it } from "vitest";
import { formatClientEmailBody } from "./dripper-email-greeting";
import {
  CLIENT_EMAIL_HINTS,
  buildClientEmailSystemPrompt,
  defaultDripperEmailSubject,
} from "./dripper-client-email";

describe("dripper-client-email", () => {
  it("defaultDripperEmailSubject uses Client Review Brief wording", () => {
    expect(defaultDripperEmailSubject("quarterly-review-brief", "Jane")).toBe(
      "Ahead of our review — Jane"
    );
    expect(defaultDripperEmailSubject("unknown-template", "Bob")).toContain("Bob");
  });

  it("formatClientEmailBody adds Hi {name}, and blank line", () => {
    const body = formatClientEmailBody("Jane", "Thanks for your time yesterday.");
    expect(body).toBe("Hi Jane,\n\nThanks for your time yesterday.");
  });

  it("formatClientEmailBody strips duplicate greeting from LLM output", () => {
    const body = formatClientEmailBody(
      "Jane",
      "Hi Jane,\n\nThanks for your time yesterday."
    );
    expect(body).toBe("Hi Jane,\n\nThanks for your time yesterday.");
  });

  it("formatClientEmailBody uses 'there' when first name empty", () => {
    const body = formatClientEmailBody("", "Quick update for you.");
    expect(body.startsWith("Hi there,\n\n")).toBe(true);
  });

  it("CLIENT_EMAIL_HINTS covers Closing Meeting Book and Prospect/Lead", () => {
    expect(CLIENT_EMAIL_HINTS["pre-meeting-talking-points"]).toContain("scheduling");
    expect(CLIENT_EMAIL_HINTS["stale-contact-nudge"]).toContain("prospect");
  });

  it("buildClientEmailSystemPrompt adds template hint for variation templates", () => {
    const sys = buildClientEmailSystemPrompt("pre-meeting-talking-points");
    expect(sys).toContain("No numbers");
    expect(sys).toContain("scheduling");
  });
});

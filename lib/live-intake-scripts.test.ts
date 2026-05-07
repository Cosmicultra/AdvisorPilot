import { describe, expect, it } from "vitest";
import {
  buildStepConfirmationScript,
  classifyConfirmationReply,
  personalizeLiveIntakeScript,
} from "./live-intake-scripts";
import { normalizeIntakeClient } from "./intake-config";

describe("live-intake-scripts", () => {
  it("personalizes client and advisor placeholders", () => {
    const client = normalizeIntakeClient({ firstName: "Jane", lastName: "Smith" });
    expect(personalizeLiveIntakeScript("Hi {{FIRST_NAME}}, {{ADVISOR_FIRST}} here.", client, "Chris Advisor"))
      .toBe("Hi Jane, Chris here.");
  });

  it("builds a readable identity confirmation", () => {
    const client = normalizeIntakeClient({
      firstName: "Jane",
      lastName: "Smith",
      advisorEmail: "jane@example.com",
    });
    expect(buildStepConfirmationScript(0, client)).toContain("Jane Smith");
    expect(buildStepConfirmationScript(0, client)).toContain("jane@example.com");
  });

  it("classifies clear yes and no replies", () => {
    expect(classifyConfirmationReply("yes, that's right")).toBe("yes");
    expect(classifyConfirmationReply("no actually change that")).toBe("no");
    expect(classifyConfirmationReply("")).toBe("no");
  });
});

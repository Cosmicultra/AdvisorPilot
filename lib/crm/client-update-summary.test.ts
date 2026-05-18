import { describe, expect, it } from "vitest";
import {
  clientSaveChangedSections,
  clientUpdatedActivityTitle,
  crmPatchChangedLabels,
} from "./client-update-summary";

describe("clientSaveChangedSections", () => {
  const base = {
    client: { firstName: "Jane" },
    holdings: [{ value: 100 }],
    meeting_notes: "",
    demo_mode: false,
    analysis: null,
    total_value: 100,
    status: "Analyzed",
    last_contacted_at: null,
    roth_worksheet: null,
  };

  it("detects holdings and meeting notes changes", () => {
    const after = {
      ...base,
      holdings: [{ value: 200 }],
      meeting_notes: "Follow up next week",
    };
    expect(clientSaveChangedSections(base, after)).toEqual(["Holdings", "Meeting notes"]);
  });

  it("returns empty when nothing changed", () => {
    expect(clientSaveChangedSections(base, { ...base })).toEqual([]);
  });
});

describe("clientUpdatedActivityTitle", () => {
  it("uses summary from metadata", () => {
    expect(
      clientUpdatedActivityTitle({ summary: "Holdings, Meeting notes", changedSections: ["Holdings"] })
    ).toBe("Client updated: Holdings, Meeting notes");
  });

  it("falls back to changedSections array", () => {
    expect(clientUpdatedActivityTitle({ changedSections: ["Portfolio analysis"] })).toBe(
      "Client updated: Portfolio analysis"
    );
  });

  it("falls back to generic title", () => {
    expect(clientUpdatedActivityTitle({})).toBe("Client updated");
  });
});

describe("crmPatchChangedLabels", () => {
  it("maps known patch keys", () => {
    expect(crmPatchChangedLabels(["stage", "tags"])).toEqual(["Stage", "Tags"]);
  });
});

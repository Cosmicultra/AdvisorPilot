import { describe, expect, it } from "vitest";
import {
  buildPastMeetingRollForwardPatch,
  isNextMeetingPast,
  mergeLastContactedWithMeeting,
} from "./roll-forward-past-meeting";

const PAST = "2026-01-15T10:00:00.000Z";
const OLDER = "2025-12-01T10:00:00.000Z";
const NEWER = "2026-02-01T10:00:00.000Z";
const NOW_MS = Date.parse("2026-05-27T12:00:00.000Z");

describe("isNextMeetingPast", () => {
  it("detects past meeting times", () => {
    expect(isNextMeetingPast(PAST, NOW_MS)).toBe(true);
    expect(isNextMeetingPast("2026-12-01T10:00:00.000Z", NOW_MS)).toBe(false);
    expect(isNextMeetingPast(null, NOW_MS)).toBe(false);
  });
});

describe("mergeLastContactedWithMeeting", () => {
  it("uses meeting time when last contacted is empty", () => {
    expect(mergeLastContactedWithMeeting(null, PAST)).toBe(PAST);
  });

  it("keeps the later timestamp", () => {
    expect(mergeLastContactedWithMeeting(OLDER, PAST)).toBe(PAST);
    expect(mergeLastContactedWithMeeting(NEWER, PAST)).toBe(NEWER);
  });
});

describe("buildPastMeetingRollForwardPatch", () => {
  it("clears next meeting and sets last contacted from meeting", () => {
    const patch = buildPastMeetingRollForwardPatch({
      nextMeetingAt: PAST,
      lastContactedAt: OLDER,
    });
    expect(patch.next_meeting_at).toBeNull();
    expect(patch.next_meeting_source).toBeNull();
    expect(patch.last_contacted_at).toBe(PAST);
  });
});

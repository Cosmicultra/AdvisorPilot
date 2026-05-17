/**
 * Tests for the pure report-editor reducer.
 *
 * The editor component (components/crm/reports/report-editor.tsx) is a
 * thin shell over this reducer. By covering the reducer + the derived
 * selectors here we get the state-management correctness without
 * needing RTL / a DOM.
 *
 * Coverage:
 *   1. initialEditorState (new vs existing)
 *   2. SET_TITLE / SET_CONTENT with validation
 *   3. SAVE_START / SAVE_SUCCESS / SAVE_ERROR transitions
 *   4. REVERT discards working edits without touching the baseline
 *   5. RESET re-initializes to a new baseline
 *   6. isDirty derivation
 *   7. canSave: dirty + valid + not saving + not empty + (existing && dirty)
 */

import { describe, expect, it } from "vitest";
import {
  canSave,
  initialEditorState,
  isDirty,
  MAX_CONTENT_LENGTH,
  MAX_TITLE_LENGTH,
  reportEditorReducer,
  validateContent,
  validateTitle,
} from "./report-editor-state";

describe("initialEditorState", () => {
  it("defaults title + content to empty strings for `new` mode", () => {
    const s = initialEditorState({ mode: "new" });
    expect(s.title).toBe("");
    expect(s.content).toBe("");
    expect(s.baseline).toEqual({ title: "", content: "" });
    expect(s.saving).toBe(false);
    expect(s.titleError).toBeNull();
    expect(s.contentError).toBeNull();
    expect(s.saveError).toBeNull();
  });

  it("seeds baseline from initial values for `existing` mode", () => {
    const s = initialEditorState({
      mode: "existing",
      title: "Q3 Review",
      content: "# Q3 Review\n\nBody.",
    });
    expect(s.baseline).toEqual({ title: "Q3 Review", content: "# Q3 Review\n\nBody." });
    expect(s.title).toBe("Q3 Review");
    expect(s.content).toBe("# Q3 Review\n\nBody.");
  });
});

describe("validators", () => {
  it("rejects empty title", () => {
    expect(validateTitle("")).toMatch(/required/);
    expect(validateTitle("   ")).toMatch(/required/);
  });
  it("rejects oversized title", () => {
    const oversized = "A".repeat(MAX_TITLE_LENGTH + 1);
    expect(validateTitle(oversized)).toMatch(/characters or fewer/);
  });
  it("accepts a normal title", () => {
    expect(validateTitle("Q3 Allocation Review")).toBeNull();
  });
  it("accepts empty content (drafts can have empty bodies briefly)", () => {
    expect(validateContent("")).toBeNull();
  });
  it("rejects oversized content", () => {
    const oversized = "x".repeat(MAX_CONTENT_LENGTH + 1);
    expect(validateContent(oversized)).toMatch(/characters or fewer/);
  });
});

describe("reportEditorReducer — SET_TITLE / SET_CONTENT", () => {
  it("SET_TITLE updates title + clears saveError + populates titleError on bad input", () => {
    let s = initialEditorState({
      mode: "existing",
      title: "Old",
      content: "Body",
    });
    // Simulate a prior failed save sitting in state.
    s = { ...s, saveError: "Server exploded." };
    s = reportEditorReducer(s, { type: "SET_TITLE", title: "" });
    expect(s.title).toBe("");
    expect(s.titleError).toMatch(/required/);
    expect(s.saveError).toBeNull();
  });

  it("SET_CONTENT updates content + clears saveError + populates contentError on overflow", () => {
    let s = initialEditorState({ mode: "new" });
    s = reportEditorReducer(s, { type: "SET_CONTENT", content: "x".repeat(MAX_CONTENT_LENGTH + 5) });
    expect(s.content.length).toBe(MAX_CONTENT_LENGTH + 5);
    expect(s.contentError).toMatch(/characters or fewer/);
  });
});

describe("reportEditorReducer — save lifecycle", () => {
  it("SAVE_START sets saving=true + clears saveError", () => {
    let s = initialEditorState({ mode: "new", title: "x", content: "y" });
    s = { ...s, saveError: "old error" };
    s = reportEditorReducer(s, { type: "SAVE_START" });
    expect(s.saving).toBe(true);
    expect(s.saveError).toBeNull();
  });

  it("SAVE_SUCCESS resets baseline to current working values + clears all errors", () => {
    let s = initialEditorState({
      mode: "existing",
      title: "Old",
      content: "Old body",
    });
    s = reportEditorReducer(s, { type: "SET_TITLE", title: "New" });
    s = reportEditorReducer(s, { type: "SET_CONTENT", content: "New body" });
    s = reportEditorReducer(s, { type: "SAVE_START" });
    s = reportEditorReducer(s, {
      type: "SAVE_SUCCESS",
      nextBaseline: { title: "New", content: "New body" },
    });
    expect(s.saving).toBe(false);
    expect(s.baseline).toEqual({ title: "New", content: "New body" });
    expect(isDirty(s)).toBe(false);
    expect(s.saveError).toBeNull();
    expect(s.titleError).toBeNull();
    expect(s.contentError).toBeNull();
  });

  it("SAVE_ERROR surfaces the message + un-sets saving", () => {
    let s = initialEditorState({ mode: "new", title: "x", content: "y" });
    s = reportEditorReducer(s, { type: "SAVE_START" });
    s = reportEditorReducer(s, { type: "SAVE_ERROR", message: "Network failed." });
    expect(s.saving).toBe(false);
    expect(s.saveError).toBe("Network failed.");
  });
});

describe("reportEditorReducer — REVERT / RESET", () => {
  it("REVERT restores baseline values + clears errors but keeps mode", () => {
    let s = initialEditorState({ mode: "existing", title: "Old", content: "Old body" });
    s = reportEditorReducer(s, { type: "SET_TITLE", title: "New" });
    s = reportEditorReducer(s, { type: "SET_CONTENT", content: "New body" });
    expect(isDirty(s)).toBe(true);
    s = reportEditorReducer(s, { type: "REVERT" });
    expect(s.title).toBe("Old");
    expect(s.content).toBe("Old body");
    expect(isDirty(s)).toBe(false);
    expect(s.mode).toBe("existing");
  });

  it("RESET re-initializes to a fresh baseline", () => {
    let s = initialEditorState({ mode: "existing", title: "Old", content: "Body" });
    s = reportEditorReducer(s, { type: "SET_TITLE", title: "Dirty" });
    s = reportEditorReducer(s, {
      type: "RESET",
      baseline: { title: "Server-fresh", content: "Server body" },
    });
    expect(s.baseline).toEqual({ title: "Server-fresh", content: "Server body" });
    expect(s.title).toBe("Server-fresh");
    expect(s.content).toBe("Server body");
    expect(isDirty(s)).toBe(false);
  });
});

describe("isDirty", () => {
  it("false at initial state", () => {
    expect(isDirty(initialEditorState({ mode: "new" }))).toBe(false);
  });
  it("true when title diverges from baseline", () => {
    const base = initialEditorState({ mode: "existing", title: "A", content: "B" });
    const next = reportEditorReducer(base, { type: "SET_TITLE", title: "AA" });
    expect(isDirty(next)).toBe(true);
  });
  it("true when content diverges from baseline", () => {
    const base = initialEditorState({ mode: "existing", title: "A", content: "B" });
    const next = reportEditorReducer(base, { type: "SET_CONTENT", content: "BB" });
    expect(isDirty(next)).toBe(true);
  });
});

describe("canSave", () => {
  it("new mode: requires title + content; otherwise blocked", () => {
    expect(canSave(initialEditorState({ mode: "new" }))).toBe(false);
    let s = initialEditorState({ mode: "new" });
    s = reportEditorReducer(s, { type: "SET_TITLE", title: "T" });
    expect(canSave(s)).toBe(false); // content still empty
    s = reportEditorReducer(s, { type: "SET_CONTENT", content: "Body" });
    expect(canSave(s)).toBe(true);
  });

  it("existing mode: requires dirty + valid", () => {
    const s = initialEditorState({
      mode: "existing",
      title: "T",
      content: "B",
    });
    expect(canSave(s)).toBe(false); // not dirty
    const dirty = reportEditorReducer(s, { type: "SET_CONTENT", content: "B2" });
    expect(canSave(dirty)).toBe(true);
  });

  it("blocked while saving", () => {
    let s = initialEditorState({ mode: "new", title: "T", content: "B" });
    s = reportEditorReducer(s, { type: "SAVE_START" });
    expect(canSave(s)).toBe(false);
  });

  it("blocked when there's a validation error on title or content", () => {
    let s = initialEditorState({ mode: "new", title: "T", content: "B" });
    s = reportEditorReducer(s, { type: "SET_TITLE", title: "" });
    expect(canSave(s)).toBe(false);
    s = reportEditorReducer(s, { type: "SET_TITLE", title: "T" });
    s = reportEditorReducer(s, {
      type: "SET_CONTENT",
      content: "x".repeat(MAX_CONTENT_LENGTH + 5),
    });
    expect(canSave(s)).toBe(false);
  });
});

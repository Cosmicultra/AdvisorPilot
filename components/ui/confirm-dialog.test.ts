/**
 * Tests for the pure helpers backing <ConfirmDialog>.
 *
 * The dialog and provider themselves are React components — they're
 * verified manually in the browser since this repo doesn't ship a DOM
 * test renderer. The pieces below capture the contract that
 * `useConfirm()` callers rely on (button labels, focus defaults) so
 * any future tone change is detected by CI rather than UAT.
 */

import { describe, it, expect } from "vitest";
import {
  defaultConfirmLabel,
  defaultFocusForTone,
  type ConfirmTone,
} from "./confirm-dialog";

describe("defaultConfirmLabel", () => {
  it("uses 'Delete' for the danger tone — explicit verb, never just 'OK'", () => {
    expect(defaultConfirmLabel("danger")).toBe("Delete");
  });

  it("uses 'Confirm' for the primary tone — neutral but action-oriented", () => {
    expect(defaultConfirmLabel("primary")).toBe("Confirm");
  });

  it("uses 'OK' for the neutral tone — purely acknowledgement", () => {
    expect(defaultConfirmLabel("neutral")).toBe("OK");
  });

  it("returns a non-empty string for every tone", () => {
    const tones: ConfirmTone[] = ["danger", "primary", "neutral"];
    for (const tone of tones) {
      const label = defaultConfirmLabel(tone);
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe("defaultFocusForTone", () => {
  it("returns 'cancel' for danger so accidental Enter doesn't blow things up", () => {
    expect(defaultFocusForTone("danger")).toBe("cancel");
  });

  it("returns 'confirm' for primary so the happy path is one keystroke away", () => {
    expect(defaultFocusForTone("primary")).toBe("confirm");
  });

  it("returns 'confirm' for neutral — it's just acknowledgement", () => {
    expect(defaultFocusForTone("neutral")).toBe("confirm");
  });
});

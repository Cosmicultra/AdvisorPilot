/**
 * Tests for the pure widget-size helpers used by the chat launcher +
 * header. The localStorage persistence is exercised end-to-end with a
 * stub `window.localStorage` so the read/write semantics are pinned.
 *
 * v2 (PR 20): simplified to a two-mode toggle (`compact` ↔ `full`).
 * Legacy "wide" reads from localStorage are mapped forward to "full"
 * so an advisor who previously preferred the wider panel still gets a
 * roomier surface.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CHAT_WIDGET_SIZES,
  isChatWidgetSize,
  readPersistedSize,
  SIZE_DIMENSIONS,
  SIZE_LABEL,
  toggleSize,
  writePersistedSize,
} from "./widget-size";

// ─── Pure helpers ──────────────────────────────────────────────────────────

describe("CHAT_WIDGET_SIZES + isChatWidgetSize", () => {
  it("exports the two shipped sizes (compact + full)", () => {
    expect(CHAT_WIDGET_SIZES).toEqual(["compact", "full"]);
  });

  it("isChatWidgetSize accepts every shipped size", () => {
    for (const s of CHAT_WIDGET_SIZES) expect(isChatWidgetSize(s)).toBe(true);
  });

  it("isChatWidgetSize rejects bad input + the dropped 'wide' value", () => {
    // PR 18 shipped "wide" as a middle mode; PR 20 dropped it. The
    // type guard returns false so any stale code paths can't sneak it
    // in — the persisted-read helper has its own forward-mapping.
    expect(isChatWidgetSize("wide")).toBe(false);
    expect(isChatWidgetSize("xl")).toBe(false);
    expect(isChatWidgetSize("")).toBe(false);
    expect(isChatWidgetSize(null)).toBe(false);
    expect(isChatWidgetSize(undefined)).toBe(false);
    expect(isChatWidgetSize(42)).toBe(false);
  });
});

describe("SIZE_DIMENSIONS + SIZE_LABEL", () => {
  it("ships pixel dimensions for compact only (full is overlay-style)", () => {
    expect(SIZE_DIMENSIONS.compact.width).toBeGreaterThan(0);
    expect(SIZE_DIMENSIONS.compact.height).toBeGreaterThan(0);
    // No `full` entry — that mode is laid out via inset:0 in the launcher.
    expect((SIZE_DIMENSIONS as Record<string, unknown>).full).toBeUndefined();
  });

  it("SIZE_LABEL covers both sizes", () => {
    for (const s of CHAT_WIDGET_SIZES) {
      expect(typeof SIZE_LABEL[s]).toBe("string");
      expect(SIZE_LABEL[s].length).toBeGreaterThan(0);
    }
  });
});

describe("toggleSize", () => {
  it("toggles compact ↔ full", () => {
    expect(toggleSize("compact")).toBe("full");
    expect(toggleSize("full")).toBe("compact");
  });

  it("round-trips", () => {
    for (const s of CHAT_WIDGET_SIZES) {
      expect(toggleSize(toggleSize(s))).toBe(s);
    }
  });
});

// ─── Persistence ──────────────────────────────────────────────────────────

describe("readPersistedSize + writePersistedSize", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => {
            store.set(k, v);
          },
          removeItem: (k: string) => {
            store.delete(k);
          },
          clear: () => store.clear(),
        },
      },
    });
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("defaults to compact when nothing is persisted", () => {
    expect(readPersistedSize()).toBe("compact");
  });

  it("round-trips a written value", () => {
    writePersistedSize("full");
    expect(readPersistedSize()).toBe("full");
    writePersistedSize("compact");
    expect(readPersistedSize()).toBe("compact");
  });

  it("forward-maps legacy 'wide' (PR 18) reads to 'full' (PR 20)", () => {
    (window.localStorage as Storage).setItem(
      "advisorpilot.chat.widgetSize",
      "wide",
    );
    expect(readPersistedSize()).toBe("full");
  });

  it("falls back to compact on garbage values", () => {
    (window.localStorage as Storage).setItem(
      "advisorpilot.chat.widgetSize",
      "xl",
    );
    expect(readPersistedSize()).toBe("compact");
  });
});

describe("readPersistedSize without window (SSR-safe)", () => {
  it("returns compact when window is undefined", () => {
    const orig = (globalThis as { window?: unknown }).window;
    delete (globalThis as { window?: unknown }).window;
    try {
      expect(readPersistedSize()).toBe("compact");
    } finally {
      if (orig !== undefined) {
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          value: orig,
        });
      }
    }
  });
});

import { describe, expect, it, vi } from "vitest";
import { diffShallow, withConfirmation } from "./confirmation";

/**
 * Confirmation helper unit tests.
 *
 *   1. First call (no `_confirmed`) returns a preview with `confirmationRequired:true`
 *   2. Second call (`_confirmed:true`) executes
 *   3. Preview errors propagate (don't execute)
 *   4. Execute errors propagate
 *   5. `confirmed:false` is treated the same as missing
 *   6. `diffShallow` returns only changed keys + skips undefineds
 *   7. `diffShallow` compares arrays positionally
 */

describe("withConfirmation", () => {
  it("first call returns preview wrapped with confirmationRequired", async () => {
    const buildPreview = vi.fn().mockResolvedValue({ noteId: "n1", changes: 2 });
    const execute = vi.fn().mockResolvedValue({ noteId: "n1", ok: true });

    const result = await withConfirmation({
      args: {},
      action: "update_note",
      buildPreview,
      execute,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(buildPreview).toHaveBeenCalledOnce();
    expect(result.result).toMatchObject({
      preview: true,
      action: "update_note",
      confirmationRequired: true,
      noteId: "n1",
      changes: 2,
    });
  });

  it("second call (_confirmed:true) executes and wraps with success:true", async () => {
    const buildPreview = vi.fn().mockResolvedValue({ noteId: "n1" });
    const execute = vi.fn().mockResolvedValue({ noteId: "n1", written: true });

    const result = await withConfirmation({
      args: { _confirmed: true },
      action: "update_note",
      buildPreview,
      execute,
    });

    expect(buildPreview).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledOnce();
    expect(result.result).toEqual({
      success: true,
      action: "update_note",
      noteId: "n1",
      written: true,
    });
  });

  it("preview error propagates without calling execute", async () => {
    const buildPreview = vi.fn().mockResolvedValue({ error: "Note not found." });
    const execute = vi.fn();

    const result = await withConfirmation({
      args: {},
      action: "update_note",
      buildPreview,
      execute,
    });
    expect(result.error).toBe("Note not found.");
    expect(execute).not.toHaveBeenCalled();
  });

  it("execute error propagates", async () => {
    const execute = vi.fn().mockResolvedValue({ error: "Insert failed." });
    const result = await withConfirmation({
      args: { _confirmed: true },
      action: "delete_note",
      buildPreview: vi.fn(),
      execute,
    });
    expect(result.error).toBe("Insert failed.");
  });

  it("_confirmed:false counts as not confirmed", async () => {
    const buildPreview = vi.fn().mockResolvedValue({ ok: 1 });
    const execute = vi.fn();
    const result = await withConfirmation({
      args: { _confirmed: false },
      action: "x",
      buildPreview,
      execute,
    });
    expect(execute).not.toHaveBeenCalled();
    expect(result.result).toMatchObject({ preview: true, ok: 1 });
  });
});

describe("diffShallow", () => {
  it("returns only changed keys", () => {
    const before = { body: "old", pinned: false, tags: ["a"] };
    const patch = { body: "new", pinned: false };
    const out = diffShallow(before, patch);
    expect(out).toEqual({ body: { before: "old", after: "new" } });
  });

  it("skips undefined values in patch", () => {
    const before = { body: "x" };
    const patch: Partial<typeof before> = { body: undefined };
    const out = diffShallow(before, patch);
    expect(out).toEqual({});
  });

  it("compares arrays positionally", () => {
    expect(diffShallow({ tags: ["a", "b"] }, { tags: ["a", "b"] })).toEqual({});
    expect(diffShallow({ tags: ["a"] }, { tags: ["a", "b"] })).toEqual({
      tags: { before: ["a"], after: ["a", "b"] },
    });
    expect(diffShallow({ tags: ["a", "b"] }, { tags: ["b", "a"] })).toEqual({
      tags: { before: ["a", "b"], after: ["b", "a"] },
    });
  });
});

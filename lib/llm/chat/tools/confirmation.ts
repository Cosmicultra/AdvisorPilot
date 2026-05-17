/**
 * Shared confirmation helper for write tools.
 *
 * Implements the T3/T4 "preview then confirm" pattern from
 * `docs/crm/70-orchestrator-tools.md §2`:
 *
 *   - **T1** (read-only)       — no confirmation; e.g. `query_crm`.
 *   - **T2** (create / non-destructive) — no confirmation; one-shot.
 *   - **T3** (update)          — first call returns a preview of the diff;
 *                                second call (with `_confirmed: true`)
 *                                actually writes.
 *   - **T4** (single delete)   — first call returns a preview of what
 *                                would be deleted; second call (with
 *                                `_confirmed: true`) actually deletes.
 *
 * The model is expected to read the preview, show it to the advisor, and
 * only re-invoke the tool with `_confirmed: true` after the advisor says
 * yes. The tool registry surfaces this convention to the model via the
 * `<tools>` block in the system prompt; each tool's description also
 * spells out the flow.
 *
 * Result shape contract:
 *
 *   Preview phase  → `{ result: { preview: true, action, summary, ... } }`
 *   Execute phase  → `{ result: { success: true, action, ...payload } }`
 *
 * Both paths return `result` (not `error`) — the preview is a SUCCESSFUL
 * tool call, just with a "this hasn't happened yet" payload. Errors come
 * back via the standard `{ error }` channel.
 */

import type { ChatToolHandlerResult } from "./types";

/**
 * Wraps a destructive operation with the preview-then-confirm pattern.
 *
 * On first call (no `_confirmed`), returns the result of `buildPreview()`
 * wrapped in `{preview: true, action, ...preview}`. On second call (with
 * `_confirmed: true`), executes `execute()` and returns the result wrapped
 * in `{success: true, action, ...result}`.
 *
 * @param args         Raw tool args (`_confirmed` flag lives here).
 * @param action       Short action label for both phases (e.g. "update_note").
 * @param buildPreview Async function returning the preview payload. Runs
 *                     READ operations only (visibility check, current-row
 *                     fetch for diff display, etc.) — must NOT write.
 * @param execute      Async function that actually performs the write +
 *                     side effects. Returns the executed-payload.
 */
export async function withConfirmation<TPreview, TResult>(opts: {
  args: Record<string, unknown>;
  action: string;
  buildPreview: () => Promise<TPreview | { error: string }>;
  execute: () => Promise<TResult | { error: string }>;
}): Promise<ChatToolHandlerResult> {
  const confirmed = opts.args._confirmed === true;

  if (!confirmed) {
    const preview = await opts.buildPreview();
    if (preview && typeof preview === "object" && "error" in preview) {
      return { error: preview.error };
    }
    return {
      result: {
        preview: true,
        action: opts.action,
        confirmationRequired: true,
        message:
          "This action requires confirmation. Show the advisor the preview, then re-invoke with `_confirmed: true` to apply.",
        ...preview,
      },
    };
  }

  const executed = await opts.execute();
  if (executed && typeof executed === "object" && "error" in executed) {
    return { error: executed.error };
  }
  return {
    result: {
      success: true,
      action: opts.action,
      ...executed,
    },
  };
}

/**
 * Compute a shallow diff for an update preview — pairs of `{before, after}`
 * for every key in `patch` that actually differs from `previous`.
 *
 * Used by every `update` operation's preview phase so the model can narrate
 * "I'll change `pinned` from false → true on note c_abc — confirm?"
 */
export function diffShallow<T extends Record<string, unknown>>(
  previous: T,
  patch: Partial<T>,
): Record<string, { before: unknown; after: unknown }> {
  const out: Record<string, { before: unknown; after: unknown }> = {};
  for (const [key, after] of Object.entries(patch)) {
    if (after === undefined) continue;
    const before = previous[key as keyof T];
    if (!shallowEqual(before, after)) {
      out[key] = { before, after };
    }
  }
  return out;
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => v === b[i]);
  }
  return false;
}

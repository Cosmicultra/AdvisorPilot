/**
 * Shared helpers for the `run_*` wrapper tools.
 *
 * Two responsibilities:
 *
 *   1. **In-process route invocation**: rather than making an HTTP fetch
 *      against `localhost:3000/api/...` (which would require knowing the
 *      base URL, threading auth headers through a real network round trip,
 *      etc.), we synthesize a Request object directly and call the route
 *      handler's exported `POST` function. The original chat-stream Request
 *      provides auth headers (NextAuth cookies + Supabase Bearer), so the
 *      route handlers' `resolveAdvisorIdentity()` works exactly as it would
 *      from a real client request.
 *
 *   2. **Client snapshot for the model**: every `run_*` tool that operates
 *      on a client needs `client + holdings + analysis + total_value`. This
 *      module exposes one helper (`fetchVisibleClientSnapshot`) so each tool
 *      doesn't duplicate the visibility check + select pattern.
 *
 * Why in-process > HTTP fetch:
 *   - No port resolution / base URL config
 *   - No DNS / TCP round trip
 *   - Auth is just header copying instead of cookie serialization
 *   - Failures surface as exceptions / structured errors, not 502s
 *   - Works in any deployment topology (Vercel, self-hosted, edge)
 *
 * Why we don't extract route-handler bodies into shared functions: that's
 * the right long-term move and is on the roadmap, but it's a cross-cutting
 * refactor across 3 routes. This pattern ships PR 7 without that
 * refactor and stays compatible with it (when the extraction happens, the
 * `run_*` tools switch from `invokeRouteHandler()` to calling the extracted
 * function directly — same result shape, fewer hops).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatToolContext } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// In-process route invocation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Signature every Next.js route handler exposes for its POST method.
 * Loose enough that simple routes (one-arg) and dynamic routes (two-arg
 * with `{params}`) both fit; `run_*` tools only wrap the one-arg kind.
 */
export type RouteHandler = (req: Request) => Promise<Response>;

export interface InvokeRouteOptions<TBody> {
  /** The chat-tool context — provides the original Request for auth header copy. */
  ctx: ChatToolContext;
  /**
   * The exported POST function from the target route module. Pass the
   * function reference directly (e.g. `import { POST } from "...route"`
   * is fine in this codebase since route modules don't depend on Next's
   * framework runtime to be importable).
   */
  handler: RouteHandler;
  /** JSON body to POST to the synthesized request. */
  body: TBody;
  /**
   * The synthetic URL we put on the Request. Doesn't affect routing (the
   * handler doesn't read it), but it's surfaced in some error logs so a
   * descriptive value here helps debugging. Default: "internal://chat-tool".
   */
  syntheticUrl?: string;
}

export interface InvokeRouteResult<T> {
  status: number;
  body: T | null;
  /** True when the route returned a non-2xx status. */
  errored: boolean;
}

/**
 * Synthesize a Request from a JSON body + the chat-stream's auth headers
 * and invoke the target route handler in-process. Returns the parsed JSON
 * body + status code.
 *
 * Auth threading: copies `cookie` + `authorization` from the original
 * chat request. Those are the only headers `resolveAdvisorIdentity()`
 * reads. Adds `content-type: application/json` since we're sending JSON.
 *
 * Errors:
 *   - Throws when `ctx.request` is null (caller should check this and
 *     surface a clearer error to the model).
 *   - Returns `{status, body: null, errored: true}` when the response body
 *     isn't valid JSON. Callers can fall back to a generic "route failed"
 *     message.
 */
export async function invokeRouteHandler<TBody, TResult>(
  opts: InvokeRouteOptions<TBody>,
): Promise<InvokeRouteResult<TResult>> {
  if (!opts.ctx.request) {
    throw new Error(
      "invokeRouteHandler: ctx.request is null — run_* tools need the original chat-stream Request for auth header threading.",
    );
  }

  const synthetic = new Request(opts.syntheticUrl ?? "internal://chat-tool", {
    method: "POST",
    headers: forwardAuthHeaders(opts.ctx.request),
    body: JSON.stringify(opts.body),
  });

  const response = await opts.handler(synthetic);
  const status = response.status;
  let parsed: TResult | null = null;
  try {
    parsed = (await response.json()) as TResult;
  } catch {
    parsed = null;
  }

  return { status, body: parsed, errored: !response.ok };
}

/**
 * Build a Headers object with ONLY the fields `resolveAdvisorIdentity()`
 * cares about, plus `content-type: application/json`. We deliberately
 * avoid copying every header — most are irrelevant, and forwarding
 * `Content-Length` etc. for a synthesized body would lie.
 */
function forwardAuthHeaders(req: Request): Headers {
  const out = new Headers();
  out.set("content-type", "application/json");
  // NextAuth session cookie
  const cookie = req.headers.get("cookie");
  if (cookie) out.set("cookie", cookie);
  // Supabase Bearer (email/password auth path)
  const auth = req.headers.get("authorization");
  if (auth) out.set("authorization", auth);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Client snapshot — fetch the data every run_* tool needs from a client row
// ─────────────────────────────────────────────────────────────────────────────

export interface ClientSnapshot {
  id: string;
  ownerEmail: string;
  /** Raw intake JSONB (what the analysis route expects as `client`). */
  intake: Record<string, unknown>;
  /** Raw holdings array (what the analysis / enrich routes expect as `holdings`). */
  holdings: Array<Record<string, unknown>>;
  /** Existing analysis JSONB or null. */
  analysis: Record<string, unknown> | null;
  /** Persisted total value column. */
  totalValue: number;
}

/**
 * Visibility-check a client and fetch the minimum row needed for `run_*` tools.
 * Returns null when the client isn't visible OR the row doesn't exist.
 * Throws on Supabase errors so the tool can surface them via `{error}`.
 */
export async function fetchVisibleClientSnapshot(
  supabase: SupabaseClient,
  viewerEmail: string,
  clientId: string,
): Promise<ClientSnapshot | null> {
  const vis = await supabase.rpc("clients_visible_to", {
    viewer_email: viewerEmail,
    client_id: clientId,
  });
  if (vis.error) throw new Error(`clients_visible_to failed: ${vis.error.message}`);
  if (vis.data !== true) return null;

  const { data, error } = await supabase
    .from("advisorpilot_clients")
    .select("id, owner_email, client, holdings, analysis, total_value")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new Error(`client snapshot failed: ${error.message}`);
  if (!data) return null;

  const row = data as Record<string, unknown>;
  return {
    id: String(row.id),
    ownerEmail: String(row.owner_email ?? ""),
    intake: isObject(row.client) ? row.client : {},
    holdings: Array.isArray(row.holdings) ? (row.holdings as Array<Record<string, unknown>>) : [],
    analysis: isObject(row.analysis) ? row.analysis : null,
    totalValue: typeof row.total_value === "number"
      ? row.total_value
      : Number(row.total_value ?? 0),
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

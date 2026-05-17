import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchVisibleClientSnapshot,
  invokeRouteHandler,
  type RouteHandler,
} from "./run-helpers";
import type { ChatToolContext } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Run-helpers unit tests.
 *
 *   1. invokeRouteHandler throws when ctx.request is null
 *   2. invokeRouteHandler synthesizes a Request with content-type=json + body
 *   3. invokeRouteHandler forwards cookie + authorization headers
 *   4. invokeRouteHandler parses JSON response + status; errored=true on non-2xx
 *   5. invokeRouteHandler handles non-JSON response gracefully (body=null)
 *   6. fetchVisibleClientSnapshot returns null on visibility miss
 *   7. fetchVisibleClientSnapshot returns the snapshot shape on success
 *   8. fetchVisibleClientSnapshot throws on Supabase errors (caller surfaces)
 */

const CLIENT_ID = "11111111-1111-1111-1111-111111111111";

function makeCtx(opts: { request: Request | null; supabase?: SupabaseClient }): ChatToolContext {
  return {
    advisorEmail: "jane@firm.com",
    conversationId: "conv_1",
    currentClientId: CLIENT_ID,
    supabase: opts.supabase ?? ({} as SupabaseClient),
    request: opts.request,
    selection: null,
    emitPartial: () => undefined,
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// invokeRouteHandler
// ─────────────────────────────────────────────────────────────────────────────

describe("invokeRouteHandler", () => {
  it("throws when ctx.request is null", async () => {
    await expect(
      invokeRouteHandler({
        ctx: makeCtx({ request: null }),
        handler: vi.fn(),
        body: { x: 1 },
      }),
    ).rejects.toThrow(/ctx\.request is null/);
  });

  it("synthesizes a POST Request with the body + content-type=json", async () => {
    const handler = vi.fn(
      async (req: Request) =>
        new Response(JSON.stringify({ ok: true, gotBody: await req.json() }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const originalReq = new Request("https://example.com/api/chat/stream", {
      method: "POST",
      headers: { cookie: "ap.session=abc; lang=en" },
    });
    const r = await invokeRouteHandler<{ foo: string }, { ok: boolean; gotBody: unknown }>({
      ctx: makeCtx({ request: originalReq }),
      handler,
      body: { foo: "bar" },
    });
    expect(handler).toHaveBeenCalledOnce();
    const calls = (handler as unknown as { mock: { calls: [Request][] } }).mock.calls;
    const syntheticReq = calls[0][0];
    expect(syntheticReq.method).toBe("POST");
    expect(syntheticReq.headers.get("content-type")).toBe("application/json");
    expect(r.status).toBe(200);
    expect(r.errored).toBe(false);
    expect(r.body?.gotBody).toEqual({ foo: "bar" });
  });

  it("forwards cookie + authorization headers from the original request", async () => {
    const handler: RouteHandler = vi.fn(
      async () => new Response(JSON.stringify({}), { status: 200 }),
    );
    const originalReq = new Request("https://x/y", {
      method: "POST",
      headers: {
        cookie: "ap.session=abc",
        authorization: "Bearer SUPABASE_JWT_TOKEN",
        "x-irrelevant": "should-not-forward",
      },
    });
    await invokeRouteHandler({
      ctx: makeCtx({ request: originalReq }),
      handler,
      body: {},
    });
    // `handler` is typed as RouteHandler (a function) — vi.fn loses the
    // signature info; cast through unknown to read the call args.
    const calls = (handler as unknown as { mock: { calls: [Request][] } }).mock.calls;
    const syntheticReq = calls[0][0];
    expect(syntheticReq.headers.get("cookie")).toBe("ap.session=abc");
    expect(syntheticReq.headers.get("authorization")).toBe("Bearer SUPABASE_JWT_TOKEN");
    // Irrelevant headers should NOT be forwarded.
    expect(syntheticReq.headers.get("x-irrelevant")).toBeNull();
  });

  it("returns errored=true on non-2xx and parses the error body", async () => {
    const handler: RouteHandler = async () =>
      new Response(JSON.stringify({ error: "boom" }), { status: 500 });
    const originalReq = new Request("https://x/y", { method: "POST" });
    const r = await invokeRouteHandler<unknown, { error?: string }>({
      ctx: makeCtx({ request: originalReq }),
      handler,
      body: {},
    });
    expect(r.errored).toBe(true);
    expect(r.status).toBe(500);
    expect(r.body?.error).toBe("boom");
  });

  it("gracefully handles non-JSON response (body=null, status preserved)", async () => {
    const handler: RouteHandler = async () =>
      new Response("not json", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    const originalReq = new Request("https://x/y", { method: "POST" });
    const r = await invokeRouteHandler({
      ctx: makeCtx({ request: originalReq }),
      handler,
      body: {},
    });
    expect(r.status).toBe(200);
    expect(r.body).toBeNull();
    // ok status → errored=false even though parsing failed; the caller
    // distinguishes via body === null.
    expect(r.errored).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fetchVisibleClientSnapshot
// ─────────────────────────────────────────────────────────────────────────────

interface TableResult {
  data: unknown;
  error: { message: string } | null;
}

function makeMockSupabase(fixtures: {
  tables?: Record<string, TableResult>;
  rpcs?: Record<string, TableResult>;
}): SupabaseClient {
  const byTable = new Map(Object.entries(fixtures.tables ?? {}));
  const byRpc = new Map(Object.entries(fixtures.rpcs ?? {}));
  return {
    from(table: string) {
      const result = byTable.get(table) ?? ({ data: null, error: null } as TableResult);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {};
      const chainable = () => builder;
      for (const m of ["select", "eq"]) builder[m] = chainable;
      builder.maybeSingle = () => Promise.resolve(result);
      return builder;
    },
    rpc(name: string) {
      const result = byRpc.get(name) ?? ({ data: null, error: null } as TableResult);
      return Promise.resolve(result);
    },
  } as unknown as SupabaseClient;
}

describe("fetchVisibleClientSnapshot", () => {
  it("returns null when the visibility RPC says false", async () => {
    const supabase = makeMockSupabase({
      rpcs: { clients_visible_to: { data: false, error: null } },
    });
    const snap = await fetchVisibleClientSnapshot(supabase, "jane@firm.com", CLIENT_ID);
    expect(snap).toBeNull();
  });

  it("returns the typed snapshot when visible", async () => {
    const row = {
      id: CLIENT_ID,
      owner_email: "jane@firm.com",
      client: { firstName: "John", lastName: "Smith" },
      holdings: [{ value: 100_000 }, { value: 50_000 }],
      analysis: { synopsis: "Existing analysis" },
      total_value: 150_000,
    };
    const supabase = makeMockSupabase({
      tables: { advisorpilot_clients: { data: row, error: null } },
      rpcs: { clients_visible_to: { data: true, error: null } },
    });
    const snap = await fetchVisibleClientSnapshot(supabase, "jane@firm.com", CLIENT_ID);
    expect(snap).not.toBeNull();
    expect(snap!.id).toBe(CLIENT_ID);
    expect(snap!.intake).toEqual({ firstName: "John", lastName: "Smith" });
    expect(snap!.holdings).toHaveLength(2);
    expect(snap!.analysis).toEqual({ synopsis: "Existing analysis" });
    expect(snap!.totalValue).toBe(150_000);
  });

  it("throws when the client fetch errors (caller surfaces as tool error)", async () => {
    const supabase = makeMockSupabase({
      tables: {
        advisorpilot_clients: { data: null, error: { message: "permission denied" } },
      },
      rpcs: { clients_visible_to: { data: true, error: null } },
    });
    await expect(
      fetchVisibleClientSnapshot(supabase, "jane@firm.com", CLIENT_ID),
    ).rejects.toThrow(/permission denied/);
  });
});

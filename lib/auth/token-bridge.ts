/**
 * Cross-tab Supabase token bridge.
 *
 * Problem this solves
 * ───────────────────
 * Email/password advisors store their Supabase JWT in `sessionStorage`.
 * That storage is **per-tab** — when the report viewer calls
 * `window.open(/print/reports/...)` the new tab has an EMPTY
 * sessionStorage even though the advisor is fully signed in on the
 * originating tab. Without a bridge, the print tab's first
 * `advisorFetch` returns 401 and shows "Sign in required" — the exact
 * failure mode flagged in `.cursor/rules/50-authentication.mdc`
 * (sessionStorage is invisible to the server AND to sibling tabs).
 *
 * Why BroadcastChannel
 * ────────────────────
 * `BroadcastChannel` is a same-origin, browser-native pub/sub that
 * works across tabs without requiring `window.opener` (so we get to
 * keep `noopener,noreferrer` on the print tab open) and survives
 * Cmd-Click / right-click "Open in new tab" — both of which break the
 * postMessage(opener) workaround. We already use BroadcastChannel for
 * chat conversation sync, so the runtime cost is amortized.
 *
 * Security
 * ────────
 * BroadcastChannel is same-origin-only, so the token never crosses
 * tabs in a different document.domain or scheme. Any same-origin
 * script could already read sessionStorage directly, so broadcasting
 * on the same-origin channel doesn't lower the security floor.
 *
 * For NextAuth (Google) advisors this bridge is a no-op — their
 * session lives in HTTP-only cookies that forward across tabs
 * automatically. The print page works without ever asking for tokens.
 * The bridge only matters for the email/password path.
 *
 * Protocol
 * ────────
 * Two message types on channel `advisorpilot.auth`:
 *
 *   request_token
 *     { type: "request_token"; requestId: string }
 *     Sent by a tab that has an empty sessionStorage and wants to ask
 *     any sibling tab to share its Supabase tokens.
 *
 *   token_response
 *     { type: "token_response"; requestId: string;
 *       accessToken: string; refreshToken: string | null }
 *     Sent by any tab that received `request_token` AND has a non-empty
 *     access token in its sessionStorage. The requesting tab matches
 *     on `requestId` so two concurrent requests don't get mixed up.
 *
 * Responders only ANSWER — they never volunteer tokens unless asked.
 * Requesters time out after `timeoutMs` (default 1.5s) and resolve
 * `null`, letting the caller fall back to the unauthorized UI.
 */

import { AP_SUPABASE_AT, AP_SUPABASE_RT } from "@/lib/advisor-fetch";

const CHANNEL_NAME = "advisorpilot.auth";

export interface SupabaseTokens {
  accessToken: string;
  refreshToken: string | null;
}

type RequestMsg = { type: "request_token"; requestId: string };
type ResponseMsg = {
  type: "token_response";
  requestId: string;
  accessToken: string;
  refreshToken: string | null;
};
type Msg = RequestMsg | ResponseMsg;

/**
 * Get a BroadcastChannel scoped to this origin. Returns null when the
 * API is unavailable (very old browsers, some SSR contexts) so callers
 * can degrade gracefully without crashing. We don't cache the channel
 * — both responder and requester create + close their own per call /
 * per mount, which keeps cleanup local and avoids any singleton-leak
 * footguns.
 */
function openChannel(): BroadcastChannel | null {
  if (typeof window === "undefined") return null;
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return null;
  }
}

/**
 * Type guards. Exported only so they can be unit tested without
 * standing up a DOM — they're called internally by the message
 * handler in this module and should not be needed by external callers.
 */
export function isRequestMessage(value: unknown): value is RequestMsg {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "request_token" &&
    typeof (value as { requestId?: unknown }).requestId === "string"
  );
}

export function isResponseMessage(value: unknown): value is ResponseMsg {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "token_response" &&
    typeof (value as { requestId?: unknown }).requestId === "string" &&
    typeof (value as { accessToken?: unknown }).accessToken === "string"
  );
}

/**
 * Read whatever tokens this tab already has in sessionStorage. Returns
 * null when the access token is missing (we never broadcast a half-set
 * token pair). Refresh token is optional — Google-auth users won't
 * have either and that's fine.
 */
function readLocalTokens(): SupabaseTokens | null {
  try {
    const accessToken = window.sessionStorage.getItem(AP_SUPABASE_AT);
    if (!accessToken) return null;
    const refreshToken = window.sessionStorage.getItem(AP_SUPABASE_RT);
    return { accessToken, refreshToken };
  } catch {
    return null;
  }
}

/**
 * Persist tokens to this tab's sessionStorage. Used by the print tab
 * after it receives a `token_response` so subsequent `advisorFetch`
 * calls use the Bearer header automatically.
 */
function writeLocalTokens(tokens: SupabaseTokens): void {
  try {
    window.sessionStorage.setItem(AP_SUPABASE_AT, tokens.accessToken);
    if (tokens.refreshToken) {
      window.sessionStorage.setItem(AP_SUPABASE_RT, tokens.refreshToken);
    }
  } catch {
    // sessionStorage can throw in private mode / quota errors. Swallow
    // — the caller will fall back to the 401 / sign-in UI on the next
    // fetch, which is correct behavior.
  }
}

/**
 * Mount a listener on this tab that responds to `request_token`
 * broadcasts from sibling tabs with whatever tokens we have locally.
 * If we don't have any tokens, we stay silent — the requester times
 * out and renders its own unauthorized UI.
 *
 * Returns a cleanup function that closes the channel. Call it from
 * useEffect's cleanup so HMR / unmounts don't leak listeners.
 *
 * Safe to call multiple times — each call opens its own channel; the
 * requester just gets two identical responses and uses the first.
 */
export function mountTokenResponder(): () => void {
  const channel = openChannel();
  if (!channel) return () => undefined;

  const onMessage = (event: MessageEvent) => {
    if (!isRequestMessage(event.data)) return;
    const tokens = readLocalTokens();
    if (!tokens) return; // we have nothing to share — stay silent

    const response: ResponseMsg = {
      type: "token_response",
      requestId: event.data.requestId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
    try {
      channel.postMessage(response);
    } catch {
      // closed mid-flight (rare). Nothing useful to do here.
    }
  };

  channel.addEventListener("message", onMessage);
  return () => {
    channel.removeEventListener("message", onMessage);
    channel.close();
  };
}

/**
 * Ask sibling tabs for Supabase tokens and wait up to `timeoutMs` for
 * a response. On success, the tokens are written into this tab's
 * sessionStorage AND returned. On timeout, returns null and writes
 * nothing.
 *
 * Should be called on mount of any tab opened via window.open() that
 * needs to make authenticated requests for email/password advisors.
 * The print page is the only known caller today.
 */
export async function requestTokenFromOtherTabs(
  timeoutMs = 1500,
): Promise<SupabaseTokens | null> {
  // Fast path: if we already have tokens in this tab, nothing to ask.
  const existing = readLocalTokens();
  if (existing) return existing;

  const channel = openChannel();
  if (!channel) return null;

  const requestId = generateRequestId();

  return new Promise<SupabaseTokens | null>((resolve) => {
    let settled = false;

    const finish = (result: SupabaseTokens | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      channel.removeEventListener("message", onMessage);
      channel.close();
      resolve(result);
    };

    const onMessage = (event: MessageEvent) => {
      if (!isResponseMessage(event.data)) return;
      if (event.data.requestId !== requestId) return;
      const tokens: SupabaseTokens = {
        accessToken: event.data.accessToken,
        refreshToken: event.data.refreshToken,
      };
      writeLocalTokens(tokens);
      finish(tokens);
    };

    channel.addEventListener("message", onMessage);

    const timer = window.setTimeout(() => finish(null), timeoutMs);

    try {
      const request: RequestMsg = { type: "request_token", requestId };
      channel.postMessage(request);
    } catch {
      finish(null);
    }
  });
}

/**
 * Generate a short opaque request id. crypto.randomUUID() is widely
 * supported in modern browsers; the fallback exists only for very old
 * runtimes where we'd already have many other problems. Exported for
 * unit testing.
 */
export function generateRequestId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // ignore — fall through to fallback below
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

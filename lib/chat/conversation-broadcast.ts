/**
 * Cross-tab awareness via the BroadcastChannel API.
 *
 * Use cases (v1):
 *   1. When a conversation is opened in two tabs, each tab knows the
 *      other is editing it (sidebar shows a small "open in another tab"
 *      pill so the advisor doesn't accidentally double-send).
 *   2. When tab A completes a turn (or creates a new conversation), tab
 *      B's sidebar refreshes the list so the new/updated row appears.
 *   3. When tab A deletes a conversation, tab B drops it from the list.
 *
 * Falls back to no-op when BroadcastChannel isn't available (SSR,
 * private browsing in some browsers). Production callers don't need to
 * branch on this — `subscribe()` returns an unsubscribe fn either way.
 *
 * One channel per advisor (scoped by lowercased email so multiple
 * advisor accounts on the same machine don't cross-pollinate).
 *
 * Message shape is a discriminated union — adding new event types is
 * just appending to `BroadcastEvent` and adding a case in `subscribe`.
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.17.
 */

/**
 * Messages the chat widgets send to each other across tabs. Keep this
 * tight — every event runs on every tab so a flood here is a flood
 * everywhere. Never put per-token deltas through here.
 */
export type BroadcastEvent =
  /** A turn just completed in some tab — sidebar should refetch the list. */
  | { type: "turn_completed"; conversationId: string; ts: number }
  /** A new conversation was created — same response. */
  | { type: "conversation_created"; conversationId: string; ts: number }
  /** A conversation was deleted — drop it from any tab's sidebar. */
  | { type: "conversation_deleted"; conversationId: string; ts: number }
  /** A conversation was renamed — update title in any tab's sidebar. */
  | { type: "conversation_renamed"; conversationId: string; title: string | null; ts: number }
  /** A conversation was pinned or unpinned — flip the star + re-group in any tab's sidebar (PR 19). */
  | {
      type: "conversation_pinned";
      conversationId: string;
      isPinned: boolean;
      pinnedAt: string | null;
      ts: number;
    }
  /** A tab adopted ownership of a conversation (became its active session). */
  | { type: "tab_opened_conversation"; conversationId: string; tabId: string; ts: number };

type Listener = (event: BroadcastEvent) => void;

/**
 * Distributive Omit — `Omit<Union, K>` collapses discriminated-union
 * variants and loses the per-variant fields. The distributive form
 * applies `Omit` to EACH variant, preserving the discriminator.
 */
type DistributiveOmit<T, K extends keyof T> = T extends unknown
  ? Omit<T, K>
  : never;

/** What callers pass to `send()` — every variant minus the auto-stamped `ts`. */
export type BroadcastEventInput = DistributiveOmit<BroadcastEvent, "ts">;

export interface ConversationBroadcast {
  send(event: BroadcastEventInput): void;
  subscribe(listener: Listener): () => void;
  /** Stable per-tab id; useful for filtering out events the current tab sent. */
  readonly tabId: string;
  close(): void;
}

/**
 * Cache one BroadcastChannel per advisor across hook re-mounts. This
 * matters because React StrictMode mounts effects twice in dev — we
 * don't want to open + close the channel each time.
 */
const channelCache = new Map<string, BroadcastChannel | null>();

/**
 * Build (or reuse) a BroadcastChannel for the given advisor email.
 * Returns a no-op shim when BroadcastChannel isn't supported (server-
 * side rendering, private-browsing variants without the API).
 */
export function getConversationBroadcast(
  ownerEmail: string,
): ConversationBroadcast {
  const key = ownerEmail.toLowerCase();
  const tabId = ensureTabId();

  // Server-side or unsupported environment — return a no-op shim.
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return makeNoopBroadcast(tabId);
  }

  if (!channelCache.has(key)) {
    try {
      const channel = new BroadcastChannel(`advisorpilot.chat.${key}`);
      channelCache.set(key, channel);
    } catch (e) {
      console.warn("[chat:broadcast] BroadcastChannel unavailable:", e);
      channelCache.set(key, null);
    }
  }

  const channel = channelCache.get(key) ?? null;
  if (!channel) return makeNoopBroadcast(tabId);

  return {
    tabId,
    send(event) {
      try {
        channel.postMessage({ ...event, ts: Date.now() });
      } catch (e) {
        console.warn("[chat:broadcast] postMessage failed:", e);
      }
    },
    subscribe(listener) {
      const onMsg = (e: MessageEvent) => {
        if (!e.data || typeof e.data !== "object") return;
        listener(e.data as BroadcastEvent);
      };
      channel.addEventListener("message", onMsg);
      return () => channel.removeEventListener("message", onMsg);
    },
    close() {
      channel.close();
      channelCache.delete(key);
    },
  };
}

/**
 * No-op fallback when BroadcastChannel isn't available. Same shape so
 * callers don't have to branch.
 */
function makeNoopBroadcast(tabId: string): ConversationBroadcast {
  return {
    tabId,
    send: () => undefined,
    subscribe: () => () => undefined,
    close: () => undefined,
  };
}

/**
 * Stable per-tab id (lives in sessionStorage, NOT localStorage — we
 * want a fresh id per browser tab, not per machine). Falls back to an
 * in-memory uuid when sessionStorage is unavailable (SSR / quota).
 */
let cachedTabId: string | null = null;
const TAB_ID_KEY = "advisorpilot.chat.tabId";

function ensureTabId(): string {
  if (cachedTabId) return cachedTabId;
  if (typeof window === "undefined") return "ssr";
  try {
    const fromSession = window.sessionStorage.getItem(TAB_ID_KEY);
    if (fromSession) {
      cachedTabId = fromSession;
      return fromSession;
    }
    const fresh =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
    window.sessionStorage.setItem(TAB_ID_KEY, fresh);
    cachedTabId = fresh;
    return fresh;
  } catch {
    cachedTabId = Math.random().toString(36).slice(2, 10);
    return cachedTabId;
  }
}

"use client";

/**
 * Chat location context — tracks the advisor's CURRENT viewing context
 * (route + client + surface) so the chat widget can include it in every
 * system prompt without each page having to thread it down manually.
 *
 * Two information sources, in order of precedence:
 *
 *   1. **Manual override** via `useChatLocation().setClient({ id, name })`.
 *      The legacy single-page shell (`app/app/legacy-app-shell.tsx`) holds
 *      the active client in its own React state — when it changes, that
 *      shell calls setClient() so Nova always knows who's loaded.
 *
 *   2. **Auto-derived from `usePathname()`** — for CRM routes the active
 *      clientId lives in the URL (`/app/crm/c_a1b2/overview`), so we
 *      parse it. Surface + tab are derived the same way.
 *
 * The combination means: when the advisor is on a CRM route, Nova knows
 * the client by URL parsing; when they're in the legacy shell on /app
 * with a client loaded in state, the shell pushes that into the context.
 * Either way the chat widget reads ONE shape — `useChatLocation()` — and
 * doesn't care which source filled it.
 *
 * Design + rationale: docs/crm/60-chat-orchestrator.md §B.14.3.
 */

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ChatStreamClientContext } from "./orchestrator-client";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatLocationClient {
  /** Stable client id (matches the CRM URL slug). */
  id: string;
  /** Human-readable display name; surfaced in the widget header. */
  name: string;
}

export interface ChatLocationValue {
  /** Resolved context the orchestrator client should send with each turn. */
  context: ChatStreamClientContext;
  /** True when a specific client is in focus (CRM detail or legacy shell override). */
  hasClient: boolean;
  /** Display info for the in-focus client (for the widget header). */
  client: ChatLocationClient | null;
  /** Legacy-shell entry point — replaces the manual override. */
  setClient: (client: ChatLocationClient | null) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fallback value when ChatLocationProvider isn't mounted. Lets the chat
 * widget render outside the provider (defensive — though in practice the
 * provider is always mounted in `app/app/layout.tsx`).
 */
const DEFAULT_VALUE: ChatLocationValue = {
  context: { currentRoute: null, currentClientId: null },
  hasClient: false,
  client: null,
  setClient: () => {},
};

const ChatLocationCtx = createContext<ChatLocationValue>(DEFAULT_VALUE);

export function ChatLocationProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/app";
  const [override, setOverride] = useState<ChatLocationClient | null>(null);

  // Parse URL-derived hints. CRM routes look like:
  //   /app/crm/<clientId>/<tab>?...
  //   /app/crm/<clientId>
  //   /app/crm                       (roster — no client)
  //   /app/intake | /app/tasks | /app/reports | /app/settings
  //   /app                           (legacy shell)
  const urlDerived = useMemo(() => deriveFromPathname(pathname), [pathname]);

  // Manual override (legacy shell) wins over URL hints when both exist —
  // because in the legacy shell the URL is always /app but the advisor
  // may have a client loaded in shell state. Wrap in useMemo so the
  // outer useMemo's identity is stable when neither input changed.
  const resolvedClient = useMemo<ChatLocationClient | null>(
    () =>
      override ??
      (urlDerived.clientId
        ? { id: urlDerived.clientId, name: "Client" }
        : null),
    [override, urlDerived.clientId],
  );

  const setClient = useCallback((client: ChatLocationClient | null) => {
    setOverride(client);
  }, []);

  const value = useMemo<ChatLocationValue>(
    () => ({
      context: {
        currentRoute: pathname,
        currentClientId: resolvedClient?.id ?? null,
        surface: urlDerived.surface,
        tab: urlDerived.tab,
      },
      hasClient: !!resolvedClient,
      client: resolvedClient,
      setClient,
    }),
    [pathname, resolvedClient, urlDerived.surface, urlDerived.tab, setClient],
  );

  return <ChatLocationCtx.Provider value={value}>{children}</ChatLocationCtx.Provider>;
}

export function useChatLocation(): ChatLocationValue {
  return useContext(ChatLocationCtx);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal — pathname → { surface, tab, clientId }
// ─────────────────────────────────────────────────────────────────────────────

interface PathnameDerived {
  surface: string | null;
  tab: string | null;
  clientId: string | null;
}

const KNOWN_CRM_SURFACES = new Set([
  "intake",
  "crm",
  "tasks",
  "reports",
  "settings",
]);

function deriveFromPathname(pathname: string): PathnameDerived {
  if (!pathname.startsWith("/app")) {
    return { surface: null, tab: null, clientId: null };
  }

  // Strip `/app` prefix, split on `/`, drop empty leading segment.
  const after = pathname.slice("/app".length);
  const segments = after.split("/").filter(Boolean);

  if (segments.length === 0) {
    // /app — the legacy shell entry point.
    return { surface: "legacy", tab: null, clientId: null };
  }

  const surface = KNOWN_CRM_SURFACES.has(segments[0]) ? segments[0] : null;

  if (surface === "crm") {
    // /app/crm                       → roster, no client
    // /app/crm/<clientId>            → overview (default tab)
    // /app/crm/<clientId>/<tab>      → specific tab
    const clientId = segments[1] ?? null;
    const tab = segments[2] ?? (clientId ? "overview" : null);
    return { surface, tab, clientId };
  }

  // Other CRM surfaces don't have per-client URLs; surface only.
  return { surface, tab: segments[1] ?? null, clientId: null };
}

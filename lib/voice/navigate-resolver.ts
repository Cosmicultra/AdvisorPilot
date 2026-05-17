/**
 * Voice `navigate` tool implementation — resolves a destination +
 * optional client name into a router push.
 *
 * Lives outside the React component because:
 *   - the resolver needs to fetch /api/clients (async, off the main
 *     render loop)
 *   - it's pure with respect to the React tree — only side effect is
 *     the supplied router.push() callback
 *
 * Used by <ChatWidget />'s VoiceAppActions plumbing.
 */

import { advisorFetch } from "@/lib/advisor-fetch";
import type { VoiceNavDestination, VoiceNavigateResult } from "./tool-handlers";

interface ResolverDeps {
  /** Performs the actual navigation. Wraps next/navigation router.push. */
  pushRoute: (href: string) => void;
}

/**
 * Pretty client-name match cache. Persisted per call only — the
 * voice agent fetches the full roster each time so the snapshot is
 * always fresh. Roster fetches are already a single round-trip with
 * server-side filtering; the small cost beats stale results.
 */
async function fetchClients(): Promise<
  Array<{ id: string; firstName: string; lastName: string }>
> {
  const res = await advisorFetch("/api/clients?limit=200", { cache: "no-store" });
  if (!res.ok) return [];
  const body = (await res.json().catch(() => ({}))) as {
    clients?: Array<{ id?: string; firstName?: string; lastName?: string }>;
  };
  const list = body.clients ?? [];
  return list
    .filter((c) => typeof c.id === "string" && (c.firstName || c.lastName))
    .map((c) => ({
      id: c.id ?? "",
      firstName: c.firstName ?? "",
      lastName: c.lastName ?? "",
    }));
}

function matchClient(
  needle: string,
  clients: Array<{ id: string; firstName: string; lastName: string }>,
): Array<{ id: string; firstName: string; lastName: string }> {
  const n = needle.trim().toLowerCase();
  if (!n) return [];
  // Exact match first; falls back to substring.
  const exact = clients.filter(
    (c) =>
      c.firstName.toLowerCase() === n ||
      c.lastName.toLowerCase() === n ||
      `${c.firstName} ${c.lastName}`.toLowerCase() === n,
  );
  if (exact.length > 0) return exact;
  return clients.filter(
    (c) =>
      c.firstName.toLowerCase().includes(n) ||
      c.lastName.toLowerCase().includes(n),
  );
}

const STATIC_ROUTES: Record<Exclude<VoiceNavDestination, "client">, string> = {
  clients: "/app/crm",
  intake: "/app/intake",
  tasks: "/app/tasks",
  reports: "/app/reports",
  home: "/app",
};

/**
 * The handler the voice tool calls. Implements:
 *   - destination='clients' / 'intake' / 'tasks' / 'reports' / 'home'
 *     → router push to the matching CRM route
 *   - destination='client' with `clientName` → roster lookup, then
 *     either route to /app/crm/:id/overview (single match) or return
 *     the candidate list for voice disambiguation (multiple matches)
 */
export async function resolveVoiceNavigate(
  args: { destination: VoiceNavDestination; clientName?: string },
  deps: ResolverDeps,
): Promise<VoiceNavigateResult> {
  if (args.destination !== "client") {
    const href = STATIC_ROUTES[args.destination];
    deps.pushRoute(href);
    return { ok: true, opened: href };
  }

  if (!args.clientName) {
    return {
      error:
        "destination='client' requires `clientName` (e.g. 'Sarah Smith').",
    };
  }

  const clients = await fetchClients();
  if (clients.length === 0) {
    return {
      error:
        "Couldn't load the client roster (network or auth). Try again or check sign-in.",
    };
  }

  const matches = matchClient(args.clientName, clients);
  if (matches.length === 0) {
    return {
      matches: [],
      message: `No client matches "${args.clientName}".`,
    };
  }
  if (matches.length === 1) {
    const c = matches[0];
    const href = `/app/crm/${c.id}/overview`;
    deps.pushRoute(href);
    return {
      ok: true,
      opened: href,
      clientName: `${c.firstName} ${c.lastName}`.trim(),
    };
  }
  return {
    matches: matches.slice(0, 5),
    message: `Multiple matches for "${args.clientName}" — say a first or last name to disambiguate.`,
  };
}

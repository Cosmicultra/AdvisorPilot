"use client";

/**
 * Roster left pane — fetches /api/clients on mount, manages filter state
 * locally, renders the filter bar + list of <ClientRow />s.
 *
 * Phase 1 keeps things simple: ONE fetch on mount (no params), client-side
 * filter/sort/limit on the cached set. Acceptable for cohorts of <100
 * clients per advisor; revisit if N grows.
 *
 * Selection comes from the URL — clicking a row pushes /app/crm/[id], and
 * the layout's children prop renders the right pane. Selection highlight
 * is derived from `usePathname()` so back/forward navigation stays in sync.
 *
 * Spec: docs/crm/20-technical-specs.md §5.2.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { advisorFetch } from "@/lib/advisor-fetch";
import type { ClientRosterItem } from "@/lib/crm/types";
import { ClientRow } from "./client-row";
import {
  RosterFilterBar,
  type RosterFilters,
  type RosterSort,
} from "./roster-filter-bar";

type FetchState =
  | { status: "loading" }
  | { status: "ready"; items: ClientRosterItem[] }
  | { status: "unauthorized" }
  | { status: "error"; message: string };

const INITIAL_FILTERS: RosterFilters = {
  search: "",
  stage: null,
  sort: "review-due-asc",
};

export function RosterList() {
  const router = useRouter();
  const params = useParams<{ clientId?: string }>();
  const selectedId = params?.clientId ?? null;

  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [filters, setFilters] = useState<RosterFilters>(INITIAL_FILTERS);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    advisorFetch("/api/clients?limit=200", { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 401) {
          if (!cancelled) setState({ status: "unauthorized" });
          return null;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `Failed to load clients (${res.status})`);
        }
        return res.json();
      })
      .then((body) => {
        if (cancelled || body === null) return;
        setState({
          status: "ready",
          items: (body?.clients ?? []) as ClientRosterItem[],
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          message:
            err instanceof Error ? err.message : "Failed to load clients.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleItems = useMemo<ClientRosterItem[]>(() => {
    if (state.status !== "ready") return [];
    return applyClientSideFilters(state.items, filters);
  }, [state, filters]);

  const handleSelect = useCallback(
    (id: string) => {
      router.push(`/app/crm/${id}/overview`);
    },
    [router]
  );

  return (
    <aside
      aria-label="Client roster"
      // Responsive layout — three viewport tiers:
      //
      //   Mobile (< md / < 768px):
      //     Fixed horizontal strip pinned to the bottom of the viewport.
      //     The roster floats over the page; the CRM layout adds bottom
      //     padding to keep main content from hiding behind it.
      //
      //   Tablet / narrow desktop (md → lg / 768px – 1023px):
      //     In-flow 60px icon-only column — matches the primary AppRail's
      //     footprint so the chrome reads as a uniform pair of rails.
      //     RosterFilterBar hides at this width (no room for search).
      //
      //   Desktop (≥ lg / 1024px):
      //     Full 360px column with filter bar + rich rows (avatar, name,
      //     subtitle, AUM, stage). Original CRM Roster behavior.
      // Layout self-sizing:
      //   Mobile (< md):     full-width (consumer renders this inline as
      //                       the page's main content — see
      //                       /app/crm/page.tsx; there's no sidebar at this
      //                       width).
      //   Tablet (md → lg):  60px icon-only column.
      //   Desktop (lg+):     360px full labeled column.
      //
      // The desktop CRM layout (app/app/(crm)/crm/layout.tsx) wraps this
      // component in a `<div className="hidden md:flex">` so the
      // sidebar variant disappears on mobile. The mobile inline variant
      // bypasses that wrapper, so RosterList itself stays visible at
      // every width and just resizes.
      className="ap-roster-aside flex h-full w-full flex-shrink-0 flex-col md:w-[60px] lg:w-[360px]"
      style={{ backgroundColor: "#FFFFFF" }}
    >
      {/* Filter bar — visible by default. Hidden only inside the
          `.ap-roster-sidebar` wrapper at md→lg (icon column mode)
          via globals.css. Mobile inline (page) usage keeps the
          filter bar because the advisor needs search/sort on a
          full-width page render. */}
      <div className="roster-filter-bar-wrapper">
        <RosterFilterBar
          filters={filters}
          onChange={setFilters}
          resultCount={visibleItems.length}
        />
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto">
        {state.status === "loading" ? (
          <RosterStatus message="Loading clients…" />
        ) : state.status === "unauthorized" ? (
          <RosterUnauthorized />
        ) : state.status === "error" ? (
          <RosterStatus message={state.message} tone="error" />
        ) : visibleItems.length === 0 ? (
          <RosterEmpty hasFilters={hasActiveFilters(filters)} totalCount={state.items.length} />
        ) : (
          visibleItems.map((item) => (
            <ClientRow
              key={item.id}
              item={item}
              selected={item.id === selectedId}
              onClick={() => handleSelect(item.id)}
            />
          ))
        )}
      </div>

    </aside>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function applyClientSideFilters(
  items: ClientRosterItem[],
  filters: RosterFilters
): ClientRosterItem[] {
  const search = filters.search.trim().toLowerCase();
  const filtered = items.filter((item) => {
    if (search) {
      const haystack = [item.firstName, item.lastName, item.householdLabel]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (filters.stage && item.stage !== filters.stage) return false;
    return true;
  });
  return sortItems(filtered, filters.sort);
}

function sortItems(items: ClientRosterItem[], sort: RosterSort): ClientRosterItem[] {
  const cloned = [...items];
  switch (sort) {
    case "review-due-asc":
      cloned.sort((a, b) => compareNullableDateAsc(a.reviewDueAt, b.reviewDueAt));
      break;
    case "aum-desc":
      cloned.sort((a, b) => compareNullableNumberDesc(a.aum, b.aum));
      break;
    case "name-asc":
      cloned.sort((a, b) => {
        const lastCmp = a.lastName.localeCompare(b.lastName);
        if (lastCmp !== 0) return lastCmp;
        return a.firstName.localeCompare(b.firstName);
      });
      break;
    case "last-contact-desc":
      cloned.sort((a, b) =>
        compareNullableDateDesc(a.lastContactedAt, b.lastContactedAt)
      );
      break;
  }
  return cloned;
}

function compareNullableDateAsc(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
  if (Number.isNaN(ta)) return 1;
  if (Number.isNaN(tb)) return -1;
  return ta - tb;
}

function compareNullableDateDesc(a: string | null, b: string | null): number {
  return -compareNullableDateAsc(a, b);
}

function compareNullableNumberDesc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

function hasActiveFilters(f: RosterFilters): boolean {
  return f.search.trim().length > 0 || f.stage !== null;
}

function RosterUnauthorized() {
  return (
    <div className="flex flex-col gap-3 px-4 py-8 text-center">
      <p className="text-[13px] font-semibold" style={{ color: "var(--ap-navy)" }}>
        Your session has expired
      </p>
      <p className="text-[12px] leading-snug" style={{ color: "var(--ap-gray)" }}>
        Sign in again to load your client roster.
      </p>
      <a
        href="/login"
        className="self-center text-[12.5px] font-medium underline-offset-2 hover:underline"
        style={{ color: "var(--ap-royal)" }}
      >
        Go to sign in →
      </a>
    </div>
  );
}

function RosterStatus({
  message,
  tone = "info",
}: {
  message: string;
  tone?: "info" | "error";
}) {
  return (
    <p
      className="px-4 py-6 text-[12.5px]"
      style={{ color: tone === "error" ? "#9B1C1C" : "var(--ap-gray)" }}
    >
      {message}
    </p>
  );
}

function RosterEmpty({
  hasFilters,
  totalCount,
}: {
  hasFilters: boolean;
  totalCount: number;
}) {
  if (totalCount === 0) {
    // R5b mitigation per docs/crm/40-path-forward.md §4.
    return (
      <div className="flex flex-col gap-3 px-4 py-8 text-center">
        <p
          className="text-[13px] font-semibold"
          style={{ color: "var(--ap-navy)" }}
        >
          No saved clients yet
        </p>
        <p
          className="text-[12px] leading-snug"
          style={{ color: "var(--ap-gray)" }}
        >
          Start your first client in <strong>Intake</strong> — they'll show up
          here once you save the profile.
        </p>
        <a
          href="/app/intake"
          className="self-center text-[12.5px] font-medium underline-offset-2 hover:underline"
          style={{ color: "var(--ap-royal)" }}
        >
          Open Intake →
        </a>
      </div>
    );
  }

  if (hasFilters) {
    return (
      <p
        className="px-4 py-6 text-[12.5px]"
        style={{ color: "var(--ap-gray)" }}
      >
        No clients match these filters.
      </p>
    );
  }

  return (
    <p
      className="px-4 py-6 text-[12.5px]"
      style={{ color: "var(--ap-gray)" }}
    >
      No clients to show.
    </p>
  );
}

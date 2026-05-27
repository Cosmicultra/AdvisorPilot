import { NextResponse } from "next/server";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import { toRosterItem, type ClientRow } from "@/lib/crm/clients-mapper";
import {
  getCrmSupabaseAdmin,
  missingCrmSupabaseEnv,
} from "@/lib/crm/supabase-admin";
import type { ClientRosterItem, ClientStage } from "@/lib/crm/types";

/**
 * GET /api/clients?search=&stage=&tag=&staleDays=&sort=&limit=&offset=
 *
 * Returns the Roster's left-pane list — every client visible to the signed-in
 * advisor, with TS-side filtering / sorting / pagination on top of the
 * visibility resolver.
 *
 * Response shape (per docs/crm/20-technical-specs.md §2.4):
 *   { clients: ClientRosterItem[], total: number, hasMore: boolean }
 *
 * Visibility: calls public.list_visible_clients(viewer_email) which wraps
 * clients_visible_to() — the SAME SQL function the RLS policies use. Single
 * source of truth (eliminates risk O5).
 *
 * Filters (all optional; combine with AND semantics):
 *   - search    : case-insensitive match against firstName + lastName + householdLabel
 *   - stage     : exact match against the resolved (persisted-or-computed) stage
 *   - tag       : comma-separated; matches ANY tag (OR within the list)
 *   - staleDays : "no contact in N+ days" — last_contacted_at older than N days
 *
 * Sort (defaults to review-due-asc):
 *   - review-due-asc  : reviewDueAt ascending; nulls last
 *   - aum-desc        : aum descending; nulls last
 *   - name-asc        : lastName, firstName ascending
 *   - last-contact-desc: lastContactedAt descending; nulls last
 *
 * Pagination: limit + offset (default limit 50, max 200).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const VALID_STAGES: ClientStage[] = [
  "Lead",
  "Prospect",
  "Onboarding",
  "Engaged",
  "Review due",
  "Upcoming",
  "Stable",
  "At risk",
];

type SortKey =
  | "review-due-asc"
  | "aum-desc"
  | "name-asc"
  | "last-contact-desc";

const VALID_SORTS: SortKey[] = [
  "review-due-asc",
  "aum-desc",
  "name-asc",
  "last-contact-desc",
];

interface RosterFilters {
  search: string | null;
  stage: ClientStage | null;
  tags: string[];
  staleDays: number | null;
  sort: SortKey;
  limit: number;
  offset: number;
}

export const GET = async (req: Request) => {
  try {
    if (missingCrmSupabaseEnv()) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 500 }
      );
    }

    const identity = await resolveAdvisorIdentity(req);
    if (!identity) {
      return NextResponse.json(
        { error: "Sign in to load the client roster." },
        { status: 401 }
      );
    }

    const filters = parseFilters(new URL(req.url).searchParams);

    const supabase = getCrmSupabaseAdmin();
    const startedAt = Date.now();
    let data: ClientRow[] | null = null;
    let error: { message: string } | null = null;

    const rosterRpc = await supabase.rpc("list_visible_clients_roster", {
      viewer_email: identity.email,
    });
    if (
      rosterRpc.error &&
      (rosterRpc.error.code === "PGRST202" ||
        /list_visible_clients_roster/i.test(rosterRpc.error.message))
    ) {
      const fallback = await supabase.rpc("list_visible_clients", {
        viewer_email: identity.email,
      });
      data = (fallback.data ?? null) as ClientRow[] | null;
      error = fallback.error;
    } else {
      data = (rosterRpc.data ?? null) as ClientRow[] | null;
      error = rosterRpc.error;
    }
    const fetchMs = Date.now() - startedAt;

    if (error) {
      console.error("[crm:api] route=/api/clients rpc-error", error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const rawRows = (data ?? []) as ClientRow[];
    const allItems: ClientRosterItem[] = rawRows.map((row) => toRosterItem(row));
    const filtered = applyFilters(allItems, filters);
    const sorted = applySort(filtered, filters.sort);
    const paged = sorted.slice(filters.offset, filters.offset + filters.limit);

    console.info(
      `[crm:api] route=/api/clients status=200 fetchMs=${fetchMs} rows=${allItems.length} filteredRows=${filtered.length} returned=${paged.length}`
    );

    return NextResponse.json({
      clients: paged,
      total: filtered.length,
      hasMore: filters.offset + paged.length < filtered.length,
    });
  } catch (err: unknown) {
    console.error("[crm:api] route=/api/clients error", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to load client roster.",
      },
      { status: 500 }
    );
  }
};

// ─── Filter / sort helpers ─────────────────────────────────────────────────

function parseFilters(params: URLSearchParams): RosterFilters {
  const search = trimOrNull(params.get("search"));

  const rawStage = trimOrNull(params.get("stage"));
  const stage = rawStage && VALID_STAGES.includes(rawStage as ClientStage)
    ? (rawStage as ClientStage)
    : null;

  const tags = (params.get("tag") || "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const staleDaysRaw = params.get("staleDays");
  const staleDays = staleDaysRaw && /^\d+$/.test(staleDaysRaw)
    ? Number(staleDaysRaw)
    : null;

  const rawSort = trimOrNull(params.get("sort"));
  const sort: SortKey = rawSort && VALID_SORTS.includes(rawSort as SortKey)
    ? (rawSort as SortKey)
    : "review-due-asc";

  const limitRaw = params.get("limit");
  const limit = clamp(
    limitRaw && /^\d+$/.test(limitRaw) ? Number(limitRaw) : DEFAULT_LIMIT,
    1,
    MAX_LIMIT
  );

  const offsetRaw = params.get("offset");
  const offset = Math.max(
    0,
    offsetRaw && /^\d+$/.test(offsetRaw) ? Number(offsetRaw) : 0
  );

  return { search, stage, tags, staleDays, sort, limit, offset };
}

function applyFilters(items: ClientRosterItem[], f: RosterFilters): ClientRosterItem[] {
  const now = Date.now();
  const staleCutoff = f.staleDays !== null
    ? now - f.staleDays * 24 * 60 * 60 * 1000
    : null;
  const search = f.search?.toLowerCase() ?? null;

  return items.filter((item) => {
    if (search) {
      const haystack = [
        item.firstName,
        item.lastName,
        item.householdLabel,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    if (f.stage && item.stage !== f.stage) return false;

    if (f.tags.length > 0) {
      const has = f.tags.some((t) => item.tags.includes(t));
      if (!has) return false;
    }

    if (staleCutoff !== null) {
      if (!item.lastContactedAt) return true; // never-contacted is always stale
      const ts = Date.parse(item.lastContactedAt);
      if (Number.isNaN(ts) || ts >= staleCutoff) return false;
    }

    return true;
  });
}

function applySort(items: ClientRosterItem[], sort: SortKey): ClientRosterItem[] {
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function trimOrNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

import { NextResponse } from "next/server";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import { ensurePersonalOrg } from "@/lib/crm/ensure-personal-org";
import {
  isReportSource,
  isReportStatus,
  toReport,
  type ReportRow,
} from "@/lib/crm/report-mapper";
import {
  getCrmSupabaseAdmin,
  missingCrmSupabaseEnv,
} from "@/lib/crm/supabase-admin";
import { writeActivityLog } from "@/lib/crm/activity-writer";
import type { Report, ReportStatus, Visibility } from "@/lib/crm/types";

/**
 * /api/reports — collection endpoint.
 *
 *   GET    list visible reports (filter by clientId / status / source /
 *          search / since; sort by created-desc | created-asc | title-asc)
 *   POST   create a new draft report (advisor-authored markdown).
 *
 * Visibility on read: list_visible_reports SQL function.
 * Visibility on write (when clientId set): clients_visible_to gate.
 *
 * Pairs with /api/reports/[id] (single-row read/PATCH/DELETE).
 * Same shape conventions as /api/tasks + /api/notes.
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.21a, docs/crm/70-orchestrator-tools.md §7.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_TITLE_LENGTH = 250;
const MAX_CONTENT_LENGTH = 200_000;

const VALID_VISIBILITY: Visibility[] = ["private", "shared", "organization"];

type SortKey = "created_desc" | "created_asc" | "title_asc" | "updated_desc";

// ─── GET ──────────────────────────────────────────────────────────────────

export const GET = async (req: Request) => {
  try {
    if (missingCrmSupabaseEnv()) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 500 },
      );
    }

    const identity = await resolveAdvisorIdentity(req);
    if (!identity) {
      return NextResponse.json({ error: "Sign in to load reports." }, { status: 401 });
    }

    const params = new URL(req.url).searchParams;
    const clientId = trimOrNull(params.get("clientId"));
    if (clientId !== null && !isUuid(clientId)) {
      return NextResponse.json({ error: "Invalid clientId." }, { status: 400 });
    }

    const statusFilter = parseStatusFilter(params.get("status"));
    if (statusFilter.error) {
      return NextResponse.json({ error: statusFilter.error }, { status: 400 });
    }

    const sourceFilter = trimOrNull(params.get("source"));
    if (sourceFilter !== null && !isReportSource(sourceFilter)) {
      return NextResponse.json(
        { error: "source must be ai_generated|advisor_authored|imported." },
        { status: 400 },
      );
    }

    const search = trimOrNull(params.get("search"));
    const since = trimOrNull(params.get("since"));
    if (since !== null && Number.isNaN(Date.parse(since))) {
      return NextResponse.json({ error: "since must be an ISO timestamp." }, { status: 400 });
    }

    const sort = parseSort(params.get("sort"));
    const limit = clamp(numOr(params.get("limit"), DEFAULT_LIMIT), 1, MAX_LIMIT);
    const offset = Math.max(0, numOr(params.get("offset"), 0));

    const supabase = getCrmSupabaseAdmin();
    const startedAt = Date.now();
    const { data, error } = await supabase.rpc("list_visible_reports", {
      viewer_email: identity.email,
    });
    const fetchMs = Date.now() - startedAt;
    if (error) {
      console.error("[crm:api] route=/api/reports rpc-error", error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const all = ((data ?? []) as ReportRow[]).map(toReport);
    const filtered = applyFilters(all, {
      clientId,
      statuses: statusFilter.value,
      source: sourceFilter,
      search,
      since,
    });
    const sorted = [...filtered].sort(makeSorter(sort));
    const paged = sorted.slice(offset, offset + limit);

    console.info(
      `[crm:api] route=/api/reports status=200 fetchMs=${fetchMs} rows=${all.length} returned=${paged.length}`,
    );

    return NextResponse.json({
      reports: paged,
      total: filtered.length,
      hasMore: offset + paged.length < filtered.length,
    });
  } catch (err: unknown) {
    console.error("[crm:api] route=/api/reports GET error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load reports." },
      { status: 500 },
    );
  }
};

// ─── POST ─────────────────────────────────────────────────────────────────

export const POST = async (req: Request) => {
  try {
    if (missingCrmSupabaseEnv()) {
      return NextResponse.json(
        { error: "Missing Supabase environment variables." },
        { status: 500 },
      );
    }

    const identity = await resolveAdvisorIdentity(req);
    if (!identity) {
      return NextResponse.json({ error: "Sign in to create a report." }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    }

    const validation = validateNewReportBody(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const supabase = getCrmSupabaseAdmin();

    // Resolve org_id: inherit from client when clientId set; else personal org.
    let orgId: string | null = null;
    if (validation.clientId) {
      const vis = await supabase.rpc("clients_visible_to", {
        viewer_email: identity.email,
        client_id: validation.clientId,
      });
      if (vis.error) {
        return NextResponse.json({ error: vis.error.message }, { status: 400 });
      }
      if (vis.data !== true) {
        return NextResponse.json({ error: "Client not found." }, { status: 404 });
      }
      const { data: clientRow } = await supabase
        .from("advisorpilot_clients")
        .select("org_id")
        .eq("id", validation.clientId)
        .maybeSingle();
      orgId = (clientRow?.org_id as string | undefined) ?? null;
    }
    if (!orgId) {
      orgId = await ensurePersonalOrg(identity.email);
    }

    const insertPayload = {
      owner_email: identity.email,
      owner_user_id: identity.userId,
      client_id: validation.clientId,
      org_id: orgId,
      visibility: validation.visibility,
      title: validation.title,
      content: validation.content,
      status: validation.status,
      tags: validation.tags,
      icon: validation.icon,
      color: validation.color ?? null,
      // POST defaults source = 'advisor_authored' (the chat path uses
      // 'ai_generated' via the generate_report_content tool directly).
      source: "advisor_authored",
    };

    const { data: inserted, error: insertError } = await supabase
      .from("advisorpilot_reports")
      .insert(insertPayload)
      .select("*")
      .single();

    if (insertError || !inserted) {
      return NextResponse.json(
        { error: insertError?.message ?? "Failed to create report." },
        { status: 400 },
      );
    }
    const report = toReport(inserted as ReportRow);

    // Activity log — best-effort.
    await writeActivityLog(supabase, {
      ownerEmail: identity.email,
      ownerUserId: identity.userId,
      clientId: report.clientId,
      type: "document",
      title: `Report created: ${report.title}`,
      actorEmail: identity.email,
      metadata: {
        report_id: report.id,
        action: "created",
        source: report.source,
        status: report.status,
        created_by: "api",
      },
    });

    console.info(`[crm:api] route=/api/reports status=201 report_id=${report.id}`);
    return NextResponse.json({ report }, { status: 201 });
  } catch (err: unknown) {
    console.error("[crm:api] route=/api/reports POST error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create report." },
      { status: 500 },
    );
  }
};

// ─── Filters / sort ───────────────────────────────────────────────────────

interface ReportFilters {
  clientId: string | null;
  /** Empty array = no status filter (return all). */
  statuses: ReportStatus[];
  source: string | null;
  search: string | null;
  since: string | null;
}

function applyFilters(reports: Report[], f: ReportFilters): Report[] {
  const sinceMs = f.since ? Date.parse(f.since) : null;
  const lowerSearch = f.search ? f.search.toLowerCase() : null;
  return reports.filter((r) => {
    if (f.clientId !== null && r.clientId !== f.clientId) return false;
    if (f.statuses.length > 0 && !f.statuses.includes(r.status)) return false;
    if (f.source && r.source !== f.source) return false;
    if (sinceMs !== null) {
      const created = Date.parse(r.createdAt);
      if (Number.isNaN(created) || created < sinceMs) return false;
    }
    if (lowerSearch && !r.title.toLowerCase().includes(lowerSearch)) return false;
    return true;
  });
}

function makeSorter(sort: SortKey): (a: Report, b: Report) => number {
  switch (sort) {
    case "created_asc":
      return (a, b) => a.createdAt.localeCompare(b.createdAt);
    case "updated_desc":
      return (a, b) => b.updatedAt.localeCompare(a.updatedAt);
    case "title_asc":
      return (a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
    case "created_desc":
    default:
      return (a, b) => b.createdAt.localeCompare(a.createdAt);
  }
}

/**
 * `status` param:
 *   - Omitted → DEFAULT excludes archived (show draft + published).
 *   - `archived` → only archived.
 *   - `all` → no status filter.
 *   - `draft` / `published` → single-status.
 *   - Comma-list (`draft,published`) → multi-status.
 *
 * Returns either `{ value }` (allowed list — empty = "all") or `{ error }`.
 */
function parseStatusFilter(raw: string | null): { value: ReportStatus[]; error?: string } {
  if (raw === null) {
    // Default: hide archived from the main list.
    return { value: ["draft", "published"] };
  }
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === "" || trimmed === "all") return { value: [] };
  const parts = trimmed
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  for (const part of parts) {
    if (!isReportStatus(part)) {
      return { value: [], error: `Unknown status '${part}'. Allowed: draft|published|archived|all.` };
    }
  }
  return { value: parts as ReportStatus[] };
}

function parseSort(raw: string | null): SortKey {
  switch (raw) {
    case "created_asc":
    case "updated_desc":
    case "title_asc":
    case "created_desc":
      return raw;
    default:
      return "created_desc";
  }
}

// ─── POST validation ──────────────────────────────────────────────────────

interface NewReportValidation {
  ok: true;
  clientId: string | null;
  title: string;
  content: string;
  status: ReportStatus;
  visibility: Visibility;
  tags: string[];
  icon: string;
  color: string | null;
}

interface NewReportValidationError {
  ok: false;
  error: string;
}

function validateNewReportBody(
  body: unknown,
): NewReportValidation | NewReportValidationError {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid body." };
  const b = body as Record<string, unknown>;

  if (typeof b.title !== "string" || !b.title.trim()) {
    return { ok: false, error: "title is required." };
  }
  const title = b.title.trim();
  if (title.length > MAX_TITLE_LENGTH) {
    return { ok: false, error: `title must be ${MAX_TITLE_LENGTH} characters or fewer.` };
  }

  if (typeof b.content !== "string") {
    return { ok: false, error: "content (markdown body) is required." };
  }
  if (b.content.length > MAX_CONTENT_LENGTH) {
    return { ok: false, error: `content must be ${MAX_CONTENT_LENGTH} characters or fewer.` };
  }
  const content = b.content;

  let clientId: string | null = null;
  if (b.clientId !== undefined && b.clientId !== null && b.clientId !== "") {
    if (typeof b.clientId !== "string" || !isUuid(b.clientId)) {
      return { ok: false, error: "clientId must be a UUID or null." };
    }
    clientId = b.clientId;
  }

  let status: ReportStatus = "draft";
  if (b.status !== undefined && b.status !== null) {
    if (!isReportStatus(b.status)) {
      return { ok: false, error: "status must be draft|published|archived." };
    }
    status = b.status;
  }

  let visibility: Visibility = "private";
  if (b.visibility !== undefined && b.visibility !== null) {
    if (
      typeof b.visibility !== "string" ||
      !VALID_VISIBILITY.includes(b.visibility as Visibility)
    ) {
      return {
        ok: false,
        error: `visibility must be one of: ${VALID_VISIBILITY.join(", ")}.`,
      };
    }
    visibility = b.visibility as Visibility;
  }

  const tags = Array.isArray(b.tags)
    ? b.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : [];

  const icon = typeof b.icon === "string" && b.icon.trim() ? b.icon.trim() : "📄";

  let color: string | null = null;
  if (b.color !== undefined && b.color !== null) {
    if (typeof b.color !== "string") {
      return { ok: false, error: "color must be a string or null." };
    }
    color = b.color.trim() || null;
  }

  return { ok: true, clientId, title, content, status, visibility, tags, icon, color };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function trimOrNull(value: string | null): string | null {
  if (value === null) return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function numOr(value: string | null, fallback: number): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  return Number(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

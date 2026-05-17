/**
 * `generate_report_content` — the markdown-author tool.
 *
 * Risk tier: T2 (creates a draft report; no preview/confirm). The advisor
 * can review and use `manage_report.update` or `manage_report.delete`
 * afterwards. The tool always persists with `status: 'draft'` —
 * publishing is an explicit follow-up action.
 *
 * Behavior:
 *   1. Validate inputs (title, reportType, prompt mandatory; optional
 *      clientId / sourceData / sections / audience / tags).
 *   2. If clientId is provided, verify visibility + fetch a minimal
 *      client snapshot (name, intake summary line, total AUM).
 *   3. Build the report-author system prompt via
 *      `buildReportAuthorPrompt()` and call `streamChat()` with NO tools
 *      and a derived sessionId (so the OpenAI/xAI Responses-API cache
 *      for the outer chat session isn't polluted).
 *   4. Drain the AsyncGenerator, concatenate all delta chunks.
 *   5. Insert the resulting markdown into `advisorpilot_reports` (same
 *      shape as manage_report.create) and write an activity-log entry.
 *   6. Return { reportId, title, status, contentLength, contentPreview }
 *      so the model can confirm in its follow-up text.
 *
 * Why a separate tool (not manage_report.create_with_ai)?
 *   - `manage_report.create` already handles persistence cleanly; this
 *     tool focuses on COMPOSITION. Keeping them split means each one's
 *     args + validation stay small and the model can choose either path
 *     (compose-then-create vs. paste-then-create).
 *   - The compose step needs an internal LLM call. Embedding that inside
 *     `manage_report` would couple a write tool to the LLM stack — this
 *     way `manage_report` stays a pure DB-write tool.
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.22.
 */

import { writeActivityLog } from "@/lib/crm/activity-writer";
import { ensurePersonalOrg } from "@/lib/crm/ensure-personal-org";
import { toReport, type ReportRow } from "@/lib/crm/report-mapper";
import type { Report, Visibility } from "@/lib/crm/types";
import { streamChat } from "../stream-chat";
import {
  buildReportAuthorPrompt,
  isReportType,
  REPORT_TYPES,
  type ReportType,
} from "../report-author-prompt";
import { fetchVisibleClientSnapshot } from "./run-helpers";
import { isUuid } from "./query-crm-helpers";
import type { ChatTool, ChatToolContext, ChatToolHandlerResult } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Caps
// ─────────────────────────────────────────────────────────────────────────────

const MAX_TITLE_LENGTH = 250;
/**
 * Max characters of advisor INSTRUCTIONS accepted in `prompt`. Bumped
 * from 8K → 50K after a real failure where the LLM dumped the entire
 * already-composed showcase markdown (every chart type, every mermaid
 * diagram, etc.) into `prompt` and tripped the cap. 50K is generous
 * enough that any reasonable brief fits, and small enough that we
 * still bound author-prompt cost. If we ever see a legitimate
 * instruction set larger than 50K we'll bump again — but realistically
 * anything larger is the model misusing the tool (it should be
 * calling `manage_report.create` with raw content instead).
 */
const MAX_PROMPT_LENGTH = 50_000;
/** Max characters of sourceData JSON we send to the model. Bounds prompt cost. */
const MAX_SOURCE_DATA_BYTES = 60_000;
/** Max sections the advisor can pre-specify as outline hints. */
const MAX_OUTLINE_SECTIONS = 12;
/** Max characters of the generated report. Matches manage_report content cap. */
const MAX_CONTENT_LENGTH = 200_000;

const VALID_VISIBILITY: Visibility[] = ["private", "shared", "organization"];

// ─────────────────────────────────────────────────────────────────────────────
// Tool surface
// ─────────────────────────────────────────────────────────────────────────────

const PARAMETERS = {
  type: "object" as const,
  properties: {
    title: {
      type: "string",
      description:
        "Report title. Becomes the H1 + the advisor-facing label in the Reports list. Max 250 chars. Required.",
    },
    reportType: {
      type: "string",
      enum: [...REPORT_TYPES],
      description:
        "Category — drives tone and standard sections. Required. Use `general` if none of the specific categories fit.",
    },
    prompt: {
      type: "string",
      description:
        "BRIEF authoring instructions for the writer model — think one to a few paragraphs telling it what to cover, focus areas, key talking points, conclusions to reach. NOT the finished markdown content; the author model writes that based on these instructions. If you already have the full markdown drafted (paste-in scenarios, showcase reports, imported content, etc.) use `manage_report.create` with `content` instead — it skips this LLM call entirely and accepts up to 200,000 chars of raw markdown. Max 50,000 chars.",
    },
    clientId: {
      type: "string",
      description:
        "UUID of the parent client. Optional — pass null/omit for a standalone report unlinked from any specific client. Visibility-checked when set; tool fails if the advisor can't see this client.",
    },
    sections: {
      type: "array",
      items: { type: "string" },
      description:
        "Optional outline hints — section titles in order. The model uses them as H2 headings when present, otherwise it picks its own structure. Max 12.",
    },
    audience: {
      type: "string",
      description:
        "Optional target audience descriptor (e.g. 'the client', 'internal review', 'CPA'). Influences tone.",
    },
    sourceData: {
      type: "object",
      description:
        "Structured data the model has already gathered via `query_crm` / `compute` / `run_analysis` etc. Will be JSON-serialized into the author prompt and is the AUTHORITATIVE source for any numbers in the report. Max ~60 KB serialized — pre-aggregate beyond that.",
    },
    tags: {
      type: "array",
      items: { type: "string" },
      description: "Free-form tag list applied to the saved report.",
    },
    visibility: {
      type: "string",
      enum: ["private", "shared", "organization"],
      description: "Defaults to 'private'. Use 'organization' to share with the advisor's org.",
    },
    icon: {
      type: "string",
      description: "Emoji icon (e.g. '📈'). Defaults to '📄'.",
    },
  },
  required: ["title", "reportType", "prompt"],
};

export const generateReportContentTool: ChatTool = {
  name: "generate_report_content",
  description:
    "Compose a polished markdown report from a BRIEF and save it as a DRAFT in the Reports library. An internal author LLM does the actual writing — your job here is to describe what to produce in `prompt` (a paragraph or two of instructions), not to paste the finished markdown. The author returns rich markdown including GFM tables and embedded Chart.js / ECharts / Mermaid fenced blocks (everything renders automatically in the viewer). Use this AFTER gathering source data via `query_crm` / `compute` / `run_analysis` — pass the gathered data via `sourceData` so numbers cited are correct. If you ALREADY have the finished markdown content (paste-in, import, showcase reports, programmatically composed content), skip this tool and call `manage_report.create` with the raw markdown in `content` instead — that path accepts up to 200,000 chars and doesn't invoke a second LLM. The advisor can review the draft and call `manage_report.update` (e.g. with `status: 'published'`) or `manage_report.delete` afterwards. T2 — no confirmation required; creates a draft.",
  parameters: PARAMETERS,
  handler: handleGenerateReportContent,
};

// ─────────────────────────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────────────────────────

async function handleGenerateReportContent(
  args: Record<string, unknown>,
  ctx: ChatToolContext,
): Promise<ChatToolHandlerResult> {
  const v = validateArgs(args);
  if (!v.ok) return { error: v.error };

  try {
    // 1. Optionally fetch the client snapshot for context grounding.
    let clientBlock: ClientBlock | undefined;
    let orgId: string | null = null;
    if (v.clientId) {
      const snap = await fetchVisibleClientSnapshot(ctx.supabase, ctx.advisorEmail, v.clientId);
      if (!snap) return { error: "Client not found." };
      const intakeName = extractClientDisplayName(snap.intake) ?? "Client";
      clientBlock = {
        name: intakeName,
        totalValue: snap.totalValue,
        summary: extractIntakeSummary(snap.intake) ?? undefined,
      };
      orgId = await fetchClientOrgId(ctx, v.clientId);
    }
    if (!orgId) {
      orgId = await ensurePersonalOrg(ctx.advisorEmail);
    }

    // 2. Compose the report via the report-author LLM call.
    const generatedAt = new Date().toISOString();
    const { systemPrompt, userMessage } = buildReportAuthorPrompt({
      title: v.title,
      reportType: v.reportType,
      prompt: v.prompt,
      sections: v.sections,
      audience: v.audience,
      client: clientBlock,
      sourceData: v.sourceData,
      generatedAt,
      advisorName: undefined,
      firmName: undefined,
    });

    const content = await runAuthorAndCollect({
      systemPrompt,
      userMessage,
      ctx,
      // Bridge each author delta into the chat-runner's per-call SSE
      // sink so the chat UI renders the report markdown LIVE while
      // the author is writing it.
      onDelta: (deltaText) => ctx.emitPartial({ deltaText }),
    });

    if (!content.trim()) {
      return { error: "Report author returned empty content." };
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      return {
        error: `Generated content (${content.length} chars) exceeded the ${MAX_CONTENT_LENGTH}-char cap. Try splitting the report or reducing sourceData.`,
      };
    }

    // 3. Persist (same insert shape as manage_report.create).
    const insertPayload: Record<string, unknown> = {
      owner_email: ctx.advisorEmail,
      owner_user_id: null,
      client_id: v.clientId,
      org_id: orgId,
      visibility: v.visibility,
      title: v.title,
      content,
      status: "draft",
      tags: v.tags,
      icon: v.icon,
      source: "ai_generated",
      generated_in_conversation_id: ctx.conversationId,
    };

    const { data: inserted, error: insertError } = await ctx.supabase
      .from("advisorpilot_reports")
      .insert(insertPayload)
      .select("*")
      .single();
    if (insertError || !inserted) {
      return { error: insertError?.message ?? "Failed to save generated report." };
    }
    const report: Report = toReport(inserted as ReportRow);

    // 4. Activity log so the report surfaces on the client's Timeline.
    await writeActivityLog(ctx.supabase, {
      ownerEmail: ctx.advisorEmail,
      ownerUserId: null,
      clientId: report.clientId,
      type: "document",
      title: `Report drafted: ${report.title}`,
      actorEmail: ctx.advisorEmail,
      metadata: {
        report_id: report.id,
        action: "ai_generated",
        report_type: v.reportType,
        content_length: content.length,
        created_by: "generate_report_content",
      },
    });

    return {
      result: {
        success: true,
        reportId: report.id,
        title: report.title,
        status: report.status,
        contentLength: content.length,
        contentPreview: content.slice(0, 240),
      },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

interface ValidatedArgs {
  ok: true;
  title: string;
  reportType: ReportType;
  prompt: string;
  clientId: string | null;
  sections: string[] | undefined;
  audience: string | undefined;
  sourceData: unknown | undefined;
  tags: string[];
  visibility: Visibility;
  icon: string;
}
interface ValidationError {
  ok: false;
  error: string;
}

function validateArgs(args: Record<string, unknown>): ValidatedArgs | ValidationError {
  if (typeof args.title !== "string" || !args.title.trim()) {
    return { ok: false, error: "`title` is required." };
  }
  const title = args.title.trim();
  if (title.length > MAX_TITLE_LENGTH) {
    return { ok: false, error: `\`title\` must be ${MAX_TITLE_LENGTH} characters or fewer.` };
  }

  if (!isReportType(args.reportType)) {
    return {
      ok: false,
      error: `\`reportType\` must be one of: ${REPORT_TYPES.join(", ")}.`,
    };
  }
  const reportType: ReportType = args.reportType;

  if (typeof args.prompt !== "string" || !args.prompt.trim()) {
    return { ok: false, error: "`prompt` is required (advisor's authoring instructions)." };
  }
  if (args.prompt.length > MAX_PROMPT_LENGTH) {
    return {
      ok: false,
      error:
        `\`prompt\` must be ${MAX_PROMPT_LENGTH} characters or fewer. ` +
        `(You sent ${args.prompt.length}.) The \`prompt\` field is for ` +
        `BRIEF authoring instructions (think one paragraph telling a ` +
        `writer what to produce). If you already have the finished ` +
        `markdown content, use \`manage_report.create\` with the ` +
        `\`content\` field instead — that path accepts up to 200,000 ` +
        `characters of raw markdown and skips the author LLM call.`,
    };
  }

  let clientId: string | null = null;
  if (args.clientId !== undefined && args.clientId !== null) {
    if (typeof args.clientId !== "string" || !isUuid(args.clientId.trim())) {
      return { ok: false, error: "`clientId` must be a UUID or null/omitted." };
    }
    clientId = args.clientId.trim();
  }

  let sections: string[] | undefined;
  if (args.sections !== undefined) {
    if (!Array.isArray(args.sections)) {
      return { ok: false, error: "`sections` must be an array of strings." };
    }
    sections = args.sections
      .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      .map((s) => s.trim());
    if (sections.length > MAX_OUTLINE_SECTIONS) {
      return {
        ok: false,
        error: `\`sections\` accepts at most ${MAX_OUTLINE_SECTIONS} entries.`,
      };
    }
    if (sections.length === 0) sections = undefined;
  }

  let audience: string | undefined;
  if (args.audience !== undefined && args.audience !== null) {
    if (typeof args.audience !== "string") {
      return { ok: false, error: "`audience` must be a string or null." };
    }
    audience = args.audience.trim() || undefined;
  }

  let sourceData: unknown | undefined;
  if (args.sourceData !== undefined && args.sourceData !== null) {
    if (typeof args.sourceData !== "object") {
      return { ok: false, error: "`sourceData` must be an object." };
    }
    // Estimate serialized size so we can reject up-front. The prompt
    // builder also truncates, but failing here gives a clearer error
    // to the model than a silently-truncated chart.
    let serialized: string;
    try {
      serialized = JSON.stringify(args.sourceData);
    } catch {
      return { ok: false, error: "`sourceData` must be JSON-serializable." };
    }
    if (serialized.length > MAX_SOURCE_DATA_BYTES * 1.5) {
      return {
        ok: false,
        error: `\`sourceData\` serialized to ${serialized.length} chars — please pre-aggregate to <= ${MAX_SOURCE_DATA_BYTES} chars.`,
      };
    }
    sourceData = args.sourceData;
  }

  const tags = Array.isArray(args.tags)
    ? args.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : [];

  let visibility: Visibility = "private";
  if (args.visibility !== undefined) {
    if (
      typeof args.visibility !== "string" ||
      !VALID_VISIBILITY.includes(args.visibility as Visibility)
    ) {
      return {
        ok: false,
        error: `\`visibility\` must be one of: ${VALID_VISIBILITY.join(", ")}.`,
      };
    }
    visibility = args.visibility as Visibility;
  }

  const icon = typeof args.icon === "string" && args.icon.trim() ? args.icon.trim() : "📄";

  return {
    ok: true,
    title,
    reportType,
    prompt: args.prompt,
    clientId,
    sections,
    audience,
    sourceData,
    tags,
    visibility,
    icon,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LLM author call
// ─────────────────────────────────────────────────────────────────────────────

interface ClientBlock {
  name: string;
  totalValue?: number;
  summary?: string;
}

interface RunAuthorArgs {
  systemPrompt: string;
  userMessage: string;
  ctx: ChatToolContext;
  /**
   * Optional per-delta callback used by the chat-runner to forward
   * partial markdown to the chat UI in real time. Tests omit it.
   */
  onDelta?: (delta: string) => void;
}

/**
 * Drive the report-author LLM call and concatenate every delta chunk
 * into the final markdown body.
 *
 * Key design points:
 *
 *   - `tools: []` — the author model has NO tool access. It composes
 *     markdown from the system prompt + source data the orchestrator
 *     already gathered. Any data lookup belongs in the OUTER chat
 *     turn, not nested inside this call.
 *
 *   - Derived `sessionId` (`report:<conversationId>:<nonce>`) — the
 *     OpenAI/xAI Responses adapter caches `previousResponseId` per
 *     sessionId. We want this run to start a FRESH thread, not extend
 *     the advisor's chat. Using a per-call nonce guarantees no
 *     accidental state sharing.
 *
 *   - The advisor's resolved selection (provider + model overrides) is
 *     re-used via `ctx.selection`. Same model the advisor configured for
 *     the chat — consistent behavior + costs.
 *
 *   - Throws on adapter errors (the surrounding handler catches and
 *     converts to `{error}`).
 */
async function runAuthorAndCollect(args: RunAuthorArgs): Promise<string> {
  const sessionId = `report:${args.ctx.conversationId}:${cryptoNonce()}`;
  const chunks: string[] = [];
  for await (const chunk of streamChat(
    {
      messages: [{ role: "user", content: args.userMessage }],
      tools: [],
      systemPrompt: args.systemPrompt,
      sessionId,
      userMessage: args.userMessage,
      previousResponseId: null,
    },
    {
      // Reuse the advisor's selection (chat-runner threaded it into ctx).
      // When null (test environments without a profile row), streamChat
      // falls back to env/hardcoded defaults — same as a fresh /api/chat
      // call.
      selection: args.ctx.selection ?? undefined,
    },
  )) {
    if (chunk.type === "delta") {
      chunks.push(chunk.text);
      args.onDelta?.(chunk.text);
    } else if (chunk.type === "error") {
      throw new Error(`Report author failed: ${chunk.error}`);
    }
    // Ignore tool_call_done / response_id / model_switch / done — the
    // author has no tools, and we collect the response_id only when we
    // need it (we don't, since this is a one-shot call).
  }
  return chunks.join("");
}

/**
 * Stable but unique nonce for `sessionId` so the adapter cache treats
 * each report-author run as a brand-new thread. Cryptographically random
 * to dodge any accidental collisions when multiple authors run in
 * parallel from the same conversation.
 */
function cryptoNonce(): string {
  // crypto.randomUUID is available in every Node/Bun runtime we target.
  // Slice for a compact log line; collision risk is negligible.
  return globalThis.crypto.randomUUID().slice(0, 12);
}

// ─────────────────────────────────────────────────────────────────────────────
// Client snapshot helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Best-effort extraction of the client's display name from the intake
 * JSONB. Mirrors the `clientFullName` logic in `lib/crm/clients-mapper`
 * but keeps the dependency one-way (we don't import the mapper to avoid
 * pulling its full surface into this tool).
 */
function extractClientDisplayName(intake: Record<string, unknown>): string | null {
  const fullName = pickString(intake, ["full_name", "fullName"]);
  if (fullName) return fullName;
  const first = pickString(intake, ["first_name", "firstName"]);
  const last = pickString(intake, ["last_name", "lastName"]);
  if (first || last) return [first, last].filter(Boolean).join(" ");
  return null;
}

/**
 * Build a short one-paragraph summary line from intake — used only as a
 * grounding nudge for the model. Pulls the few high-signal fields that
 * are always available; ignores everything else.
 */
function extractIntakeSummary(intake: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const age = pickString(intake, ["age"]);
  const status = pickString(intake, ["marital_status", "maritalStatus"]);
  const employmentStatus = pickString(intake, ["employment_status", "employmentStatus"]);
  const goals = pickString(intake, ["primary_goal", "primaryGoal", "goal"]);
  if (age) parts.push(`age ${age}`);
  if (status) parts.push(status);
  if (employmentStatus) parts.push(employmentStatus);
  if (goals) parts.push(`primary goal: ${goals}`);
  return parts.length > 0 ? parts.join("; ") : null;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

async function fetchClientOrgId(ctx: ChatToolContext, clientId: string): Promise<string | null> {
  const { data, error } = await ctx.supabase
    .from("advisorpilot_clients")
    .select("org_id")
    .eq("id", clientId)
    .maybeSingle();
  if (error || !data) return null;
  const orgId = (data as { org_id?: string | null }).org_id;
  return typeof orgId === "string" && orgId.trim() ? orgId : null;
}

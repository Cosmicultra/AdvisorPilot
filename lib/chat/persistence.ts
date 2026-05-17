/**
 * Chat-orchestrator persistence layer.
 *
 * Pure async functions over a `SupabaseClient` — no Supabase admin client
 * constructed here so the chat-runner can pass the same instance it uses
 * for tools, and so tests can inject a stub.
 *
 * Responsibility split:
 *   - chat-runner.ts owns the per-turn lifecycle (call these in the right
 *     order) and event emission
 *   - this module owns the shape + sequencing of DB writes
 *   - REST routes (app/api/chat/conversations/*) call the *read* helpers
 *
 * Tables (see supabase/_apply_crm_phase5_migrations.sql):
 *   - advisorpilot_chat_conversations  — header (title, last_*, counts)
 *   - advisorpilot_chat_messages       — append-only message log
 *
 * v1 keeps everything OWNER-PRIVATE; sharing comes later via the same
 * `advisorpilot_share_grants` table that notes/tasks/reports use.
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.16 (persistence + multi-session).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatMessage, ChatToolCall, ChatToolResult } from "@/lib/llm/chat/types";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Camel-cased view of the `advisorpilot_chat_conversations` row, with
 * derived fields (e.g. `displayTitle` that handles the nullable column).
 * REST routes return this shape directly.
 */
export interface ChatConversationSummary {
  id: string;
  ownerEmail: string;
  title: string | null;
  /** "Untitled chat" when title is null/empty. */
  displayTitle: string;
  lastClientId: string | null;
  lastRoute: string | null;
  lastProvider: string | null;
  lastModel: string | null;
  /** OpenAI/xAI stateful resume id. Caller threads back into streamChat. */
  lastProviderResponseId: string | null;
  messageCount: number;
  turnCount: number;
  isArchived: boolean;
  archivedAt: string | null;
  /** Pinned conversations sort above recency buckets in the sidebar (PR 19). */
  isPinned: boolean;
  /** Set when the conversation was last pinned; cleared on unpin. */
  pinnedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
}

/**
 * One message row, camel-cased. Tool-call / tool-result blobs round-trip
 * through `jsonb` columns so the sidebar can reconstruct exactly the same
 * `<ChatToolStack>` the live chat showed.
 */
export interface ChatMessageRecord {
  id: string;
  conversationId: string;
  ordinal: number;
  role: ChatMessage["role"];
  content: string;
  toolCalls: ChatToolCall[] | null;
  toolResults: ChatToolResult[] | null;
  providerResponseId: string | null;
  createdAt: string;
}

/**
 * Full conversation (header + all messages). Returned by the
 * `/api/chat/conversations/[id]` GET handler.
 */
export interface ChatConversationDetail extends ChatConversationSummary {
  messages: ChatMessageRecord[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const CONVERSATIONS_TABLE = "advisorpilot_chat_conversations";
const MESSAGES_TABLE = "advisorpilot_chat_messages";

/** Max chars of the first user message to use as the conversation title. */
export const AUTO_TITLE_MAX_LENGTH = 60;
/** Max user-provided title length (matches notes / tasks / reports for consistency). */
export const MANUAL_TITLE_MAX_LENGTH = 250;

// ─────────────────────────────────────────────────────────────────────────────
// Auto-title — pure (no DB)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive a title from the first user message. Strips leading whitespace,
 * collapses internal whitespace, truncates at the first sentence-ending
 * punctuation OR at AUTO_TITLE_MAX_LENGTH. Adds an ellipsis on truncation.
 *
 * Returns `null` for empty input — caller decides whether to fall back
 * to "Untitled chat" or wait for a longer message.
 */
export function deriveTitleFromFirstMessage(text: string): string | null {
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;

  // Cut at the FIRST sentence-ending punctuation (so a "Show me the AUM
  // by stage. Also include..." question becomes "Show me the AUM by
  // stage", not the whole paragraph).
  const sentenceMatch = cleaned.match(/^(.*?[.!?])\s/);
  let candidate = sentenceMatch ? sentenceMatch[1] : cleaned;
  if (candidate.length > AUTO_TITLE_MAX_LENGTH) {
    candidate = candidate.slice(0, AUTO_TITLE_MAX_LENGTH).trimEnd() + "…";
  }
  return candidate;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mappers — DB row → camelCase shape
// ─────────────────────────────────────────────────────────────────────────────

/** Raw row from advisorpilot_chat_conversations. */
interface ConversationRow {
  id: string;
  owner_email: string;
  owner_user_id: string | null;
  title: string | null;
  last_client_id: string | null;
  last_route: string | null;
  last_provider: string | null;
  last_model: string | null;
  last_provider_response_id: string | null;
  message_count: number;
  turn_count: number;
  is_archived: boolean;
  archived_at: string | null;
  /** Optional — present after PR 19 migration; defaults to false on older rows. */
  is_pinned?: boolean | null;
  pinned_at?: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
}

function toConversationSummary(row: ConversationRow): ChatConversationSummary {
  return {
    id: row.id,
    ownerEmail: row.owner_email,
    title: row.title,
    displayTitle: row.title && row.title.trim() ? row.title : "Untitled chat",
    lastClientId: row.last_client_id,
    lastRoute: row.last_route,
    lastProvider: row.last_provider,
    lastModel: row.last_model,
    lastProviderResponseId: row.last_provider_response_id,
    messageCount: row.message_count,
    turnCount: row.turn_count,
    isArchived: row.is_archived,
    archivedAt: row.archived_at,
    // Defensive defaults for rows that pre-date the PR 19 migration —
    // the column might not exist yet on older deployments.
    isPinned: row.is_pinned === true,
    pinnedAt: row.pinned_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
  };
}

/** Raw row from advisorpilot_chat_messages. */
interface MessageRow {
  id: string;
  conversation_id: string;
  ordinal: number;
  role: string;
  content: string;
  tool_calls: unknown;
  tool_results: unknown;
  provider_response_id: string | null;
  created_at: string;
}

function toMessageRecord(row: MessageRow): ChatMessageRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    ordinal: row.ordinal,
    role: (row.role as ChatMessage["role"]) ?? "user",
    content: row.content ?? "",
    toolCalls: Array.isArray(row.tool_calls)
      ? (row.tool_calls as ChatToolCall[])
      : null,
    toolResults: Array.isArray(row.tool_results)
      ? (row.tool_results as ChatToolResult[])
      : null,
    providerResponseId: row.provider_response_id,
    createdAt: row.created_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Writes — turn lifecycle
// ─────────────────────────────────────────────────────────────────────────────

export interface UpsertConversationInput {
  /** Stable id the client + adapter both already know. */
  conversationId: string;
  ownerEmail: string;
  ownerUserId?: string | null;
  /** Optional initial title; otherwise derived from the first user message on first turn. */
  title?: string | null;
  lastClientId?: string | null;
  lastRoute?: string | null;
}

/**
 * Ensure a conversation row exists. Idempotent — second + later calls
 * UPDATE the convo's last_route / last_client_id (so resume + multi-tab
 * keep the header current) but leave counts + title untouched.
 *
 * Returns the row's id (the same value passed in, surfaced for clarity).
 */
export async function upsertConversation(
  supabase: SupabaseClient,
  input: UpsertConversationInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  // Use Supabase upsert with onConflict so we never race against another
  // tab opening the same conversation simultaneously.
  const payload = {
    id: input.conversationId,
    owner_email: input.ownerEmail.toLowerCase(),
    owner_user_id: input.ownerUserId ?? null,
    title: input.title ?? null,
    last_client_id: input.lastClientId ?? null,
    last_route: input.lastRoute ?? null,
  };
  const { error } = await supabase
    .from(CONVERSATIONS_TABLE)
    .upsert(payload, { onConflict: "id", ignoreDuplicates: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: input.conversationId };
}

// ─────────────────────────────────────────────────────────────────────────────
// PR 22 — early user-message persistence (survives stream death)
// ─────────────────────────────────────────────────────────────────────────────

export interface AppendUserMessageInput {
  conversationId: string;
  /** The text the advisor just sent. */
  userText: string;
}

/**
 * Insert the user message FIRST — runs at the start of a turn so the
 * message lands in DB even if the stream dies mid-flight (network drop,
 * browser crash, process kill). Returns the ordinal the user message
 * landed at so the runner knows where the assistant message should
 * sequence next.
 *
 * Safe to call multiple times on the same `userText` only if you want
 * duplicate rows — the runner calls it exactly once per turn.
 *
 * Spec: docs/crm/60-chat-orchestrator.md §B.19 (soft-resume).
 */
export async function appendUserMessage(
  supabase: SupabaseClient,
  input: AppendUserMessageInput,
): Promise<{ ok: true; ordinal: number } | { ok: false; error: string }> {
  // Read the current message_count so we sequence the next ordinal.
  const { data: convRow, error: fetchError } = await supabase
    .from(CONVERSATIONS_TABLE)
    .select("message_count")
    .eq("id", input.conversationId)
    .maybeSingle();
  if (fetchError) return { ok: false, error: fetchError.message };
  if (!convRow) return { ok: false, error: "Conversation not found." };

  const ordinal = ((convRow.message_count as number) ?? 0) + 1;
  const { error: insertError } = await supabase.from(MESSAGES_TABLE).insert({
    conversation_id: input.conversationId,
    ordinal,
    role: "user",
    content: input.userText,
  });
  if (insertError) return { ok: false, error: insertError.message };

  // Bump message_count + last_message_at NOW so any concurrent reader
  // (e.g. the sidebar in another tab) sees the new turn-in-progress.
  // We deliberately do NOT increment turn_count yet — that signals
  // "complete user+assistant pair" and bumps when the assistant lands.
  const { error: updateError } = await supabase
    .from(CONVERSATIONS_TABLE)
    .update({
      message_count: ordinal,
      last_message_at: new Date().toISOString(),
    })
    .eq("id", input.conversationId);
  if (updateError) return { ok: false, error: updateError.message };

  return { ok: true, ordinal };
}

export interface AppendTurnInput {
  conversationId: string;
  ownerEmail: string;
  /** The user message text the advisor just sent. */
  userText: string;
  /** Final assistant text concatenated across all stream iterations. */
  assistantText: string;
  /**
   * Per-tool-call records gathered during the turn (one entry per
   * iteration where the model issued tool calls). The persistence
   * helper inserts a `tool`-role message per iteration so the sidebar
   * can replay them in order.
   */
  iterations?: Array<{
    toolCalls: ChatToolCall[];
    toolResults: ChatToolResult[];
  }>;
  /** Provider id at end of the turn (for OpenAI/xAI Responses-API resume). */
  providerResponseId?: string | null;
  /** LLM provider + model that served the turn (for the sidebar). */
  provider?: string | null;
  model?: string | null;
  /** Route + clientId at turn time (refreshes the conversation header). */
  lastRoute?: string | null;
  lastClientId?: string | null;
  /**
   * When the user message was persisted early via `appendUserMessage`,
   * pass its ordinal here so `appendTurn` skips re-inserting it and
   * sequences the assistant + tool-role rows starting at
   * `userMessageOrdinal + 1`. Omit to use the legacy "insert everything
   * at once" path.
   */
  userMessageOrdinal?: number;
}

/**
 * Insert the user message + the assistant message (+ any intermediate
 * tool-role messages) for a single turn. Bumps the conversation header's
 * counters + `last_message_at` + `last_provider_response_id` in the same
 * pass.
 *
 * Best-effort: each step is awaited but failures are returned via the
 * result discriminator so the chat-runner can decide whether to surface
 * the failure to the client (it doesn't — chat continues even if
 * persistence fails so a DB hiccup doesn't break the advisor's session).
 *
 * Ordinal assignment: we read `message_count` from the conversation row
 * BEFORE writing so the first user message in a brand-new conversation
 * lands at ordinal 1. The subsequent inserts increment locally without
 * another DB round-trip.
 */
export async function appendTurn(
  supabase: SupabaseClient,
  input: AppendTurnInput,
): Promise<
  | { ok: true; insertedMessageCount: number; nextTitle?: string }
  | { ok: false; error: string }
> {
  // 1. Fetch current message_count so we can assign sequential ordinals.
  const { data: convRow, error: convFetchError } = await supabase
    .from(CONVERSATIONS_TABLE)
    .select("message_count, turn_count, title")
    .eq("id", input.conversationId)
    .maybeSingle();
  if (convFetchError) return { ok: false, error: convFetchError.message };
  if (!convRow) {
    return { ok: false, error: "Conversation not found." };
  }
  const startOrdinal = (convRow.message_count as number) ?? 0;
  const currentTitle = (convRow.title as string | null) ?? null;
  const userAlreadyPersisted = typeof input.userMessageOrdinal === "number";

  // 2. Build the message rows we need to insert. Two paths:
  //   (a) `userMessageOrdinal` provided (PR 22 default) — the user
  //       message landed already via `appendUserMessage`. We sequence
  //       assistant + tool-role rows AFTER it.
  //   (b) Legacy path — insert user + assistant in one batch.
  type Insert = Record<string, unknown>;
  const inserts: Insert[] = [];
  let ord = userAlreadyPersisted
    ? (input.userMessageOrdinal as number)
    : startOrdinal;

  if (!userAlreadyPersisted) {
    inserts.push({
      conversation_id: input.conversationId,
      ordinal: ++ord,
      role: "user",
      content: input.userText,
    });
  }

  for (const iter of input.iterations ?? []) {
    if (iter.toolCalls.length === 0) continue;
    inserts.push({
      conversation_id: input.conversationId,
      ordinal: ++ord,
      role: "assistant",
      content: "",
      tool_calls: iter.toolCalls,
    });
    inserts.push({
      conversation_id: input.conversationId,
      ordinal: ++ord,
      role: "tool",
      content: "",
      tool_results: iter.toolResults,
    });
  }

  // Final assistant message (may have empty content if the turn ended
  // with only a tool result — but the runner usually emits a text
  // summary after the last tool call too).
  inserts.push({
    conversation_id: input.conversationId,
    ordinal: ++ord,
    role: "assistant",
    content: input.assistantText,
    provider_response_id: input.providerResponseId ?? null,
  });

  // 3. Insert all messages.
  const { error: insertError } = await supabase.from(MESSAGES_TABLE).insert(inserts);
  if (insertError) return { ok: false, error: insertError.message };

  // 4. Derive a title if this is the very first turn and no title is set.
  //    `userAlreadyPersisted` path: the user msg landed at ordinal 1, so
  //    `startOrdinal === 1` when this is the first complete turn. Legacy
  //    path: startOrdinal === 0 before this turn's inserts.
  const isFirstTurn = userAlreadyPersisted
    ? startOrdinal === 1
    : startOrdinal === 0;
  const nextTitle =
    !currentTitle && isFirstTurn
      ? deriveTitleFromFirstMessage(input.userText) ?? null
      : null;

  // 5. Bump the conversation header.
  const patch: Insert = {
    message_count: ord, // ord is now == total messages
    turn_count: ((convRow.turn_count as number) ?? 0) + 1,
    last_message_at: new Date().toISOString(),
  };
  if (input.providerResponseId !== undefined) {
    patch.last_provider_response_id = input.providerResponseId;
  }
  if (input.provider !== undefined) patch.last_provider = input.provider;
  if (input.model !== undefined) patch.last_model = input.model;
  if (input.lastRoute !== undefined) patch.last_route = input.lastRoute;
  if (input.lastClientId !== undefined) patch.last_client_id = input.lastClientId;
  if (nextTitle) patch.title = nextTitle;

  const { error: updateError } = await supabase
    .from(CONVERSATIONS_TABLE)
    .update(patch)
    .eq("id", input.conversationId);
  if (updateError) return { ok: false, error: updateError.message };

  return {
    ok: true,
    insertedMessageCount: inserts.length,
    ...(nextTitle ? { nextTitle } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads — list / get / archive / rename
// ─────────────────────────────────────────────────────────────────────────────

export interface ListConversationsArgs {
  ownerEmail: string;
  /** Include archived rows when true. Default false (hidden from sidebar). */
  includeArchived?: boolean;
  limit?: number;
  offset?: number;
  /**
   * Full-text search across title AND message content (PR 21). Trimmed
   * to ≥3 chars before dispatching to the search RPC — shorter queries
   * are passed through unfiltered (the sidebar applies its instant
   * client-side title filter for those). Empty/missing search → no
   * filtering (returns every conversation, same as v1).
   */
  search?: string;
}

/** Min query length before we dispatch to the FTS search RPC. */
const FTS_MIN_QUERY_LENGTH = 3;

export async function listConversations(
  supabase: SupabaseClient,
  args: ListConversationsArgs,
): Promise<
  | { ok: true; conversations: ChatConversationSummary[] }
  | { ok: false; error: string }
> {
  // 1. Resolve the "visible to this viewer" set via the RPC. We always
  // fetch the FULL list first — the rows are small (header-only) and
  // the index is fast. Search/archive/pagination apply in-memory below.
  const { data, error } = await supabase.rpc("list_visible_chat_conversations", {
    viewer_email: args.ownerEmail,
  });
  if (error) return { ok: false, error: error.message };

  let rows = ((data ?? []) as ConversationRow[]).map(toConversationSummary);

  // 2. Server-side FTS — only when the query is meaningful enough to
  // warrant a DB round trip. The RPC returns matching conversation IDs
  // (title + message content); we filter the visible set by that ID
  // set. Order is preserved from the visible-set RPC (newest activity
  // first) since the search RPC returns by ID for stable dedup.
  const trimmedSearch = (args.search ?? "").trim();
  if (trimmedSearch.length >= FTS_MIN_QUERY_LENGTH) {
    const search = await supabase.rpc("search_chat_conversations", {
      viewer_email: args.ownerEmail,
      query: trimmedSearch,
      lim: 200,
    });
    if (search.error) return { ok: false, error: search.error.message };
    const matchIds = new Set(
      ((search.data ?? []) as Array<{ conversation_id: string }>)
        .map((r) => r.conversation_id),
    );
    rows = rows.filter((r) => matchIds.has(r.id));
  }

  // 3. Archive + pagination — in that order so pagination indexes the
  // visible (non-archived) set, not the full list.
  if (!args.includeArchived) {
    rows = rows.filter((r) => !r.isArchived);
  }
  if (typeof args.offset === "number" && args.offset > 0) {
    rows = rows.slice(args.offset);
  }
  if (typeof args.limit === "number" && args.limit > 0) {
    rows = rows.slice(0, args.limit);
  }
  return { ok: true, conversations: rows };
}

export interface GetConversationArgs {
  conversationId: string;
  ownerEmail: string;
}

export async function getConversation(
  supabase: SupabaseClient,
  args: GetConversationArgs,
): Promise<
  | { ok: true; conversation: ChatConversationDetail }
  | { ok: false; error: string; notFound?: boolean }
> {
  // Visibility check via the RPC predicate.
  const vis = await supabase.rpc("chat_conversation_visible_to", {
    viewer_email: args.ownerEmail,
    conversation_id: args.conversationId,
  });
  if (vis.error) return { ok: false, error: vis.error.message };
  if (vis.data !== true) return { ok: false, error: "Conversation not found.", notFound: true };

  const { data: convData, error: convError } = await supabase
    .from(CONVERSATIONS_TABLE)
    .select("*")
    .eq("id", args.conversationId)
    .maybeSingle();
  if (convError) return { ok: false, error: convError.message };
  if (!convData) return { ok: false, error: "Conversation not found.", notFound: true };

  const { data: msgRows, error: msgError } = await supabase
    .from(MESSAGES_TABLE)
    .select("*")
    .eq("conversation_id", args.conversationId)
    .order("ordinal", { ascending: true });
  if (msgError) return { ok: false, error: msgError.message };

  return {
    ok: true,
    conversation: {
      ...toConversationSummary(convData as ConversationRow),
      messages: ((msgRows ?? []) as MessageRow[]).map(toMessageRecord),
    },
  };
}

export interface PatchConversationArgs {
  conversationId: string;
  ownerEmail: string;
  /** Rename the conversation. Pass empty string to clear (back to auto-title fallback). */
  title?: string | null;
  /** Archive or restore. */
  isArchived?: boolean;
  /**
   * Pin or unpin. Sidebar lifts pinned conversations into a top-of-list
   * group. `pinned_at` is set/cleared by the helper — callers don't
   * pass it (PR 19).
   */
  isPinned?: boolean;
}

export async function patchConversation(
  supabase: SupabaseClient,
  args: PatchConversationArgs,
): Promise<
  | { ok: true; conversation: ChatConversationSummary }
  | { ok: false; error: string; notFound?: boolean }
> {
  const vis = await supabase.rpc("chat_conversation_visible_to", {
    viewer_email: args.ownerEmail,
    conversation_id: args.conversationId,
  });
  if (vis.error) return { ok: false, error: vis.error.message };
  if (vis.data !== true) return { ok: false, error: "Conversation not found.", notFound: true };

  const patch: Record<string, unknown> = {};
  if (args.title !== undefined) {
    if (args.title === "" || args.title === null) {
      patch.title = null;
    } else {
      if (args.title.length > MANUAL_TITLE_MAX_LENGTH) {
        return {
          ok: false,
          error: `Title must be ${MANUAL_TITLE_MAX_LENGTH} characters or fewer.`,
        };
      }
      patch.title = args.title.trim();
    }
  }
  if (args.isArchived !== undefined) {
    patch.is_archived = args.isArchived;
    patch.archived_at = args.isArchived ? new Date().toISOString() : null;
  }
  if (args.isPinned !== undefined) {
    patch.is_pinned = args.isPinned;
    patch.pinned_at = args.isPinned ? new Date().toISOString() : null;
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "Provide at least one of: title, isArchived, isPinned." };
  }

  const { data, error } = await supabase
    .from(CONVERSATIONS_TABLE)
    .update(patch)
    .eq("id", args.conversationId)
    .select("*")
    .single();
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Update failed." };
  }
  return { ok: true, conversation: toConversationSummary(data as ConversationRow) };
}

export async function deleteConversation(
  supabase: SupabaseClient,
  args: { conversationId: string; ownerEmail: string },
): Promise<{ ok: true } | { ok: false; error: string; notFound?: boolean }> {
  const vis = await supabase.rpc("chat_conversation_visible_to", {
    viewer_email: args.ownerEmail,
    conversation_id: args.conversationId,
  });
  if (vis.error) return { ok: false, error: vis.error.message };
  if (vis.data !== true) return { ok: false, error: "Conversation not found.", notFound: true };

  const { error } = await supabase
    .from(CONVERSATIONS_TABLE)
    .delete()
    .eq("id", args.conversationId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

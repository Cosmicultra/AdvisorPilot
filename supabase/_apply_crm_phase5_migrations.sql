-- =============================================================================
-- AdvisorPilot — apply CRM Phase 5 migrations
--
-- Self-contained — paste into Supabase Dashboard → SQL Editor → Run.
--
-- Phase 5 ships the chat-orchestrator persistence layer:
--
--   1. advisorpilot_chat_conversations  — one row per conversation
--   2. advisorpilot_chat_messages       — append-only message log
--   3. list_visible_chat_conversations(viewer_email)  — owner-only RPC
--   4. advisorpilot_report_versions     — append-only version log per report
--      (auto-written by an `manage_report.update` trigger)
--
-- Conversations are STRICTLY owner-private in v1 (no sharing). Sharing,
-- handoff to another advisor, and team-visible conversations would slot
-- into a future phase using the same `advisorpilot_share_grants` pattern
-- the notes / tasks / reports tables use.
--
-- Report versions inherit visibility from the parent report — the
-- `reports_visible_to` predicate (Phase 4) is the source of truth.
--
-- Multi-tab + multi-session support is a CLIENT concern (each tab keeps
-- its own conversationId; the sidebar lists every conversation the
-- advisor owns regardless of which tab created it). The schema is
-- intentionally agnostic.
--
-- Idempotent: every object uses CREATE OR REPLACE / IF NOT EXISTS /
-- DROP-THEN-CREATE for policies. Safe to re-run.
--
-- DEPENDENCIES (must already exist from earlier phases):
--   - public.set_advisorpilot_updated_at()
--   - public.advisorpilot_clients (for last_client_id FK)
--   - public.advisorpilot_reports (Phase 4) — versions FK target
--   - public.reports_visible_to(text, uuid) — RLS predicate for versions
--
-- Spec: docs/crm/60-chat-orchestrator.md §B.16 (conversation persistence)
--       + docs/crm/70-orchestrator-tools.md §7 (report versions + line ops).
-- =============================================================================


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 1 — Conversation header table                                        ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.advisorpilot_chat_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  owner_user_id uuid,

  -- Title is generated from the first user message; nullable until that
  -- first turn lands. The reducer + sidebar both render "Untitled chat"
  -- as a fallback so a turn-in-flight conversation always has a label.
  title text,

  -- Last-known route + client at turn time. Used for the sidebar's
  -- "current focus" hint and to restore the chat-location context when
  -- resuming a conversation in a different tab.
  last_client_id uuid references public.advisorpilot_clients(id) on delete set null,
  last_route text,

  -- Provider + model that served the most recent turn. Surfaces in the
  -- sidebar so the advisor knows "this convo was Gemini, that one was
  -- gpt-4o" without opening each.
  last_provider text,
  last_model text,

  -- OpenAI/xAI Responses-API id. Threaded back into streamChat on resume
  -- so the adapter can continue the stateful thread instead of replaying
  -- the full history. Null for Gemini (stateless from our adapter's POV).
  last_provider_response_id text,

  -- Denormalized counts the sidebar reads — saves N message-table scans
  -- on each list. Updated in the same transaction as the message INSERT.
  message_count integer not null default 0,
  turn_count integer not null default 0,             -- pairs of user+assistant

  -- Soft delete. v1 hides archived from the default sidebar list; future
  -- "Trash" view shows them with a Restore button.
  is_archived boolean not null default false,
  archived_at timestamptz,

  -- Pin support (PR 19). When `is_pinned` is true the sidebar lifts
  -- the row out of its recency bucket and stacks it in a top-of-list
  -- "Pinned" group, ordered by `pinned_at desc nulls last` (so newer
  -- pins surface above older ones, and conversations pinned before
  -- this column existed sort last). `pinned_at` is set to `now()` on
  -- pin, cleared to null on unpin — the persistence helpers handle
  -- this so callers only set `isPinned`.
  is_pinned boolean not null default false,
  pinned_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz                              -- bumped on every new message
);

-- Bump updated_at on UPDATE (uses the shared Phase 0 trigger function).
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'set_advisorpilot_chat_conversations_updated_at'
  ) then
    create trigger set_advisorpilot_chat_conversations_updated_at
      before update on public.advisorpilot_chat_conversations
      for each row execute function public.set_advisorpilot_updated_at();
  end if;
end$$;

-- PR 19 — pin support. ALTER TABLE is wrapped in a guarded DO block so
-- re-running this migration on an existing DB safely adds the column
-- without conflicting with the original CREATE TABLE above (which now
-- also declares `is_pinned` for fresh installs).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'advisorpilot_chat_conversations'
      and column_name = 'is_pinned'
  ) then
    alter table public.advisorpilot_chat_conversations
      add column is_pinned boolean not null default false;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'advisorpilot_chat_conversations'
      and column_name = 'pinned_at'
  ) then
    alter table public.advisorpilot_chat_conversations
      add column pinned_at timestamptz;
  end if;
end$$;

-- Index supporting the sidebar's "pinned first, then by recency" query.
-- Partial: only indexes pinned rows so unpinned rows don't bloat it
-- (most conversations stay unpinned).
create index if not exists advisorpilot_chat_conversations_pinned_idx
  on public.advisorpilot_chat_conversations (lower(owner_email), pinned_at desc nulls last)
  where is_pinned = true;

-- PR 21 — Full-text search over message content. The sidebar's search
-- input becomes server-driven once the query reaches ≥3 chars; for
-- shorter queries it still filters titles client-side (instant).
--
-- GIN index on the tsvector of content. We index `english` config —
-- good enough for advisor English; future-proof to switch if/when
-- we need multilingual.
create index if not exists advisorpilot_chat_messages_content_fts_idx
  on public.advisorpilot_chat_messages
  using gin (to_tsvector('english', coalesce(content, '')));

-- search_chat_conversations(viewer, query, lim) — returns the conversation
-- IDs the viewer owns whose TITLE matches the query OR whose MESSAGES match,
-- ordered by most-recent activity. The sidebar uses this when the search
-- input has ≥3 chars; it returns up to `lim` ids (default 100), then the
-- list endpoint joins the conversation headers.
--
-- Why not `to_tsquery`: it requires the caller to escape per-token
-- operators (& | ! :). `plainto_tsquery` (used here) treats the input as
-- a literal phrase with AND between terms — what advisors expect when
-- they type a search input.
create or replace function public.search_chat_conversations(
  viewer_email text,
  query text,
  lim integer default 100
)
returns table (conversation_id uuid)
language sql stable
as $$
  with conv as (
    select c.id, c.title, coalesce(c.last_message_at, c.created_at) as activity_at
    from public.advisorpilot_chat_conversations c
    where lower(c.owner_email) = lower(viewer_email)
  ),
  matched as (
    -- Title hits — case-insensitive substring match keeps the behavior
    -- consistent with the sidebar's <3-char client-side filter.
    select id, activity_at from conv
    where coalesce(lower(title), '') like '%' || lower(query) || '%'
    union
    -- Message content hits — full-text search via the GIN index.
    select c.id, c.activity_at
    from conv c
    join public.advisorpilot_chat_messages m on m.conversation_id = c.id
    where to_tsvector('english', coalesce(m.content, ''))
      @@ plainto_tsquery('english', query)
  )
  select distinct id as conversation_id
  from matched
  order by id
  -- Note: we sort by ID for stable dedup; the calling endpoint re-sorts
  -- by activity_at after joining headers.
  limit lim;
$$;

comment on function public.search_chat_conversations(text, text, integer) is
  'Return up to `lim` conversation IDs owned by viewer matching `query` in title OR message content.';


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 2 — Message log (append-only)                                        ║
-- ║                                                                            ║
-- ║  One row per message — user, assistant, or tool. We preserve toolCalls +   ║
-- ║  toolResults as JSONB so the chat-history sidebar can render exactly the   ║
-- ║  same <ChatToolStack> on resume that the live chat showed.                 ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.advisorpilot_chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.advisorpilot_chat_conversations(id) on delete cascade,

  -- Position within the conversation (1-indexed). Lets the sidebar sort
  -- messages without trusting created_at clock skew during high-throughput
  -- inserts.
  ordinal integer not null,

  role text not null check (role in ('user', 'assistant', 'tool', 'system')),
  content text not null default '',

  -- Assistant messages may carry tool_calls; tool-role messages carry
  -- tool_results. We store the FULL ChatToolCall / ChatToolResult shape
  -- (see lib/llm/chat/types.ts) verbatim — no schema indirection.
  tool_calls jsonb,
  tool_results jsonb,

  -- Provider response id at the moment this message landed (assistant
  -- messages only). Threaded back into resume via the conversation's
  -- `last_provider_response_id` column above.
  provider_response_id text,

  created_at timestamptz not null default now()
);

-- Lookups by conversation (the only access pattern in v1).
create unique index if not exists advisorpilot_chat_messages_conv_ord_idx
  on public.advisorpilot_chat_messages (conversation_id, ordinal);

create index if not exists advisorpilot_chat_messages_conv_created_idx
  on public.advisorpilot_chat_messages (conversation_id, created_at);


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 3 — Conversation list RPC (owner-only)                               ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

create or replace function public.list_visible_chat_conversations(viewer_email text)
returns setof public.advisorpilot_chat_conversations
language sql stable
as $$
  select c.*
  from public.advisorpilot_chat_conversations c
  where lower(c.owner_email) = lower(viewer_email)
  order by coalesce(c.last_message_at, c.created_at) desc;
$$;

comment on function public.list_visible_chat_conversations(text) is
  'List every chat conversation owned by the viewer, newest activity first.';

-- Per-conversation visibility predicate (mirrors the reports / notes /
-- tasks helpers so callers feel consistent).
create or replace function public.chat_conversation_visible_to(viewer_email text, conversation_id uuid)
returns boolean
language sql stable
as $$
  select exists (
    select 1
    from public.advisorpilot_chat_conversations c
    where c.id = conversation_id
      and lower(c.owner_email) = lower(viewer_email)
  );
$$;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 4 — Row-Level Security                                               ║
-- ║                                                                            ║
-- ║  Defense in depth: production code uses the service role and bypasses RLS, ║
-- ║  but locking down anon/authenticated keys prevents a leaked anon JWT from  ║
-- ║  reading conversations.                                                    ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

alter table public.advisorpilot_chat_conversations enable row level security;
alter table public.advisorpilot_chat_messages enable row level security;

-- Conversations: owner reads + writes; everyone else: nothing.
do $$
begin
  if exists (select 1 from pg_policy where polname = 'chat_conv_owner_select') then
    drop policy chat_conv_owner_select on public.advisorpilot_chat_conversations;
  end if;
  if exists (select 1 from pg_policy where polname = 'chat_conv_owner_modify') then
    drop policy chat_conv_owner_modify on public.advisorpilot_chat_conversations;
  end if;
end$$;

create policy chat_conv_owner_select
  on public.advisorpilot_chat_conversations
  for select using (
    lower(owner_email) = lower(coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', ''))
  );

create policy chat_conv_owner_modify
  on public.advisorpilot_chat_conversations
  for all using (
    lower(owner_email) = lower(coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', ''))
  ) with check (
    lower(owner_email) = lower(coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', ''))
  );

-- Messages: visibility flows from the parent conversation.
do $$
begin
  if exists (select 1 from pg_policy where polname = 'chat_msg_owner_select') then
    drop policy chat_msg_owner_select on public.advisorpilot_chat_messages;
  end if;
  if exists (select 1 from pg_policy where polname = 'chat_msg_owner_modify') then
    drop policy chat_msg_owner_modify on public.advisorpilot_chat_messages;
  end if;
end$$;

create policy chat_msg_owner_select
  on public.advisorpilot_chat_messages
  for select using (
    exists (
      select 1 from public.advisorpilot_chat_conversations c
      where c.id = conversation_id
        and lower(c.owner_email) = lower(coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', ''))
    )
  );

create policy chat_msg_owner_modify
  on public.advisorpilot_chat_messages
  for all using (
    exists (
      select 1 from public.advisorpilot_chat_conversations c
      where c.id = conversation_id
        and lower(c.owner_email) = lower(coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', ''))
    )
  ) with check (
    exists (
      select 1 from public.advisorpilot_chat_conversations c
      where c.id = conversation_id
        and lower(c.owner_email) = lower(coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', ''))
    )
  );


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 5 — Report versions (snapshot-on-update history)                     ║
-- ║                                                                            ║
-- ║  Every UPDATE to advisorpilot_reports writes a snapshot of the PREVIOUS    ║
-- ║  state into advisorpilot_report_versions. `manage_report.restore_version`  ║
-- ║  copies a chosen snapshot's content back onto the live row (also via       ║
-- ║  UPDATE, so the restored-from row itself gets snapshotted before it's      ║
-- ║  overwritten — no version is ever lost).                                   ║
-- ║                                                                            ║
-- ║  Storage: full content blob per version. Reports cap at 200 KB so even     ║
-- ║  an active advisor with 100 edits/year on one report stays well under      ║
-- ║  20 MB lifetime per report. We don't diff or compact in v1.                ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

create table if not exists public.advisorpilot_report_versions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.advisorpilot_reports(id) on delete cascade,

  version_number integer not null,

  title text not null,
  content text not null,
  status text,
  visibility text,
  tags jsonb,
  icon text,
  color text,

  edited_by_email text,
  edited_at timestamptz not null default now()
);

create unique index if not exists advisorpilot_report_versions_report_version_idx
  on public.advisorpilot_report_versions (report_id, version_number);

create index if not exists advisorpilot_report_versions_report_edited_idx
  on public.advisorpilot_report_versions (report_id, edited_at desc);

create or replace function public.advisorpilot_reports_snapshot_on_update()
returns trigger
language plpgsql
as $$
declare
  next_version integer;
  actor text;
begin
  if old.title is not distinct from new.title
     and old.content is not distinct from new.content
     and old.status is not distinct from new.status
     and old.visibility is not distinct from new.visibility
     and old.tags is not distinct from new.tags
     and old.icon is not distinct from new.icon
     and old.color is not distinct from new.color
  then
    return new;
  end if;

  select coalesce(max(version_number), 0) + 1
    into next_version
    from public.advisorpilot_report_versions
    where report_id = old.id;

  actor := coalesce(
    current_setting('request.jwt.claims', true)::jsonb->>'email',
    new.owner_email
  );

  insert into public.advisorpilot_report_versions (
    report_id, version_number,
    title, content, status, visibility, tags, icon, color,
    edited_by_email, edited_at
  ) values (
    old.id, next_version,
    old.title, old.content, old.status, old.visibility, old.tags, old.icon, old.color,
    actor, now()
  );

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'advisorpilot_reports_snapshot_trigger'
  ) then
    create trigger advisorpilot_reports_snapshot_trigger
      before update on public.advisorpilot_reports
      for each row execute function public.advisorpilot_reports_snapshot_on_update();
  end if;
end$$;

alter table public.advisorpilot_report_versions enable row level security;

do $$
begin
  if exists (select 1 from pg_policy where polname = 'report_versions_select') then
    drop policy report_versions_select on public.advisorpilot_report_versions;
  end if;
  if exists (select 1 from pg_policy where polname = 'report_versions_modify') then
    drop policy report_versions_modify on public.advisorpilot_report_versions;
  end if;
end$$;

create policy report_versions_select
  on public.advisorpilot_report_versions
  for select using (
    public.reports_visible_to(
      coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', ''),
      report_id
    )
  );

create policy report_versions_modify
  on public.advisorpilot_report_versions
  for all using (
    public.reports_visible_to(
      coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', ''),
      report_id
    )
  ) with check (
    public.reports_visible_to(
      coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', ''),
      report_id
    )
  );


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 6 — Sanity spot-checks (uncomment to run manually)                   ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- -- (a) Conversations + messages tables exist with the expected columns:
-- select column_name, data_type
-- from information_schema.columns
-- where table_name = 'advisorpilot_chat_conversations'
-- order by ordinal_position;

-- select column_name, data_type
-- from information_schema.columns
-- where table_name = 'advisorpilot_chat_messages'
-- order by ordinal_position;

-- -- (b) RPC returns the caller's own conversations only:
-- select id, title, last_message_at, message_count
-- from public.list_visible_chat_conversations('me@firm.com')
-- limit 10;

-- -- (c) Per-conversation visibility helper:
-- select public.chat_conversation_visible_to('me@firm.com', '00000000-0000-0000-0000-000000000000');

# 00 · Fundamentals

What this work is, what it changes, what it preserves, and the user journey it produces.

## 1. The shift in one sentence

AdvisorPilot today is a **linear workflow** (intake → upload → confirm → analysis → … → report) reached as one page. Option B Roster keeps **Intake as the landing surface** and adds a **side nav** with peer items — **CRM** (client roster + detail tabs), **Tasks**, **Reports**, **Settings** — so the advisor can navigate to any of those without leaving intake mid-question. When an advisor opens a saved client from the CRM Roster, the same 10-step workflow renders as tabs scoped to that client.

## 2. What Option B Roster is

A two-pane CRM shell (`examples/AP2/option-b-roster.jsx`) with:

```
┌────┬────────────────┬──────────────────────────────────────────────────────────┐
│ A  │  Client list   │  Profile header (avatar, name, KPI strip, actions)        │
│ p  │  ─────────     │  ─────────────────────────────────────────────────────── │
│ p  │  • Margaret C. │  Tabs: Overview · Workflow · Notes · Timeline · Tasks    │
│    │  • Robert G.   │  ─────────────────────────────────────────────────────── │
│ r  │  • Maria S.    │  ┌────────────────────────┬─────────────────────────┐  │
│ a  │  • …38 results │  │  Allocation             │  Profile facts           │  │
│ i  │                │  │  Accounts               │  Tasks (open)            │  │
│ l  │                │  │  Timeline               │  Pinned note             │  │
│    │                │  │                          │  Contacts                │  │
│ (60│ (360px)        │  └────────────────────────┴─────────────────────────┘  │
│ px)│                │                                                            │
└────┴────────────────┴──────────────────────────────────────────────────────────┘
```

**The app rail (60px navy):**
- AP logo tile (top)
- **Intake** *(default landing after login)* — the 10-question wizard at `/app/intake` for starting a new client. Same surface advisors land on today; the difference is now it's reachable from the rail anywhere, not the URL bar's `/app`. When opened from a client's detail page it routes to `/app/crm/[clientId]/intake` (edit-existing mode).
- **CRM** — the two-pane Roster (client list + selected-client detail). Reached when the advisor navigates here from the rail; not the default landing.
- **Tasks** — a flat list of tasks across all clients with due-date / priority filters. Badge shows open-task count.
- **Reports** — a list of recently-generated PDFs + the report-builder (today's `step="report"`).
- **Settings** (pinned bottom) — advisor profile, signature, LLM model picker, voice agent prefs.

**The client roster (360px white panel):**
- Search + filter chips ("My book · 38", "All advisors · 142", "Prospects · 7").
- Sort header ("Sort · review due ↑") with result count.
- Scrollable list of `ListRow` items (56–60px each): avatar, name + AUM, household + accounts count, next-meeting + status chip.
- Selected row: pilot-light background + 3px royal left border.

**The client detail (flexible right pane):**
- **Profile header card:** 56px avatar, household eyebrow, h2 name, meta strip (location · email · phone · owner · client-since), action buttons ("Log note" secondary, "Prep meeting" primary, kebab), and a 4-column KPI strip (Total AUM, YTD return, Accounts, Next meeting).
- **Sticky tab bar (v1):** Overview · Workflow · Notes · Timeline · Tasks · Contacts · Documents. The **Workflow** tab hosts the legacy step machine (intake/upload/confirm/analysis/meeting/fia/roth/ret-income/fee-analysis/report) accessed via `?step=` URLs. The AP2 design canvas labels this tab "Portfolio" anticipating v2, where Workflow splits into three tabs (Portfolio = holdings + analysis · Planning = FIA/Roth/RetIncome/FeeAnalysis/Meeting · Reports). For v1 we use "Workflow" because it contains the full workflow step machine; "Portfolio" returns as a sub-tab name in v2.
- **Tab body** — Overview is a two-column grid:
  - **Left:** Current allocation card (stacked bar), Accounts card (4 rows with custodian + value), Timeline rail (6 most recent events).
  - **Right:** Profile facts (DOB, advisor, household, risk profile, etc.), open Tasks, Pinned note, Contacts list.

## 3. What stays the same

These are the load-bearing pieces of today's app. The CRM rebuild is an **addition** around them, not a replacement:

| Concern | What survives |
|---|---|
| **The 10-step workflow** | Every step (`intake / upload / confirm / analysis / meeting / fia / roth / retIncome / feeAnalysis / report / saved`) continues to render the same JSX bodies; they get extracted to component files but the markup + state shape don't change. Voice agent's `navigate(step)` still resolves all 11 names. |
| **`/api/analyze-statement` and `/api/generate-analysis`** | Request and response contracts unchanged. The CRM detail tabs that read holdings/analysis reuse the same data. |
| **The multi-provider LLM abstraction** | Provider selection (OpenAI / Gemini / Grok), per-pass model overrides, the citation-filter fix, the voice agent — all untouched. The CRM is a UI shell over the same `lib/llm` surface. |
| **Supabase tables** | `advisorpilot_clients`, `advisorpilot_advisor_profiles`, `advisorpilot_documents`, `advisorpilot_audit_events`, `advisorpilot_security_enrichment_cache`, `advisorpilot_upload_tokens`, the new LLM + voice tables — every existing row + column stays. We ADD `advisorpilot_tasks`, `advisorpilot_notes`, `advisorpilot_activity_log` as new sidecar tables and ADD a few nullable columns to `advisorpilot_clients` for `owner`, `tags`, `stage`. |
| **Client magic-link upload** | The public `/client-upload/[token]` flow is unrelated to the advisor product and unaffected. |
| **Demo mode + print CSS** | Demo mode (skip auth + load demo data) and the print-optimized report page keep working. Print styles are scoped to the report tab. |
| **Voice agent persona + tools** | The Gemini Live voice agent keeps every tool it has. It gains new tools (`create_task`, `complete_task`, `list_tasks`, `log_note`) — see §6 of `20-technical-specs.md`. |
| **Auth model** | Three-path auth (Google NextAuth / Supabase JWT / upload-token) unchanged. |

## 4. What's new

| Surface | Status | Notes |
|---|---|---|
| **Side-nav rail** | New | `components/crm/app-rail.tsx`. Replaces `AppTopNav()` (lines 667-747 of `app/app/page.tsx`). |
| **Top header bar** | New | `components/crm/top-header.tsx`. Page title + global search + "New client" button + bell + avatar. |
| **Dashboard / Roster homepage** | New | `app/app/crm/page.tsx`. Two-pane Roster (client list + selected-client overview). |
| **Client detail tabs** | New | `app/app/crm/[clientId]/page.tsx` + sub-routes for each tab. |
| **Tasks** | New | Per-client and global-roll-up view. `advisorpilot_tasks` table. |
| **Notes** | New | Per-client. `advisorpilot_notes` table. |
| **Activity timeline** | New | Per-client. `advisorpilot_activity_log` table (auto-populated by audit events + manual entries). |
| **Contacts** | New | Per-client related people (spouse, children, attorney, CPA). Phase 2 in v1 — appears in JSON in `client.contacts` for now. |
| **Global Tasks page** | New | `app/app/tasks/page.tsx`. Flat list across all clients. |
| **Reports archive** | New | `app/app/reports/page.tsx`. Lists generated PDFs. |
| **Settings page** | Restructured | `app/app/settings/page.tsx`. Subsections: Profile, AI Models, Voice Agent, Disclosures. Replaces the current "settings card" embedded in `app/app/page.tsx`. |

## 5. The user journey it produces

### Login → Intake (unchanged from today)

1. Advisor signs in (Google or email/password).
2. **Default route is `/app/intake`.** The advisor lands on the 10-question new-client wizard — same place they land today. The visible difference: there's a side rail on the left with CRM / Tasks / Reports / Settings as peer items, instead of a top nav.
3. The advisor can complete the intake to start a new client, or click **CRM** in the rail to manage existing clients.

### "Show me Sarah Chen"

1. Advisor clicks **CRM** in the rail → `/app/crm` (Roster opens; client list on left, most-recently-viewed client auto-selected on the right).
2. Then either:
   - **Clicks** the Sarah Chen row in the left list → URL becomes `/app/crm/c01`, right pane updates.
   - Or says "Open Sarah Chen" to the voice agent → `open_client({ name: "Sarah Chen" })` → same URL change (the agent navigates straight to her, bypassing the roster step).
2. Profile header renders KPIs from `client.totalValue`, `analysis.ytdReturn`, `client.accounts.length`, `client.nextMeetingAt`.
3. Overview tab loads. Tabs deep-link via URL (`/app/crm/c01/notes`, `/app/crm/c01/tasks`, etc.).

### "Run analysis for Sarah"

1. From Sarah's overview the advisor clicks **"Run analysis"** (a contextual action in the Portfolio card) OR clicks the existing **Analysis** tab.
2. URL: `/app/crm/c01/analysis`.
3. The same analysis flow renders (data-fetched from the same `/api/generate-analysis` route). Synopsis, scores, red flags, recommendations — same payload, just inside the CRM shell rather than a top-level page.

### "I just talked to Robert"

1. Advisor clicks **"Log note"** in his profile header → side drawer opens.
2. Types a note → drawer saves to `advisorpilot_notes` + writes an entry to `advisorpilot_activity_log` + updates `client.last_contacted_at`.
3. Drawer closes; the timeline card on Overview gains a new "Note · D. Patel · just now" entry.

### "What do I owe people?"

1. Advisor clicks **Tasks** in the rail → `/app/tasks`.
2. Flat list of every open task across all clients, sorted by due date.
3. Each row links back to its client (`/app/crm/[clientId]/tasks`).
4. Voice equivalent: "What do I have due today?" → `list_tasks({ due: "today" })`.

### Mobile (≤640px)

- Rail collapses to a bottom tab bar.
- Roster list and client detail become separate routes: `/app/crm` shows the list; tapping a row navigates to `/app/crm/[clientId]/overview`.
- Profile header collapses to a single column.
- Tabs become horizontally scrollable.

## 6. Design language we adopt

From the AP2 design tokens (verbatim names already match what `app/globals.css` defines):

**Colors** — already in `app/globals.css`:
- `--ap-navy` `#0C1929` (rail bg, primary text, headings)
- `--ap-navy-mid` `#153A5C`
- `--ap-royal` `#0F6FDE` (primary CTAs, active states, accent borders)
- `--ap-royal-hover` `#0D5EC4`
- `--ap-pilot-light` `#CCE4FF` (selected row bg, active chip bg)
- `--ap-pilot-light-border` `#7EB3E8`
- `--ap-gray` `#6B7280` (meta text)
- `--ap-border` `rgba(12, 25, 41, 0.12)` (hairlines)
- `--ap-border-strong` `rgba(12, 25, 41, 0.20)` (pane dividers)
- App bg `#F5F6F8`, card bg `#FFFFFF`

**Status tones** — to add to `globals.css` if not present:
- Warn (overdue): bg `#FFF5E6` text `#92400E`
- Danger (high-priority / at-risk): bg `#FDECEC` text `#9B1C1C`
- Success (positive delta / on-track): bg `#E6F4EE` text `#065F46`
- Success accent (positive number): `#047857`

**Typography:**
- **Display** Fraunces — 40-60px (page titles), 28px (section h2), 22px (KPI value with `font-variant-numeric: tabular-nums`), 18px (card titles).
- **Body** Inter — 13px (default body), 12.5px (button), 11.5px (meta), 11px (chip), 10.5px (eyebrow uppercase with 0.18em letter-spacing).

**Surface rules:**
- **Sharp corners everywhere.** `border-radius: 0`. (The current AdvisorPilot product is already mostly sharp-cornered; the few rounded cards in the report page stay rounded — they're in PDF output and not part of the CRM shell.)
- 1px borders using `--ap-border`.
- No drop shadows on cards. Subtle `0 1px 0 rgba(12, 25, 41, 0.03)` only on detached top headers.

**Spacing rhythm:**
- 4 / 8 / 12 / 14 / 16 / 18 / 20 / 28 px tokens. Use the existing Tailwind scale (`gap-1` through `gap-7` and equivalents).

## 7. Why Option B (vs A and C)

Option A "Ledger" treats clients as ledger rows; Option C "Cadence" is a workflow-pipeline view. We picked **Roster** because:

1. **Lowest cognitive switch from today.** The advisor's mental model is "I work on one client at a time" — Roster makes that explicit by always centering the selected client on the right.
2. **Best fit for the existing 10-step workflow.** Roster's tabbed detail naturally absorbs the existing steps (intake / upload / confirm / analysis become tabs).
3. **Mobile-friendly.** Two-pane → list-then-detail at ≤640px works cleanly; Ledger's grid and Cadence's kanban both break on small screens.
4. **Familiar pattern from CRMs the audience already uses** (Salesforce, Wealthbox, Redtail). Lower training cost.

## 8. The two intake modes

The current app has ONE intake: a 10-question wizard the advisor walks through. After Option B there are TWO contexts for that same wizard:

| Mode | URL | When |
|---|---|---|
| **New-client intake** | `/app/intake` | Advisor wants to start a brand-new client. Reachable from rail's "Intake" item or the "New client" button in the top header. |
| **Edit-existing intake** | `/app/crm/[clientId]/intake` | Advisor is on a client and wants to update demographics, risk, goal, etc. Reachable from the Profile facts card → "Edit". |

Both modes render the same `<IntakeWizard />` component. The differences:

- **New-client mode** (`/app/intake`) — starts at step 0 and walks linearly. The advisor uses the wizard's existing side rail of step numbers to jump ahead, but the default flow is sequential.
- **Edit-existing mode** (`/app/crm/[id]/intake`) — hydrates from `advisorpilot_clients` row AND honors `?step=N` deep linking from the start. Profile facts card on the Overview tab has per-field "Edit" pencils that link directly to `/app/crm/[id]/intake?step=N` for the relevant question. Random access by design; the side rail is identical to new-client mode.

The voice agent's `navigate({ step: "intake" })` resolves to the new-client URL when no client is open, and to the edit-existing URL when one is. `navigate_intake_step({ index: N })` works in both modes — in edit-existing it deep-links via `?step=N`.

## 9. Open questions (carry forward to `40-path-forward.md`)

These need product calls before Phase 2 (per the AP2 audit's Section H):

- **YTD return source** — Is there a stored value, or do we compute it from holdings + (cost basis or prior period)? Phase 1 displays `null` if not computable.
- **Stage logic** — `stage` is a string ("Review due", "At risk", etc.). Computed from `review_due_at` + `next_meeting_at` + `status`, or persisted? Phase 1 persists.
- **Task ownership** — Single-advisor in v1 (matches existing multi-tenancy). Multi-assignee deferred.
- **Search scope** — Phase 1: name + household. Phase 2 adds tags/email/phone.
- **Filter persistence** — Phase 1: in-URL searchParams. Phase 2: optional localStorage.

## 10. Success criteria

A working v1 hits all of these:

1. Default `/app` redirects to `/app/intake` — the advisor's first impression is the new-client wizard inside the CRM shell, exactly as today's UX expects.
2. CRM is reachable in one click via the rail; from CRM, any saved client is reachable in two clicks (rail → row).
3. All existing flows (`intake` through `report`) still run end-to-end via the new URLs. Voice agent's `navigate()` still works for all 11 step names.
4. Tasks + Notes + Activity-log persist to Supabase, scoped per-advisor, scoped per-client.
5. The 8,279-line `app/app/page.tsx` is decomposed into ≤500-line route components — no file over 1k lines.
6. Feature flag `CRM_SHELL=off` reverts to the legacy single-page experience without code rollback (no `NEXT_PUBLIC_` prefix — server-only, runtime-readable).
7. No new lint errors, no regressed tests, no broken Supabase queries.

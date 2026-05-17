# 40 · Path Forward

Sequenced rollout, per-phase gates, risks + mitigations, dependencies, owners.

## 1. Phase summary

| # | Name | Days | Ships | Visible to advisor |
|---|---|---|---|---|
| **0** | Skeleton + flag + org schema + backfill | 2½ | Routes + shell + feature flag. Org schema + RLS helpers + sharing tables. Backfill runs in the same deploy. `ensurePersonalOrg()` helper for future signups. | No (flag off) |
| **1** | Read-only Roster + visibility resolver | 5 | Roster list, Profile header, Overview, new API routes (calling the SQL visibility functions). **Voice nav aliases moved to Phase 4 — see 30-§4.** | Yes (flag on; voice still legacy-only) |
| **2** | Tasks + Notes + Activity | 5 | Full CRUD UIs (org-scoped from creation), drawers, side-effects | Yes |
| **3** | Workflow extraction | 8 | Each of 10 step blocks → its own component file → mounted as a tab | Yes, one tab per sub-phase |
| **4** | Voice in CRM (mount + nav aliases + read tools) | 4 | `<VoiceAgent>` mounted in CRM shell with router.push() adapter; navigation aliases for all 11 step names; `list_tasks`, `get_recent_activity`, `get_notes` tools; persona prompt update | Yes |
| **4.1** | Voice CRM write tools | 2 | `create_task`, `log_note`, `complete_task` — gated by `voice_can_write` | Opt-in advisor pref |
| **5** | Cutover | 2 | Flag flipped on by default, legacy redirect, cleanup PR | Yes (mandatory) |
| ─── | **CRM v1 SHIPS** | — | — | — |
| **6** | Organizations & sharing UI | 8 | Share drawer, org settings page, invite flow, voice share tools (incl. persona update for org-mate clients) | Yes (opt-in cohort first) |
| **7** | Resolver cleanup + audit org scope | 3 | `CHECK (org_id IS NOT NULL)` constraint, org-aware audit views | Behind admin role |

**Total v1 (Phases 0–5):** ~29 working days (was ~28; Phase 4 absorbs the voice-mount work that was originally going to land in Phase 1 — same total work, different sequencing). **v1 + sharing (Phases 0–6):** ~37 days.

The backfill merges into Phase 0 because it's purely additive (writes only to new columns + new tables; zero impact on existing reads). Running it in the same deploy as the schema means every Phase-1 write already has the correct `org_id`.

## 2. Phase-by-phase detail

### Phase 0 — Skeleton (Days 1-2)

**Scope** (per `10-implementation.md §3`):
- New route tree under `app/app/(crm)/`
- `<CrmShell />` + `<AppRail />` + `<TopHeader />` (placeholder content)
- Feature flag wiring in legacy page and CRM layout
- `lib/crm/feature-flag.ts`

**Gate:**
- `npm run build` clean
- `npm test` no regressions
- Manual: flag off → legacy works exactly as today; flag on → all CRM routes render the placeholder shell
- Voice agent + Settings drawer still functional in legacy mode

**Risk:** None — additive routes, zero behavior change.

**Owner:** TBD (single dev; small scope).

---

### Phase 1 — Read-only Roster (Days 3-7)

**Scope:**
- Apply `supabase/advisorpilot_crm_schema.sql` to add the three new tables + nullable columns on `advisorpilot_clients`. (Already done in Phase 0 via `_apply_crm_phase0_migrations.sql`.)
- Build `/api/clients` + `/api/clients/[id]` + `/api/activity` GETs.
- Build `lib/crm/stage.ts` with unit tests.
- Roster UI: list, filter chips, search, sort, selection → URL.
- Profile header with KPI strip.
- Overview tab with placeholder cards for tasks/notes/timeline (real allocation + accounts + profile facts).

**Voice in this phase:** None inside the CRM shell. Voice continues to work on the legacy `/app` (with `CRM_SHELL=off`) exactly as today; flag-on internal testers temporarily lose voice in CRM until Phase 4 wires it. Decision recorded in Phase 0 (2026-05-15) — see `30-backward-compat.md §4`.

**Gate:**
- An advisor with ≥3 saved clients sees them all in the new Roster.
- Click a row → URL updates → Profile header renders correctly with KPIs.
- New API routes return `200` with the documented shapes; auth gating works (`401` without identity).
- Existing routes unaffected: `/api/client-database`, `/api/analyze-statement`, `/api/generate-analysis` all unchanged.
- Stage compute unit tests pass.
- Legacy voice still works on `/app` when flag is off.

**Risk:** Roster perf with >100 clients.
**Mitigation:** Phase 1 ships without virtualization; if any tester has >100 clients, virtualization moves into Phase 1.5 before Phase 2.

**Risk:** A stage-compute rule mismatch causes wrong chip color.
**Mitigation:** Unit tests for `computeStage` cover the 6 stage values with 3 cases each. UI shows the persisted `stage` when present, computed when null — never both.

**Risk:** Loading a client with `client.ytdReturn = null` shows "—" or breaks the KPI.
**Mitigation:** KPI renderer treats null as "—" explicitly; documented in component spec.

**Owner:** TBD.

---

### Phase 2 — Tasks + Notes + Activity (Days 8-12)

**Scope:**
- `/api/tasks` + `/api/notes` + `/api/activity` POST/PATCH/DELETE.
- Drawers: `<LogNoteDrawer />`, `<AddTaskDrawer />`.
- Overview cards: Tasks (open list with checkboxes), Pinned Note, Timeline.
- Tab views: `/app/crm/[id]/tasks`, `/notes`, `/timeline`.
- Global `/app/tasks` page (flat list across all clients).
- Side effects: note creation → activity log + `last_contacted_at` advance; task creation/completion → activity log.

**Gate:**
- Logging a note updates the Pinned Note card immediately (optimistic UI) and the timeline within 1 round-trip.
- Adding a task appears in client's Tasks tab + global `/app/tasks`.
- Completing a task strikes through and moves to Done section.
- `advisorpilot_clients.last_contacted_at` advances when a note is logged.
- RLS verified: a second test advisor cannot see the first's tasks/notes (via Supabase SQL editor as the second advisor's JWT).

**Risk:** Optimistic UI rolls back loudly on failure.
**Mitigation:** Toast on failure; row gets a red error state with retry button.

**Risk:** Note `body` could be huge — performance issue in timeline render.
**Mitigation:** Timeline truncates body to 280 chars with "show more"; full body in Notes tab only.

**Risk:** Concurrent edit of the same task from two browser tabs.
**Mitigation:** Last-write-wins; no optimistic locking in v1 (acceptable for single-advisor multi-tab).

**Owner:** TBD.

---

### Phase 3 — Workflow extraction (Days 13-20)

Eight days, one extraction per day (10 blocks × ~0.8 days each accounting for review + visual diff).

**Order** (low-risk to high-risk):

| Day | Block | Risk profile |
|---|---|---|
| 13 | Intake wizard | Low — pure form, well-isolated |
| 14 | Upload section | Low — file inputs, isolated |
| 15 | Confirm holdings | Medium — table renders + edit-in-place |
| 16 | Analysis view | Low — read-only display |
| 17 | Meeting guide | Low — read-only display |
| 18 | FIA calculator | High — complex math, many controls |
| 19 | Roth worksheet | High — same |
| 20 | Retirement income + Fee analysis + Report | Medium — each ~2hrs |

**Per-extraction protocol:**
1. Copy JSX block into new `components/workflow/<name>.tsx`.
2. Replace state references with `useAdvisorClient()` context calls.
3. Render the new component in BOTH the legacy page (where the block used to live) AND the new tab page.
4. **Visual-diff manually** — open `/app/legacy?step=<x>` and `/app/crm/[id]/<x>` side-by-side in two browser tabs. Must be pixel-equivalent. (No Playwright `toMatchSnapshot` infrastructure — the maintenance overhead of snapshot tests isn't worth it for 10 one-shot extractions. Re-evaluate in v2 if we accumulate more component-level changes that need regression protection.)
5. Land the PR with both still mounted. Don't remove the legacy mount until Phase 5.

**Gate (per extraction):**
- Visual diff clean.
- All forms still submit to the same API endpoints with the same payload.
- Voice agent's `navigate(<step>)` lands on the new URL.

**Risk:** State coupling — some legacy block reads a state hook another block writes.
**Mitigation:** Map state-hook ownership before extraction starts. Anything read by multiple blocks moves to context first (small PR), then individual blocks extract.

**Risk:** Print-mode CSS breaks when report tab is in a CRM shell.
**Mitigation:** `print:hidden` on `<AppRail />` and `<TopHeader />`. Visual-test the printed report (with browser print dialog) before landing Report extraction.

**Owner:** TBD.

---

### Phase 4 — Voice in CRM: mount + nav aliases + read tools (Days 21-24)

**Scope** (combines the original Phase-1 voice work that was deferred per `30-backward-compat.md §4` with the original Phase-4 read-tool scope):

1. **Mount `<VoiceAgent>` inside the CRM shell.** Add it to `app/app/(crm)/layout.tsx` (or a child client component the layout renders) so voice is available on every CRM route. The legacy mount at `legacy-app-shell.tsx:8276` stays put — both mounts coexist; only one renders at a time depending on the URL.
2. **CRM-side action adapter.** A new `lib/voice/crm-actions.ts` translates `navigate(step)` calls to `router.push()` (using `useRouter()` from `next/navigation`) instead of legacy state setters. Handles the 11 step strings per the table in `30-backward-compat.md §4`. Handles `open_client` via `router.push("/app/crm/[id]")`. Handles `navigate_intake_step` via the `?step=N` query param.
3. **New voice read tools** (call existing CRM APIs from Phases 1-2): `list_tasks`, `get_recent_activity`, `get_notes`.
4. **Persona prompt update** in `lib/voice/prompts/advisor.txt` — adds the new aliases AND the read-tool trigger phrases ("what's on my plate today?", "what did I talk to Sarah about?", "any open tasks for Robert?").
5. **Eval fixtures** in `lib/voice/eval/conversations.test.ts` covering navigation + read tools.

**Gate:**
- Voice agent button is present on every CRM route (rail-bottom or top-header — TBD by Phase 4 design).
- "Open Sarah Chen" → `router.push("/app/crm/[sarah.id]")` → Roster updates.
- "Go to her FIA calculator" (with Sarah open) → `router.push("/app/crm/[sarah.id]/fia")`.
- "What do I have due today?" → agent calls `list_tasks({ due: "today" })` → speaks count + names top 3.
- "What's the latest on Sarah?" (with Sarah open) → `get_recent_activity({ clientId })` → speaks last 3 entries.
- Audit log records each tool call.
- Legacy voice still works on `/app` when flag is off (regression check — we're adding a parallel mount, not modifying the legacy one).

**Risk:** Agent over-calls tools.
**Mitigation:** Persona instruction: prefer in-context answers when possible. Limit fan-out by capping result lists.

**Risk:** Two `<VoiceAgent>` mounts double-emit something at the layout boundary.
**Mitigation:** They're behind the `CRM_SHELL` flag on/off split — never both render simultaneously. Smoke-test both states.

**Owner:** TBD.

---

### Phase 4.1 — Voice write tools (Days 24-25)

**Scope:**
- New voice tools: `create_task`, `complete_task`, `log_note`, `log_call`, `update_client_stage`.
- New advisor pref `voice_can_write` (default false) in `advisorpilot_voice_settings`.
- Tools gated on `voice_can_write = true` AND `voice_audit_tool_calls = true`.
- Persona update with confirmation rules ("Logging a note that Robert called about RMD strategy — saving now. Say cancel within 5 seconds if that's wrong.").
- 5-second cancel-window UX (red "Undo" toast).

**Gate:**
- Opt-in advisor flips `voice_can_write` → write tools become callable.
- "Remind me to send the IPS tomorrow at 9am" → agent confirms aloud → creates a task with `due_date=tomorrow`, `due_time=09:00`.
- "Cancel" within 5s reverts the task creation.
- Audit log shows the create + the cancel.

**Risk:** Agent hallucinates a write action when user was just talking.
**Mitigation:** Strict trigger phrases in persona. Confirmation aloud is non-negotiable. Cancel window is 5s with visible UI prompt. Eval suite has 5 cases where the advisor's speech sounds like an action but isn't (e.g. "I was thinking I should send the IPS" → must NOT create a task).

**Owner:** TBD.

---

### Phase 5 — Cutover (Days 26-27)

**Scope:**
- `CRM_SHELL=on` set in production Vercel env (server-only flag — no redeploy required for the flip).
- `app/app/page.tsx` becomes ~30 lines: redirect to `/app/crm`.
- `app/app/legacy/page.tsx` is renamed from the old `page.tsx` and kept for one release as the emergency backstop.
- Voice agent persona prompt drops legacy step-name aliases that are no longer needed.

**Gate:**
- All advisors sees CRM by default on next login.
- `/app/legacy` still works for ~30 days (advertised internally only).
- No production errors in Vercel logs for 48 hours.

**Cleanup PR (Day +30):**
- `app/app/legacy/page.tsx` deleted.
- Feature flag deleted.
- All `?step=` and `?clientId=` legacy URL parsing deleted.

**Risk:** A subset of advisors miss the legacy workflow.
**Mitigation:** Survey advisors during Phase 5 week. If significant resistance, defer cleanup PR by 30 days and keep the legacy backstop accessible at `/app/legacy`.

## 3. Cross-cutting concerns

### 3.1 Telemetry

`lib/llm/observability.ts` already emits `[llm]` lines. Add `[crm:nav]` and `[crm:api]` lines (per `20-technical-specs.md §11`) from Phase 0. The single dashboard (your terminal or Vercel logs) shows:

- Provider routing (already there).
- CRM page loads and durations.
- API call durations + errors.
- Voice tool calls (already there).

### 3.2 Documentation updates

Each phase lands a CHANGELOG entry in `docs/CHANGELOG.md` and a short note in `CLAUDE.md`'s Architecture section if anything load-bearing changes.

### 3.3 PR sizing

- Phase 0: 1 PR.
- Phase 1: 3-4 PRs (DB migration, APIs, UI, voice persona update).
- Phase 2: 3 PRs (APIs, drawers/UI, global tasks page).
- Phase 3: 10 PRs (one per workflow block).
- Phase 4: 1 PR.
- Phase 4.1: 1 PR.
- Phase 5: 2 PRs (cutover + cleanup).

Total: ~22 PRs over ~6 weeks. Reviewable.

### 3.4 Environment knobs added

| Env var | Phase | Purpose |
|---|---|---|
| `CRM_SHELL` | 0 | `on` / `off` (default off until Phase 5). Server-only — no `NEXT_PUBLIC_` prefix; runtime-readable in Vercel without a redeploy. |
| `CRM_LANDING` | 0 | Redirect target when shell is on. Default `/app/crm` (Roster) during Phases 0-2 when intake isn't extracted yet. Flip to `/app/intake` at Phase 3 day 1 once the wizard is real. |
| (future v1.5) `advisorpilot_advisor_profiles.crm_shell_enabled` | — | Per-advisor opt-in for cohort rollout. Not in v1. |
| (none others) | — | Reuses existing Supabase + auth + LLM env vars |

## 4. Risk register

| # | Risk | Likelihood | Impact | Mitigation phase |
|---|---|---|---|---|
| R1 | Workflow extraction breaks pixel-equivalence | Med | High | Phase 3: visual diff per PR; revert if not equivalent |
| R2 | Stage-compute logic shows wrong chip | Low | Med | Phase 1: table-driven unit tests; manual QA on 10 sample clients |
| R3 | `advisorpilot_clients` queries slow as we add columns | Low | Low | Phase 1: new columns are not in any current WHERE clause; existing indexes unaffected |
| R4 | Voice agent creates a task when the advisor was thinking aloud | Med | Med | Phase 4.1: persona strict triggers + audible confirmation + 5s cancel window |
| R5 | Advisor lands on Intake and doesn't realize the CRM exists | Med | Med | Phase 1: completion step on intake nudges "Saved! Find this client in the CRM →"; rail badge appears once the first client is saved |
| R5b | An advisor with 0 saved clients clicks CRM and sees an empty roster | Low | Low | Phase 1: empty state "No saved clients yet — start your first one in Intake →" with a clear back-arrow to `/app/intake` |
| R6 | Print mode breaks when Report tab is inside CRM shell | Med | High | Phase 3 step 10: explicit visual-diff for printed PDF before landing |
| R7 | Voice agent's `getState()` returns stale data after URL push | Low | Med | Phase 1: voice provider's React context subscribes to router events |
| R8 | An advisor in a long Roth worksheet session loses state when navigating tabs | Low | High | Phase 3: AdvisorClientProvider treats Roth/FIA worksheets as dirty-tracked; navigating away prompts "save?" |
| R9 | Mobile experience cramped at ≤640px | Med | Med | Phase 1: mobile breakpoint testing on iPhone SE viewport; Phase 5 dedicated mobile-polish day if needed |
| R10 | Cutover (Phase 5) reveals broken voice persona alias not caught earlier | Low | Med | Phase 4-5: dedicated voice eval suite run before flag flip |

## 5. Dependencies

- **Supabase migration applied** before Phase 1 PR lands. Use `supabase/_apply_all_new_migrations.sql` pattern (combined idempotent file).
- **Feature flag set in Vercel** before Phase 1 deploy. Defaults to `off`.
- **Voice persona file updated** with new aliases — coordinate with Phase 1 deploy.
- **Existing test suite must be green** at the start of every phase.

## 5.5 Follow-up cleanup tickets (non-blocking, surfaced by schema audit)

Tracked separately from the CRM rollout — these don't affect any phase but should land at some point:

| Ticket | Description | Where it came from |
|---|---|---|
| **RLS parity** | `advisorpilot_voice_settings`, `_voice_audit_log`, `_deep_research_jobs` have RLS enabled but no policies (deny-all-non-service-role). Inconsistent with the rest of the schema. Add full RLS policies matching the clients/documents pattern. | Schema audit Finding 2 |
| **Securities-master column rename** | `advisorpilot_securities_master` has columns with literal spaces and a typo: `"Ticker Symbols"`, `"Holding Name"`, `"Investment Type"`, `"Share Class"`, `"Asset Class"`, `"Domestic, Foriegn, Global"` (note the "Foriegn" misspelling). Rename to snake_case + fix the typo. Outside CRM scope. | Schema audit Finding 6 |
| **Magic-link ingest sets `status='Prospect'`** | The schema's `advisorpilot_clients.status` defaults to `'Analyzed' NOT NULL`. Confirm the magic-link ingest sets it to `'Prospect'` so the Roster's Prospect filter chip works. One-line fix; flagged in `30-backward-compat.md §9`. | Schema audit Finding 5 |

## 6. Out of scope (deliberately deferred)

- **Email send/receive.** Communications shown in the timeline but no compose surface.
- **Calendar integrations.** `next_meeting_at` is stored, not synced.
- **Multi-advisor / team views.** Single-advisor view only.
- **Pipeline / opportunity stages.** Option C "Cadence" pattern.
- **Tags taxonomy.** Free-form string tags only; no shared vocabulary or autocomplete.
- **Bulk operations.** No multi-select row actions.
- **Document upload (in the Documents tab).** v1 surfaces existing `advisorpilot_documents` only; uploading is still done from the Upload tab.
- **Mobile-optimized print/PDF.** Print mode stays desktop-aware.
- **Reports archive auto-store.** v1 lists rows from `advisorpilot_documents` only.
- **Voice agent's full Athena-style Nudge queue.** The voice plan already designed it; it stays "infrastructure ready, no tools using it" until v2.

## 7. Success metric

A working v1 (post-Phase 5) hits all three:

1. **Time-to-first-action.** Advisor logs in → lands on `/app/intake` (today: equivalent) → reaches an existing client's overview in **≤2 clicks** via the rail's **CRM** item + row click (today: ≥5).
2. **Stickiness of CRM.** 50%+ of advisor sessions touch the Tasks or Notes tab.
3. **No regressions.** Zero new errors in production logs vs. the 30 days before cutover. All legacy advisor workflows complete successfully.

Measured 30 days post-cutover.

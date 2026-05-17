# 30 · Backward Compatibility

How the legacy app keeps running while the CRM ships. Explicit rules + the carry-over surface for every existing concern.

## 1. The single switch

`CRM_SHELL` (server-only, NOT `NEXT_PUBLIC_`) is the only thing that decides whether an advisor sees the new shell.

| Flag value | `/app` | `/app/crm` | New tables | Existing tables |
|---|---|---|---|---|
| `off` (default) | Legacy single-page workflow | redirects to `/app` | exist but dormant | unchanged |
| `on` (Phase 5+) | Redirects to `/app/intake` | New Roster shell | active | unchanged |
| `on` (Phase 0–2 internal-only) | Redirects to `/app/crm` (intake placeholder not real yet) | New Roster shell | active | unchanged |

The flag is read at request-time on the server (no client-bundle inlining because it lacks the `NEXT_PUBLIC_` prefix). **A single env-var flip in Vercel restores the legacy experience** without a redeploy.

## 2. Database rules

Every database change in this work passes the additive-only test from the multi-provider plan §0:

| Rule | Compliance |
|---|---|
| No existing column dropped | ✅ |
| No existing column renamed | ✅ |
| No NOT NULL added to existing tables | ✅ |
| No CHECK constraint added that could fail on existing rows | ✅ |
| New columns are nullable with no DEFAULT | ✅ — `advisorpilot_clients` gains 13 new columns (11 CRM-only per `20-technical-specs.md §1.2` + the `org_id`/`visibility` pair per `50-organizations-and-sharing.md §3.4`), all nullable, all default-less |
| New tables are sidecar, no FK from existing → new | ✅ — FKs go new → existing only |
| Every CREATE/ALTER uses IF NOT EXISTS | ✅ |
| Migration runs in any order | ✅ — idempotent |

**Dropping the new tables and columns at any phase is safe.** The CRM UI degrades gracefully (empty roster, no tasks, no notes); the legacy app keeps working because it never reads them.

### 2.1 Explicit "do not change" list

Forbidden during this work (would break production):

- `advisorpilot_clients.client` (JSONB) — the legacy app reads from this. CRM components also read from this when the new top-level columns are NULL.
- `advisorpilot_clients.holdings`, `analysis`, `roth_worksheet` — legacy app writes these via `/api/client-database`. CRM components read them via `/api/clients/[id]` which fans out to the same JSONB blobs.
- `advisorpilot_advisor_profiles.*` — unchanged (LLM prefs additions already landed in the prior PR).
- `advisorpilot_audit_events` — keep writing here from existing routes; the new `activity_log` is a separate stream optimized for the UI timeline (denormalized, indexed for client+occurred_at).

## 3. URL aliases and redirects

The legacy URL space is preserved. Intake stays the landing surface — only the chrome around it changes (top-nav → side-nav):

| Legacy URL | Flag off | Flag on |
|---|---|---|
| `/app` | Renders single-page workflow (lands on `step="intake"`) | **Redirects to `/app/intake`** (lands on the new-client wizard inside the CRM shell) |
| `/app?step=intake` | Renders legacy with `step="intake"` | Resolves to `/app/intake` |
| `/app?step=<other>` | Renders legacy with that step | Resolves to `/app/legacy?step=<x>` (legacy preview escape hatch) — Phase 5 removes after every block is extracted |
| `/app?clientId=c01` (rare; advisor-shared) | No-op (legacy doesn't honor) | Resolves to `/app/crm/c01` |
| `/app/legacy` | 404 | Renders legacy single-page workflow (emergency backstop) |
| `/app/legacy?step=…` | 404 | Renders legacy with state pre-set |
| `/client-upload/[token]` | unchanged | unchanged |
| Marketing routes | unchanged | unchanged |

Phase 5 deletes the `?step=` and `?clientId=` search-param aliases; before then they're honored to make experimentation reversible.

## 4. Voice agent: step-name continuity

**Decision (Phase 0, 2026-05-15): voice in CRM is deferred to Phase 4.** The original plan had a `<VoiceStateProvider>` mounted at `app/app/layout.tsx` above both shells, with one action adapter dispatching by `window.location.pathname`. Reality at Phase 0 start: `<VoiceAgent>` is a leaf inside the legacy `legacy-app-shell.tsx` (line 8276) consuming `voiceActions` from the page's local state — there is no provider. Hoisting it would require refactoring load-bearing legacy code in Phase 0; deferring lets us ship Phase 0 without touching the voice path.

**What this means concretely:**

- Phases 0–3: voice continues to work on the legacy `/app` shell (with `CRM_SHELL=off`) exactly as today. Voice does NOT work inside the new CRM routes (`/app/crm`, `/app/intake`, `/app/tasks`, `/app/reports`, `/app/settings`) during this window — internal testers flipping the flag lose voice access until Phase 4 wires it in. This is acceptable because no advisor-facing rollout happens until Phase 5.
- **Phase 4** (formerly "Voice CRM read tools") absorbs the voice-in-CRM integration: mounts `<VoiceAgent>` inside the CRM shell with a CRM-specific action adapter that calls `router.push()` instead of state setters, and ships the navigation aliases below. The legacy mount at `legacy-app-shell.tsx:8276` stays put.
- **Phase 5** cutover: when the legacy shell is retired, only the CRM mount remains.

**Two `<VoiceAgent>` mounts coexist during the rollout window** (Phase 4 → Phase 5). They never both render at once — the legacy mount only renders when `CRM_SHELL=off`, the CRM mount only when on. Both consume the same `lib/voice/tool-handlers.ts` types, just with different action adapters.

**The CRM-side adapter (lands in Phase 4)** dispatches the existing 11 step strings to `router.push()` calls. Same step name continuity the original plan promised; just delivered later in the rollout:

| Legacy step | Flag off → state setter (legacy mount) | Flag on → URL push (CRM mount, Phase 4+) |
|---|---|---|
| `"intake"` | `setStep("intake")` | `/app/crm/[activeId]/intake` (or `/app/intake` if no client) |
| `"upload"` | `setStep("upload")` | `/app/crm/[activeId]/upload` |
| `"confirm"` | `setStep("confirm")` | `/app/crm/[activeId]/confirm` |
| `"analysis"` | `setStep("analysis")` | `/app/crm/[activeId]/analysis` |
| `"meeting"` | `setStep("meeting")` | `/app/crm/[activeId]/meeting` |
| `"fia"` | `setStep("fia")` | `/app/crm/[activeId]/fia` |
| `"roth"` | `setStep("roth")` | `/app/crm/[activeId]/roth` |
| `"retIncome"` | `setStep("retIncome")` | `/app/crm/[activeId]/ret-income` |
| `"feeAnalysis"` | `setStep("feeAnalysis")` | `/app/crm/[activeId]/fee-analysis` |
| `"report"` | `setStep("report")` | `/app/crm/[activeId]/report` |
| `"saved"` | `setStep("saved")` | `/app/crm` |

`navigate_intake_step({ index })` works in both worlds; the CRM adapter (Phase 4+) pushes `/app/intake?step=N` or `/app/crm/[id]/intake?step=N`.

`open_client({ name })` works in both; the CRM adapter calls `router.push()` instead of setting in-memory state.

**Persona prompt is updated** (`lib/voice/prompts/advisor.txt`) in the **Phase 4 PR** that ships the CRM voice mount, NOT in Phase 1. The persona is loaded at session-mint time so we can ship the v2 prompt alongside the CRM-side voice integration without affecting the legacy mount during Phases 0–3.

## 5. API contracts

### 5.1 Legacy endpoints (unchanged contracts forever)

- `GET /api/client-database` — same `{ clients: SavedReview[] }` response. The CRM UI doesn't use this; it uses `/api/clients`. Both endpoints coexist.
- `POST /api/client-database` — same accept/return. Used by the legacy save flow AND by Phase 3+ tabs that mutate `client`/`holdings`/`analysis`.
- `DELETE /api/client-database` — unchanged.
- `POST /api/analyze-statement` — unchanged.
- `POST /api/generate-analysis` — unchanged. Both legacy view and CRM Analysis tab call the same route.
- `POST /api/generate-report` / `generate-roth-report` — unchanged.
- `POST /api/email-client-snapshot` — unchanged.
- `POST /api/intake-voice|tts|stt` — unchanged.
- `POST /api/voice/token` + `/audit` + `/settings` — unchanged.
- `POST /api/research/*` — unchanged.

### 5.2 New endpoints

- `GET/PATCH /api/clients` + `/api/clients/[id]` — new shape; legacy never calls these.
- `GET/POST/PATCH/DELETE /api/tasks` — new.
- `GET/POST/PATCH/DELETE /api/notes` — new.
- `GET/POST /api/activity` — new.
- `GET /api/reports` — new.

If `/api/clients` is unreachable (e.g. CRM tables not yet migrated), the Roster page gracefully degrades: shows the legacy `SavedReview[]` shape via a fallback fetch to `/api/client-database` so the advisor isn't blocked.

## 6. In-memory state continuity

The biggest behavior risk: the legacy app holds `client`, `holdings`, `analysis` in **page-local React state**. Switching tabs / navigating today doesn't persist these to the DB until the advisor clicks Save. The CRM rebuild keeps that "draft" feel but moves the state from page-local to context-local.

| Concern | Legacy | CRM | Net |
|---|---|---|---|
| Advisor types into intake, navigates away, comes back | State persists in `page.tsx` while the route is mounted; lost on refresh. | Context persists across CRM tab routes; lost on hard refresh. | Equivalent. |
| Advisor opens a saved review | `setActiveReviewId(id)` + load JSONB into state. | `router.push("/app/crm/[id]")` + `AdvisorClientProvider` fetches detail + hydrates context. | Equivalent. |
| Advisor edits a holding, leaves the confirm tab | In-memory edit persists until they save. | Same — context preserves the edit across tab switches. | Equivalent. |
| Advisor refreshes mid-edit | Lost. | Lost. | Equivalent. |
| Advisor on legacy and presses Save | POST `/api/client-database`. | Same. | Equivalent. |

**The state model is identical; only the storage location moves** (from one giant `useState` block to a context provider).

## 7. Print / PDF generation

The current `step="report"` view uses extensive Tailwind `print:` modifiers (`app/app/page.tsx:3935-4012` and `7820-8121`). The print stylesheet hides the top nav (`print:hidden`), strips card borders, and lays out a clean letter-sized page.

Migration:
- Print styles move with the report block when `report-snapshot.tsx` is extracted (Phase 3).
- The CRM shell's `<AppRail />` and `<TopHeader />` get `print:hidden` so they vanish when the report tab is printed.
- The Report tab's URL `/app/crm/[id]/report` opens in a print-friendly layout that omits the tab bar and rail.

Verified by visual diff before merging Phase 3 step 10.

## 8. Demo mode

`demoMode` (current `boolean` flag in legacy page state) skips auth and loads `demoHoldings`. Carried forward:

- The CRM shell honors `?demo=1` search param. When set, `useAdvisorClient()` returns the demo client + holdings + analysis without calling Supabase.
- Demo routes: `/app/crm?demo=1` shows **exactly one demo client row** in the roster — the existing legacy `demoClient` projected into `ClientRosterItem` shape, with the same demoHoldings and demoAnalysis the legacy app uses. Avoids drift between legacy demo and CRM demo (single source of truth). `/app/crm/demo/overview?demo=1` opens that one client.
- `/app/legacy?demo=1` (and the legacy `/app?demoMode=true`) continue to work.

## 9. Client magic-link upload

The public `/client-upload/[token]` route is untouched. Phase 0–5 do not modify it. The advisor receiving a client's submission still sees the row in `advisorpilot_clients` via the existing ingest flow; CRM shows it in the Roster with `status = 'Prospect'` (set by the ingest route in Phase 1).

**Phase-1 implementation TODO** — confirm whether the existing magic-link ingest currently sets `status = 'Prospect'` or leaves it at the default `'Analyzed'`. Per the schema dump, `advisorpilot_clients.status` defaults to `'Analyzed' NOT NULL`. If the ingest doesn't override, the "Prospect" filter chip in the Roster will be empty. The fix is one line in the ingest route — but flagging here so we don't forget.

## 10. Auth

The three-path auth (Google NextAuth / Supabase JWT / upload-token) is unchanged. `resolveAdvisorIdentity(req)` is called from every new CRM route the same way it's called from legacy routes.

Voice agent token mint is unchanged. The persona prompt update in §4 above is the only voice-side touch.

## 11. Settings drawer

The current `LlmSettingsDrawer` (overlay invoked from the top-nav pill) moves into a proper `/app/settings` page in CRM mode. Behavior carries:

- In legacy mode: drawer overlay (unchanged).
- In CRM mode: dedicated `/app/settings/ai-models` page that renders the same form.
- Same `GET/POST /api/advisor-profile` endpoint, same payload shape.
- Same advisor preferences honored by the LLM registry (provider, per-pass model overrides).

## 12. Voice agent settings + audit log

Per voice agent plan: `advisorpilot_voice_settings` + `advisorpilot_voice_audit_log` are unchanged. Voice agent tool-call audit continues to write hashed args to the audit log; the new write tools (`create_task`, `log_note`, etc. in Phase 4) write to the same audit log with `tool` names like `"create_task"`.

## 13. Tests

Legacy test suite (`npm test`) continues to pass at every phase. Specifically:

- `lib/intake-config.test.ts` — intake state machine. The CRM keeps `canAdvanceIntakeStep` logic identical.
- `lib/holding-merge.test.ts` — holdings de-dup. Same data, same logic.
- `lib/openai-model-eval.test.ts` — LLM provider eval. Doesn't touch UI.
- `lib/llm/citation-filter.test.ts` — citation fix. Doesn't touch UI.
- `lib/llm/attachments.test.ts` — intake layer. Doesn't touch UI.

New tests added for CRM:
- `lib/crm/stage.test.ts` — `computeStage` rules.
- `lib/crm/feature-flag.test.ts` — flag behavior.
- `app/api/tasks/route.test.ts` — happy + auth + RLS paths.
- `app/api/notes/route.test.ts` — same.
- `app/api/clients/route.test.ts` — same.

Voice agent eval (`lib/voice/eval/conversations.test.ts`) gets new turns for the CRM tools (Phase 4).

## 14. Rollout rollback matrix

If we need to back out at any phase:

| Phase | Active flag | Rollback action |
|---|---|---|
| 0 | `off` | None needed — placeholder routes never reached. |
| 1 | flip `on` then `off` | Advisors can't reach CRM; legacy still works. New tables dormant. |
| 2 | flip `on` then `off` | Tasks/notes/activity created during the `on` window are preserved in Supabase but unreachable until flag is re-flipped. No data loss. |
| 3 | flip `on` then `off` | Extracted components are still rendered in legacy because we keep them mounted in both places during the phase. So legacy works. |
| 4 | flip `on` then `off` | Voice agent reverts to its 17 read-only tools (the new write tools' persona-prompt sections aren't loaded under the legacy flag). |
| 5 | flip `on` then `off` | Same as Phase 4 — legacy page (one-line redirect) is kept as a redirect target throughout the cutover release; in the cleanup release it's deleted and Phase-5 rollback requires a code revert. |

The only phase that requires a real code revert is Phase 5 cleanup. Until then, every roll-out is one env-var flip.

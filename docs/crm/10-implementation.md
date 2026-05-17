# 10 · Implementation

How we decompose the 8,279-line `app/app/page.tsx` into the CRM shell + nested routes without breaking anything. References `20-technical-specs.md` for shapes/contracts.

## 1. The decomposition challenge

`app/app/page.tsx` today is one client component holding ~50 state hooks driving 11 mutually-exclusive views (`step` values). The pieces we need to extract are tightly coupled via shared in-memory state (`client`, `holdings`, `analysis`, `savedReviews`, `activeReviewId`).

Three structural moves make this tractable:

1. **State extraction.** The shared workflow state moves out of `page.tsx` into a React context (`<AdvisorClientProvider />`) so the new route components consume it without prop-drilling and without forcing a megacomponent.
2. **JSX block extraction.** Each `step`'s JSX body becomes a self-contained component file in `components/workflow/`. Behavior unchanged; the file just moves and accepts the context's values via hook (`useAdvisorClient()`).
3. **Route layering.** The CRM shell layout wraps `app/app/(crm)/layout.tsx`; pages mount the extracted workflow components inside tabs. The legacy `/app/page.tsx` remains the orchestrator behind the feature flag.

## 2. Phased decomposition (overview)

Phase numbering matches `40-path-forward.md` so they cross-reference. This doc focuses on WHAT each phase does to the codebase.

| Phase | What | Where |
|---|---|---|
| **0** | Skeleton routes + shell + feature flag, no UI yet | `app/app/crm/`, `components/crm/`, `lib/crm/feature-flag.ts` |
| **1** | Read-only Roster (left list + Overview right pane) + new APIs | `app/app/crm/page.tsx`, `app/api/clients/`, `lib/crm/` |
| **2** | Tasks + Notes + Activity log (writes) | new tables + UIs + drawers |
| **3** | Workflow extraction: intake → report each become a tab | `components/workflow/*` mounted in `app/app/crm/[id]/[tab]/page.tsx` |
| **4** | Voice agent CRM tools (`create_task`, `log_note`, etc.) | `lib/voice/token-config.ts` + handlers |
| **5** | Cutover: `/app` redirects to `/app/crm`, legacy retired | flag flipped, old `page.tsx` deleted in a follow-up cleanup |

## 3. Phase 0 — Skeleton

**Goal:** All new routes exist, render a "Coming soon" stub, mount the new shell. Nothing breaks. Lighthouse-shippable to production behind the flag set to `off`.

### 3.1 New route tree

```
app/
└── app/
    ├── page.tsx              (LEGACY — unchanged)
    ├── (crm)/                (route group — adds shell layout without changing URL)
    │   ├── layout.tsx        (NEW — mounts <CrmShell />)
    │   ├── crm/
    │   │   ├── page.tsx      (NEW — Roster placeholder)
    │   │   └── [clientId]/
    │   │       ├── page.tsx  (NEW — redirects to /[tab=overview])
    │   │       └── [tab]/
    │   │           └── page.tsx (NEW — tab placeholder)
    │   ├── intake/
    │   │   └── page.tsx      (NEW — new-client intake placeholder)
    │   ├── tasks/
    │   │   └── page.tsx      (NEW — global task list placeholder)
    │   ├── reports/
    │   │   └── page.tsx      (NEW — reports archive placeholder)
    │   └── settings/
    │       ├── page.tsx      (NEW — redirects to /profile section)
    │       └── [section]/
    │           └── page.tsx  (NEW — settings tab placeholder)
    ├── voice-state-provider.tsx (existing — unchanged)
    └── ...
```

The `(crm)` route group keeps URLs at `/app/crm`, `/app/tasks`, etc., while applying the CRM shell layout to all children. The legacy `/app` page lives outside the group so it does not get the shell.

### 3.2 New components (placeholders only in Phase 0)

```
components/crm/
├── crm-shell.tsx       — wrapper with <AppRail /> + <TopHeader /> + main slot
├── app-rail.tsx        — 60px vertical nav (Intake / CRM / Tasks / Reports / Settings)
├── top-header.tsx      — page title + global search + "New client" button + bell + avatar
└── feature-flag-gate.tsx — wraps `crmShellEnabled()` check; renders <LegacyRedirect /> when off
```

### 3.3 Feature-flag wiring

```ts
// lib/crm/feature-flag.ts
// Server-only — read in RSC redirect() calls. NOT `NEXT_PUBLIC_` because
// the client doesn't need to know; the voice provider's adapter routes
// based on URL pathname instead. Server-only env vars are re-read per
// request, so a Vercel env flip takes effect without a redeploy.
export function crmShellEnabled(): boolean {
  return process.env.CRM_SHELL === "on";
}
```

```ts
// app/app/page.tsx — top of legacy page
import { redirect } from "next/navigation";
import { crmShellEnabled, crmLandingRedirectTarget } from "@/lib/crm/feature-flag";

// In the page component, before any other logic:
// When the CRM shell is on, /app redirects. Target depends on rollout
// phase — see lib/crm/feature-flag.ts. In production (Phase 5+) it's
// /app/intake. During internal testing (Phases 0-2 with flag manually
// flipped) it's /app/crm because the intake wizard hasn't been extracted
// yet.
if (crmShellEnabled()) {
  redirect(crmLandingRedirectTarget());
}
```

```ts
// lib/crm/feature-flag.ts (continued)
export function crmLandingRedirectTarget(): string {
  // Phase-3-day-1 onwards (intake extracted), this becomes "/app/intake".
  // Pre-Phase-3, internal testers land on the most-developed surface.
  // Toggle via CRM_LANDING env var — defaults to "/app/crm" until we flip.
  return process.env.CRM_LANDING?.trim() || "/app/crm";
}
```

```ts
// app/app/(crm)/layout.tsx — top of new layout
import { redirect } from "next/navigation";
import { crmShellEnabled } from "@/lib/crm/feature-flag";

export default function CrmLayout({ children }: { children: ReactNode }) {
  if (!crmShellEnabled()) {
    redirect("/app");  // CRM disabled, send back to legacy
  }
  return <CrmShell>{children}</CrmShell>;
}
```

This handshake means **the env flag is the only switch.** With `off` everywhere works as today. With `on` the new shell is live; the advisor lands on `/app/intake` (the new-client wizard inside the CRM shell) and reaches the Roster by clicking **CRM** in the rail.

### 3.4 Phase 0 gate

- `npm run build` — green.
- With `CRM_SHELL=off`: `/app` renders the legacy workflow. `/app/crm` and `/app/intake` redirect to `/app`.
- With `CRM_SHELL=on` (default `CRM_LANDING`): `/app` redirects to `/app/crm` (Roster placeholder). The CRM shell mounts on `/app/intake`, `/app/crm`, `/app/tasks`, `/app/reports`, `/app/settings`. All inner routes render their "Coming soon" placeholder inside the shell.
- Voice agent + Settings drawer + Analysis still work in legacy mode (no regression).
- After Phase 3 step 1 (intake extracted), flipping `CRM_LANDING=/app/intake` lands the user on the real wizard.

## 4. Phase 1 — Read-only Roster

**Goal:** With CRM flag on, the advisor can see their full client list in the new Roster layout, click into a client, see the Overview tab populated from real Supabase data.

### 4.1 Migrations applied first

Per `20-technical-specs.md §1`:

- `advisorpilot_crm_schema.sql` adds three new tables + nullable columns. Apply via Supabase SQL editor.
- Existing rows are untouched. No app code reads the new columns until 4.4 ships.

### 4.2 New API routes

```
app/api/clients/route.ts             — GET (list with filters)
app/api/clients/[id]/route.ts        — GET (detail) + PATCH (CRM fields only)
app/api/activity/route.ts            — GET + POST (auto-populated; manual entries from agent)
```

All gated by `resolveAdvisorIdentity`. Service-role Supabase client. Filter by `owner_email`.

### 4.3 Stage computation

```
lib/crm/stage.ts
  computeStage(client): ClientStage
  isOverdue(client): boolean
```

Pure functions; unit-tested with table-driven cases per the rules in `20-technical-specs.md §4`.

### 4.4 Client roster UI

The Roster is the inner experience of the CRM rail item. Advisors reach it by clicking **CRM** in the rail; they don't land here by default. With no client previously viewed, the right pane shows an empty-state ("Pick a client on the left, or start a new one in Intake").

```
app/app/crm/page.tsx                  — Server component. Fetches /api/clients in parallel with /api/clients/[mostRecentlyViewedId]. Renders <RosterPage />.
components/crm/roster-list.tsx        — Two-pane container; manages selection + URL.
components/crm/client-row.tsx         — Single row.
components/crm/roster-filter-bar.tsx  — Search + chips + sort.
app/app/crm/[clientId]/page.tsx       — Server component. Fetches /api/clients/[id]. Renders <ProfileHeader /> + tabs.
app/app/crm/[clientId]/overview/page.tsx — Server component. Renders <OverviewGrid />.
```

Tabs that aren't ready yet (`portfolio`, `notes`, `timeline`, `tasks`, `intake`, etc.) render a "Coming in Phase 2/3" placeholder with a link to the legacy `/app/legacy?step=…` page so an advisor on the new shell isn't blocked.

### 4.5 Profile header KPI computation

The four KPIs render from:

- **Total AUM** — `sum(holdings.value)` for the client's most-recent saved review.
- **YTD return** — `client.ytdReturn` if present; otherwise null (placeholder).
- **Accounts** — `client.holdings.unique(accountNumber).length`.
- **Next meeting** — `client.next_meeting_at` formatted as `Tue, May 19 · 10:00 AM`.

KPIs are computed server-side in `/api/clients/[id]` and returned in the `ClientDetail` payload — no client-side math.

### 4.6 Voice agent updates (Phase 1)

The voice agent's `navigate(step)` mappings expand. Persona prompt updates:

```
"navigate to my clients" / "open my client database"   → push /app/crm
"open Sarah Chen"                                       → push /app/crm/[sarah.id]
"go to her overview"                                    → push /app/crm/[activeId]/overview
"show me tasks" / "open task list"                      → push /app/tasks
"settings"                                              → push /app/settings
```

`open_client` tool unchanged in shape; it now updates the URL via `router.push()` instead of `setActiveReviewId` + `setStep`. The host page's `voiceActions.openClient` callback wraps `useRouter().push()` instead of state setters.

### 4.7 Phase 1 gate

- An advisor with N≥3 saved clients sees them all in the roster.
- Clicking a row updates the URL to `/app/crm/[id]` and right pane renders.
- Overview cards populate (allocation, accounts, profile facts, recent activity if any).
- Voice agent's "open Sarah Chen" works end-to-end.
- All legacy URLs still resolve (legacy page accessible at `/app/legacy?step=…` for the next phases of extraction).

## 5. Phase 2 — Tasks + Notes + Activity (writes)

**Goal:** Full CRUD on tasks, notes, activity. Drawers for adding. The Overview cards now render real data.

### 5.1 New API routes

```
app/api/tasks/route.ts            — GET, POST
app/api/tasks/[id]/route.ts       — PATCH, DELETE
app/api/notes/route.ts            — GET, POST
app/api/notes/[id]/route.ts       — PATCH, DELETE
```

### 5.2 New UI

```
components/crm/tabs/notes-tab.tsx
components/crm/tabs/timeline-tab.tsx
components/crm/tabs/tasks-tab.tsx
components/crm/drawers/log-note-drawer.tsx
components/crm/drawers/add-task-drawer.tsx
components/crm/overview/tasks-card.tsx       — replaces Phase 1 placeholder
components/crm/overview/pinned-note-card.tsx — replaces Phase 1 placeholder
components/crm/overview/timeline-card.tsx    — replaces Phase 1 placeholder
app/app/tasks/page.tsx                       — global task list
```

### 5.3 Side-effects

- POST `/api/notes` writes a row to `activity_log` (`type: "note"`) AND updates `advisorpilot_clients.last_contacted_at = now()`.
- POST `/api/tasks` writes a row to `activity_log` (`type: "task"`).
- PATCH `/api/tasks/[id]` with `status: "done"` writes a "task completed" entry.

### 5.4 Phase 2 gate

- Advisor clicks "Log note" → drawer opens → save → timeline updates immediately + `last_contacted_at` advances.
- Adding a task → appears in client's Tasks tab + in global `/app/tasks` list.
- Completing a task → strikethrough + moves to `Done` section.
- Activity timeline shows real chronological events.

## 6. Phase 3 — Workflow extraction (the big one)

**Goal:** Each of the 11 legacy step JSX blocks moves into its own component file and mounts inside a CRM tab. The legacy `app/app/page.tsx` shrinks dramatically.

### 6.1 State context

```
lib/crm/use-client.ts
  <AdvisorClientProvider clientId={...}>
    children read via useAdvisorClient()
  </AdvisorClientProvider>
```

The provider holds: `client`, `setClient`, `holdings`, `setHoldings`, `analysis`, `setAnalysis`, `meetingNotes`, `setMeetingNotes`, `rothWorksheet`, `setRothWorksheet`, `fiaWorksheet`, `setFiaWorksheet`, etc. — every piece the workflow components touch.

On URL change (`/app/crm/c01/...`), the provider's effect calls `/api/clients/[id]` and hydrates the context. On unmount it persists any dirty state to Supabase via `/api/client-database` (existing endpoint).

### 6.2 Extraction order (one per PR for reviewability)

| Order | Block | New file | Approx legacy lines |
|---|---|---|---|
| 1 | Intake wizard | `components/workflow/intake-wizard.tsx` | 4213-4468 |
| 2 | Upload section | `components/workflow/upload-section.tsx` | 4470-4616 |
| 3 | Confirm holdings | `components/workflow/confirm-holdings.tsx` | 4618-4994 |
| 4 | Analysis view | `components/workflow/analysis-view.tsx` | 4995-5012 |
| 5 | Meeting guide | `components/workflow/meeting-guide.tsx` | 5013-5103 |
| 6 | FIA calculator | `components/workflow/fia-calculator.tsx` | 5104-5864 |
| 7 | Roth worksheet | `components/workflow/roth-worksheet.tsx` | 5865-6792 |
| 8 | Retirement income | `components/workflow/retirement-income.tsx` | 6820-7582 |
| 9 | Fee analysis | `components/workflow/fee-analysis.tsx` | 7583-7820 |
| 10 | Report snapshot | `components/workflow/report-snapshot.tsx` | 7820-8121 |

Each PR: extract the block → render in BOTH the legacy page AND a new tab → verify visual diff is zero → land. Repeat until `app/app/page.tsx` is just routing + state shell, well under 1k lines.

### 6.3 Tab routing

```
app/app/crm/[clientId]/intake/page.tsx        → <IntakeWizard mode="edit" />
app/app/crm/[clientId]/upload/page.tsx        → <UploadSection />
app/app/crm/[clientId]/confirm/page.tsx       → <ConfirmHoldings />
app/app/crm/[clientId]/analysis/page.tsx      → <AnalysisView />
app/app/crm/[clientId]/meeting/page.tsx       → <MeetingGuide />
app/app/crm/[clientId]/fia/page.tsx           → <FiaCalculator />
app/app/crm/[clientId]/roth/page.tsx          → <RothWorksheet />
app/app/crm/[clientId]/ret-income/page.tsx    → <RetirementIncome />
app/app/crm/[clientId]/fee-analysis/page.tsx  → <FeeAnalysis />
app/app/crm/[clientId]/report/page.tsx        → <ReportSnapshot />
app/app/intake/page.tsx                       → <IntakeWizard mode="new" />
```

All mount inside the CRM shell + the tabs row. Print-mode CSS scopes only to `report/page.tsx`.

### 6.4 Phase 3 gate

- Every legacy step is reachable via the new tab URL with identical behavior.
- `/app/legacy?step=…` still works (toggle-able for advisor preview).
- Voice agent's `navigate("fia")` lands the user on `/app/crm/[activeId]/fia` and the calculator renders with the same data.
- Print/PDF generation from the report tab works exactly as today.
- The legacy `app/app/page.tsx` is below 2k lines (down from 8,279).

## 7. Phase 4 — Voice CRM tools

**Goal:** Voice agent can now create tasks, log notes, complete tasks. Read tools added in Phase 1 expand.

Per `20-technical-specs.md §6`:

```
list_tasks, get_recent_activity, get_notes      — read-only, always on
create_task, complete_task, log_note, log_call,
update_client_stage                              — write, gated on voice_can_write flag
```

Phase 4 ships read-only tools. Write tools land in Phase 4.1 after persona eval shows the agent uses them responsibly (no spurious task creation).

## 8. Phase 5 — Cutover

**Goal:** Legacy page retired. CRM is the default.

- `CRM_SHELL=on` in production.
- Legacy `app/app/page.tsx` becomes a 30-line file that just redirects to `/app/crm`.
- Old top-nav, old voice-agent state-setter glue, old workflow-step state machine — deleted.
- `lib/crm/use-client.ts` (the context) becomes the single source of truth.

A follow-up cleanup PR removes the legacy shell entirely once everyone's on the CRM ≥30 days.

## 9. File-size budget

By the end of Phase 5:

| File | Today | After |
|---|---|---|
| `app/app/page.tsx` | 8,279 | <100 (redirect only) |
| Workflow blocks (combined) | ~3,900 lines | extracted into 10 files, each ≤500 lines |
| New CRM components | 0 | ~3,500 lines across ~25 files |
| Total LOC | similar | better-organized |

No file over 1k lines. Reviews become tractable.

## 10. Migration safety net

If something goes wrong mid-migration:

- **Phase 0–2:** Flip `CRM_SHELL=off`. Legacy page renders. New tables exist but are dormant. Zero advisor impact.
- **Phase 3:** Flip flag off. Legacy page renders. Workflow components are still in their old positions inside `app/app/page.tsx` because extraction is additive (the extracted component is rendered both places until cutover).
- **Phase 5:** Same flip-off, but now the legacy redirect kicks in. We keep `app/app/legacy/page.tsx` as a literal copy of pre-Phase-3 `page.tsx` for one release as the emergency backstop.

Each phase is independently revertable with no data migration.

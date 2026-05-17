# AdvisorPilot CRM Integration — Plan Set

This folder is the design + implementation plan for layering the **Option B "Roster"** CRM design (from `/examples/AP2`) onto the existing AdvisorPilot advisor product without breaking the 10-step workflow that lives today.

## Read order

1. **[00-fundamentals.md](./00-fundamentals.md)** — what Option B Roster is, what it changes, what it doesn't, the user journey, design language, and what we keep from the current app.
2. **[10-implementation.md](./10-implementation.md)** — how we decompose the 8,279-line `app/app/page.tsx` into a side-nav shell + nested routes, what gets extracted, what stays.
3. **[20-technical-specs.md](./20-technical-specs.md)** — concrete schemas (Supabase tables, columns, indexes), API surface (routes + request/response), TypeScript types, component contracts, voice-agent tool extensions.
4. **[30-backward-compat.md](./30-backward-compat.md)** — how the legacy single-page workflow keeps working during rollout: feature flag, URL aliases, advisor-step-state migration, voice-agent navigation continuity, additive-only DB rules.
5. **[40-path-forward.md](./40-path-forward.md)** — phased rollout (6 phases), per-phase gate criteria, risks + mitigations, dependencies, owners.
6. **[50-organizations-and-sharing.md](./50-organizations-and-sharing.md)** — multi-tenant orgs + sharing model (private / shared / organization-wide visibility). Schema lands in Phase 0–1 alongside CRM; full UI ships in Phase 6. Until then every advisor is a transparent "org of one."
7. **[60-chat-orchestrator.md](./60-chat-orchestrator.md)** — in-app chat widget + server-side orchestrator (SSE, streaming, tool-loop-ready). Layers on the existing `lib/llm/` provider abstraction. Ships tool-less in v1; tool registry is reserved namespace for later phases. Covers OpenAI, Grok, and Gemini.
8. **[70-orchestrator-tools.md](./70-orchestrator-tools.md)** — the chat tool surface: `query_crm` (compound, visibility-safe Supabase read DSL with full JSONB exposure — replaces Control Tower's DuckDB `query_data`), `compute` (named projections — allocation, holdings, drift, fees), three write compound tools (`manage_note` / `manage_task` / `manage_client` — extracted from existing API routes), four `run_*` wrappers around existing AI surfaces (`run_analysis` / `run_fee_analysis` / `run_enrich_holdings` / `run_deep_research`), and `manage_report` + `generate_report_content` (13-op compound + markdown generator; `chart:chartjs` / `chart:echarts` / `mermaid` fenced blocks). Includes a self-audit section verifying every column / RPC / route reference against the current repo.
9. **[75-database-tools.md](./75-database-tools.md)** — the SQL-facing deep reference for `query_crm` + `compute`. Owns: the full security model (identity → service-role → visibility helpers → RLS), the per-table inventory for every table the chat reads (columns, indexes, RLS policies, JSONB shapes, mappers, tool exposure), the literal SQL each `query_crm` operation compiles to, full bodies of the new `query_crm_aggregate` + `query_crm_path` Postgres functions (with the four `_qcrm_*` allowlist-validating helpers), performance characteristics, a worked end-to-end trace, and a per-line audit against `schema.sql`.

## Source material

- **Design canvas:** `/Users/djperussina/Code/AdvisorPilot/examples/AP2/option-b-roster.jsx` (main two-pane Roster), `option-b-mobile.jsx` (mobile variant), `shell.jsx` (app rail + top header + shared components), `data.jsx` (sample data — the canonical CRM data shape), and `Option B - Developer Handoff.html` (intent + spec).
- **Current-app audit:** condensed in §1 of every doc.

## Decisions already locked

- **Side nav replaces top nav.** The current `AppTopNav()` at `app/app/page.tsx:667-747` becomes a vertical 60px rail with sections: Intake, CRM, Tasks, Reports, Settings.
- **Intake stays the landing surface.** Default landing route after login is `/app/intake` (the 10-question new-client wizard) — same surface advisors see today. The new **Side nav** adds peer items (CRM, Tasks, Reports, Settings). CRM is something an advisor navigates **to**, not the homebase. The "10-step workflow" becomes a sub-flow scoped to an open client (URL: `/app/crm/[clientId]/intake`, `/analysis`, etc.) when the advisor is editing an existing client; the new-client wizard at `/app/intake` is the unchanged default entry.
- **Database changes are additive only.** No ALTER that removes / renames a column, no NOT NULL on existing tables. New tables (tasks, notes, activity) are sidecars. The single carve-out — already permitted in the LLM plan — is nullable columns on `advisor_profile`.
- **Voice agent keeps its 11 step names.** `navigate("intake")` still works; it now translates to a URL push under the current client's scope. Tools added (`create_task`, `complete_task`, `list_tasks`, `log_note`) are read-write in v2; in v1 the CRM tools stay read-only like today.
- **Feature flag for rollout.** `CRM_SHELL=on` switches the layout (server-only env var, no `NEXT_PUBLIC_` prefix — runtime-readable in Vercel without a redeploy); with it off the existing `/app` page renders unchanged.
- **Multi-tenant orgs schema lands NOW, UI later.** Every advisor becomes an "org of one" in Phase 0–1's migration (invisible to them); the share/invite UI ships in Phase 6 after CRM v1 stabilizes. See `50-organizations-and-sharing.md`. No advisor sees an org chip during v1.

## What is NOT in scope for v1

- Calendar / scheduling integrations (we surface "next meeting" but don't book).
- Email send/receive inbox (we log communications; we don't compose).
- Multi-advisor role-based access (an advisor still sees only their own book).
- Pipeline / opportunity tracking (Option C "Cadence" pattern; not Roster).
- The `Portfolio`, `Contacts`, `Documents` tabs in client detail — only `Overview`, `Notes`, `Timeline`, `Tasks` are fully wired in v1. Per the design handoff (line 628), Overview is the only fully-specified tab; the others get scaffold placeholders that link to existing flows.

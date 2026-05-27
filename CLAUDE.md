# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev          # next dev (do not start a second instance if one is running)
npm run build        # next build
npm run start        # next start (production)
npm run lint         # eslint (flat config in eslint.config.mjs)
npm test             # vitest run (node env, all *.test.ts files)
npx vitest run lib/holding-merge.test.ts          # run a single test file
npx vitest run -t "merges duplicate holdings"     # run by test name
npm run seed:enrichment-cache                     # tsx scripts/seed-enrichment-cache-from-clients.ts
```

Optional QA pass — paired-model JSON eval (requires `OPENAI_API_KEY`):
```bash
ADVISORPILOT_EVAL_JSON_COMPARE=1 npm test
```

Restart `npm run dev` after editing `.env.local`. See README.md for the full env-var list.

## Architecture

### Two distinct "apps" in `app/`
- **Marketing site** at `app/page.tsx` (~300 lines) plus `app/pricing`, `app/demo`, `app/login` — uses `MarketingSiteHeader/Footer`. This is the public site.
- **Advisor product** at `app/app/page.tsx` — single very large client component (~7.5k lines) holding the full workflow state machine (upload → extract → enrich → review → PDF/email). Most product changes happen in this file or its `lib/` helpers.
- **Public client-upload flow** at `app/client-upload/[token]` — phone-friendly page reached via magic link; no auth, validated server-side by token.

### Three coexisting auth paths
Server routes resolve the advisor via `lib/advisor-auth.ts → resolveAdvisorIdentity(request)`, which checks **in order**:
1. **NextAuth Google session** (cookie) — required for Gmail send (`/api/email-client-snapshot`).
2. **Supabase email/password JWT** sent as `Authorization: Bearer <token>`. The browser stores this in `sessionStorage` under `ap_supabase_at`; use `lib/advisor-fetch.ts` from the client so the header is attached automatically.
3. **Upload-token** (separate code path) — only for `/api/client-upload-context/[token]` and `/api/client-upload/ingest`; these are public and must not assume an advisor session.

Google-signed-in users have no Supabase `user_id`, so ownership is enforced by normalized email. Keep that in mind when adding queries against advisor-scoped tables.

### Multi-provider LLM abstraction (`lib/llm/`)
**Route handlers never instantiate provider SDKs directly.** They import only `complete()`, `research()`, `tts()`, `stt()` from `@/lib/llm` (facade in `lib/llm/index.ts`). The facade picks an adapter per request based on a fixed precedence chain:

1. Request header (`x-llm-provider`, `x-llm-model-<pass>`) — preview / power-user override.
2. Per-advisor selection from `advisorpilot_advisor_profiles` (`llm_provider`, `llm_model_overrides`, `default_research_tier`), loaded by `resolveAdvisorLlmSelection(email)`. NULL columns fall through.
3. New-style env vars: `LLM_<PROVIDER>_<PASS>_MODEL`, `ADVISORPILOT_DEFAULT_LLM_PROVIDER`.
4. Legacy aliases (`OPENAI_EXTRACTION_MODEL`, `OPENAI_ANALYSIS_*_MODEL`, …) — still honored for backward compat, only for OpenAI.
5. Hardcoded defaults in `lib/llm/registry.ts`.

Providers: `openai` | `gemini` | `grok` (adapters in `lib/llm/providers/`). Passes: `extraction`, `intake.turn`, `research.fast-grounded`, `research.agentic`, `research.deep`, `synthesis.json`, `tts`, `stt`. `lib/llm/capabilities.ts` is the capability matrix; TTS/STT always fall back to OpenAI in v1. Citation hallucinations are filtered against the research pass's real URL list (`lib/llm/citation-filter.ts`).

Attachment intake is centralized in `lib/llm/attachments.ts` (MIME sniff → size cap → PDF page-slice → text-layer extract → typed `Attachment`). Adapters never re-do this work.

### AI pipeline (route → pass)
1. `POST /api/analyze-statement` — `pass: "extraction"` on the raw PDF/image → holdings JSON. `assertHoldingsReconcileToVerifiedTotal()` rejects extractions where `sum(values)` doesn't match machine-parsed totals (~2% / $500). When `ADVISORPILOT_SECURITIES_MASTER=1`, rows are reconciled against the Supabase `advisorpilot_securities_master` catalog (ticker-first, then a Jaccard name-overlap gate set by `ADVISORPILOT_MASTER_NAME_SCORE_THRESHOLD`).
2. `POST /api/enrich-holdings` — per holding: cache (`advisorpilot_security_enrichment_cache`) → OpenFIGI (`lib/openfigi.ts`) → `research({ tier: "fast-grounded" })` + `complete({ pass: "synthesis.json" })`. Selective re-runs via `enrichIndices: number[]`.
3. `POST /api/generate-analysis` — `research({ tier: "agentic-research" })` then long `synthesis.json` prompt with strict section roles (synopsis / portfolioHighlights / strategies / redFlags / overlapInsights / displayWhatThisMeans / recommendations / talkingPoints / advisorOpeningScript / objectionHandling), plus normalized `citations[]`.
4. `POST /api/generate-report` (or `/api/generate-roth-report`) — `pdf-lib` assembly; embeds `public/logo.png` when present.
5. `POST /api/research/start` + `GET /api/research/[id]` + `GET /api/research/cron` — async deep-research jobs backed by `advisorpilot_deep_research_jobs` (OpenAI `background:true`, Gemini Interactions, Grok runs synchronously). Lifecycle in `lib/llm/deep-research-jobs.ts`.

### Nova chat + voice (single surface)
- **Nova** is the text chat orchestrator (`lib/chat/`, `POST /api/chat/stream`). System prompt: "You are Nova…"
- **Voice mode** lives inside `components/chat/chat-widget.tsx` via `VoiceAgentController` (`components/voice/voice-agent.tsx` + `lib/voice/*`). `/api/voice/token` mints Gemini Live config; voice can fire-and-forget to Nova via the `chat()` tool (`lib/voice/chat-bridge.ts`). Per-advisor settings: `advisorpilot_voice_settings`; tool audit: `advisorpilot_voice_audit_log`. `lib/voice/focus.ts` serializes React state for the agent (PII redaction).

### Supabase schema
SQL files in `supabase/` are the source of truth for tables; apply them in this order on a fresh database. **Any schema change you make must be backwards-compatible** — see `.cursor/rules/40-supabase-schema-changes.mdc` (prefer a new sidecar table; if you must add a column, it must be additive and nullable; migrations must be idempotent).

1. `advisorpilot_full_schema_rls.sql` — base schema with RLS. Includes `advisorpilot_clients`, `advisorpilot_advisor_profiles`, `advisorpilot_upload_tokens` (with `intake_snapshot`), `advisorpilot_documents`, `advisorpilot_audit_events`, `advisorpilot_security_enrichment_cache`, plus storage buckets `advisorpilot-statements` (private) and `advisorpilot-advisor-branding` (public). Standalone enrichment-cache / upload-tokens files in `supabase/` are legacy and only needed for installs that predate this unified schema.
2. `advisorpilot_securities_master.sql` — firm catalog (optional; only used when `ADVISORPILOT_SECURITIES_MASTER=1`).
3. `_apply_all_new_migrations.sql` — idempotent bundle of the five most recent migrations. Adds:
   - LLM-preference columns on `advisor_profiles` (`llm_provider`, `llm_model_overrides`, `default_research_tier`).
   - `advisorpilot_enrichment_provenance` — sidecar to the enrichment cache, records which provider produced a cached row + citations.
   - `advisorpilot_deep_research_jobs` — async job table for `/api/research/*`.
   - `advisorpilot_voice_settings` — per-advisor voice agent prefs.
   - `advisorpilot_voice_audit_log` — append-only tool-call log for the Gemini Live agent.
   - `advisorpilot_client_drippers` + `advisorpilot_dripper_runs` — per-client scheduled AI drip enrollments and run history (`supabase/advisorpilot_client_drippers.sql`). Cron: `POST /api/drippers/cron` with `DRIPPER_CRON_SECRET`. Successful runs email the client via Gmail using `advisorpilot_advisor_gmail_tokens` (refresh token saved on Google sign-in).
   - LLM passes `dripper` (advisor brief) and `dripper.client-email` (client-safe rewrite before send).

Both `/api/advisor-profile` and `LlmSettingsDrawer` gracefully detect missing LLM columns (`PGRST204 / "Could not find the 'llm_provider' column"`) and surface a clear "run this migration" message — so the app still works against an old DB, it just can't persist LLM preferences.

`docs/advisorpilot-database-reference.sql` is a reference dump, **not** something to apply.

### `lib/` conventions
- Pure helpers with co-located `*.test.ts` (Vitest, node env). Prefer adding logic here rather than in `app/app/page.tsx` so it's testable.
- `lib/supabaseClient.ts` is for browser/server contexts that have anon access; server routes that need elevated access build their own admin client with `SUPABASE_SERVICE_ROLE_KEY` (see `lib/advisor-auth.ts` for the pattern). Never import a service-role client from a `components/` file.
- `lib/llm/` is the provider-agnostic AI surface. **Import only from `@/lib/llm`** — never `openai`, `@google/genai`, or a Grok client directly from a route or `components/` file. Adding a new pass means adding a string to `LlmPass` in `lib/llm/types.ts`, a default in `lib/llm/registry.ts`, and entries in `lib/llm/capabilities.ts`.
- `lib/voice/` holds the Gemini Live session, tool dispatch, and focus serializer. The set of tools advertised in `lib/voice/token-config.ts` is the **complete agent surface** — adding a tool there is what enables the agent to call it.
- Path alias `@/*` maps to repo root (see `tsconfig.json` and `vitest.config.ts`).

## Route handler conventions
- Keep handlers thin: validate input, call the service, return `NextResponse` with stable JSON error shapes (`400` invalid input, `401` auth, `500` env/server).
- Any handler using Node-only APIs (`Buffer`, `googleapis`, `pdf-lib`, `pdf-parse`) must declare `export const runtime = "nodejs"` and usually `export const dynamic = "force-dynamic"`.
- Validate required env vars and return a helpful error rather than 500'ing silently. Never echo secret values.

## Gotchas
- **This Next.js (16.x) differs from the public docs / training data.** Before changing framework-level behavior (caching, route segment config, middleware), read `node_modules/next/dist/docs/` and heed deprecations.
- `NEXT_PUBLIC_*` env values **ship to the browser bundle**. `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, and `XAI_API_KEY` must stay server-side. **Exception:** `/api/voice/token` returns `GEMINI_API_KEY` directly to the authenticated advisor's browser so it can open a Gemini Live WebSocket — that's the documented design (see `lib/voice/session.ts` header comments).
- `NEXT_PUBLIC_APP_URL` controls the host baked into generated magic links / QR codes. If unset, the app falls back to the incoming request host — fine in dev, wrong behind some proxies in prod.
- When mutating advisor-scoped data, branch on `identity.provider`: Google users key by `email`, Supabase users key by `userId`.

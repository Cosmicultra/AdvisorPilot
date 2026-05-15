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

### OpenAI pipeline (per-pass models)
Routes use different models for different passes. The mapping lives in `lib/openai-route-models.ts` and is configurable via `OPENAI_*_MODEL` env vars (see README). Typical flow:
1. `POST /api/analyze-statement` — extraction model on the raw PDF/image → holdings JSON. If `ADVISORPILOT_SECURITIES_MASTER=1`, rows are reconciled against the Supabase `advisorpilot_securities_master` catalog (ticker-first, then a Jaccard name-overlap gate set by `ADVISORPILOT_MASTER_NAME_SCORE_THRESHOLD`).
2. `POST /api/enrich-holdings` — web-search pass + JSON pass per holding; results are cached in `advisorpilot_security_enrichment_cache`.
3. `POST /api/generate-analysis` — macro web-search pass + structured review JSON.
4. `POST /api/generate-report` (or `/api/generate-roth-report`) — `pdf-lib` assembly; embeds `public/logo.png` when present.

`/api/intake-voice`, `/api/intake-tts`, and `/api/intake-stt` power the **Live Intake** overlay (`components/live-intake-overlay.tsx`). It is pause-based dialogue (not the Realtime API): browser mic → Whisper STT → JSON-turn LLM → OpenAI TTS playback.

### Supabase schema
SQL files in `supabase/` are the source of truth for tables; apply them in this order on a fresh database:
- `advisorpilot_full_schema_rls.sql` — base schema with RLS (includes the `intake_snapshot` column on upload tokens).
- `advisorpilot_securities_master.sql` — firm catalog (optional; only used when `ADVISORPILOT_SECURITIES_MASTER=1`).
- `advisorpilot_security_enrichment_cache.sql` — enrichment cache.
- `advisorpilot_upload_tokens.sql` / `advisorpilot_upload_tokens_add_intake_snapshot.sql` — only needed for older installs that predate the unified schema.

`docs/advisorpilot-database-reference.sql` is a reference dump, **not** something to apply.

### `lib/` conventions
- Pure helpers with co-located `*.test.ts` (Vitest, node env). Prefer adding logic here rather than in `app/app/page.tsx` so it's testable.
- `lib/supabaseClient.ts` is for browser/server contexts that have anon access; server routes that need elevated access build their own admin client with `SUPABASE_SERVICE_ROLE_KEY` (see `lib/advisor-auth.ts` for the pattern). Never import a service-role client from a `components/` file.
- Path alias `@/*` maps to repo root (see `tsconfig.json` and `vitest.config.ts`).

## Route handler conventions
- Keep handlers thin: validate input, call the service, return `NextResponse` with stable JSON error shapes (`400` invalid input, `401` auth, `500` env/server).
- Any handler using Node-only APIs (`Buffer`, `googleapis`, `pdf-lib`, `pdf-parse`) must declare `export const runtime = "nodejs"` and usually `export const dynamic = "force-dynamic"`.
- Validate required env vars and return a helpful error rather than 500'ing silently. Never echo secret values.

## Gotchas
- **This Next.js (16.x) differs from the public docs / training data.** Before changing framework-level behavior (caching, route segment config, middleware), read `node_modules/next/dist/docs/` and heed deprecations.
- `NEXT_PUBLIC_*` env values **ship to the browser bundle**. `SUPABASE_SERVICE_ROLE_KEY` and `OPENAI_API_KEY` must stay server-side.
- `NEXT_PUBLIC_APP_URL` controls the host baked into generated magic links / QR codes. If unset, the app falls back to the incoming request host — fine in dev, wrong behind some proxies in prod.
- When mutating advisor-scoped data, branch on `identity.provider`: Google users key by `email`, Supabase users key by `userId`.

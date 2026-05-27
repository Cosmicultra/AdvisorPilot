# AdvisorPilot

AdvisorPilot is a Next.js (App Router) web app for financial advisors to:
- Upload a client statement (PDF/image) and **extract holdings** via the configured LLM provider (OpenAI / Gemini / Grok).
- Generate an **advisor-style portfolio review** (with current market context and normalized source citations).
- Run side-calculators: Roth conversion, Fixed Income Annuity, retirement income projection, 10-year scenarios.
- Generate polished **PDFs** (Client Snapshot + Advisor Deep Dive).
- Save/load a simple **client database** in Supabase.
- Optionally **email the Client Snapshot via Gmail** using Google OAuth.
- Collect intake via a **public magic-link upload** (clients use their phone; no auth).
- Use **Nova** (chat + optional Gemini Live voice in the global chat widget) for CRM questions, navigation, and hands-free help.

## Tech stack

- **Next.js**: 16.x (App Router) + **React** 19
- **UI**: Tailwind CSS v4 + shadcn-style components in `components/ui`
- **AI**: provider-agnostic LLM facade in `lib/llm/` with adapters for **OpenAI** (`openai`), **Google Gemini** (`@google/genai`), and **xAI Grok**. Each advisor can pick a provider + per-pass model overrides in the in-app **AI Models** settings drawer (`LlmSettingsDrawer`); env vars + legacy `OPENAI_*_MODEL` aliases still work as defaults. TTS/STT always fall back to OpenAI in v1.
- **PDF**: `pdf-lib`
- **Data**: Supabase (`@supabase/supabase-js`)
- **Auth**:
  - **Google OAuth (Gmail send)** via `next-auth`
  - **Email/password** via a Supabase-backed API route (`/api/auth/email`)
- **Nova (chat + voice)** — global chat orchestrator (`components/chat/chat-widget.tsx`) with optional Gemini Live voice mode (`components/voice/voice-agent.tsx`). Text and voice share one conversation; voice can delegate heavy work to Nova via the `chat()` tool.

## How the app works (end-to-end)

The advisor product lives at **`app/app/page.tsx`** — a server-component entry that wraps the legacy client shell in **`app/app/legacy-app-shell.tsx`** inside a `<Suspense>` boundary (`app/page.tsx` is the public marketing site). The workflow drives these route handlers:

### Statement → analysis pipeline

- **`POST /api/analyze-statement`**: sends one or more uploaded statements to the configured LLM provider for extracted holdings JSON. Reconciles totals (`sum(values)` vs machine-parsed account-ending values) and optionally **augments rows from** the Supabase `advisorpilot_securities_master` catalog when `ADVISORPILOT_SECURITIES_MASTER=1`.
- **`POST /api/enrich-holdings`**: per-holding web-search + JSON pass with cache (`advisorpilot_security_enrichment_cache`) and OpenFIGI lookups. Supports selective re-runs via `enrichIndices: number[]`.
- **`POST /api/generate-analysis`**: generates market research notes + a structured portfolio review JSON (synopsis, scores, red flags, talking points, etc.) with normalized citations.
- **`POST /api/generate-report`** / **`POST /api/generate-roth-report`**: generate PDFs (client/advisor mode) using `pdf-lib` and return bytes. Embed `public/logo.png` when present.
- **`POST /api/roth-analysis`**: pre-flight that confirms the embedded federal-tax-illustration tables before running the Roth side-flow.

### Saved data & sharing

- **`GET/POST/DELETE /api/client-database`**: stores and retrieves saved reviews in Supabase (`advisorpilot_clients`).
- **`GET/POST /api/advisor-profile`** (+ `POST /api/advisor-profile/upload` for logos): stores and loads advisor signature, branding, and LLM preferences.
- **`POST /api/email-client-snapshot`**: generates the client PDF and sends it via Gmail (requires Google sign-in).
- **`POST /api/email-client-upload-link`**: emails a magic upload link to the client.
- **`GET /api/qr?text=<url>`**: returns an SVG QR for a magic link.
- **`POST /api/inbound-email`**: webhook for emailed statements (gated by `INBOUND_EMAIL_WEBHOOK_SECRET`).

### Client magic links (public; no advisor auth)

- **`POST /api/client-upload-token`**: mints a **magic link** bound to the signed-in advisor (Google session or Supabase JWT from email/password login). Optional **`intakeSnapshot`** body stores prefilled profile JSON for the client page.
- **`GET /api/client-upload-context/[token]`**: **public** helper for `/client-upload/[token]`; validates the token and returns any stored intake snapshot + expiry (no upload side effects).
- **`POST /api/client-upload/ingest`**: **public** upload endpoint used by `/client-upload/[token]`; validates the token, accepts **`intakeJson`** (full normalized profile), runs statement extraction, and inserts a **Draft** row on that advisor’s client list only.

### Nova chat + voice

- **`POST /api/chat/stream`**: Nova text orchestrator (SSE).
- **`POST /api/voice/token`**: mints Gemini Live session config for voice mode inside the chat widget.
- **`GET/POST /api/voice/settings`** / **`POST /api/voice/audit`**: per-advisor voice prefs and append-only tool-call audit log.

### LLM control plane

- **`GET /api/llm-providers`**: which providers have keys configured (used by `LlmSettingsDrawer`).
- **`POST /api/research/start`** + **`GET /api/research/[id]`** + **`GET /api/research/cron`**: async deep-research jobs backed by `advisorpilot_deep_research_jobs`.

## Client upload link (magic link + optional QR)

Clients can confirm the full intake profile and upload statement(s) on **their phone** without signing in:

1. Run **`supabase/advisorpilot_upload_tokens_add_intake_snapshot.sql`** if your upload-token table existed before intake snapshots were added (adds optional `intake_snapshot` JSON for advisor-prefilled answers). New installs running `supabase/advisorpilot_full_schema_rls.sql` include this column.
2. Sign in to AdvisorPilot, open **Statement Capture**, and tap **Create link**. Copy the URL or use the **QR** (same URL). Your current intake form is bundled into the link so the client sees the same profile questions prefilled where you already answered.
3. After the client confirms their profile and uploads, open **Client Database** — the row appears as a **Draft** with a **Client link upload** badge. Open it to confirm holdings and continue the workflow.

**Production:** set **`NEXT_PUBLIC_APP_URL`** to your public site origin (e.g. `https://app.example.com`) so generated links point at the right host. If unset, the app uses the incoming request host.

**Email/password sign-in:** the app stores the Supabase access token in **`sessionStorage`** (`ap_supabase_at`) so the mint API can verify the advisor; signing out clears it.

## Local development

Install dependencies:

```bash
npm install
```

Create a `.env.local` in the project root:

### OpenAI

```bash
OPENAI_API_KEY=...
```

Used for statement extraction, portfolio analysis, and Nova chat passes (via `lib/llm/`).

Optional overrides:

```bash
# Per-pass models (defaults: gpt-4o). JSON passes are good candidates for gpt-4o-mini after QA.
# OPENAI_ANALYSIS_RESEARCH_MODEL=gpt-4o           # macro web-search pass for /api/generate-analysis
# OPENAI_ANALYSIS_JSON_MODEL=gpt-4o               # structured review JSON for /api/generate-analysis
# OPENAI_ENRICHMENT_RESEARCH_MODEL=gpt-4o        # web-search pass per holding in /api/enrich-holdings
# OPENAI_ENRICHMENT_JSON_MODEL=gpt-4o            # enrichment JSON mapping per holding
# OPENAI_EXTRACTION_MODEL=gpt-4o                 # PDF/image holdings extraction (/api/analyze-statement)

# ADVISORPILOT_SECURITIES_MASTER=1              # ticker-first match vs Supabase advisorpilot_securities_master after extract / before enrichment web run
# ADVISORPILOT_MASTER_NAME_SCORE_THRESHOLD=35   # 0–100 Jaccard word-overlap gate (statement vs master holding_name) when symbol matches

# ADVISORPILOT_EVAL_JSON_COMPARE=1                # paired OpenAI Responses JSON smoke vs fixtures (Vitest); needs OPENAI_API_KEY
# ADVISORPILOT_EVAL_JSON_BASELINE_MODEL=gpt-4o
# ADVISORPILOT_EVAL_JSON_CANDIDATE_MODEL=gpt-4o-mini
```

**Nova voice:** Open the chat launcher (bottom-right on `/app/*`), toggle voice mode for a Gemini Live session. Requires `GEMINI_API_KEY` (see below).

Restart `npm run dev` after changing `.env.local`.

Add `public/logo.png` for PDFs and branding; without it, the wordmark **AdvisorPilot** is shown.

### CRM Drippers (scheduled AI templates)

Per-client drip templates run on a schedule via `POST /api/drippers/cron`. In production, configure a Vercel cron (hourly recommended) to call that route with:

```bash
DRIPPER_CRON_SECRET=...   # sent as x-cron-secret header; if unset in dev, cron is open
```

Each successful drip also emails the **client’s CRM email** via the advisor’s **Gmail or Outlook** (same OAuth as Client Snapshot). That requires:

- Google: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `NEXTAUTH_SECRET` (sign-in with `gmail.send`)
- Microsoft: `AZURE_AD_CLIENT_ID` / `AZURE_AD_CLIENT_SECRET` / `AZURE_AD_TENANT_ID` (sign-in with `Mail.Send`)
- Advisor signed in with Google or Microsoft at least once after deploy so a refresh token is stored
- Client `email` populated on the CRM record (Overview / Contacts)

Apply `supabase/advisorpilot_client_drippers.sql`, `supabase/advisorpilot_advisor_gmail_tokens.sql` (or sections 6–7 in `supabase/_apply_all_new_migrations.sql`) before using the Drippers tab.

### Supabase

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Apply SQL files in the Supabase dashboard in this order on a fresh database:

1. **`supabase/advisorpilot_full_schema_rls.sql`** — base tables, RLS, triggers, and two storage buckets (`advisorpilot-statements`, `advisorpilot-advisor-branding`).
2. **`supabase/advisorpilot_securities_master.sql`** — optional firm catalog. Only used when `ADVISORPILOT_SECURITIES_MASTER=1`. If your table came from CSV import first, rename columns to snake_case (`primary_symbol`, …) — see commented examples in that file.
3. **`supabase/_apply_all_new_migrations.sql`** — idempotent bundle: adds LLM-preference columns on `advisor_profiles`, plus `advisorpilot_enrichment_provenance`, `advisorpilot_deep_research_jobs`, `advisorpilot_voice_settings`, and `advisorpilot_voice_audit_log`. Required for the AI Models drawer, deep-research jobs, and the Voice Agent. Safe to re-run.

The standalone enrichment-cache / upload-tokens SQL files in `supabase/` are legacy — only needed for installs that predate `advisorpilot_full_schema_rls.sql`.

### Gemini (Voice Agent)

```bash
GEMINI_API_KEY=...
# Optional:
# LLM_VOICE_MODEL=gemini-3.1-flash-live-preview
# LLM_VOICE_NAME=Aoede
# LLM_VOICE_MAX_SESSION_MINUTES=15
# LLM_VOICE_SYSTEM_PROMPT_PATH=lib/voice/prompts/advisor.txt
```

Without `GEMINI_API_KEY` the mic button is hidden. The system prompt (`lib/voice/prompts/advisor.txt`) defines the agent's persona + the trigger→tool map.

### Grok (optional)

```bash
XAI_API_KEY=...
```

Required only when an advisor selects Grok in the AI Models drawer.

### LLM model overrides (optional)

Any pass can be overridden via env. Preferred form is `LLM_<PROVIDER>_<PASS>_MODEL`; legacy `OPENAI_*_MODEL` names still work:

```bash
# LLM_OPENAI_EXTRACTION_MODEL=gpt-4o
# LLM_GEMINI_SYNTHESIS_MODEL=gemini-3.1-flash-lite
# LLM_GROK_RESEARCH_AGENTIC_MODEL=grok-4.3
# ADVISORPILOT_DEFAULT_LLM_PROVIDER=openai
```

The full list of passes is in `lib/llm/types.ts` (`LlmPass`); precedence is documented in `lib/llm/registry.ts`.

### Google OAuth / NextAuth (for Gmail sending)

```bash
NEXTAUTH_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

### Microsoft OAuth / NextAuth (for Outlook sending)

Register an app in the [Microsoft Entra admin center](https://entra.microsoft.com/). Add redirect URI `{NEXTAUTH_URL}/api/auth/callback/azure-ad`, grant delegated **Mail.Send**, and create a client secret.

```bash
AZURE_AD_CLIENT_ID=...
AZURE_AD_CLIENT_SECRET=...
AZURE_AD_TENANT_ID=common
```

Use `common` for personal + work Microsoft accounts, or your org tenant ID for work-only sign-in (admin consent may be required for Mail.Send).

Refresh tokens are stored in `advisorpilot_advisor_outlook_tokens` (apply `supabase/advisorpilot_advisor_outlook_tokens.sql` or section 10 in `supabase/_apply_all_new_migrations.sql`).

### Email/password password reset (Supabase Auth)

Forgot-password emails use Supabase `resetPasswordForEmail`. In the Supabase dashboard:

1. **Authentication → URL configuration:** add `http://localhost:3000/reset-password` (dev) and `https://<your-domain>/reset-password` (prod) to redirect URLs.
2. Configure Auth email delivery (SMTP or Supabase built-in) so reset emails send.

Set **`NEXT_PUBLIC_APP_URL`** in production so reset links use the correct host.

Run the dev server:

```bash
npm run dev
```

Open `http://localhost:3000`.

## Scripts

```bash
npm run dev      # start dev server
npm run build    # production build
npm run start    # run production server
npm run lint     # eslint
npm test         # Vitest (set ADVISORPILOT_EVAL_JSON_COMPARE=1 + OPENAI_API_KEY for optional paired-model JSON QA)
```

## Project layout

- **`app/page.tsx`** + **`app/pricing`**, **`app/demo`**, **`app/login`**: public marketing site + sign-in form (`MarketingSiteHeader/Footer`, `AdvisorLoginForm`).
- **`app/app/page.tsx`**: the advisor product — single large client component (~7.8k lines) holding the workflow state machine (intake → upload → confirm → analysis → meeting → fia/roth/retIncome → report → saved).
- **`app/client-upload/[token]/page.tsx`**: the public, phone-friendly client upload page reached via magic link; no auth.
- **`app/api/*/route.ts`**: server-side route handlers (LLM dispatch, Supabase, PDF generation, Gmail send, auth, voice).
- **`components/ui/*`**: UI primitives (shadcn-style).
- **`components/voice/*`** + **`lib/voice/*`**: Gemini Live voice agent (session, tools, focus serializer, prompts).
- **`lib/llm/*`**: provider-agnostic LLM facade — `complete()`, `research()`, `tts()`, `stt()` plus per-provider adapters in `lib/llm/providers/`.
- **`lib/*`**: pure helpers (allocation math, holdings normalization, intake config, calculators, etc.) with co-located `*.test.ts`.
- **`supabase/*.sql`**: schema + migrations (source of truth).
- **`app/globals.css`**: Tailwind v4 + shadcn theme imports.

## Notes / gotchas

- **Google sign-in is required for sending emails via Gmail** (`/api/email-client-snapshot`). Email/password accounts can still use the app, download PDFs, and copy follow-up emails manually.
- **`SUPABASE_SERVICE_ROLE_KEY` is highly privileged.** Keep it server-side only (in `.env.local` / deployment secrets) and never expose it to the browser. The same applies to `OPENAI_API_KEY` and `XAI_API_KEY`.
- **`GEMINI_API_KEY` is the one documented exception:** `/api/voice/token` returns it directly to the authenticated advisor's browser so it can open a Gemini Live WebSocket. See `lib/voice/session.ts` for the design notes; swap in ephemeral tokens or a server-side WSS relay for higher-security deployments.
- **AI Models drawer needs the migration applied.** If `supabase/_apply_all_new_migrations.sql` hasn't run, the profile API returns a graceful "Profile saved, but AI model preferences could NOT be persisted" message — the rest of the app still works, but per-advisor provider/model selection silently falls back to env defaults.
- This repo includes a rule in `AGENTS.md` warning that this Next.js version may differ from typical docs; if behavior looks “off”, consult `node_modules/next/dist/docs/`.

## Optional: logo

`/api/generate-report` will try to embed `public/logo.png` if present; otherwise it falls back to text branding.

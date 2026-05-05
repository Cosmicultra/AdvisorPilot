# AdvisorPilot

AdvisorPilot is a Next.js (App Router) web app for financial advisors to:
- Upload a client statement (PDF/image) and **extract holdings** via OpenAI.
- Generate an **advisor-style portfolio review** (with current market context).
- Generate polished **PDFs** (Client Snapshot + Advisor Deep Dive).
- Save/load a simple **client database** in Supabase.
- Optionally **email the Client Snapshot via Gmail** using Google OAuth.

## Tech stack

- **Next.js**: 16.x (App Router) + **React** 19
- **UI**: Tailwind CSS v4 + shadcn-style components in `components/ui`
- **AI**: OpenAI (`openai` SDK)—portfolio analysis, statement extraction, and **in-room voice intake** prompts share the same API key.
- **PDF**: `pdf-lib`
- **Data**: Supabase (`@supabase/supabase-js`)
- **Auth**:
  - **Google OAuth (Gmail send)** via `next-auth`
  - **Email/password** via a Supabase-backed API route (`/api/auth/email`)

## How the app works (end-to-end)

The primary workflow lives in `app/page.tsx` and calls these route handlers:

- **`POST /api/analyze-statement`**: sends the uploaded statement to OpenAI and returns extracted holdings JSON.
- **`POST /api/generate-analysis`**: generates market research notes + a structured portfolio review JSON.
- **`POST /api/generate-report`**: generates a PDF (client/advisor mode) using `pdf-lib` and returns bytes.
- **`GET/POST/DELETE /api/client-database`**: stores and retrieves saved reviews in Supabase.
- **`GET/POST /api/advisor-profile`**: stores and loads an advisor email signature in Supabase.
- **`POST /api/email-client-snapshot`**: generates the client PDF and sends it via Gmail (requires Google sign-in).
- **`POST /api/intake-voice`**: OpenAI chat turn that maps spoken intent to intake fields (used by **AdvisorPilot Live Intake**).
- **`POST /api/intake-tts`**: OpenAI **text-to-speech** for natural voice playback in Live Intake (`gpt-4o-mini-tts` by default).
- **`POST /api/client-upload-token`**: mints a **magic link** bound to the signed-in advisor (Google session or Supabase JWT from email/password login).
- **`POST /api/client-upload/ingest`**: **public** upload endpoint used by `/client-upload/[token]`; validates the token, runs statement extraction, and inserts a **Draft** row on that advisor’s client list only.

## Client upload link (magic link + optional QR)

Clients can upload a statement on **their phone** without signing in:

1. Run the SQL in **`supabase/advisorpilot_upload_tokens.sql`** once in the Supabase SQL editor (creates the token table).
2. Sign in to AdvisorPilot, open **Statement Capture**, and tap **Create link**. Copy the URL or use the **QR** (same URL).
3. After the client uploads, open **Client Database** — the row appears as a **Draft** with a **Client link upload** badge. Open it to confirm holdings and continue the workflow.

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

Used for statement extraction, portfolio analysis, **Live Intake** understanding, and **Live Intake** speech output.

Optional overrides:

```bash
# OPENAI_INTAKE_MODEL=gpt-4o-mini   # JSON turns for /api/intake-voice
# OPENAI_TTS_MODEL=gpt-4o-mini-tts   # natural voice for /api/intake-tts (default)
# OPENAI_TTS_VOICE=sage              # alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse
# OPENAI_STT_MODEL=whisper-1         # Whisper model used by /api/intake-stt (mic transcription)
```

**Live Intake:** Opens a full-screen session with the logo and a **mic level visualizer**. The browser captures speech; OpenAI turns each pause-separated utterance into intake updates; replies play back via **OpenAI TTS** so they sound human—not the browser’s robotic voice. True **streaming** two-way voice (like ChatGPT Advanced Voice) would use OpenAI’s Realtime API separately; this flow is pause-based dialogue plus premium TTS.

Restart `npm run dev` after changing `.env.local`.

Add `public/logo.png` for the Live Intake header; without it, the wordmark **AdvisorPilot** is shown.

### Supabase

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

### Google OAuth / NextAuth (for Gmail sending)

```bash
NEXTAUTH_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

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
```

## Project layout

- **`app/page.tsx`**: main UI + workflow state
- **`app/api/*/route.ts`**: server-side route handlers (OpenAI, Supabase, PDF generation, Gmail send, auth)
- **`components/ui/*`**: UI primitives
- **`app/globals.css`**: Tailwind v4 + shadcn theme imports

## Notes / gotchas

- **Google sign-in is required for sending emails via Gmail** (`/api/email-client-snapshot`). Email/password accounts can still use the app, download PDFs, and copy follow-up emails manually.
- **`SUPABASE_SERVICE_ROLE_KEY` is highly privileged.** Keep it server-side only (in `.env.local` / deployment secrets) and never expose it to the browser.
- This repo includes a rule in `AGENTS.md` warning that this Next.js version may differ from typical docs; if behavior looks “off”, consult `node_modules/next/dist/docs/`.

## Optional: logo

`/api/generate-report` will try to embed `public/logo.png` if present; otherwise it falls back to text branding.

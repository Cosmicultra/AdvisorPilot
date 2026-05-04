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
- **AI**: OpenAI (`openai` SDK, Responses API)
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

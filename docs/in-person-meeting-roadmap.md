# AdvisorPilot — In-person meeting roadmap

This document captures the product goal, what the codebase already supports, gaps vs. that goal, and a phased plan to close them. It is grounded in the app as of the roadmap authoring date.

## Product goal

Sit **across from a client** (first meeting or follow-up), capture their statement **on the spot** by either:

- Having them **email** the statement to you, or  
- **Taking a picture** with your phone and uploading it to the app.

Then the app should:

1. Run analysis on **tickers and holdings**.  
2. Let you **correct and confirm** everything before anything client-facing is final.  
3. Run a **deep AI analysis**.  
4. Produce a **streamlined report for the client**.  
5. Produce an **advisor-specific report** with more detail, aligned to the live discussion.

---

## What you already have (aligned with the goal)

### 1. Capture statements on the spot (phone or file)

The upload step supports a normal file picker and **camera capture on mobile** (`capture="environment"`), which matches “picture with my phone and upload.”

**Where:** `app/page.tsx` — step `"upload"` (Statement Capture).

### 2. Human-in-the-loop: correct holdings before analysis

You have a **Confirm Holdings** step: pick from AI options, override asset class, manual ticker/CUSIP, value override, and a visible “needs review” count. This is the right pattern for accuracy and compliance before any deep dive.

**Where:** `app/page.tsx` — step `"confirm"`.

### 3. Deep AI analysis

**Endpoint:** `POST /api/generate-analysis`

Market context plus structured JSON (synopsis, highlights, red flags, overlap insights, recommendations, talking points, opening script, objection handling, etc.).

### 4. Two reports (client vs advisor)

**Endpoint:** `POST /api/generate-report`

Accepts `mode: "client" | "advisor"` and builds different PDFs (client snapshot vs advisor deep dive, including holdings appendix in advisor mode where applicable).

**Where:** `app/api/generate-report/route.ts`.

### 5. Live meeting support

**Meeting Mode** includes opening script, walkthrough, questions, objection handling, and closing—aligned with sitting across from the client.

**Where:** `app/page.tsx` — step `"meeting"`.

### 6. Delivery after the meeting

- Client PDF download from the UI (`downloadPDFReport`).  
- Optional **Gmail send** of client snapshot: `POST /api/email-client-snapshot`.  
- Follow-up email helpers (copy, Gmail/Outlook compose links).

---

## Gaps between the vision and the current product

| Your goal | Today |
|-----------|--------|
| Client **emails statement to you** and it lands in the app | **Manual only:** they email you → you save/open the attachment → **upload** in the app. There is **no inbound-email → auto-import** pipeline. |
| **Fast enough** for a live first meeting | Extraction (`/api/analyze-statement`) + analysis (`/api/generate-analysis`) are **two sequential OpenAI calls**; on slow networks this can feel long. Limited progress UX beyond button loading states. |
| **Ticker-level correctness** beyond advisor edits | One AI extraction pass; **no second “normalize / validate tickers”** step (e.g. against a securities reference database). |
| **Multi-page or multiple statements** | One file per run; no “add page 2” or merge multiple accounts in one flow. |
| **Multi-advisor / production security** | Several APIs accept `ownerEmail` from the client; fine for personal use, **not** safe if untrusted users share the same deployment. |
| **Advisor profile extra fields** | `app/api/advisor-profile/route.ts` persists **`email_signature`** and **`logo_url`** (and maps those from Supabase). Extra UI fields for name/title/phone/etc. may **not** round-trip unless the table and API are extended. |

---

## Phased roadmap

### Phase 1 — “Meeting-ready” polish (highest ROI, smaller changes)

**Objective:** Same room, same Wi‑Fi, client watching—you want confidence and clarity.

- **Clarify UI copy / field names** so it is obvious which email is for **sending the client snapshot** vs advisor identity (today `client.advisorEmail` is used as the **recipient** for client snapshot email in places—easy to misread).  
- **Guardrails before analysis:** e.g. block “Run Analysis” until there are zero `review` holdings, or require an explicit “I acknowledge remaining uncertainty” acknowledgment.  
- **Default happy path:** after analysis, steer the primary CTA toward **Meeting Mode**; treat PDFs as wrap-up / send-after.  
- **Latency UX:** step-by-step status (“Uploading… extracting… generating review…”) and honest expectations; optionally **auto-save draft** to Supabase after confirm so work is not lost mid-meeting.  
- **Mobile layout pass:** larger tap targets, sticky primary actions on confirm/analysis, less vertical scroll on phone.

**Exit criteria:** You can run a full first meeting on a phone without fighting the UI; holdings are explicitly confirmed before AI deep dive runs.

---

### Phase 2 — Ingestion: “email to me” without manual attachment handling

**Objective:** Client sends a PDF; it appears in AdvisorPilot without you manually downloading from mail and re-uploading.

Choose **one** path first (simplest wins):

**Option A — Dedicated inbox + inbound processing**

- Address like `statements+you@yourdomain` receives mail → provider webhook → API stores attachment (e.g. Supabase Storage) → creates a **pending review** record → you open it in the app at Confirm Holdings.  
- **Pros:** Matches “email me the statement.”  
- **Cons:** DNS, provider (SendGrid Inbound, Mailgun, Postmark, etc.), webhook auth, virus scanning policy.

**Option B — QR / magic link (client uploads on their phone)**

- Your session shows a QR code; client scans, uploads on their device, file attaches to **your** logged-in review.  
- **Pros:** No email provider integration.  
- **Cons:** Client must use their phone; you need session/token design.

**Exit criteria:** At least one path removes the “save attachment from email then upload” step.

---

### Phase 3 — Data quality: tickers, funds, completeness

**Objective:** After AI extraction + advisor picks, the system **flags** bad or ambiguous symbols when possible.

- **Optional normalization API:** confirmed rows in → canonical symbol / security type / “unable to verify” out; **advisor review**, not auto-trading.  
- **Completeness checks:** compare sum of holdings to statement total when the document exposes it; prompt for another page if counts look wrong.  
- **Multi-file / merge:** allow multiple uploads in one session merged into one holdings table.

**Exit criteria:** Fewer wrong-ticker surprises; explicit data-quality warnings before client-facing outputs.

---

### Phase 4 — Analysis and reports: sharper client vs advisor split

**Objective:** Client PDF feels **simple and reassuring**; advisor PDF reads like **meeting playbook + technical depth**.

- **Prompt tuning** so client-facing sections never read like advisor-only language; advisor PDF always leans on talking points, objections, recommendations, appendix (partially true today—tighten consistency).  
- **Optional “post-meeting regenerate”:** feed `meetingNotes` into the analysis prompt so the written output reflects what was actually said.  
- **Caching:** if holdings + key client fields are unchanged, avoid redundant OpenAI calls on repeated actions.

**Exit criteria:** Side-by-side, a third party can tell which artifact is for the client vs the advisor without reading the filename.

---

### Phase 5 — Production hardening (when others use the app)

- **Server-side ownership:** derive advisor identity from session/JWT; **do not trust** client-supplied `ownerEmail` for writes.  
- **Supabase RLS:** row-level security per authenticated user.  
- **Audit trail:** exports, sends, and major state changes logged for compliance conversations.

**Exit criteria:** Safe multi-user deployment with clear accountability.

---

## Suggested execution order

1. **Phase 1** — meeting UX, guardrails, mobile; shippable to yourself quickly.  
2. **Phase 2** — if “email to me without re-upload” is mandatory, invest here next; otherwise QR/magic-link is often faster to ship.  
3. **Phase 3** — as volume and accuracy pressure grow.  
4. **Phase 4** — differentiate outputs and tie analysis to meeting notes.  
5. **Phase 5** — when the product is not single-advisor-only.

---

## Key files reference

| Area | Location |
|------|----------|
| Main UI and step flow | `app/page.tsx` |
| Statement extraction | `app/api/analyze-statement/route.ts` |
| AI portfolio analysis | `app/api/generate-analysis/route.ts` |
| PDF generation | `app/api/generate-report/route.ts` |
| Saved clients | `app/api/client-database/route.ts` |
| Advisor profile / signature | `app/api/advisor-profile/route.ts` |
| Gmail client snapshot | `app/api/email-client-snapshot/route.ts` |
| Google OAuth (Gmail scope) | `app/api/auth/[...nextauth]/route.ts` |

---

## Open decision (pick one to prioritize next 30 days)

- **(A)** Faster, clearer **in-room meeting flow** (Phase 1).  
- **(B)** **Email auto-import** or QR upload (Phase 2).  
- **(C)** **Ticker / data validation** layer (Phase 3).

Document owner: align the next sprint with whichever of A/B/C matters most for your first real client meetings.

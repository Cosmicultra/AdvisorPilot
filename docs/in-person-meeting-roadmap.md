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

The upload step supports a **file picker** and a mobile camera intent (`capture="environment"`). **Reliable on-device camera capture and ingestion for deep AI analysis is still a priority:** when the camera path is flaky or unfinished, treat **file upload** (saved attachment or exported PDF) as the working path for live meetings. Closing the camera → upload → extract loop is what unlocks “picture on the spot” for the full roadmap.

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

**Product bar:** the **client snapshot** should stay **easy to find and send** after the meeting (minimal taps, clear recipient vs advisor identity—see Phase 1).

---

## Gaps between the vision and the current product


| Your goal                                                  | Today                                                                                                                                                                                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client **emails statement to you** and it lands in the app | **Manual only:** they email you → you save/open the attachment → **upload** in the app. There is **no inbound-email → auto-import** pipeline.                                                                                |
| **Camera “on the spot”** feels as reliable as file upload  | Camera/upload pipeline may still need hardening for consistent extraction → deep AI; file path is the fallback until then.                                                                                                   |
| **Fast enough** for a live first meeting                   | Extraction (`/api/analyze-statement`) + analysis (`/api/generate-analysis`) are **two sequential OpenAI calls**; on slow networks this can feel long. Limited progress UX beyond button loading states.                      |
| **Ticker-level correctness** beyond advisor edits          | One AI extraction pass; **no second “normalize / validate tickers”** step (e.g. against a securities reference database).                                                                                                    |
| **Multi-page or multiple statements**                      | One file per run; no “add page 2” or merge multiple accounts in one flow.                                                                                                                                                    |
| **Multi-advisor / production security**                    | Several APIs accept `ownerEmail` from the client; fine for personal use, **not** safe if untrusted users share the same deployment.                                                                                          |
| **Advisor profile extra fields**                           | `app/api/advisor-profile/route.ts` persists `**email_signature`** and `**logo_url**` (and maps those from Supabase). Extra UI fields for name/title/phone/etc. may **not** round-trip unless the table and API are extended. |


---

## Phased roadmap

### Phase 1 — “Meeting-ready” polish (highest ROI, smaller changes)

**Objective:** Same room, same Wi‑Fi, client watching—you want confidence and clarity.

- **Clarify UI copy / field names** so it is obvious which email is for **sending the client snapshot** vs advisor identity (today `client.advisorEmail` is used as the **recipient** for client snapshot email in places—easy to misread). **Goal:** client snapshot is **obvious to send** (right recipient, few steps, no ambiguity).  
- **Guardrails before analysis (confirmed):** **block “Run Analysis” until there are zero `review` holdings** (no deep AI until the table is clean). Optionally keep a separate path later for “I acknowledge remaining uncertainty” if compliance ever requires it.  
- **Autosave to draft (confirmed):** persist work-in-progress (e.g. after Confirm Holdings) so a dropped connection or accidental navigation does not lose the meeting—**auto-save draft** to Supabase where it fits the current schema.  
- **Default happy path:** after analysis, steer the primary CTA toward **Meeting Mode**; treat PDFs as wrap-up / send-after.  
- **Latency UX:** step-by-step status (“Uploading… extracting… generating review…”) and honest expectations (already directionally right—keep tightening).  
- **Mobile layout pass:** larger tap targets, sticky primary actions on confirm/analysis, less vertical scroll on phone.

**Exit criteria:** You can run a full first meeting on a phone without fighting the UI; holdings are explicitly confirmed before AI deep dive runs; snapshot send path feels frictionless.

---

### Phase 2 — Ingestion: “email to me” without manual attachment handling

**Objective:** Client sends a PDF; it appears in AdvisorPilot without you manually downloading from mail and re-uploading.

Choose **one** path first (simplest wins):

**Option A — Dedicated inbox + inbound processing**

- Address like `statements+you@yourdomain` receives mail → provider webhook → API stores attachment (e.g. Supabase Storage) → creates a **pending review** record → you open it in the app at Confirm Holdings.  
- **Pros:** Matches “email me the statement.”  
- **Cons:** DNS, provider (SendGrid Inbound, Mailgun, Postmark, etc.), webhook auth, virus scanning policy.

**Option B — Magic link first, QR optional (client uploads on their phone)**

- **Primary UX: magic link** — you copy/send a **short link**; client opens it on their phone and uploads. Easier for **older or less technical clients** than “scan this QR code.”  
- **Optional:** show a **QR code** that encodes the **same link** for clients who prefer scan-to-open.  
- **Advisor binding (required):** the link (and QR) must resolve to a **server-issued token tied to the advisor who is signed in** (e.g. your email session)—uploads must attach to **your** review queue only, never another advisor’s.  
- **Pros:** No inbound email provider integration; predictable mapping from link → advisor.  
- **Cons:** Token expiry, abuse prevention, and storage wiring need design (see Phase 5 for production-grade auth).

**Exit criteria:** At least one path removes the “save attachment from email then upload” step; client uploads always land on the **correct advisor’s** session.

---

### Phase 3 — Data quality: tickers, funds, completeness, tax context

**Objective:** After AI extraction + advisor picks, the system **flags** bad or ambiguous symbols when possible, and captures **account context** when the statement supports it.

- **Optional normalization API:** confirmed rows in → canonical symbol / security type / “unable to verify” out; **advisor review**, not auto-trading.  
- **Completeness checks:** compare sum of holdings to statement total when the document exposes it; prompt for another page if counts look wrong.  
- **Multi-page / multi-file on phone:** support **multiple pages or scans in one flow** (add page 2+, or multiple files) merged into **one** holdings table for the session.  
- **Qualified vs non-qualified (when labeled):** when the statement names accounts (e.g. IRA, 401(k), brokerage, “taxable”), infer or extract **tax treatment** — **tax-deferred / qualified** vs **taxable / non-qualified** — so holdings and narrative align with how advisors actually talk about buckets. (Exact labels depend on document wording; advisor confirmation remains the source of truth.)

**Exit criteria:** Fewer wrong-ticker surprises; explicit data-quality warnings before client-facing outputs; multi-page sessions workable on mobile; tax bucket signals when the PDF gives them.

---

### Phase 4 — Analysis and reports: sharper client vs advisor split

**Objective:** **Advisor deep dive** is always **advisor-leaning** (playbook, nuance, recommendations, appendix). **Client report** stays a **stripped-down, digestible** snapshot—reassuring, not overloaded.

- **Prompt tuning** so client-facing sections never read like advisor-only language; advisor PDF always leans on talking points, objections, recommendations, appendix (partially true today—tighten consistency).  
- **Content direction (confirmed):** keep **Monte Carlo-style framing where applicable**, **holding types**, **allocation / proposed allocation changes**, and similar mechanics—these match how you want to present outcomes. “More bulletproof” usually means pairing narrative with **Phase 3 validation** (tickers, totals, tax buckets) and clear **disclaimers**, not necessarily new report sections.  
- **Optional “post-meeting regenerate”:** feed `meetingNotes` into the analysis prompt so the written output reflects what was actually said.  
- **Caching:** if holdings + key client fields are unchanged, avoid redundant OpenAI calls on repeated actions.

**Exit criteria:** Side-by-side, a third party can tell which artifact is for the client vs the advisor without reading the filename; advisor version never feels “dumbed down,” client version never feels like internal notes.

---

### Phase 5 — Production hardening (when others use the app)

**If Supabase / server work is new to you:** this phase is mostly “make the backend enforce what the UI already *intends*.” You do not need to become a DBA overnight—work item by item with someone who knows NextAuth + Supabase, or follow official Supabase RLS tutorials scoped to your tables.

- **Server-side ownership:** derive advisor identity from **session/JWT** (the signed-in user); **do not trust** client-supplied `ownerEmail` (or any email in JSON bodies) for writes.  
- **Supabase RLS:** row-level security so each authenticated user only reads/writes **their** rows (clients, drafts, uploads metadata).  
- **Magic-link uploads (ties to Phase 2):** tokens map to **one advisor id**; uploads land in that advisor’s storage prefix + pending queue.  
- **Audit trail:** exports, sends, and major state changes logged for compliance conversations.

**Exit criteria:** Safe multi-user deployment with clear accountability; no cross-advisor data bleed via API payloads or guest upload links.

**Collaboration note:** If ChatGPT (or similar) helped stand up the server, treat Phase 5 as a **review pass**: list each API that mutates data and confirm whether it checks the **server session** before writing. That list becomes the implementation checklist.

---

## Suggested execution order

1. **Phase 1** — meeting UX, guardrails, mobile; shippable to yourself quickly.
2. **Phase 2** — if “email to me without re-upload” is mandatory, invest here next; otherwise **magic-link-first** client upload (advisor-scoped) is often faster to ship than inbound email parsing.
3. **Phase 3** — as volume and accuracy pressure grow.
4. **Phase 4** — differentiate outputs and tie analysis to meeting notes.
5. **Phase 5** — when the product is not single-advisor-only.

---

## Key files reference


| Area                        | Location                                 |
| --------------------------- | ---------------------------------------- |
| Main UI and step flow       | `app/page.tsx`                           |
| Statement extraction        | `app/api/analyze-statement/route.ts`     |
| AI portfolio analysis       | `app/api/generate-analysis/route.ts`     |
| PDF generation              | `app/api/generate-report/route.ts`       |
| Saved clients               | `app/api/client-database/route.ts`       |
| Advisor profile / signature | `app/api/advisor-profile/route.ts`       |
| Gmail client snapshot       | `app/api/email-client-snapshot/route.ts` |
| Google OAuth (Gmail scope)  | `app/api/auth/[...nextauth]/route.ts`    |


---

## Open decision (pick one to prioritize next 30 days)

- **(A)** Faster, clearer **in-room meeting flow** (Phase 1).  
- **(B)** **Email auto-import** or QR upload (Phase 2).  
- **(C)** **Ticker / data validation** layer (Phase 3).

Document owner: align the next sprint with whichever of A/B/C matters most for your first real client meetings.
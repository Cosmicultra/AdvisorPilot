# Global Voice Agent — Design Plan

**Status:** Planning · **Date:** 2026-05-14 · **Owner:** TBD

## Goal

A **global, always-available voice agent** inside the AdvisorPilot product (`app/app/*`) that lets advisors:

1. **Navigate the app by voice** — "Open Sarah Chen's review," "Go to the analysis screen," "Take me back to intake step 3."
2. **Ask read-only questions about clients** — "What's Sarah's risk profile?", "Which clients haven't been contacted in 90 days?", "What's Robert's top red flag?"
3. **Be walked through the workflow** — "How do I start a new client?", "Where do I upload a statement?", "What does this red-flag mean?"

Implemented on **Gemini Live** with browser-direct WebSocket and ephemeral tokens. Modeled architecturally on the Athena desktop agent (`fragilepak-mcp-servers/athena-desktop-agent`), specifically its **AppContext snapshot pattern, Nudge async-delivery queue, and tool registry** — adapted from Electron to a web app.

## Non-goals (v1)

- No write actions (no email send, no client save/delete, no PDF generation, no analysis run).
- No tools beyond **navigation** and **read-only client Q&A**. Background-task patterns are designed but unused in v1.
- No multi-provider abstraction yet — voice is Gemini Live only (text passes can still pick provider per the [multi-provider plan](./multi-provider-llm-plan.md)).
- No persistent voice transcripts or memory across sessions.
- No marketing-site presence — voice is gated to authenticated `app/app/*` routes.

---

## 0. Database change policy (rule for this entire plan)

**New tables only. We do not alter any existing Supabase table** (including `advisor_profile`). Voice is its own concern and lives in its own table.

Complete inventory of database changes in this plan:

| Change | Type | Tables touched |
|---|---|---|
| Per-advisor voice preferences | **NEW table** | `advisorpilot_voice_settings` (one row per advisor) |

No other migrations are required by this plan.

---

## 1. UX surface

### 1.1 Activation
- A persistent **mic button** in the header of `app/app/page.tsx` (sibling to the model-provider pill from the multi-provider plan). States: idle → listening → thinking → speaking, plus a small volume meter.
- Tap to start, tap to stop. **No wake word** (parity with Athena; avoids accidental triggers in shared offices).
- Keyboard shortcut: `Cmd/Ctrl + Shift + V` to toggle.

### 1.2 Voice indicator overlay
- When active, a low-profile bar appears at the bottom of the screen showing live transcript (user side) + assistant captions + an "interrupt" hint.
- Live Intake overlay (`LiveIntakeOverlay`) was removed; Nova chat + Gemini Live voice in `ChatWidget` is the only advisor voice surface.

### 1.3 What it looks like (script)
> Advisor (mid-screen, looking at Sarah Chen's analysis): "What's her income readiness score?"
> Agent: "Sarah Chen's income readiness score is 68 out of 100, with a flag around bond duration."
> Advisor: "Open Robert Garcia."
> Agent: *(navigates)* "Showing Robert Garcia. He's on the meeting guide. Want me to read the talking points?"
> Advisor: "No, take me to upload for a new client."
> Agent: *(navigates)* "On the upload screen. Drop a statement or create a client link."

### 1.4 Settings — advisor controls (NOT env-locked)

Every voice setting that affects the experience is **changeable by the advisor in the Settings drawer**, under the **Voice Agent** tab. Env vars set firm defaults; the advisor's saved choice wins.

```
┌────────────────────────────────────────────────────────────────────────┐
│  Voice Agent                                                            │
├────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ☑ Enable voice agent in this account                                   │
│                                                                         │
│  Model                                                                  │
│  [ gemini-3.1-flash-live-preview          ▾ ]   default: same           │
│      └ also available: gemini-2.5-flash-native-audio-preview-12-2025    │
│                          (supports long-running async tools)             │
│                                                                         │
│  Voice                                                                  │
│  [ Aoede — warm, professional             ▾ ]   ▶ Preview               │
│      └ Aoede · Puck · Charon · Kore · Fenrir · Leda · Orus · Zephyr ·   │
│        + 22 more (30 prebuilt voices, all free with API)                │
│                                                                         │
│  Activation                                                             │
│  Hotkey   [ Cmd ⌘  +  Shift ⇧  +  V                          Edit… ]    │
│  ☑ Show captions overlay while listening                                │
│  ☐ Auto-pause when this browser tab is in the background (recommended)  │
│                                                                         │
│  Privacy                                                                │
│  ☑ I have disclosed AI assistant use to my clients per firm policy      │
│  ☐ Log tool calls to my audit trail (shape only — no transcripts)       │
│                                                                         │
│  [Save changes]                                                         │
└────────────────────────────────────────────────────────────────────────┘
```

**Behavior:**
- All persisted in a **new dedicated table** `advisorpilot_voice_settings` (one row per advisor; the existing `advisor_profile` table is **not** modified — voice is its own concern). **Every preference column is nullable with no DEFAULT** — `NULL` means "use the firm/env default for this preference." Existing advisors simply have no row until they open Settings; the resolver falls back to env defaults transparently. Columns:
  - `advisor_email text primary key`
  - `advisor_user_id uuid` *(nullable; populated for Supabase advisors)*
  - `voice_enabled bool` *(nullable; NULL → env default, which is enabled)*
  - `voice_model text` *(nullable)*
  - `voice_name text` *(nullable)*
  - `voice_hotkey text` *(nullable)*
  - `voice_show_captions bool` *(nullable)*
  - `voice_pause_on_blur bool` *(nullable)*
  - `voice_disclosed bool` *(nullable; NULL is distinguishable from explicit `false` for compliance audits)*
  - `voice_audit_tool_calls bool` *(nullable)*
  - `created_at timestamptz not null default now()` *(metadata, always populated)*
  - `updated_at timestamptz not null default now()` *(metadata, always populated)*

  RLS: advisor can only read/write their own row, keyed by email (Google) or `advisor_user_id` (Supabase) matching today's resolver pattern. **Why nullable with no default:** keeps the "NULL = use env default" pattern uniform with the AI-model picker (multi-provider plan §9.7), makes rollback trivial (`drop table` with no residual references), and lets compliance audits distinguish "advisor hasn't answered the disclosure prompt" (NULL) from "advisor explicitly said no" (`false`).
- "Preview" button next to Voice plays a short canned sample line in the selected voice (uses a server-side mint of a single-turn token; ~$0.001 per preview).
- The **token-mint route** (`/api/voice/token`) reads the advisor's saved profile and uses their `voice_model` + `voice_name` when constructing `liveConnectConstraints`. Browser cannot tamper because the constraints are server-side.
- Model dropdown sources from `lib/voice/model-catalog.ts` (parallel to the multi-provider plan's `lib/llm/model-catalog.ts`). New voices land by editing one file.
- A "Custom…" option in both Model and Voice dropdowns accepts free text for power users / preview-only models we haven't added to the catalog yet.

---

## 2. Architecture overview

```
┌──────────────────────────────── Browser (app/app/*) ─────────────────────────────────┐
│                                                                                       │
│   ┌──────────────────┐   useVoiceAgent() hook                                          │
│   │   <MicButton/>   │ ─────────┐                                                      │
│   └──────────────────┘          │                                                      │
│                                 ▼                                                      │
│   ┌──────────────────────────────────────────────────────────────┐                    │
│   │  VoiceSession (WebSocket → Gemini Live)                       │                   │
│   │   • AudioWorklet: mic 48 kHz → resample → 16 kHz PCM         │                   │
│   │   • PCM 24 kHz playback queue (AudioContext)                  │                   │
│   │   • Server VAD; barge-in via `interrupted` flag               │                   │
│   │   • Tool-call dispatcher (function_call → handler → response) │                   │
│   │   • Session resumption (handle) + GoAway → reconnect          │                   │
│   └──────────────────────────────────────────────────────────────┘                   │
│           │ tool calls                          │ injects (Nudge, future)              │
│           ▼                                     ▲                                      │
│   ┌──────────────────────────┐         ┌──────────────────────────┐                  │
│   │  AppContext / Focus      │         │  NudgeQueue              │                  │
│   │  (DOM-free, React state) │         │  (speech-boundary gated) │                  │
│   └──────────────────────────┘         └──────────────────────────┘                  │
│           │                                     ▲                                      │
│           ▼                                     │                                      │
│   ┌──────────────────────────────────────────────────────────────┐                   │
│   │  React state (step, intakeStep, client, savedReviews, ...)  │                   │
│   │  + URL searchParams (new in this work)                       │                   │
│   └──────────────────────────────────────────────────────────────┘                   │
│                                                                                       │
└───────────────────────────────────────────────────────────────────────────────────────┘
        │  POST /api/voice/token (mint ephemeral, 30-min messaging window)
        ▼
┌──────────────── Next.js server ─────────────────┐         ┌─── Gemini Live ───┐
│  resolveAdvisorIdentity(req)                     │  WSS    │ generativelang.   │
│  → ai.authTokens.create({                        ├────────►│ googleapis.com    │
│      uses: 1,                                    │         │  /ws/.../Bidi...  │
│      newSessionExpireTime: now + 60s,            │         │  Constrained      │
│      expireTime: now + 30m,                      │         └───────────────────┘
│      liveConnectConstraints: { model, config }   │
│    })                                            │
└──────────────────────────────────────────────────┘
```

**Why browser-direct (not server-relay):**
- Google's published guidance: ephemeral tokens are the recommended pattern; relay adds latency and load.
- The token is constrained server-side to a specific model, voice, tools, and system instructions — the browser can't tamper.
- Only the **mint endpoint** is server-side; the audio path never touches our servers.

---

## 3. Gemini Live setup (verified May 2026)

| Concern | Choice | Notes |
|---|---|---|
| Model | `gemini-3.1-flash-live-preview` | Default; sequential tool calls only |
| Alt model | `gemini-2.5-flash-native-audio-preview-12-2025` | Use ONLY if/when we want `NON_BLOCKING` long-running tools (future Nudge work) |
| Transport | WebSocket (WSS) direct from browser | Endpoint `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=…` |
| SDK | `@google/genai` v2.x via `ai.live.connect()` | Same module as the multi-provider plan |
| Auth | Ephemeral tokens minted at `POST /api/voice/token` | Uses 1; start-window 60s; message-window 30 min; server pins model + voice + tools + system prompt |
| Audio in | PCM 16 kHz mono, 16-bit LE | AudioWorklet for capture + resampling |
| Audio out | PCM 24 kHz mono, 16-bit LE | AudioContext queue; `interrupted` flag stops playback |
| VAD | Server-side; tunable | `endOfSpeechSensitivity: MEDIUM`, `silenceDurationMs: 600` defaults |
| Barge-in | Yes, automatic | Client must stop playback on `interrupted` |
| Voice | `Aoede` (warm, professional) — same as Athena default | Per-session via `speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName` |
| Session caps | ~10 min connection, ~15 min audio | Enable `contextWindowCompression` for indefinite sessions |
| Resume | `sessionResumption: { handle }` from `sessionResumptionUpdate` | Valid 2 h post-disconnect; reconnect on `GoAway` automatically |
| Pricing (3.1) | $3/M audio in ($0.005/min) · $12/M audio out ($0.018/min) · $0.75/M text in · $4.50/M text out | ~$0.023 per active minute = $1.40/hr advisor |
| Compliance | **Paid tier only**; "no training on inputs/outputs" applies | Free tier may be human-reviewed — never enable in production |

### Env vars

**Important:** these are **firm defaults**. Each advisor can pick their own voice model and voice name in the Settings drawer (§11) — those preferences override the env vars. Don't think of these as user-facing settings.

```bash
GEMINI_API_KEY=...                                     # server-only; used by token-mint route
LLM_VOICE_MODEL=gemini-3.1-flash-live-preview          # default; advisor can choose another in Settings
LLM_VOICE_NAME=Aoede                                   # default; advisor can pick from 30 voices in Settings
LLM_VOICE_SYSTEM_PROMPT_PATH=lib/voice/prompts/advisor.txt
LLM_VOICE_MAX_SESSION_MINUTES=15
LLM_VOICE_CONTEXT_COMPRESSION=true
```

---

## 4. Patterns adopted from Athena (and how we adapt them)

Athena (Electron, multi-surface) and AdvisorPilot (browser, single-surface) differ enough that a verbatim port is wrong. Here's what we keep, what we change, what we drop.

### 4.1 AppContext snapshot + Focus — ADOPT VERBATIM
- **Athena:** `voice-app-context.ts` builds an `AppContext` with `focus.description` (a one-line summary of "what's in front of the user") delivered to the agent via `get_context`. Prevents hallucination ("I see the dashboard" when the user is on settings).
- **Us:** `lib/voice/context.ts` builds the same shape from React state. On every `get_context` tool call, we snapshot `{ step, intakeStep, activeReviewId, clientName, clientCount, lastAction, focus: { description, surface, selection } }`. The `focus.description` is computed from a switch on `step`:
  ```ts
  function focusDescription(state) {
    switch (state.step) {
      case "intake": return `Intake step ${state.intakeStep + 1} of 10 (${INTAKE_STEPS[state.intakeStep].title}) for ${clientName(state) ?? "a new client"}.`;
      case "upload": return `Statement upload screen for ${clientName(state)}.`;
      case "analysis": return `Portfolio analysis for ${clientName(state)} — Income readiness ${state.analysis?.incomeReadinessScore ?? "n/a"}, ${state.holdings.length} holdings.`;
      // ...
    }
  }
  ```
- The agent sees this string in every `get_context` response and uses it to ground answers.

### 4.2 Tool registry pattern — ADOPT, NARROW
- **Athena:** `voice-app-tools.ts` exposes 7 tools. We adopt the **registry shape** (named tool + JSON schema + handler) but ship a much smaller v1 set (§5).

### 4.3 Inject as system message, not user message — ADOPT
- **Athena:** Nudge results are pushed via `clientContent` framed as a system message so they don't pollute conversation history as "user said."
- **Us:** Same. When (in v2) a background task completes, we send `{ turns: [{ role: "user", parts: [{ text: "[system: background task complete] ..." }] }] }` and prompt-engineer the agent to recognize the prefix.

### 4.4 NudgeQueue with speech-boundary gating — ADOPT IN CODE, UNUSED IN V1
- **Athena:** `voice-app-nudge.ts` — speech-boundary-gated delivery (only when NOT speaking/listening/thinking), 800ms settle delay after `response_done`, race-safe cancellation, 1s watchdog, 5min expiry.
- **Us:** Implement `lib/voice/nudge-queue.ts` with the same shape. **No tools dispatch nudges in v1** (no long-running work), but the plumbing lands so a future "run analysis in the background, speak the score when done" tool drops in cleanly.

### 4.5 Completion event bus — DEFER
- Athena has three channels (CT/CC/Ask Athena). We have one surface; an event emitter is overkill until v2 introduces background tools. Skip.

### 4.6 Audio I/O via Web Audio — ADOPT, REPLACE SCRIPT PROCESSOR
- **Athena:** ScriptProcessor (deprecated in modern browsers, still works).
- **Us:** Use **AudioWorklet** for input (the modern replacement; same low-latency PCM stream). Output via `AudioContext.createBufferSource()` queued to `currentTime + offset`. Same playback pattern.

### 4.7 System wake/resume — DROP
- Electron-specific. Browser tabs handle this differently; if the tab is backgrounded, audio suspends, and we reconnect on focus. No `powerMonitor` equivalent needed.

### 4.8 Volume ref (60Hz, no re-renders) — ADOPT
- A `useRef<number>` updated in the AudioWorklet message handler; the mic-button canvas reads it in its own RAF. Critical to avoid re-rendering `app/app/page.tsx` (a 7.5k-line component) 60×/s.

---

## 5. Tool surface (v1: navigation + read-only Q&A)

All tools are **read-only or navigational**. Every tool is server-pinned in the ephemeral-token constraints so the browser can't add new tools at runtime.

| # | Tool | Purpose | Args |
|---|---|---|---|
| 1 | `get_context` | Snapshot current app state (step, intakeStep, active client, focus.description, recent action). Called frequently. | none |
| 2 | `navigate` | Change the active step. | `step: "intake"|"upload"|"confirm"|"analysis"|"meeting"|"fia"|"roth"|"retIncome"|"report"|"saved"` |
| 3 | `navigate_intake_step` | Within intake, jump to a specific question. | `index: 0..9` |
| 4 | `open_client` | Find and load a saved client by name. Atomic: find → load → navigate to a sensible default step (analysis if present, intake otherwise). Mirrors Athena's `route_and_inject` atomicity. | `name: string` (fuzzy match) |
| 5 | `start_new_client` | Reset state and go to intake step 0. Confirmation gate: agent must ask "OK to discard the current review?" if there are unsaved changes. | none |
| 6 | `list_clients` | Returns up to N saved clients with names, ages, last-contacted dates, status. For "which clients haven't been contacted in 90 days?". | `filter?: { staleDays?: number; status?: string; search?: string }` |
| 7 | `get_client_details` | Returns the active client's profile, holdings summary, allocation, analysis scores, top findings. **No PII beyond what's already on screen.** | `clientId?: string` (defaults to active) |
| 8 | `read_analysis_section` | Read a specific section of the current analysis aloud naturally. | `section: "synopsis"|"highlights"|"redFlags"|"recommendations"|"talkingPoints"|"objectionHandling"` |
| 9 | `explain_ui` | Walk-through helper: explain what the current screen does and what action the user usually takes next. Pulls from a static knowledge base (§7). | `topic?: string` (defaults to current step) |

**Explicit non-tools in v1:**
- `save_review` / `delete_review` / `send_email` — destructive or external.
- `run_analysis` / `generate_report` — long-running (>30s) — needs Nudge wiring, deferred to v2.
- `take_screenshot` — privacy concerns in a financial app; not needed for navigation-only.

### 5.1 Tool handler shape

```ts
// lib/voice/tools.ts
export interface VoiceTool<TArgs> {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON schema
  handler: (args: TArgs, ctx: VoiceToolContext) => Promise<unknown>;
}

export interface VoiceToolContext {
  appState: AppStateRef;            // ref to live React state via context
  navigate: (step: AppStep) => void;
  setIntakeStep: (i: number) => void;
  setActiveReviewId: (id: string | null) => void;
  setClientSearch: (s: string) => void;
  // ... narrow setters intentionally; tools cannot mutate holdings/analysis/client directly
  fetchAdvisor: ReturnType<typeof useAdvisorFetch>; // for any read-only API
}
```

### 5.2 Confirmation flows

The agent **never** mutates state without speaking the action first. For navigation, the action is the speech ("Going to the analysis screen"). For `start_new_client`, the agent must ask explicitly because the unsaved-changes case is irreversible.

---

## 6. App-state visibility (the Focus / AppContext layer)

Athena's biggest win is that the agent **never guesses what the user sees**. We replicate this with a single source of truth.

### 6.1 `VoiceAppStateProvider`

```ts
// app/app/voice-state-provider.tsx
export function VoiceAppStateProvider({ children }) {
  const state = /* read every navigation-relevant field from existing useState hooks via a context */;
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; });
  return <VoiceAppStateContext.Provider value={stateRef}>{children}</VoiceAppStateContext.Provider>;
}
```

The ref is read by tool handlers on every `get_context` invocation. State updates do NOT re-render the voice subtree (it consumes the ref, not the value), so the 60Hz volume meter and audio loop don't churn.

### 6.2 Focus computation

`lib/voice/focus.ts` exports a single `focusDescription(state) → string` and `focusPayload(state) → AppContext`. This is the **only** place agent-visible state is shaped — no leaks elsewhere. Examples:

- step `analysis`, client Sarah, score 68 → `"Portfolio analysis for Sarah Chen — Income readiness 68/100, 14 holdings, 2 red flags."`
- step `saved`, search "garcia" → `"Saved clients screen, filtered to 3 results matching 'garcia'."`
- step `intake`, intakeStep 5 → `"Intake step 6 of 10 (Retirement spendable income) for new client."`

### 6.3 What we deliberately do NOT expose

- Holdings beyond a summary count.
- Full analysis text (only via `read_analysis_section`).
- Magic-link tokens, email addresses other than the active client's, SSN-equivalents.

---

## 7. "Training" the agent on the app (knowledge base)

The user asked how we teach the agent to walk users through workflows. There are two parallel mechanisms.

### 7.1 System instruction (persistent persona + capability map)

`lib/voice/prompts/advisor.txt` — the system prompt baked into every session. Sections:

1. **Identity & tone** — "You are AdvisorPilot's in-app assistant. You speak in short, professional sentences suited to a financial advisor on a client call. You are not a financial advisor and never give investment advice; you help the human navigate the app and recall data they've already entered."
2. **Capability map** — explicit list of what the agent CAN and CANNOT do (mirrors §5).
3. **Navigation model** — names of the 10 steps, ordering, what each is for, what comes before/after.
4. **Workflow walk-throughs** — short "how do I…" answers keyed to topics: "starting a new client," "uploading a statement," "what's an income readiness score?", "how do I send the meeting guide?"
5. **Privacy rules** — never read full SSN/account numbers aloud even if they appear in state. Don't volunteer PII the user didn't ask for.
6. **Tool usage rules** — always call `get_context` before answering "where am I?" / "what's this?"; never `navigate` and answer in the same turn without speaking the action.

This file is **the source of truth** for the agent's behavior. It's tested via a small set of red-team cases (next section).

### 7.2 Dynamic in-prompt context (via `get_context`)

For everything that changes per-session (which client is loaded, where the user is, recent saved clients), the agent calls `get_context` and `list_clients` / `get_client_details`. The system prompt teaches the agent **when** to call each:

> "Before answering a 'where am I' or 'what's this' question, call `get_context`. Before answering 'open <name>' or 'find <name>', call `list_clients` to disambiguate names. Never assume context is unchanged between turns — the user may have clicked something."

### 7.3 Tested conversations (the "training set")

A small fixture file `lib/voice/eval/conversations.test.ts` runs offline regression: a sequence of `{userText, expectedTools[], expectedAssistantPattern}` tuples. Examples:

- "What's Sarah's risk profile?" → must call `list_clients` (if Sarah isn't active) → `get_client_details` → mention risk profile.
- "Take me to the analysis screen" → must call `navigate({step:"analysis"})` and speak the action.
- "Send the report to Sarah" → must refuse politely (out of v1 scope) and offer the path the user can take manually.

Eval runs in Node with the Gemini SDK; no audio, just function-call shape + text response. Cheap, catches regressions in the system prompt.

---

## 8. The URL-state refactor (prereq for `navigate`)

Today `app/app/page.tsx` uses **only React state** for `step`, `intakeStep`, `activeReviewId`, `clientSearch`. The agent's `navigate` tool calls into setters — that part works immediately. But:

1. The advisor would expect to share or bookmark `/app?step=analysis&clientId=...`. Today they can't.
2. Resume after refresh/reconnect should put them back on the same screen.
3. The voice agent's `get_context` is more reliable if URL = state.

### 8.1 Scope of the refactor (small)

Add a thin sync layer that writes `step`, `intakeStep`, `activeReviewId`, `clientSearch` to `useSearchParams()` on change and reads them on mount. Use Next.js 16's `useRouter`/`useSearchParams` (App Router pattern). Approximate diff:

- Add `useSyncToUrl(state)` hook in `app/app/page.tsx` that calls `router.replace(...)` (no history pollution) when any of the synced fields change.
- On mount, hydrate state from `searchParams` if present.
- Defaults: `step="intake"`, `intakeStep=0`, no client.

**Decision:** Bundle this into Phase 1 of the voice rollout. Without it, `navigate` works but refresh-resilience and shareable links don't — and the agent's mental model of "the URL is the screen" is a Western standard worth honoring.

---

## 9. Background-task / Nudge pattern (designed, unused in v1)

Even though v1 has no long-running tools, we land the **NudgeQueue** so the future doesn't require a re-architecture.

### 9.1 Queue shape (mirrors Athena `voice-app-nudge.ts`)

```ts
class NudgeQueue {
  enqueue(label: string, deliver: () => void): void;          // called when a background task completes
  onStateChange(state: VoiceState): void;                      // wired to session state events
  // Internal: 800ms settle delay after response_done; 1s watchdog; 5min expiry; race-safe cancel.
}
```

### 9.2 Future use case (not v1)

In a later phase: a tool like `run_analysis_in_background(clientId)` kicks off the existing analyze flow on the server, returns immediately with a task id, and registers an in-memory listener. When the analysis completes (existing webhook or polling), the queue speech-gates a one-liner like *"Sarah's analysis is ready — income readiness 71, two red flags. Want me to read them?"*

This is exactly Athena's pattern. We land the queue + delivery semantics in v1 so the v2 PR is short and small.

### 9.3 If/when we adopt `gemini-2.5-flash-native-audio-preview-12-2025`

That model supports `behavior: NON_BLOCKING` with `scheduling: INTERRUPT|WHEN_IDLE|SILENT` on tool calls — Google's native version of the Nudge pattern. The queue we build is **portable**: it handles delivery for the 3.1 model (where we manually inject); when 2.5 native-audio becomes attractive, we change the dispatch to use Google's native scheduling and keep the same UX.

---

## 10. Privacy, compliance, supervision

The advisor product handles client PII. Voice changes the threat model.

| Concern | Mitigation |
|---|---|
| Google training on inputs | **Paid Gemini Developer API only.** Free tier explicitly trains and is human-reviewed; we set `GEMINI_API_KEY` for paid tier and document this in env-var contract. |
| Audio recording on Google's side | Per docs, paid tier logs transiently for abuse detection only. Document this for compliance review. If firm requires zero-retention, switch to **Vertex AI Live API** + VPC-SC (separate rollout). |
| PII over the wire | All audio is direct browser↔Google over WSS with ephemeral token. No third-party hops. |
| Recordings on our side | None. We do not store audio or transcripts. Tool calls and Focus payloads are logged (without raw audio) for QA and revocation. |
| Tab visibility | Voice auto-pauses on `document.visibilityState !== "visible"` (don't capture audio when the advisor switches tabs). |
| Cross-advisor data leakage | Every tool handler enforces ownership via `resolveAdvisorIdentity` on the existing patterns. `list_clients` returns only the signed-in advisor's clients. |
| Disclosure to clients | The mic button is visibly persistent; the indicator overlay shows "listening." Advisor is responsible for disclosing AI use to clients per their firm's rules. We add a small advisor-profile setting "Disclose AI assistant to clients" that surfaces firm-specific copy. |
| Microphone permission | Browser prompts once per origin. If denied, the mic button shows a disabled state with a tooltip pointing to browser settings. |
| Accidental activation in front of clients | No wake word (parity with Athena). Tap-to-start only. Hotkey is two-modifier (Cmd+Shift+V) to avoid accidents. |
| Sensitive fields | `lib/voice/focus.ts` is the single redaction layer — strips account numbers, full SSNs, full DOBs (we let it speak "age 64", not "DOB 04/12/1962"), and full emails (we say "Sarah's email" not the address). |

---

## 11. Rollout phases

### Phase 0 — token-mint + persona file + URL state refactor (3 days)
- `POST /api/voice/token` mints constrained ephemeral tokens (advisor-auth gated).
- `lib/voice/prompts/advisor.txt` skeleton checked in.
- URL-state sync (§8) — `step`, `intakeStep`, `activeReviewId`, `clientSearch` → `searchParams`.
- No UI yet; tested via curl that the token is bounded.

### Phase 1 — session + mic button + `get_context` + `navigate` (4–5 days)
- AudioWorklet capture + PCM playback queue.
- `useVoiceAgent` hook + mic button + state indicator.
- Two tools live: `get_context` and `navigate`.
- Eval fixture: 5 simple conversations ("where am I?", "go to upload," "take me to intake step 3").
- **Gate:** advisor can navigate the app entirely by voice across all 10 steps.

### Phase 2 — Q&A tools (3 days)
- `open_client`, `list_clients`, `get_client_details`, `read_analysis_section`, `explain_ui`.
- Fuzzy name matching for `open_client` (Levenshtein over `savedReviews[].client.firstName + lastName`).
- Disambiguation flow ("There are two Garcias — Robert or Maria?").
- Eval expanded to 15 conversations including read-only Q&A.
- **Gate:** advisor can ask "What's <client>'s <metric>?" and get correct answer in <1.5s.

### Phase 3 — Nudge queue (1–2 days, no tools use it yet)
- Land `lib/voice/nudge-queue.ts` with full Athena-style semantics.
- Unit tests for speech-boundary gating, race-safe cancellation, 800ms delay, watchdog, expiry.
- No tool wired; this is plumbing only.

### Phase 4 — Voice Agent settings tab + polish + compliance review (3–4 days)
- **Settings drawer "Voice Agent" tab** (§1.4) — model picker, voice picker with preview-play, hotkey editor, captions/auto-pause toggles, privacy toggles.
- `lib/voice/model-catalog.ts` exports the selectable models and voices; "Custom…" free-text accepted for both.
- Supabase migration: **new** table `advisorpilot_voice_settings` (see §1.4). The existing `advisor_profile` table is not modified.
- `/api/voice/token` reads the advisor's saved profile and applies their `voice_model` / `voice_name` to `liveConnectConstraints` (env vars are the firm fallback).
- "Preview voice" button mints a single-turn token, plays a canned sample line.
- Tab-visibility auto-pause; session resumption + reconnect on `GoAway`.
- Cost dashboard (per-advisor monthly voice minutes).
- Walk-through scripts in `advisor.txt` filled out for every step.
- Internal demo + firm compliance sign-off.

### Phase 5+ (future, not in this plan)
- First background tool (likely `run_analysis_in_background`) → exercises NudgeQueue.
- Visual context (send a screenshot mid-turn so the agent literally sees the screen).
- Vertex AI Live API migration for firms requiring VPC-SC / CMEK.
- Provider switch — when Grok or OpenAI realtime voice catches up, abstract behind the multi-provider layer.

---

## 12. File / module layout

```
app/api/voice/
└── token/route.ts             // mints ephemeral tokens; advisor-auth gated

app/app/
├── voice-state-provider.tsx   // ref-based context exposing snapshotable React state
└── components/
    ├── mic-button.tsx         // header pill + canvas volume meter (RAF)
    └── voice-overlay.tsx      // captions + interrupt hint

lib/voice/
├── session.ts                 // VoiceSession class wrapping @google/genai live.connect
├── audio-capture.ts           // AudioWorklet bootstrap + PCM resample to 16 kHz
├── audio-playback.ts          // 24 kHz PCM queue, barge-in stop
├── tools.ts                   // tool registry + JSON schemas
├── tool-handlers.ts           // implementations of get_context/navigate/open_client/...
├── focus.ts                   // focusDescription() + focusPayload() — only place state leaks to agent
├── nudge-queue.ts             // Athena-style queue (designed, unused in v1)
├── prompts/
│   └── advisor.txt            // system instruction
└── eval/
    ├── conversations.test.ts  // offline regression: text + tool-shape, no audio
    └── fixtures.ts
```

---

## 13. Risks & mitigations

| Risk | Mitigation |
|---|---|
| 10-min Live connection cap mid-call | Session resumption + `GoAway` handler → reconnect with same handle, advisor doesn't notice. |
| Preview-model API drift (3.1 Live is preview) | Pin model in env; nightly eval catches breaks; alternate model id (2.5 native-audio) ready as fallback. |
| Cost runaway on long sessions | Default `LLM_VOICE_MAX_SESSION_MINUTES=15` auto-closes the WS; advisor can reopen. Per-advisor budget alarm. |
| Ephemeral token leaked from page DOM | Token has uses=1 and start-window 60s; even if leaked it's useless after first WS open. |
| Background tab capturing audio | `visibilitychange` listener pauses capture; resume on visible. |
| Hallucinated "I just navigated for you" (no action taken) | Tool-shape eval asserts every navigation utterance is preceded by a real `navigate` tool call. |
| Wrong client opened on ambiguous name | `open_client` disambiguates aloud before action; never silently picks. |
| Compliance pushback on Google audio retention | Document paid-tier "no training, transient logging only"; have Vertex migration path costed and ready. |
| Mic button feels intrusive in shared offices | Tap-to-start, no wake word, hotkey requires Shift modifier. |
| Voice overlay blocks UI | Floating, dismissible; auto-hides 3s after speech ends. |
| Speakers not muted on advisor's end → echo | `getUserMedia({audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })`. |
| Different mic permission UX on iOS Safari | Test before launch; degrade gracefully with a "voice not supported here" hint on iOS < 17.4. |
| Long client lists (>200) blow context window in `list_clients` | Server-side filter + cap result count; sort by recency. Agent calls iteratively if needed. |

---

## 14. Concrete first-PR scope (Phase 0 + Phase 1 bundled)

**PR title:** "Voice agent v1: navigation by voice"

- `POST /api/voice/token` — advisor-auth gated, mints constrained ephemeral token.
- URL-state sync for `step`, `intakeStep`, `activeReviewId`, `clientSearch`.
- `lib/voice/session.ts` + `audio-capture.ts` + `audio-playback.ts`.
- `tools.ts` + `tool-handlers.ts` with `get_context` and `navigate` (only).
- `focus.ts` with the static `focusDescription()` switch covering all 10 steps.
- `advisor.txt` system prompt covering identity, capability map, navigation model, privacy rules.
- Mic button + voice overlay components.
- `eval/conversations.test.ts` with 5 cases ("where am I?", 4 navigation cases).
- Env vars + paid-tier `GEMINI_API_KEY` doc.

Ships before any of the Q&A tools (Phase 2), so the simplest "voice navigation" feature is in advisors' hands quickly and we get real-world usage data.

---

## 15. Open questions

**Decided (no longer open):**

- ~~**Per-advisor voice preference (model + voice name).**~~ **Decided 2026-05-15:** model AND voice are both first-class settings in the Voice Agent tab (§1.4). Env vars are firm defaults; advisor choice wins. "Preview voice" button so they can audition before saving.
- ~~**Custom hotkey.**~~ **Decided:** hotkey is editable in Settings; default `Cmd/Ctrl+Shift+V`.

**Still open:**

1. **Disclosure of AI to clients.** Some firms require explicit client disclosure when AI is in the room. Add a profile-level "I have disclosed AI assistant use" toggle + firm-specific copy template? Recommend yes, included in Phase 4 settings tab.
2. **Vertex AI Live vs Developer API.** Developer API + paid tier handles "no training" but Vertex adds VPC-SC, CMEK, data residency for enterprise firms. Recommend: Developer API v1; document the Vertex path; switch only when a firm explicitly requires it.
3. **Mute-on-meeting heuristic.** If the advisor's screen indicates an active client meeting (Live Intake overlay open), auto-pause voice? Or trust the advisor? Recommend: don't auto-pause; trust the advisor; show a small "Live Intake is active — voice agent off" hint if both are open.
4. **Compliance trail.** Should every tool call be logged to an audit table (advisor, timestamp, tool, args, result hash)? Recommend yes, but only the tool shape — not full transcripts. (Already exposed as a toggle in §1.4.)

---

## Appendix: minimal token-mint route

```ts
// app/api/voice/token/route.ts
import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { resolveAdvisorIdentity } from "@/lib/advisor-auth";
import { readFile } from "fs/promises";
import { join } from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VOICE_TOOLS = [
  {
    functionDeclarations: [
      {
        name: "get_context",
        description: "Snapshot what the advisor sees right now.",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "navigate",
        description: "Switch the active step.",
        parameters: {
          type: "object",
          properties: {
            step: {
              type: "string",
              enum: ["intake","upload","confirm","analysis","meeting","fia","roth","retIncome","report","saved"],
            },
          },
          required: ["step"],
        },
      },
      // ... other v1 tools
    ],
  },
];

export async function POST(req: Request) {
  const identity = await resolveAdvisorIdentity(req);
  if (!identity) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const systemPrompt = await readFile(
    join(process.cwd(), process.env.LLM_VOICE_SYSTEM_PROMPT_PATH ?? "lib/voice/prompts/advisor.txt"),
    "utf-8"
  );

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const now = Date.now();

  const token = await ai.authTokens.create({
    config: {
      uses: 1,
      newSessionExpireTime: new Date(now + 60_000).toISOString(),
      expireTime: new Date(now + 30 * 60_000).toISOString(),
      liveConnectConstraints: {
        model: process.env.LLM_VOICE_MODEL ?? "gemini-3.1-flash-live-preview",
        config: {
          responseModalities: ["AUDIO"],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.LLM_VOICE_NAME ?? "Aoede" } },
          },
          tools: VOICE_TOOLS,
          sessionResumption: {},
          contextWindowCompression: { slidingWindow: {} },
        },
      },
    },
  });

  return NextResponse.json({ token: token.name });
}
```

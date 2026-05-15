# Multi-Provider LLM Integration Plan

**Status:** Planning — v2 (deep research) · **Date:** 2026-05-14 · **Owner:** TBD

## Goal

Allow the advisor to **pick the LLM provider once** in the UI — OpenAI, Google Gemini, or xAI Grok — and have **every** AI interaction in the app honor that choice. API keys live in `.env.local`. Capability parity with current OpenAI behavior is the floor; the **real win** is exposing each provider's modern **agentic research** surfaces (OpenAI Deep Research, Gemini `google_search` + `url_context` + Deep Research Interactions API, Grok Agent Tools API with `web_search` + `x_search` + `code_interpreter`) as first-class capabilities so the advisor's analyses get visibly stronger — not just provider-swappable.

---

## 0. Database change policy (rule for this entire plan)

**New tables only. We do not alter the shape of any existing Supabase table** (`advisorpilot_clients`, `advisorpilot_securities_master`, `advisorpilot_security_enrichment_cache`, `advisorpilot_documents`, `advisorpilot_upload_tokens`, etc.).

**Single carve-out:** the AI-model picker is allowed to add 3 small preference columns to `advisor_profile` (`llm_provider`, `llm_model_overrides`, `default_research_tier`) because that's the row that already holds advisor preferences. **All three columns are nullable with no DEFAULT** so existing rows are untouched at migration time, any code path that doesn't know about them continues to work, and `alter table … drop column` is a safe rollback. `NULL` is the universal "use firm/env default" signal in the resolver (see §9.7). Every other database touch in this plan is a **new table**.

Complete inventory of database changes in this plan:

| Change | Type | Tables touched |
|---|---|---|
| AI-model picker | **ALTER (carve-out)** | `advisor_profile` — add 3 cols, all **nullable, no DEFAULT** (backward-compatible; safe to roll back) |
| Enrichment cache provenance (per-provider citations) | **NEW table** | `advisorpilot_enrichment_provenance` — sidecar joined by `cache_id` |
| Deep-research async jobs | **NEW table** | `advisorpilot_deep_research_jobs` |

No other migrations are required by this plan. Voice agent settings are handled by the [voice-agent plan](./voice-agent-plan.md) in its own new table — neither plan touches the other's surface.

---

## 1. Current state (verified end-to-end audit)

All OpenAI usage flows through `lib/openai-route-models.ts` with env overrides. Each route does `new OpenAI({ apiKey })` (no shared client). Detailed audit findings below — they materially shape the plan.

| Call site | File:line | SDK method | Today's model | Tool config |
|---|---|---|---|---|
| Statement extraction | `lib/extract-statement-holdings.ts:264-287` | `responses.create` | `gpt-4o` | vision input_file/input_image, json_object, 16,384 max tokens |
| Macro research | `app/api/generate-analysis/route.ts:81-87` | `responses.create` | `gpt-4o` | `tools: [{type:"web_search_preview"}]`, **no domain filters**, **no recency**, output parsed as plain text |
| Macro JSON | `app/api/generate-analysis/route.ts:282-290` | `responses.create` | `gpt-4o` | json_object, **no citations on schema** |
| Enrichment research | `lib/holding-enrichment.ts:210-216` | `responses.create` | `gpt-4o` | `web_search_preview`, prompt says **"Cite no URLs in this step — facts only"** |
| Enrichment JSON | `lib/holding-enrichment.ts:257-261` | `responses.create` | `gpt-4o` | json_object, schema includes `sourceUrls[]` — **but the model is asked to populate it from memory, since research pass returned no URLs** |
| Intake turn | `app/api/intake-voice/route.ts:105-113` | **`chat.completions.create`** | `gpt-4o-mini` | `response_format: {type:"json_object"}` |
| TTS | `app/api/intake-tts/route.ts:27-44` | `audio.speech.create` | `gpt-4o-mini-tts` | voice `sage`, mp3, 4096-char cap |
| STT | `app/api/intake-stt/route.ts:39-43` | `audio.transcriptions.create` | `whisper-1` | en, no streaming |

### Audit-driven findings that change the plan

1. **Citations are silently lost today.** None of the routes parse `annotations` / `url_citation` from web-search responses. The macro PDF has no "Sources" section (`app/api/generate-report/route.ts` has zero references to citations). The UI shows no source links either. So **migrating to a citation-bearing abstraction is upside, not regression.**

2. **Enrichment `sourceUrls` are effectively hallucinated.** `lib/holding-enrichment.ts:204` explicitly tells the research pass *not* to cite URLs; `:249-251` then asks the JSON pass to include `sourceUrls` "≥1 HTTPS URL when claiming public ticker mapping." Since pass 1 returned no real URLs, pass 2's URLs are from the model's pretraining memory — i.e., guesses. The cache (`lib/security-enrichment-cache.ts:151-168`) persists them. **This bug is worth fixing as part of this work** by routing real grounded citations through.

3. **Per-holding enrichment is serial with a hard-coded 350ms pause** (`app/api/enrich-holdings/route.ts:108`). 25-holding portfolio ≈ 8.75s of pure sleep on top of model latency. Agentic loops make individual calls slower; we need a real concurrency strategy.

4. **Intake voice uses `chat.completions.create`**, not Responses. Migration must preserve `response_format: { type: "json_object" }` behavior — Gemini and Grok handle JSON differently.

5. **Eval fixtures only cover JSON synthesis** (`lib/openai-model-eval-fixtures.ts`). The research pass is never evaluated end-to-end, even on OpenAI. New eval fixtures needed.

6. **No background-job infrastructure.** Every route is synchronous request/response — long-running deep research (5–60 min on OpenAI/Gemini) needs new plumbing (queue + webhook or status polling).

7. **Extraction route's `extractedHolding.statementAccountEndingValue`** is consumed in `app/api/analyze-statement/route.ts:166` and used for reconciliation; preserve exactly.

8. **Cache key shape** (`lib/security-enrichment-cache.ts`) is `figi:` / `cusip:` / `sym:` prefixed. Cross-provider correctness requires a `provider` column so Gemini-cited enrichments don't get served when the advisor switched to OpenAI.

---

## 2. Provider research summary (verified May 2026)

### OpenAI — incumbent, now stronger than the codebase reflects
- **Models:** `gpt-5.5` (current canonical), `o3-deep-research-2025-06-26` (deep research), `o4-mini-deep-research-2025-06-26` (cheap deep research). Knowledge cutoff Jan 2026.
- **`web_search` tool** (not `web_search_preview` — that's legacy and doesn't accept `filters` or new params).
- **Agentic loop control:** `max_tool_calls` caps server-side tool invocations per request.
- **Domain filters:** `tools[].filters.allowed_domains` / `disallowed_domains` (no documented cap; functionally larger than Grok's 5).
- **Citations:** annotations array with `type: "url_citation"`, `url`, `title`, `start_index`, `end_index`. Plus full source list with `include: ["web_search_call.action.sources"]`.
- **Deep Research:** Responses API only, requires `background: true` (tens of minutes). Webhook or polling. Pricing `o3-deep-research`: $2 / $0.50 cached / $8 per 1M tokens. Uses `web_search`/`file_search`/`code_interpreter`/MCP autonomously.
- **`file_search`:** vector store you pre-populate via Files API. Great fit for SEC filings / prospectuses (out of scope for v1, but the abstraction must not preclude it).
- **`reasoning_effort`:** `none | low | medium | high | xhigh` (gpt-5.5).
- **Structured JSON:** `text.format: { type: "json_schema", name, schema, strict: true }`. Strict-mode parity with our needs.

### Gemini — `@google/genai` v2.x, Gemini 3 generation
- **Models:** `gemini-3-flash-preview` and `gemini-3.1-flash-lite` (stable) for production; `gemini-3.1-pro-preview` for heavy passes; `deep-research-preview-04-2026` / `deep-research-max-preview-04-2026` for async Deep Research via the new **Interactions API**. Older 2.5 family deprecates June 2026.
- **`google_search` grounding** — current name (`google_search_retrieval` is legacy). Returns `groundingMetadata.{webSearchQueries[], groundingChunks[].web.{uri,title}, groundingSupports[].segment(startIndex,endIndex,text)→groundingChunkIndices, searchEntryPoint.renderedContent}`. Per-claim attribution via `groundingSupports`.
- **`url_context` tool** — model fetches specific URLs (up to 20/request). Token-billed on fetched content. Combinable with `google_search` in one call. Returns `url_context_metadata.url_metadata[].{retrieved_url, url_retrieval_status}`.
- **Deep Research Interactions API** (launched Dec 11, 2025): `client.interactions.create({ agent: "...", input, background: true, store: true, stream: true, agent_config: { type: "deep-research", ... } })`. Latency typically ~20 min (max 60). Returns long-form report. Auto-uses google_search + url_context + code_execution.
- **Agentic in `generateContent`:** model may issue **multiple** `google_search` queries in one call (it decides) but **no `maxAgenticSteps`** knob — for bounded loops use Interactions API or roll your own client-loop. Single-pass multi-search is enough for our enrichment use case.
- **JSON + tools combo:** **Gemini 3 only** can combine Structured Outputs + tools (`google_search`, `url_context`, etc.) in one request. Gemini 2.x cannot — we target Gemini 3 exclusively.
- **`thinkingLevel`:** `minimal | low | medium | high`. Gemini 3.1 Pro forces high (cannot disable).
- **Pricing:** Flash-Lite $0.25/$1.50; Pro $2/$12 (≤200k). Grounding: 5k free/month then **$14/1k search queries** (per query the model issues, not per prompt). URL context: token-billed at model input rate.
- **⚠️ ToS:** Google requires rendering `searchEntryPoint.renderedContent` ("Search Suggestions" widget) when grounding is used. We must plumb this HTML to the UI / PDF when Gemini is selected.
- **System instructions:** top-level `systemInstruction`, roles `user`/`model`.

### Grok — xAI, OpenAI-SDK-compatible at `baseURL: https://api.x.ai/v1`
- **Model:** `grok-4.3` (primary; aliases `grok-4.3-latest`, `grok-latest`). 1M context. $1.25 / $0.20 cached / $2.50 per 1M tokens.
- **Agent Tools API** (the user's "built-in agentic tool"): server-side tools `web_search`, `x_search`, `code_interpreter`, `collections_search`. Pass once in `tools`; model autonomously decides how many calls and in what order, all inside one `responses.create`.
- **Responses API only.** Live Search on chat.completions deprecates **Dec 15, 2025**. New code uses `responses.create` exclusively for web-search-enabled paths.
- **`max_turns`** caps server-side iterations per request (client-side function tools reset the counter).
- **`web_search` knobs:** `allowed_domains` / `excluded_domains` (max 5 each, mutually exclusive), `enable_image_understanding`. **No recency or max_results knob anymore** (those were Live Search params; sunset).
- **`x_search`** — opt-in tool for X posts. Useful for market-sentiment passes; add `{type:"x_search"}` alongside `web_search`.
- **Citations:** flat `citations` list + inline annotations `[[1]](url)` with character offsets — on by default. Toggle with `include: ["no_inline_citations"]`. Types: `web_citation`, `x_citation`, `collections://...`.
- **JSON:** `response_format: { type: "json_schema", json_schema }` — strict-mode-style enforcement.
- **Vision:** JPG/PNG only, ≤20 MiB each. **No PDF input** — extraction must rasterize PDF pages to PNG (`pdfjs-dist` or `pdf-to-img`).
- **TTS/STT** exist as xAI-specific REST routes (`/v1/tts`, `/v1/stt`), not OpenAI-SDK-shape. **v1 keeps OpenAI for audio.**
- **No async deep-research endpoint** — agentic synthesis is synchronous inside `responses.create`, typically multi-second to tens-of-seconds.
- **`reasoning_effort`:** `low | medium | high`. Does **not** contractually increase hop count.
- **⚠️ Retirement May 15, 2026:** related SKUs (grok-4-1-fast-*, grok-4-fast-*, grok-3, grok-code-fast-1) retire and silently redirect to `grok-4.3` at `grok-4.3` pricing. Pin model IDs explicitly.

---

## 3. Capability matrix

| Capability | OpenAI | Gemini | Grok |
|---|---|---|---|
| Plain/JSON completion | ✅ | ✅ | ✅ |
| Structured JSON (strict) | ✅ | ✅ (Gemini 3 only) | ✅ |
| **Single-call grounded search** | ✅ `web_search` | ✅ `google_search` (multi-query auto) | ✅ `web_search` |
| **URL context (read specific pages)** | indirect (prompt) | ✅ `url_context` (20 URL cap) | indirect (prompt) |
| **Agentic loop (multi-tool, server-side, sync)** | ✅ Responses + `max_tool_calls` | ⚠️ single-call multi-query only; bounded loop via Interactions/Deep Research | ✅ Agent Tools + `max_turns` |
| **Async deep research** | ✅ `o3-deep-research` (background) | ✅ `deep-research-preview-04-2026` (Interactions API, background) | ❌ (sync only; max_turns high) |
| Per-claim citations | ✅ (url_citation, char offsets) | ✅ (groundingSupports → segment→chunk) | ✅ (inline + flat) |
| Domain filtering | ✅ no published cap | ❌ (no allowed_domains on `google_search`; use `url_context` for whitelist via prompt) | ✅ 5 allow / 5 deny |
| X/social signal | ❌ | ❌ | ✅ `x_search` |
| Native PDF input | ✅ | ✅ (free text tokens) | ❌ rasterize |
| Image input | ✅ | ✅ | ✅ (JPG/PNG only) |
| TTS / STT | ✅ mature | ⚠️ TTS preview; audio understanding for STT | ✅ separate REST shape |
| OpenAI SDK reusable | ✅ native | ❌ separate `@google/genai` | ✅ via baseURL swap |

---

## 4. Research as a first-class capability (the abstraction's biggest idea)

The current code treats "research" as: do one `web_search_preview` call and squint at `output_text`. The providers have moved well past that. The abstraction should expose **three research tiers** the rest of the app picks from by intent, not by provider:

### Tier A — `fast-grounded` (sub-30s, in-request)
- **Use:** per-holding enrichment, intake-time price lookups, anywhere the workflow can't tolerate a UI spinner > 30s.
- **OpenAI:** `gpt-5.5` + `web_search` with `filters.allowed_domains`, `reasoning.effort: "low"`, `max_tool_calls: 3-5`.
- **Gemini:** `gemini-3-flash-preview` + `googleSearch` + (optionally) `urlContext` if a known URL is supplied, `thinkingLevel: "low"`.
- **Grok:** `grok-4.3` + `{type:"web_search", allowed_domains}` + (optional) `x_search`, `max_turns: 3-5`, `reasoning.effort: "low"`.

### Tier B — `agentic-research` (30s–3min, in-request, sync)
- **Use:** macro market context for the portfolio review (current `generate-analysis` research pass).
- **OpenAI:** `gpt-5.5` + `web_search` + `code_interpreter`, `max_tool_calls: 12`, `reasoning.effort: "medium"`.
- **Gemini:** `gemini-3.1-pro-preview` + `googleSearch` + `urlContext`, `thinkingLevel: "high"` (single multi-query call, the model issues 5–15 queries).
- **Grok:** `grok-4.3` + `web_search` + `x_search` + `code_interpreter`, `max_turns: 12`, `reasoning.effort: "high"`.

### Tier C — `deep-research` (5–60min, async/background)
- **Use:** quarterly portfolio strategy memos, "give me a full prospectus comparison" — power-user, opt-in.
- **OpenAI:** `o3-deep-research-2025-06-26`, `background: true`, webhook or status polling.
- **Gemini:** **Interactions API** with `deep-research-preview-04-2026` (or `-max-`), `background: true, store: true`.
- **Grok:** **no async endpoint** — fall back to Tier B with `max_turns: 25` and `reasoning.effort: "high"`. Surfaced to the UI as "Grok deep research runs synchronously and may take a few minutes."

### Single research API

```ts
// lib/llm/research.ts
export type ResearchTier = "fast-grounded" | "agentic-research" | "deep-research";

export interface ResearchRequest {
  tier: ResearchTier;
  system?: string;
  user: string;
  contextDocs?: Attachment[];           // PDFs/images included as input parts
  knownUrls?: string[];                 // hint for url_context / prompt inclusion
  allowedDomains?: string[];            // best-effort across providers
  blockedDomains?: string[];
  includeSocialSignals?: boolean;       // Grok x_search; ignored elsewhere
  jsonSchema?: object;                  // if set, returns parsed JSON
  maxAgenticSteps?: number;             // mapped to provider-specific cap
}

export interface ResearchResult<T = unknown> {
  text?: string;
  json?: T;
  citations: Citation[];                // normalized across providers
  searchSuggestionsHtml?: string;       // Gemini ToS widget; render in PDF/UI when present
  provider: LlmProvider;
  tier: ResearchTier;
  raw: unknown;
  usage?: TokenUsage;
  asyncHandle?: { id: string; pollUrl?: string }; // only when tier === "deep-research"
}

export interface Citation {
  uri: string;
  title?: string;
  snippet?: string;                     // Grok has this; Gemini does not
  startIndex?: number;                  // inline-citation offsets (OpenAI, Grok)
  endIndex?: number;
  chunkIndex?: number;                  // Gemini groundingSupports → groundingChunks index
  sourceType?: "web" | "x" | "file" | "code";
}
```

Each provider adapter implements `research()` and normalizes its native shape to `ResearchResult`. **Deep research returns immediately with an `asyncHandle`**; the route persists the handle to Supabase and polls / awaits webhook. Tier-C UI is opt-in.

---

## 5. Citations become first-class (and fix the enrichment hallucination)

The audit found `enrichmentSourceUrls` in the cache today is model-memory guesswork. New abstraction:

1. **Enrichment research (Tier A)** calls `research()` and **the abstraction returns real citations**.
2. **Enrichment JSON pass** is given those citations as **structured context** in the prompt (not free text) and instructed to **echo only URLs from the provided citations list** into `sourceUrls`. Schema-validated post-call.
3. **Cache row gains `provider` column** and stores `{ ..., citations: Citation[] }` instead of just URLs — preserves title/snippet/index for UI display.
4. **Macro analysis JSON schema gains `citations: Citation[]`** that the report PDF will render in a new Sources section (today: zero sources rendered).
5. **UI** gets a small "n sources" pill on each enriched holding row and on the macro review; click expands a list with provider attribution and `searchEntryPoint` widget when present.

This is the single highest-leverage user-facing improvement in the project. **Doing the multi-provider rollout without it would lock in a known bug.**

---

## 6. Abstraction design (v2)

### 6.1 Module layout

```
lib/llm/
├── index.ts                  // public surface: complete(), research(), tts(), stt()
├── types.ts                  // LlmProvider, ResearchTier, CompletionRequest, ResearchResult, Citation
├── registry.ts               // resolve provider per request (header → profile → env)
├── capabilities.ts           // matrix as code; gates fallbacks
├── normalize/
│   ├── citations-openai.ts   // annotations + sources → Citation[]
│   ├── citations-gemini.ts   // groundingMetadata → Citation[] + searchSuggestionsHtml
│   └── citations-grok.ts     // inline annotations + flat citations → Citation[]
├── providers/
│   ├── openai.ts             // wraps current usage; uses Responses API everywhere
│   ├── gemini.ts             // @google/genai
│   └── grok.ts               // OpenAI SDK + baseURL swap
├── pdf-rasterize.ts          // PDF → PNG[] (Grok only)
├── deep-research-jobs.ts     // background poll/webhook orchestration (Supabase-backed)
└── eval/
    ├── fixtures.ts           // moved from lib/openai-model-eval-fixtures.ts; provider-axis
    └── runner.ts
```

### 6.2 Public API

```ts
export async function complete<T>(req: CompletionRequest): Promise<CompletionResponse<T>>;
export async function research<T>(req: ResearchRequest): Promise<ResearchResult<T>>;
export async function tts(req: TtsRequest): Promise<Buffer>;
export async function stt(req: SttRequest): Promise<string>;

// Deep-research lifecycle (Tier C)
export async function pollResearchJob(handle: { id: string }): Promise<ResearchResult | null>;
export async function cancelResearchJob(handle: { id: string }): Promise<void>;
```

Routes call these; they never see the provider.

### 6.3 Provider resolution

Per request: header `x-llm-provider` → persisted `advisor_profile.llm_provider` → env `ADVISORPILOT_DEFAULT_LLM_PROVIDER` → `openai`. Capability matrix in `capabilities.ts` triggers per-pass fallback (e.g., TTS always falls back to OpenAI in v1; deep research on Grok falls back to Tier B agentic-research with logged warning).

### 6.4 Model mapping (per provider, per pass)

| Pass | OpenAI | Gemini | Grok |
|---|---|---|---|
| `extraction` (vision → JSON) | `gpt-5.5` | `gemini-3-flash-preview` | `grok-4.3` (rasterized PDFs) |
| `intake.turn` (chat JSON) | `gpt-5.5` (effort: low) | `gemini-3.1-flash-lite` (low) | `grok-4.3` (effort: low) |
| `research.fast-grounded` | `gpt-5.5` + `web_search` | `gemini-3-flash-preview` + grounding | `grok-4.3` + `web_search` |
| `research.agentic` | `gpt-5.5` + tools, max_tool_calls 12 | `gemini-3.1-pro-preview` + grounding + url_context | `grok-4.3` + Agent Tools, max_turns 12 |
| `research.deep` | `o3-deep-research-2025-06-26` | `deep-research-preview-04-2026` (Interactions) | (fallback → agentic, max_turns 25, with banner) |
| `synthesis.json` (after research) | `gpt-5.5` + json_schema strict | `gemini-3.1-flash-lite` + responseSchema | `grok-4.3` + json_schema |
| `tts` | `gpt-4o-mini-tts` | fallback → OpenAI | fallback → OpenAI |
| `stt` | `whisper-1` | fallback → OpenAI | fallback → OpenAI |

Every cell overridable via `LLM_<PROVIDER>_<PASS>_MODEL` env. Legacy `OPENAI_*_MODEL` shims map to the new keys for one release.

---

## 7. Document & Image Intake Layer (cross-cutting)

The biggest cross-provider gotcha is **how documents and images enter the model**. OpenAI takes native PDFs; Gemini takes native PDFs but bills 258 tok/page for rasterized image content while giving the embedded text layer for free; Grok rejects PDFs entirely and only takes JPG/PNG. A single intake-normalization layer at `lib/llm/attachments.ts` handles this so routes never branch on provider.

### 7.1 Entry points the layer must serve (verified)

| # | Entry point | File | Auth | Size cap | MIME accepted | Notes |
|---|---|---|---|---|---|---|
| 1 | Advisor upload (file picker + camera) | `app/app/page.tsx:4091-4092` | Advisor session | **None in code** — relies on reverse-proxy | `.pdf, image/*` | `<input capture="environment">` for mobile camera |
| 2 | `POST /api/analyze-statement` | `app/api/analyze-statement/route.ts:81-174` | Advisor session | **None** | accepts `file.type` or fallback `application/pdf` | multi-file iteration, no per-file size guard |
| 3 | `POST /api/client-upload/ingest` | `app/api/client-upload/ingest/route.ts:108-355` | Magic-link token | **25 MB / file** (`MAX_FILE_BYTES`), **25 files / token** | same | public path; only place with hard caps today |
| 4 | `POST /api/inbound-email` | `app/api/inbound-email/route.ts:39-127` | Webhook secret | n/a (metadata only) | n/a | external email service pre-extracts PDFs; this route just records metadata |
| 5 | Statement upload queue | `lib/statement-upload-queue.ts` | client-side queue helper | n/a | n/a | UI queue object, not a network path |
| 6 | Quality pre-flight | `lib/statement-input-quality.ts` | n/a | min **520 px short edge** for images (`MIN_IMAGE_SHORT_EDGE_PX`); empty/corrupt PDF rejected | PNG + JPEG (magic-byte parsed) | called from `extractHoldingsFromFileBuffer()` |

**Findings worth flagging:**

- The advisor upload route (`/api/analyze-statement`) has **no server-side file-size or count cap**. Reverse-proxy or Vercel's request-body limit (~4.5 MB on hobby, more on pro) is the de-facto cap. **Should add an explicit cap** in this PR to match the 25 MB ingest path.
- MIME detection is "soft": `file.type || "application/pdf"` (`route.ts:123`). If the browser doesn't send a `Content-Type` for a `.heic` photo, the file silently gets treated as PDF and the extractor blows up at the model. Better: sniff magic bytes (we already do for image dimension checks) and refuse mismatched MIMEs.
- **Magic-link path persists no bytes** — `storedBytes: false` (`route.ts:317`). Audit/retry requires uploading-to-bucket if we ever want to support re-extraction with a different provider. Out of scope v1 but flag in risks.
- **HEIC photos from iPhones** are accepted today by `<input accept="image/*">` but Grok does NOT support HEIC (only JPG/PNG). Layer must transcode HEIC → JPEG before sending to Grok.

### 7.2 The `Attachment` shape (the single internal type)

```ts
// lib/llm/types.ts
export type AttachmentKind = "pdf" | "image";

export interface Attachment {
  kind: AttachmentKind;
  bytes: Buffer;
  mime: string;                       // canonical: application/pdf | image/jpeg | image/png | image/webp | image/heic
  fileName: string;
  pageHint?: string;                  // "1-3,5-6" — advisor's holdings-page hint
  // Computed / annotated by the layer:
  pageCount?: number;                 // PDFs only, from pdf-lib
  hasTextLayer?: boolean;             // PDFs only — drives scan-vs-digital routing
  textLayer?: PdfTextLayerContext;    // pre-extracted, clipped to 104k chars
  imageDimensions?: { width: number; height: number };
}

export interface PdfTextLayerContext {
  fullText: string;
  clippedText: string;                // head + tail, max PDF_TEXT_PROMPT_DEFAULT_MAX_CHARS
  multiAccountHint?: string;          // from buildMultiAccountPdfHint()
}
```

All current preprocessing (`tryExtractPdfText`, `slicePdfBytesToPages`, `assertStatementFileReadable`, `buildMultiAccountPdfHint`) runs **once, in the layer**, regardless of provider. The provider adapter receives a normalized `Attachment[]` with annotations and decides only the wire format.

### 7.3 Per-provider mapping

#### OpenAI Responses API
- **PDF inline (≤ 8 MB):** `{ type: "input_file", filename, file_data: "data:application/pdf;base64,..." }` — same as today.
- **PDF managed (> 8 MB or > 25 MB total inline budget):** Files API `POST /v1/files` with `purpose: "user_data"` → `{ type: "input_file", file_id }`. Files persist until manually deleted; layer deletes after successful extraction.
- **Image inline (≤ 8 MB):** `{ type: "input_image", image_url: "data:image/...;base64,...", detail }`.
- **Image managed:** Files API `purpose: "vision"` → `{ type: "input_image", file_id }`.
- **`detail`:** `"auto"` default (matches today, avoids the `"high"` 400-error from `extract-statement-holdings.ts:185`). Provider config opt to bump to `"high"` for low-resolution scans.
- **Max per request:** 50 MB total inline / 50 MB managed; 1,500 images. Generous — no need to chunk.
- **Cost note:** OpenAI bills BOTH extracted text AND page-image tokens. Multi-account PDFs cost roughly 1–2k tokens/page.

#### Gemini (`@google/genai`)
- **PDF inline (≤ 15 MB total request):** `{ inlineData: { mimeType: "application/pdf", data: base64 } }`.
- **PDF managed (> 15 MB):** `ai.files.upload({ file, config: { mimeType: "application/pdf" } })` → `{ fileData: { mimeType: "application/pdf", fileUri } }`. **48 h TTL** — fine for sync extraction; for deep-research jobs longer than 48h, the layer must re-upload.
- **Image inline:** `{ inlineData: { mimeType, data: base64 } }`. MIMEs: `image/png|jpeg|webp|heic|heif` (HEIC native — Gemini handles iPhone photos without transcoding!).
- **`mediaResolution`:** layer sets per-attachment:
  - Digital PDFs (text layer present): `LOW` or `MEDIUM` — text is free anyway, image fidelity matters less.
  - **Scanned PDFs / phone photos: `HIGH` (default) or `ULTRA_HIGH`** for dense tabular small print. Ours is dense — go `HIGH` as default, expose `LLM_GEMINI_VISION_RESOLUTION` env override.
- **258 tok/page on images; native PDF text is free.** Digital brokerage statements on Gemini Flash-Lite are dramatically cheaper than OpenAI.
- **Page cap:** 1,000 pages — comfortably above any realistic statement.
- **Vertex path:** Same wire format with `fileData.fileUri = "gs://..."` and up to 2 GB. Out of scope v1; document for future.

#### Grok (xAI)
- **No PDF.** Layer always rasterizes via `lib/llm/pdf-rasterize.ts` (pdfjs-dist; serverless-safe; ~2 MB dep).
  - Render each page at **2x scale → JPEG quality 80**, long edge clamped to **2048 px** (downscale phone photos similarly).
  - **Page-hint applied BEFORE rasterization** so we never render pages we're going to discard.
  - **Cap: first 20 pages per request** (large multi-account statements: split into multiple `extract()` calls, then merge).
  - Output: `Buffer[]` (one JPEG per page), passed as a sequence of `{ type: "input_image", image_url: "data:image/jpeg;base64,..." }` parts.
- **HEIC handling:** layer transcodes HEIC → JPEG before sending to Grok (sharp or heic-convert). Other providers get HEIC unchanged (Gemini) or via OpenAI's image_url (OpenAI claims WebP but does NOT list HEIC — transcode to JPEG to be safe).
- **No image-count cap documented**, but request size is. Multi-page statements at 200 KB/page JPEG → 20 pages × 200 KB ≈ 4 MB → comfortable.
- **`detail` equivalent:** none. Quality knob = rasterization DPI; layer's defaults (2x scale, q80, 2048 long edge) are tuned for brokerage tables.
- **Embedded PDF text** still goes in the prompt for Grok — used as ground-truth anchor for fuzzy image OCR.

### 7.4 Decision tree (the layer's choice algorithm)

```
function selectIntakeStrategy(attachment, provider) {
  if (attachment.kind === "pdf") {
    if (provider === "grok") return { mode: "rasterize", dpi: 2.0, format: "jpeg", quality: 80 };
    const totalBytes = attachment.bytes.length + estimatedPromptBytes;
    const threshold = provider === "openai" ? 8 * 1024 * 1024 : 15 * 1024 * 1024;
    return totalBytes > threshold ? { mode: "files-api" } : { mode: "inline" };
  }
  // image
  if (provider === "grok" && /heic|webp|gif/.test(attachment.mime)) {
    return { mode: "transcode-to-jpeg" };
  }
  return attachment.bytes.length > 8 * 1024 * 1024
    ? { mode: provider === "gemini" ? "files-api" : "files-api-vision" }
    : { mode: "inline" };
}
```

Thresholds are env-overridable (`LLM_INLINE_BYTES_THRESHOLD_OPENAI`, `..._GEMINI`).

### 7.5 Scan vs digital detection (cost optimization for Gemini)

Currently `tryExtractPdfText` returns `null` if the text layer is unusable (< 50 chars) — that already flags scans. The layer surfaces `hasTextLayer` on `Attachment` and the adapter uses it:

- **Gemini + digital PDF:** `mediaResolution: LOW` (text-free billing dominates).
- **Gemini + scanned PDF:** `mediaResolution: HIGH` (need image quality; we're paying for it anyway).
- **OpenAI:** ignored (no resolution knob; cost is similar either way).
- **Grok:** ignored (rasterization quality is constant; quality knob is DPI which we keep at 2x).

Result: digital-statement extraction on Gemini Flash is roughly **5–10× cheaper** than today's OpenAI cost without quality loss.

### 7.6 Multi-account & page-slicing interaction

- `holdingsPagesWithPositions` advisor hint → `slicePdfBytesToPages()` produces a smaller PDF **before** any provider work.
- For Grok, rasterization happens on the sliced PDF, so we never render irrelevant pages.
- `buildMultiAccountPdfHint()` runs on the **original** PDF text (pre-slice) to find all account IDs, then is added to the prompt regardless of slicing — preserves the "look for all N accounts" instruction even when we're only sending pages 4–9.

### 7.7 Hardening gaps to close in this work (small, worth bundling)

1. **Add `MAX_FILE_BYTES` to `/api/analyze-statement`** — match the 25 MB ingest cap or raise both to a single constant (`LLM_MAX_UPLOAD_BYTES`). Trivial; closes a real DoS surface.
2. **Sniff magic bytes on intake** — if the file starts with `%PDF-` treat as PDF regardless of MIME; if `\xFF\xD8` JPEG; if `\x89PNG` PNG; reject everything else with a clear "unsupported file format" error. Today an HTML file labeled `application/pdf` would reach the model.
3. **Transcode HEIC → JPEG** in the layer when (a) advisor uploads from iPhone Safari and (b) provider ≠ Gemini. Use `sharp` (already in many Next.js deployments) or `heic-decode`.
4. **Image dimension downscale** — phone photos at 4032×3024 are wasteful; cap long edge at 2048 px in the layer (sharp resize) before sending to any provider.
5. **Per-attachment usage logging** — record `provider`, `mode (inline/files-api/rasterize)`, `byteCount`, `pageCount`, `tokensInput`, `tokensOutput` in the audit log; powers cost dashboards.

### 7.8 New env vars added by this layer

```bash
LLM_MAX_UPLOAD_BYTES=26214400                           # 25 MB; enforced on advisor + magic-link
LLM_INLINE_BYTES_THRESHOLD_OPENAI=8388608               # 8 MB; above → Files API
LLM_INLINE_BYTES_THRESHOLD_GEMINI=15728640              # 15 MB; above → Files API
LLM_GROK_RASTERIZE_DPI=2.0                              # 2x ≈ 144 dpi
LLM_GROK_RASTERIZE_FORMAT=jpeg                          # jpeg | png
LLM_GROK_RASTERIZE_QUALITY=80                           # JPEG quality
LLM_GROK_MAX_PAGES_PER_REQUEST=20                       # split larger PDFs into multiple calls
LLM_GEMINI_VISION_RESOLUTION=HIGH                       # LOW | MEDIUM | HIGH | ULTRA_HIGH (Gemini 3)
LLM_IMAGE_MAX_LONG_EDGE_PX=2048                         # downscale phone photos
```

### 7.9 Module additions

```
lib/llm/
├── attachments.ts            // public: normalizeAttachment(), selectIntakeStrategy()
├── pdf-rasterize.ts          // pdfjs-dist; Grok only
├── image-transcode.ts        // HEIC → JPEG + downscale (sharp)
└── providers/
    ├── openai-attachments.ts // inline vs Files API ("user_data"/"vision")
    ├── gemini-attachments.ts // inlineData vs ai.files.upload; mediaResolution
    └── grok-attachments.ts   // rasterize-then-image; HEIC transcode
```

### 7.10 Tests the abstraction must pass

- **Digital 5-page PDF, 3 MB:** OpenAI inline; Gemini inline + LOW resolution; Grok rasterize 5 JPEGs.
- **Scanned 12-page PDF, 18 MB:** OpenAI Files API; Gemini Files API + HIGH; Grok rasterize 12 JPEGs (capped at 20 — passes).
- **Multi-account digital PDF (3 accounts, 22 pages), 6 MB:** Page-hint "1-7,8-14,15-22" exercises slicing; all providers extract account totals.
- **Phone JPEG (4032×3024), 4 MB:** Layer downscales to 2048-long-edge; all providers accept; quality OK.
- **iPhone HEIC, 3 MB:** Layer transcodes to JPEG for Grok and OpenAI; Gemini gets HEIC native.
- **Animated GIF (intentional malformed input):** Rejected with "unsupported file format."
- **HTML file mislabeled as PDF:** Magic-byte sniff rejects.
- **30-page Grok request:** Auto-splits into 2 sub-calls (pages 1-20, 21-30), merges holdings, reconciles totals.
- **Below 520 px short edge:** Existing `STATEMENT_FILE_TOO_LOW_QUALITY` error fires before the model is touched.

---

## 8. Per-route migration (revised)

### 8.1 Statement extraction — `lib/extract-statement-holdings.ts`
- Replace direct `openai.responses.create` with `complete({ pass: "extraction", attachments, jsonSchema: ExtractedHoldingsSchema })`.
- All attachment normalization (text-layer extract, page-slice, multi-account hint, magic-byte sniff, HEIC transcode, dimension downscale) happens in **§7's intake layer** — `extract-statement-holdings.ts` becomes a thin orchestrator.
- Provider-specific wire shape (inline vs Files API vs rasterize) lives in `providers/<p>-attachments.ts`; the route never branches.
- Preserve return shape exactly: `{ holdings: ExtractedHolding[], statementAccountEndingValue?: number }`.

### 8.2 Macro research + portfolio review — `app/api/generate-analysis/route.ts`
- Replace pass 1 with `research({ tier: "agentic-research", user: macroPrompt, allowedDomains: FINANCE_DOMAINS })`.
- Pass 2 (`synthesis.json`) receives `researchResult.text` AND `researchResult.citations` as structured context in the prompt. JSON schema gains a `citations: Citation[]` field.
- `generate-report` PDF route renders a new **Sources** section from `citations` and embeds `searchSuggestionsHtml` when Gemini is the provider.

### 8.3 Per-holding enrichment — `lib/holding-enrichment.ts`
- Replace pass 1 with `research({ tier: "fast-grounded", user: holdingPrompt, allowedDomains: ["sec.gov","morningstar.com","fundissuer.com",...], knownUrls: figiSummary.url ? [figiSummary.url] : undefined })`.
- Pass 2 (`synthesis.json`) is told explicitly: **populate `sourceUrls` ONLY from the provided citations list**. Validate at parse time — drop unsupported URLs.
- **Provenance sidecar (new table, no schema change to the existing cache):** new table `advisorpilot_enrichment_provenance(cache_id uuid pk references advisorpilot_security_enrichment_cache(id) on delete cascade, provider text not null, citations jsonb not null default '[]'::jsonb, created_at timestamptz not null default now())`. On every cache write, also insert/upsert the provenance row keyed by `cache_id`. On read, `JOIN` to filter by current provider; if no match for this provider, treat the cache row as a miss and re-research. **The existing cache table is untouched.**
- **Concurrency:** replace the 350ms sleep with a real concurrency limiter (e.g., `p-limit(4)`); each provider's rate limits are high enough (Grok 1800 RPM, OpenAI varies by tier, Gemini tier-based). The 350ms was a guess from an older OpenAI rate-limit era — measure and tune.

### 8.4 Intake voice — `app/api/intake-voice/route.ts`
- `complete({ pass: "intake.turn", system, user, jsonSchema: IntakeTurnSchema })`. Adapter chooses chat.completions vs responses internally; route doesn't care.
- Preserve 3 modes (`opening` / `turn` / `handoff`) by prompt switching.

### 8.5 TTS / STT — `app/api/intake-tts/route.ts`, `app/api/intake-stt/route.ts`
- `tts()` / `stt()`. v1 always OpenAI. v2 plumbs xAI `/v1/tts` and `/v1/stt`. Gemini TTS only when it leaves preview.

### 8.6 Eval fixtures
- Move `lib/openai-model-eval-fixtures.ts` → `lib/llm/eval/fixtures.ts`.
- **Add research-pass fixtures**: 5 macro queries with expected domains and minimum citation count; 5 per-holding queries with known correct ticker and at least one issuer-domain URL.
- Paired runner gains `provider` axis: `provider × tier × fixture`. Output: markdown comparison report.

### 8.7 NEW: Deep-research lifecycle (Tier C)
- New table `advisorpilot_deep_research_jobs(id uuid pk, advisor_id, provider, tier, request jsonb, status, result jsonb, started_at, completed_at, error)`.
- New routes: `POST /api/research/start` returns `jobId`; `GET /api/research/:id` polls; optional `POST /api/research/webhook/openai` receives OpenAI completion webhooks (Vercel cron `/api/research/cron` polls Gemini until webhook support lands).
- UI: opt-in button on the analysis view ("Run deep research — takes a few minutes"); progress indicator; result rendered into the existing review JSON shape via the synthesis pass.

---

## 9. UI

**Core principle:** the advisor picks **provider AND model** per pass in the UI. Env vars are the **defaults** the firm ships with — the UI **always wins** when the advisor has saved a preference. No hidden flag, no "advanced mode" gate. We do not lock the user to one provider/model just because the env var says so.

### 9.1 NEW: Settings page (this is where the controls live)

AdvisorPilot has no real settings page today — the account menu in the header (`aria-label="Account menu"` at `app/app/page.tsx:644`) exists but is a thin dropdown. This work adds a proper Settings surface.

**Implementation:** a `<SettingsDrawer/>` opened from the account menu. Slide-over panel (not a route — keeps the existing single-page workflow uninterrupted). Tabbed sections so we can grow this later without re-architecting:

```
Settings
├── AI Models       ← provider + per-pass model picker (this PR)
├── Voice Agent     ← model + voice + hotkey (voice-agent plan)
├── Research        ← default tier, allowed domains, x_search toggle
├── Profile         ← email signature (existing /api/advisor-profile fields)
└── Privacy         ← AI disclosure, audit logging opt-in
```

**Why a drawer instead of a route:** advisor product is a single giant component holding workflow state; navigating to a route would lose intake-in-progress state. A drawer overlays without disrupting work.

### 9.2 NEW: AI Models tab (the provider+model picker)

```
┌────────────────────────────────────────────────────────────────────────┐
│  AI Models                                                              │
├────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Provider                                                               │
│  ●  ChatGPT (OpenAI)        — configured                                │
│  ○  Gemini (Google)         — configured                                │
│  ○  Grok (xAI)              — missing API key (ask your admin)          │
│                                                                         │
│  ── Per-task model overrides ──────────────────  [Reset all to default] │
│                                                                         │
│  Statement extraction      [gpt-5.5            ▾]   default: gpt-5.5    │
│  Macro research (agentic)  [o3-deep-research   ▾]   default: gpt-5.5    │
│  Macro report synthesis    [gpt-5.5            ▾]   default: gpt-5.5    │
│  Holding research          [gpt-5.5            ▾]   default: gpt-5.5    │
│  Holding synthesis         [gpt-5.5            ▾]   default: gpt-5.5    │
│  Intake conversation       [gpt-5.5            ▾]   default: gpt-5.5    │
│                                                                         │
│  ☑ Use my chosen provider for everything where possible                  │
│    (uncheck to mix providers per task — advanced)                       │
│                                                                         │
│  Default research tier      ( Fast | ● Agentic | Deep )                 │
│                                                                         │
│  [Save changes]                              Last updated 2 min ago     │
└────────────────────────────────────────────────────────────────────────┘
```

**Behavior:**
- **Provider radio** persists `advisor_profile.llm_provider`. Header pill in the top bar reflects this and offers the same radio for quick switching without opening Settings.
- **Per-task model dropdown** persists `advisor_profile.llm_model_overrides` (jsonb, shape `{ "extraction": "gpt-5.5", "analysis.research": "o3-deep-research-2025-06-26", ... }`). Each dropdown lists the **known stable models for the selected provider** plus a **"Custom…"** option that accepts free-text (so power users can pin a snapshot ID like `gpt-5.5-2026-04-10` without us shipping a release).
- **"Use my chosen provider for everything"** is a convenience toggle that grays out per-task pickers and just uses the provider's defaults. Default ON for new advisors.
- **Default research tier** is also per-advisor (still overridable at the analysis CTA per §9.4 below).
- **Reset all to default** clears `llm_model_overrides` so the firm defaults from env vars take over again.

**Server-side**, `lib/llm/registry.ts` resolves the model for a request in this order: **request header `x-llm-model-<pass>` > advisor profile override > env `LLM_<PROVIDER>_<PASS>_MODEL` > hardcoded default**. The same precedence applies to provider.

**Disabling unavailable providers:** `GET /api/llm-providers` returns `[{ id, configured: boolean }]` based on whether the firm has set the API key. The picker grays out unconfigured providers with a tooltip — never silently falls back.

**Model lists per provider** live in `lib/llm/model-catalog.ts`:
```ts
export const MODEL_CATALOG = {
  openai: {
    extraction: ["gpt-5.5", "gpt-5.4", "gpt-4o"],
    "analysis.research": ["gpt-5.5", "o3-deep-research-2025-06-26", "o4-mini-deep-research-2025-06-26"],
    // ...
  },
  gemini: { /* ... */ },
  grok: { /* ... */ },
} as const;
```
This file is the **single source of truth** for what shows up in the dropdowns. Update it when a new model lands; no other code needs to change.

### 9.3 NEW: Header pill (quick provider switch)

A compact pill in the app header (sibling to the user menu) shows the active provider: **`Model: Gemini ▾`**. Click expands a mini radio with the three providers and a link "More settings…" that opens the Settings drawer on the AI Models tab. For advisors who never want to leave the keyboard, the radio is operable with Tab + Space.

### 9.4 NEW: Research tier selector (per analysis run)
- On the macro-analysis CTA, a small dropdown: **Fast · Agentic · Deep**. Default comes from Settings (§9.2) and is per-advisor.
- "Deep" shows a clear "this runs in the background and may take 5–30 minutes" copy; reveal-on-click. Disabled for Grok with tooltip explaining the sync-only fallback.

### 9.5 NEW: Sources panel
- New collapsible panel on the review screen. Per-holding row: small "n sources" pill linking to the same panel filtered to that holding.
- When `searchSuggestionsHtml` is present (Gemini), render it inline at the bottom of the panel inside a sandboxed `<div>` with the docs-required styling. **This is a ToS requirement** when using `google_search`.

### 9.6 NEW: Provider attribution
- Tiny footer line on the PDF: "Generated with <Provider> · <YYYY-MM-DD>". Compliance / audit hint.

### 9.7 Persistence model

Supabase migration on `advisor_profile` — **all columns nullable, no DEFAULT**, so existing rows are unaffected and any code path that doesn't know about these columns continues to work. `NULL` is the carrier of "not set — use the firm/env default."

```sql
alter table advisor_profile
  add column if not exists llm_provider text,                 -- nullable, no default
  add column if not exists llm_model_overrides jsonb,         -- nullable, no default
  add column if not exists default_research_tier text;        -- nullable, no default
```

**Why no default values:** a `default 'openai'` would silently backfill every existing advisor row at migration time — which looks fine until you roll back, at which point those rows now have data the old code knows nothing about. Pure NULL means "the migration was a no-op for existing advisors" and rollback is trivial (`alter table … drop column if exists …`).

**Resolver precedence stays the same:** request header → `advisor_profile.llm_provider` (when **not null**) → env `ADVISORPILOT_DEFAULT_LLM_PROVIDER` → hardcoded `"openai"`. Same applies to `llm_model_overrides` (NULL or `{}` → fall through to env per-pass model) and `default_research_tier` (NULL → fall through to env or hardcoded `"agentic-research"`).

`/api/advisor-profile` GET/PATCH already exists; extend its body schema. `lib/advisor-fetch.ts` reads the profile once on app mount, caches in React context, and attaches `x-llm-provider` + `x-llm-model-<pass>` headers to every AI-route fetch — and **only** when the corresponding column is not null. Saving Settings round-trips through PATCH and updates the context immediately (no reload).

---

## 10. Env-var contract (v2)

**Important:** these env vars set the **firm's defaults**. Any advisor can override provider and per-pass model in the UI (§9.2), and their saved preference wins over the env var. Use these to set sensible starting points and to disable a provider entirely (by not configuring its key); don't think of them as user-facing settings.

```bash
# Provider keys
OPENAI_API_KEY=...
GEMINI_API_KEY=...                                  # @google/genai (Developer API)
XAI_API_KEY=...                                     # Grok

# Default provider; missing → openai
ADVISORPILOT_DEFAULT_LLM_PROVIDER=openai            # openai | gemini | grok

# Model overrides — per provider, per pass
LLM_OPENAI_EXTRACTION_MODEL=gpt-5.5
LLM_OPENAI_INTAKE_MODEL=gpt-5.5
LLM_OPENAI_RESEARCH_FAST_MODEL=gpt-5.5
LLM_OPENAI_RESEARCH_AGENTIC_MODEL=gpt-5.5
LLM_OPENAI_RESEARCH_DEEP_MODEL=o3-deep-research-2025-06-26
LLM_OPENAI_SYNTHESIS_MODEL=gpt-5.5

LLM_GEMINI_EXTRACTION_MODEL=gemini-3-flash-preview
LLM_GEMINI_INTAKE_MODEL=gemini-3.1-flash-lite
LLM_GEMINI_RESEARCH_FAST_MODEL=gemini-3-flash-preview
LLM_GEMINI_RESEARCH_AGENTIC_MODEL=gemini-3.1-pro-preview
LLM_GEMINI_RESEARCH_DEEP_MODEL=deep-research-preview-04-2026
LLM_GEMINI_SYNTHESIS_MODEL=gemini-3.1-flash-lite

LLM_GROK_EXTRACTION_MODEL=grok-4.3
LLM_GROK_INTAKE_MODEL=grok-4.3
LLM_GROK_RESEARCH_FAST_MODEL=grok-4.3
LLM_GROK_RESEARCH_AGENTIC_MODEL=grok-4.3
LLM_GROK_RESEARCH_DEEP_MODEL=grok-4.3                # falls back to agentic
LLM_GROK_SYNTHESIS_MODEL=grok-4.3

# Research tuning
LLM_RESEARCH_FAST_MAX_STEPS=5
LLM_RESEARCH_AGENTIC_MAX_STEPS=12
LLM_RESEARCH_DEEP_MAX_STEPS=25
LLM_ENRICHMENT_CONCURRENCY=4
LLM_DEFAULT_ALLOWED_DOMAINS=sec.gov,morningstar.com,ishares.com,vanguard.com,ssga.com,federalreserve.gov

# Intake layer (see §7)
LLM_MAX_UPLOAD_BYTES=26214400                           # 25 MB
LLM_INLINE_BYTES_THRESHOLD_OPENAI=8388608               # >8 MB → Files API
LLM_INLINE_BYTES_THRESHOLD_GEMINI=15728640              # >15 MB → Files API
LLM_GROK_RASTERIZE_DPI=2.0
LLM_GROK_RASTERIZE_FORMAT=jpeg
LLM_GROK_RASTERIZE_QUALITY=80
LLM_GROK_MAX_PAGES_PER_REQUEST=20
LLM_GEMINI_VISION_RESOLUTION=HIGH                       # LOW | MEDIUM | HIGH | ULTRA_HIGH
LLM_IMAGE_MAX_LONG_EDGE_PX=2048

# Legacy aliases — honored for one release for the OpenAI provider
OPENAI_EXTRACTION_MODEL=...
OPENAI_ANALYSIS_RESEARCH_MODEL=...
# ...
```

Server boot logs `[llm] configured: openai, gemini` (no key values).

---

## 11. Compliance & ToS

- **Gemini `searchEntryPoint` widget** is required by Google's grounding ToS. The abstraction returns `searchSuggestionsHtml` whenever Gemini grounding produced results; the UI / PDF MUST render it. Build a sandboxed renderer; failing to display = ToS violation.
- **Provider attribution in outputs** (PDF footer) is also useful for the firm's compliance/audit trail.
- **Domain allow-listing** is a compliance / supervision win — the same `LLM_DEFAULT_ALLOWED_DOMAINS` applies regardless of provider (with Grok capped to 5, picked by relevance score in code).
- **Caching across providers** must filter by provider — mixing Gemini grounding with OpenAI-cached citations would mis-attribute sources.

---

## 12. Rollout phases (v2)

### Phase 0 — pure refactor + intake layer skeleton (2–3 days)
- New `lib/llm/` module. Move every current OpenAI call behind `complete()` / `research()` / `tts()` / `stt()`.
- New `lib/llm/attachments.ts` consolidates today's text-layer extraction, page-slicing, multi-account hint, and quality preflight in one place; `providers/openai-attachments.ts` initially preserves today's inline-base64 behavior exactly.
- Magic-byte sniff + `LLM_MAX_UPLOAD_BYTES` enforcement on both upload routes (security hardening worth bundling).
- Citations are now extracted (annotations parsed) but UI/PDF unchanged yet.
- Existing env vars still work via aliases.
- **Gate:** `npm test` green; manual smoke shows identical user-visible behavior on both advisor and magic-link upload paths.

### Phase 1 — Fix the enrichment citation bug (1 day, shippable on its own)
- Even before adding new providers, change pass 2 to consume real citations from pass 1's parsed annotations.
- Add `provider` + `citations` columns to enrichment cache; backfill defaults.
- Add a smoke test that `sourceUrls` ⊆ pass-1 citations.

### Phase 2 — Gemini adapter (3–4 days)
- `providers/gemini.ts` with `@google/genai`.
- `providers/gemini-attachments.ts`: inline ≤15 MB, Files API otherwise (48 h TTL re-upload logic), `mediaResolution` from env, HEIC native passthrough.
- Grounding + `url_context` combined; structured JSON for the synthesis pass.
- `searchSuggestionsHtml` plumbed end-to-end (route returns it; UI renders it).
- Zod validation on every JSON output (Gemini schema is non-strict).
- Paired eval (OpenAI baseline vs Gemini) on extraction, fast-grounded, agentic-research fixtures.
- **Gate:** Digital-PDF extraction cost on Gemini Flash is measurably (>3×) cheaper than OpenAI baseline; scan extraction matches OpenAI quality on the 8 checklist scenarios in `STATEMENT_EXTRACTION_EVAL_CHECKLIST`.

### Phase 3 — Grok adapter (3–4 days)
- `providers/grok.ts` via OpenAI SDK + baseURL swap.
- `lib/llm/pdf-rasterize.ts` (pdfjs-dist → JPEG q80 @ 2x scale, long edge 2048 px, capped at 20 pages/request, auto-split larger PDFs).
- `lib/llm/image-transcode.ts` for HEIC → JPEG (sharp or heic-decode).
- `providers/grok-attachments.ts`: rasterize on demand, transcode HEIC, ensure no WebP/GIF reaches Grok.
- Agent Tools wiring with `max_turns`; inline-annotation normalization to `Citation[]`.
- Same eval matrix.
- **Gate:** Reconciliation on a 30-page multi-account PDF (split into 2 Grok calls) ties to the OpenAI baseline within tolerance (`assertHoldingsReconcileToVerifiedTotal`).

### Phase 4 — Settings page + UI selectors + Sources panel (3–4 days)
- **Settings drawer** with tabs (§9.1) — provider radio, per-pass model dropdowns, research-tier default, "use my provider everywhere" toggle, reset-to-default.
- Header pill (quick provider switch) + research-tier dropdown on the analysis CTA.
- Sources panel + PDF Sources section + provider footer attribution.
- `GET /api/llm-providers` (key-presence only).
- Supabase migration: `llm_provider`, `llm_model_overrides`, `default_research_tier` on `advisor_profile`.
- `lib/llm/model-catalog.ts` lists selectable models per provider per pass; "Custom…" free-text accepted.
- `lib/advisor-fetch.ts` reads profile + attaches `x-llm-provider` / `x-llm-model-<pass>` headers to every AI-route fetch.
- Persistence via existing `/api/advisor-profile` (add `llm_provider` column migration).

### Phase 5 — Deep-research lifecycle (3–5 days, optional)
- `advisorpilot_deep_research_jobs` table + routes + webhook/poll worker.
- UI opt-in button + status indicator.
- OpenAI + Gemini implementations; Grok auto-degrades.

### Phase 6 — audio parity & cleanup (later)
- Grok `/v1/tts` + `/v1/stt` adapters.
- Gemini TTS once GA.
- Remove legacy `OPENAI_*_MODEL` shims.

---

## 13. Risks & mitigations (v2)

| Risk | Mitigation |
|---|---|
| Gemini JSON schema is non-strict | Zod-validate every response; on first failure, retry once with stricter prompt; on second failure surface structured `LlmValidationError`. |
| Gemini grounding returns no snippets, only URIs/titles | Pair `google_search` with `url_context` for high-importance citations the synthesis needs to quote; cache the fetched content in enrichment row. |
| Grok rasterized PDFs lose fidelity vs native PDF | Always include `extractPdfTextLayer()` output in the prompt alongside the page images; Grok uses text as ground truth, images for layout/table cells. |
| Grok allowed_domains cap of 5 | Maintain a ranked default list; on each call pick top-5 by relevance to query (cheap heuristic in code); document the cap in env var. |
| Concurrency hike (`p-limit(4)`) hits provider rate limits | Provider-specific limiter per request; on 429 back off exponentially and fall through to the next provider in user's failover preference (off by default). |
| Deep research webhook delivery unreliable | Always also poll on a 30s cron; treat webhook as best-effort. |
| Search Suggestions widget rendering omitted = Gemini ToS violation | E2E test that asserts `searchSuggestionsHtml` reaches the DOM when present. Block release if not rendered. |
| Provider switch poisons cache | `provider` column + lookup filter. |
| `gpt-5.5` or other model IDs evolve mid-release | All model IDs in env, registry resolves at runtime, no hard-coded IDs in routes. Eval suite catches regressions. |
| Grok SKU retirement 2026-05-15 silently re-routes | Pin `grok-4.3` explicitly (never `-latest` in prod); add a CI assert. |
| Cost surprise from agentic loops | `max_tool_calls` / `max_turns` always set; log usage per call; daily budget meter in admin view (Phase 5). |
| Background deep-research jobs orphaned by Vercel cold starts | All state in Supabase; restart-safe poller. |
| Per-route prompt drift across providers | Centralize prompts in `lib/llm/prompts/`; one prompt per pass, one set of provider-specific adapters per prompt where needed. |
| HEIC iPhone photos break on Grok / OpenAI (silent model failure) | §7 intake layer transcodes HEIC → JPEG before any non-Gemini provider; magic-byte sniff rejects unknown formats with a clear error. |
| Advisor `/api/analyze-statement` has no file-size cap (DoS surface) | §7.7 bundles `LLM_MAX_UPLOAD_BYTES` enforcement on both upload routes. |
| Grok 20-page request limit truncates large multi-account statements | §7.3 layer auto-splits into multiple `extract()` calls and merges holdings; reconciliation guard catches any drop. |
| Gemini 48 h Files API TTL expires mid-deep-research job | §7.3 Gemini adapter re-uploads on TTL miss; tracked via `fileUri` cache with timestamp. |
| Scanned PDFs cost 10× on Gemini (no free text) without warning | §7.5 layer detects `hasTextLayer === false` and either upgrades to HIGH/ULTRA_HIGH resolution (worth the cost) or routes to OpenAI on cost-sensitive plans. |
| MIME spoofing (HTML labeled as PDF reaches model) | §7.7 magic-byte sniff at intake; reject anything that doesn't start with `%PDF-`, JPEG SOI, or PNG signature. |

---

## 14. Out of scope (v1)

- Streaming responses (no current consumer; Phase 5+).
- Embeddings (unused today).
- Realtime voice (Grok offers it; current intake is pause-based).
- Auto-failover across providers — explicit user action only.
- Per-client (vs per-advisor) provider preference.
- Vertex AI surface — Developer API only in v1.

---

## 15. Concrete first-PR scope (Phase 0 + Phase 1 bundled)

**PR title:** "lib/llm: refactor, intake-layer skeleton, real citations into enrichment cache"

- Add `lib/llm/{index.ts, types.ts, registry.ts, capabilities.ts, attachments.ts}` + `providers/openai.ts` + `providers/openai-attachments.ts` + `normalize/citations-openai.ts`.
- Migrate every OpenAI call into `complete()` / `research()` / `tts()` / `stt()`. Behavior unchanged on the user-visible surface.
- Centralize today's `tryExtractPdfText`, `slicePdfBytesToPages`, `buildMultiAccountPdfHint`, and `assertStatementFileReadable` into `attachments.normalizeAttachment()`. The OpenAI adapter preserves today's inline base64 encoding bit-for-bit; Files API path is wired but gated behind a flag for v2.
- **Fix the enrichment bug:** pass 1's URL annotations are parsed → passed as structured context to pass 2 → pass 2's schema requires `sourceUrls ⊆ providedCitations`. Add a test fixture that asserts no hallucinated URLs.
- **Hardening (small but worth bundling):** magic-byte MIME sniff at intake; `LLM_MAX_UPLOAD_BYTES` enforced on both `/api/analyze-statement` and `/api/client-upload/ingest`; HEIC transcode helper landed but unused on OpenAI (so it's tested but a no-op on v1).
- Supabase migration: **new** table `advisorpilot_enrichment_provenance` (see §8.3). The existing cache table is not modified.
- No new providers, no UI changes, no behavior changes for the advisor.
- **Tests:** existing `npm test` passes; eval suite gains 3 new research-pass fixtures + 4 intake-layer fixtures (digital PDF, scanned PDF, HEIC, oversized).

Ships safely before any Gemini / Grok code lands and **fixes a real correctness bug** advisors are unknowingly relying on.

---

## 16. Open questions (decisions needed)

**Decided (no longer open):**

- ~~**Per-pass model overrides as a power-user "v1.1" feature.**~~ **Decided 2026-05-15:** per-pass model dropdowns are first-class in v1 (§9.2). Env vars set firm defaults; the advisor's UI choices always win.
- ~~**Settings location.**~~ **Decided:** new Settings drawer opened from the account menu (no separate route — keeps workflow state intact).
- ~~**Custom model IDs (snapshot pins like `gpt-5.5-2026-04-10`).**~~ **Decided:** every dropdown includes a "Custom…" option that accepts free text, so advisors aren't blocked when we haven't shipped a release for a new model snapshot.

**Still open:**

1. **Default research tier for the existing macro analysis flow.** v1 of the abstraction should map today's behavior (agentic-research). Confirm we want to keep "deep research" opt-in only, not auto-promote.
2. **Cache-across-providers strategy.** Per-provider cache is safe but wasteful. Alternative: cache the *normalized* Citation[] and let any provider reuse it for ticker→URL lookups, while keeping the *generated text* per-provider. Recommend per-provider in v1; cross-provider in a follow-up after we see how much divergence occurs.
3. **Vertex AI vs Developer API for Gemini.** Recommend Developer API in v1 (single key); document Vertex path for firms that need IAM-bound or RAG corpora.
4. **Audio in v1.** Recommend keeping OpenAI for TTS/STT regardless of selected provider; surface this clearly in the UI ("Voice features powered by OpenAI"). Revisit in Phase 6.
5. **`x_search` for sentiment.** Worth enabling on Grok agentic-research? Useful for "what's the market saying" but introduces X content into compliance scope. Recommend off by default, opt-in setting in advisor profile.

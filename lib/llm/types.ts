/**
 * Provider-agnostic LLM types.
 *
 * The `complete()` / `research()` / `tts()` / `stt()` surface in `lib/llm/index.ts`
 * is the only thing route handlers should call — they never instantiate provider
 * SDKs directly. This keeps provider switching contained to `lib/llm/registry.ts`
 * + `lib/llm/providers/*`.
 *
 * Today only `openai` is implemented. `gemini` and `grok` types live here so
 * route code compiled against the abstraction will not change shape when they
 * land in later PRs.
 */

import type { Buffer } from "buffer";

// ─────────────────────────────────────────────────────────────────────────────
// Providers + passes
// ─────────────────────────────────────────────────────────────────────────────

export type LlmProvider = "openai" | "gemini" | "grok";

/**
 * Every distinct "call site shape" in the app maps to one pass. The registry
 * resolves a model per (provider, pass), and the adapter knows what wire shape
 * each pass expects.
 *
 * Keep this list closed — new call sites should reuse an existing pass when
 * possible. Each pass corresponds to a column in §6.4 of
 * docs/multi-provider-llm-plan.md.
 */
export type LlmPass =
  | "extraction" // vision/PDF → holdings JSON
  | "intake.turn" // chat → IntakeTurn JSON
  | "research.fast-grounded" // single-call grounded search, sub-30s
  | "research.agentic" // multi-step server-side tool loop, 30s–3min
  | "research.deep" // async background, minutes
  | "synthesis.json" // narrative + structured JSON consuming research result
  | "tts"
  | "stt";

// ─────────────────────────────────────────────────────────────────────────────
// Attachments (intake layer — see lib/llm/attachments.ts)
// ─────────────────────────────────────────────────────────────────────────────

export type AttachmentKind = "pdf" | "image";

export interface PdfTextLayerContext {
  /** Raw text from pdf-parse before any trimming. */
  fullText: string;
  /** Head + tail clip used in prompts; may equal fullText for short PDFs. */
  clippedText: string;
  /**
   * "MULTI-ACCOUNT DOCUMENT (...)" hint inserted into the prompt when the
   * embedded PDF text references more than one Account Number block. Empty
   * string when single-account.
   */
  multiAccountHint: string;
  /** Number of distinct "Account Number" lines detected in the embedded text. */
  accountCount: number;
}

/**
 * Normalized attachment passed to provider adapters. The intake layer fills
 * the computed fields (`pageCount`, `hasTextLayer`, `textLayer`,
 * `imageDimensions`) once and shares them across providers.
 */
export interface Attachment {
  kind: AttachmentKind;
  bytes: Buffer;
  /** Canonical MIME — after magic-byte sniffing, never an empty string. */
  mime: string;
  /** Original filename for logging + Files API. */
  fileName: string;
  /** Advisor's holdings-page hint e.g. "1-3,5-6". Honored before any provider work. */
  pageHint?: string;
  /** PDFs only, from pdf-lib. */
  pageCount?: number;
  /** PDFs only. False when no usable text layer (scanned / image-only). */
  hasTextLayer?: boolean;
  /**
   * PDFs only. True when the intake layer physically dropped pages outside
   * the advisor's `pageHint` before handing bytes to the provider. False when
   * either no hint was given or slicing failed (full PDF attached, hint
   * passed as guidance in the prompt).
   */
  pdfPhysicallySliced?: boolean;
  /** Present iff `hasTextLayer === true`. */
  textLayer?: PdfTextLayerContext;
  /** Images only — populated by quality preflight. */
  imageDimensions?: { width: number; height: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Citations (normalized across providers)
// ─────────────────────────────────────────────────────────────────────────────

export type CitationSourceType = "web" | "x" | "file" | "code";

/**
 * Provider-normalized citation. Different providers populate different fields:
 *
 * - OpenAI `url_citation` → `uri`, `title`, `startIndex`, `endIndex`.
 * - Grok inline annotations → same fields; `snippet` may be present.
 * - Gemini `groundingMetadata` → `uri`, `title`, `chunkIndex`; no snippet text.
 *
 * Consumers should treat `uri` as the only universally-present field.
 */
export interface Citation {
  uri: string;
  title?: string;
  snippet?: string;
  /** Character offset in the response where this citation supports a claim (OpenAI/Grok). */
  startIndex?: number;
  endIndex?: number;
  /** Gemini groundingSupports → groundingChunks index (provider-specific). */
  chunkIndex?: number;
  sourceType?: CitationSourceType;
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolution context (header → profile → env → default)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolved per-request configuration. The registry (`lib/llm/registry.ts`)
 * builds this from request headers, advisor profile, and env vars; adapters
 * receive it as part of every call.
 */
export interface LlmContext {
  provider: LlmProvider;
  pass: LlmPass;
  /** Resolved model ID for (provider, pass). */
  model: string;
}

/**
 * Per-advisor selection persisted in `advisorpilot_advisor_profiles`.
 * Loaded from the DB on the server side and threaded through to
 * `resolveLlmContext`. NULL columns in the DB → `undefined` here, signaling
 * "fall through to env / hardcoded default."
 */
export interface AdvisorLlmSelection {
  provider?: LlmProvider;
  /** Per-pass model overrides. e.g. `{ "extraction": "gpt-4o" }`. */
  models?: Partial<Record<LlmPass, string>>;
  /** Default research tier (`fast-grounded`/`agentic-research`/`deep-research`). */
  defaultResearchTier?: ResearchTier;
}

export type ResearchTier = "fast-grounded" | "agentic-research" | "deep-research";

// ─────────────────────────────────────────────────────────────────────────────
// Completion (plain or JSON)
// ─────────────────────────────────────────────────────────────────────────────

export interface CompletionRequest {
  pass: LlmPass;
  /** Optional override forcing a specific provider regardless of registry resolution. */
  providerOverride?: LlmProvider;
  /** System / instructions string. */
  system?: string;
  /** User-side prompt. */
  user: string;
  /** Attachments (extraction / vision passes). */
  attachments?: Attachment[];
  /** When set, the adapter requests structured JSON and parses it. */
  jsonSchema?: Record<string, unknown>;
  maxOutputTokens?: number;
  /** Reasoning effort, mapped per-provider (OpenAI: reasoning.effort; Grok: reasoning.effort). Ignored where unsupported. */
  reasoningEffort?: "low" | "medium" | "high";
}

export interface TokenUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
}

export interface CompletionResponse<T = unknown> {
  /** Raw text response — empty string when only JSON was returned. */
  text: string;
  /** Parsed JSON when `jsonSchema` was provided; otherwise undefined. */
  json?: T;
  /** Provider-native raw payload, for debugging / future fields. */
  raw: unknown;
  usage?: TokenUsage;
  context: LlmContext;
}

// ─────────────────────────────────────────────────────────────────────────────
// Research (web/url grounded)
// ─────────────────────────────────────────────────────────────────────────────

export interface ResearchRequest {
  tier: ResearchTier;
  providerOverride?: LlmProvider;
  system?: string;
  user: string;
  /** Optional list of URLs the model should consider reading (Gemini url_context; prompt hint elsewhere). */
  knownUrls?: string[];
  /** Domain whitelist (best-effort across providers). */
  allowedDomains?: string[];
  blockedDomains?: string[];
  /** Grok x_search opt-in. Ignored on other providers. */
  includeSocialSignals?: boolean;
  /** When set, the model returns structured JSON alongside text + citations. */
  jsonSchema?: Record<string, unknown>;
  /** Hard cap on server-side agentic tool calls. */
  maxAgenticSteps?: number;
}

export interface ResearchResult<T = unknown> {
  text: string;
  json?: T;
  citations: Citation[];
  /**
   * Gemini-only — when present this HTML widget MUST be rendered in the UI
   * displaying the result. ToS requirement of `google_search` grounding.
   */
  searchSuggestionsHtml?: string;
  raw: unknown;
  usage?: TokenUsage;
  context: LlmContext;
  /** Populated only when tier === "deep-research"; result not yet ready. */
  asyncHandle?: { id: string; pollUrl?: string };
}

// ─────────────────────────────────────────────────────────────────────────────
// Audio
// ─────────────────────────────────────────────────────────────────────────────

export interface TtsRequest {
  text: string;
  /** Provider-specific voice id; ignored when provider has none. */
  voice?: string;
  /** Audio format; adapters may downconvert. */
  format?: "mp3" | "wav" | "opus";
  /** Optional natural-tone instruction string for models that accept it (e.g. gpt-4o-mini-tts). */
  instructions?: string;
}

export interface SttRequest {
  audio: Buffer;
  /** Audio container/mime — webm / ogg / mp3 / wav etc. */
  mime: string;
  /** ISO 639-1 hint. Defaults to "en". */
  language?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider adapter contract
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Each provider implements this. Adapters are stateless (apart from the
 * shared client singleton they manage internally) and pure — all
 * configuration comes through the request types above.
 *
 * If an adapter cannot serve a pass, it should throw an `LlmCapabilityError`;
 * `lib/llm/index.ts` will fall back to OpenAI per the capability matrix.
 */
export interface LlmAdapter {
  readonly id: LlmProvider;
  complete<T>(req: CompletionRequest, ctx: LlmContext): Promise<CompletionResponse<T>>;
  research<T>(req: ResearchRequest, ctx: LlmContext): Promise<ResearchResult<T>>;
  tts(req: TtsRequest, ctx: LlmContext): Promise<Buffer>;
  stt(req: SttRequest, ctx: LlmContext): Promise<string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export class LlmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmConfigError";
  }
}

export class LlmCapabilityError extends Error {
  constructor(
    public readonly provider: LlmProvider,
    public readonly pass: LlmPass,
    message: string
  ) {
    super(message);
    this.name = "LlmCapabilityError";
  }
}

export class LlmAttachmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmAttachmentError";
  }
}

export class LlmValidationError extends Error {
  constructor(
    message: string,
    public readonly raw?: unknown
  ) {
    super(message);
    this.name = "LlmValidationError";
  }
}

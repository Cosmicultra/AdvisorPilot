/**
 * OpenAI adapter — the only provider implemented in Phase 0+1.
 *
 * Wraps the current call shapes used across the app:
 *
 *   complete({ pass: "extraction", ... })       → responses.create (vision + json_object)
 *   complete({ pass: "intake.turn", ... })      → chat.completions.create (response_format json_object)
 *   complete({ pass: "synthesis.json", ... })   → responses.create (json_object)
 *   research({ tier: "fast-grounded" | "agentic-research", ... }) → responses.create (web_search_preview tool)
 *   research({ tier: "deep-research", ... })    → responses.create (background:true, o3-deep-research)
 *   tts(...)                                    → audio.speech.create
 *   stt(...)                                    → audio.transcriptions.create
 *
 * Everything else stays identical to today's behavior bit-for-bit — this PR
 * is a refactor, not a behavior change. The two intentional differences:
 *
 *   - We extract citations from `response.output` annotations and return them
 *     on `ResearchResult.citations` (today's code discards them).
 *   - `research.deep` is plumbed but unused in v1 routes (no route opts in yet).
 */

import OpenAI from "openai";
import type { Buffer } from "buffer";
import type {
  Attachment,
  CompletionRequest,
  CompletionResponse,
  LlmAdapter,
  LlmContext,
  ResearchRequest,
  ResearchResult,
  SttRequest,
  TtsRequest,
} from "../types";
import { LlmCapabilityError, LlmConfigError } from "../types";
import { citationsFromOpenAiResponse } from "../normalize/citations-openai";

// ─────────────────────────────────────────────────────────────────────────────
// Shared client singleton
// ─────────────────────────────────────────────────────────────────────────────

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new LlmConfigError("Missing OPENAI_API_KEY in environment.");
  }
  if (_client) return _client;
  _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

// ─────────────────────────────────────────────────────────────────────────────
// Attachment → Responses API content parts
// ─────────────────────────────────────────────────────────────────────────────

type ResponsesInputPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "auto" | "low" | "high" | "original" }
  | { type: "input_file"; filename: string; file_data: string };

function attachmentToPart(a: Attachment): ResponsesInputPart {
  const base64 = a.bytes.toString("base64");
  if (a.kind === "image") {
    return {
      type: "input_image",
      image_url: `data:${a.mime};base64,${base64}`,
      // Avoid detail "high" — some gpt-4o Responses requests reject it (400).
      detail: "auto",
    };
  }
  return {
    type: "input_file",
    filename: a.fileName || "document.pdf",
    file_data: `data:${a.mime};base64,${base64}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON parsing helpers (lifted from lib/extract-statement-holdings.ts so other
// JSON-returning passes share the same robustness).
// ─────────────────────────────────────────────────────────────────────────────

function stripTrailingCommas(json: string): string {
  let prev = "";
  let out = json;
  for (let i = 0; i < 6 && out !== prev; i++) {
    prev = out;
    out = out.replace(/,(\s*[}\]])/g, "$1");
  }
  return out;
}

function extractJsonBlob(text: string): string {
  const trimmed = text.trim().replace(/^﻿/, "");
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = fence ? fence[1].trim() : trimmed;
  body = body.replace(/[“”]/g, '"');
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start >= 0 && end > start) body = body.slice(start, end + 1);
  return stripTrailingCommas(body);
}

function safeJsonParse<T>(text: string): T {
  const body = extractJsonBlob(text);
  return JSON.parse(body) as T;
}

/**
 * Attempt a JSON parse; return undefined on failure so callers can fall back
 * to `text` defensively. Used when `jsonSchema` is set on a CompletionRequest
 * — we still ask the model for JSON via `response_format`/`text.format`, but
 * we don't crash the route on a marginally malformed response.
 */
function tryJsonParse<T>(text: string): T | undefined {
  try {
    return safeJsonParse<T>(text);
  } catch {
    return undefined;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// complete()
// ─────────────────────────────────────────────────────────────────────────────

async function complete<T>(
  req: CompletionRequest,
  ctx: LlmContext
): Promise<CompletionResponse<T>> {
  const openai = getClient();

  // The `intake.turn` pass historically uses chat.completions, not Responses,
  // because that's where today's response_format:json_object call lives.
  // Keep that route identical until we decide to unify.
  if (ctx.pass === "intake.turn") {
    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    messages.push({ role: "user", content: req.user });

    const completion = await openai.chat.completions.create({
      model: ctx.model,
      messages,
      response_format: req.jsonSchema ? { type: "json_object" } : undefined,
      max_tokens: req.maxOutputTokens,
    });
    const text = completion.choices[0]?.message?.content ?? "";
    const json = req.jsonSchema ? tryJsonParse<T>(text) : undefined;
    return {
      text,
      json,
      raw: completion,
      usage: {
        inputTokens: completion.usage?.prompt_tokens,
        outputTokens: completion.usage?.completion_tokens,
      },
      context: ctx,
    };
  }

  // Everything else goes through Responses API.
  const inputContent: ResponsesInputPart[] = [];
  for (const a of req.attachments ?? []) inputContent.push(attachmentToPart(a));
  inputContent.push({ type: "input_text", text: req.user });

  const response = await openai.responses.create({
    model: ctx.model,
    instructions: req.system,
    input: [{ role: "user", content: inputContent }],
    max_output_tokens: req.maxOutputTokens,
    text: req.jsonSchema ? { format: { type: "json_object" } } : undefined,
  });

  const text = response.output_text ?? "";

  // Preserve today's "incomplete due to max_output_tokens" error behavior so
  // callers (extract-statement-holdings) keep getting the same exception.
  if ((response as { status?: string }).status === "incomplete") {
    const reason = (response as { incomplete_details?: { reason?: string } }).incomplete_details
      ?.reason;
    if (reason === "max_output_tokens") {
      throw new Error(
        "OpenAI extraction stopped early because the response size limit was reached. Try a smaller document, or raise the per-pass max output tokens."
      );
    }
  }

  if (!text) throw new Error("OpenAI returned an empty response.");

  const json = req.jsonSchema ? safeJsonParse<T>(text) : undefined;
  return {
    text,
    json,
    raw: response,
    usage: {
      inputTokens: (response as { usage?: { input_tokens?: number } }).usage?.input_tokens,
      outputTokens: (response as { usage?: { output_tokens?: number } }).usage?.output_tokens,
    },
    context: ctx,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// research()
// ─────────────────────────────────────────────────────────────────────────────

async function research<T>(
  req: ResearchRequest,
  ctx: LlmContext
): Promise<ResearchResult<T>> {
  const openai = getClient();

  // Today's code uses `web_search_preview` — preserve exactly until we migrate
  // to the new `web_search` tool. Adapter doesn't care which model is chosen.
  const tools: Array<Record<string, unknown>> = [{ type: "web_search_preview" }];

  // Domain filters and `max_tool_calls` were added to the new `web_search`
  // tool; legacy preview tool silently ignores them but they are forward-
  // compatible for when the env var picks the new tool name via model
  // selection. Pass them whenever the request specifies them.
  if (req.allowedDomains?.length || req.blockedDomains?.length) {
    (tools[0] as Record<string, unknown>).filters = {
      ...(req.allowedDomains?.length ? { allowed_domains: req.allowedDomains } : {}),
      ...(req.blockedDomains?.length ? { disallowed_domains: req.blockedDomains } : {}),
    };
  }

  const body: Record<string, unknown> = {
    model: ctx.model,
    input: req.system
      ? [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ]
      : req.user,
    tools,
    text: req.jsonSchema ? { format: { type: "json_object" } } : undefined,
    include: ["web_search_call.action.sources"],
  };
  if (typeof req.maxAgenticSteps === "number") body.max_tool_calls = req.maxAgenticSteps;
  if (req.tier === "deep-research") body.background = true;

  // openai-node's typed surface doesn't yet expose every Responses-API option
  // we use here (web_search_preview filters, include, background). Cast for
  // the create() call; the underlying HTTP shape is correct.
  const response = await (openai.responses as unknown as {
    create: (b: Record<string, unknown>) => Promise<unknown>;
  }).create(body);

  const r = response as {
    output_text?: string;
    id?: string;
    status?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = r.output_text ?? "";
  const citations = citationsFromOpenAiResponse(response);

  // Deep-research returns immediately with `background: true`. The caller is
  // responsible for polling. No route opts in v1, so we keep the plumbing
  // ready but don't exercise it here.
  const asyncHandle = req.tier === "deep-research" && r.id ? { id: r.id } : undefined;

  const json = req.jsonSchema && text ? tryJsonParse<T>(text) : undefined;

  return {
    text,
    json,
    citations,
    raw: response,
    usage: {
      inputTokens: r.usage?.input_tokens,
      outputTokens: r.usage?.output_tokens,
    },
    context: ctx,
    asyncHandle,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// tts()
// ─────────────────────────────────────────────────────────────────────────────

async function tts(req: TtsRequest, ctx: LlmContext): Promise<Buffer> {
  const openai = getClient();
  const format = req.format ?? "mp3";

  // gpt-4o-mini-tts supports an `instructions` field for natural tone; older
  // tts-1 models don't. Pass it only when present so we stay compatible.
  const params: Record<string, unknown> = {
    model: ctx.model,
    voice: req.voice ?? "sage",
    input: req.text,
    response_format: format,
  };
  if (req.instructions) params.instructions = req.instructions;

  const response = await (openai.audio.speech as unknown as {
    create: (p: Record<string, unknown>) => Promise<{ arrayBuffer: () => Promise<ArrayBuffer> }>;
  }).create(params);

  const arrayBuf = await response.arrayBuffer();
  return globalThis.Buffer.from(arrayBuf);
}

// ─────────────────────────────────────────────────────────────────────────────
// stt()
// ─────────────────────────────────────────────────────────────────────────────

async function stt(req: SttRequest, ctx: LlmContext): Promise<string> {
  const openai = getClient();
  // openai-node accepts a File-like object. Browser File polyfill is fine on
  // Node 18+ where it's globally available; otherwise use Buffer→Uint8Array
  // wrapped in a Blob-shaped object. The SDK detects both.
  const file = new File([new Uint8Array(req.audio)], `audio.${extensionFromMime(req.mime)}`, {
    type: req.mime,
  });
  const result = await openai.audio.transcriptions.create({
    model: ctx.model,
    file,
    language: req.language ?? "en",
  });
  return result.text;
}

function extensionFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mp3") || m.includes("mpeg")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("m4a") || m.includes("mp4")) return "m4a";
  return "bin";
}

// ─────────────────────────────────────────────────────────────────────────────
// Adapter export
// ─────────────────────────────────────────────────────────────────────────────

export const openaiAdapter: LlmAdapter = {
  id: "openai",
  complete,
  research,
  tts,
  stt,
};

// Suppress lint warning about unused — exported for future provider parity.
void LlmCapabilityError;

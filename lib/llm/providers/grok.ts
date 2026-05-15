/**
 * Grok (xAI) adapter.
 *
 * Uses the OpenAI Node SDK with `baseURL: https://api.x.ai/v1`. Both
 * `responses.create` and `chat.completions.create` are supported by xAI; this
 * adapter follows the same shape as the OpenAI adapter so the codepath is
 * almost identical.
 *
 * Key differences vs OpenAI:
 *   - PDFs must be rasterized to JPEG (xAI accepts JPG/PNG only).
 *   - HEIC/WEBP/GIF images must be transcoded to JPEG.
 *   - Web search lives under the Agent Tools API (Responses-only) with
 *     `max_turns` instead of `max_tool_calls`. The legacy chat.completions
 *     Live Search is deprecated.
 *   - Optional `x_search` tool for social-signal research (opt-in per advisor).
 *   - TTS/STT exist as xAI REST endpoints but use a different shape; v1
 *     falls back to OpenAI per the capability matrix.
 */

import OpenAI from "openai";
import { Buffer } from "buffer";
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
import { LlmConfigError } from "../types";
import { citationsFromGrokResponse } from "../normalize/citations-grok";
import { rasterizePdfToJpegs } from "../pdf-rasterize";
import { needsTranscodeForGrok, transcodeImage } from "../image-transcode";
import { openaiAdapter } from "./openai";

// ─────────────────────────────────────────────────────────────────────────────
// Client singleton (OpenAI SDK + baseURL swap)
// ─────────────────────────────────────────────────────────────────────────────

let _client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!process.env.XAI_API_KEY) {
    throw new LlmConfigError("Missing XAI_API_KEY in environment.");
  }
  if (_client) return _client;
  _client = new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: "https://api.x.ai/v1",
  });
  return _client;
}

// ─────────────────────────────────────────────────────────────────────────────
// Attachment normalization — PDFs become JPEG sequences; HEIC/WEBP transcode.
// ─────────────────────────────────────────────────────────────────────────────

interface GrokImagePart {
  type: "input_image";
  image_url: string;
  detail: "auto" | "low" | "high" | "original";
}

async function attachmentToGrokParts(a: Attachment): Promise<GrokImagePart[]> {
  if (a.kind === "image") {
    let bytes = a.bytes;
    let mime = a.mime;
    if (needsTranscodeForGrok(mime)) {
      const out = await transcodeImage(bytes);
      bytes = out.bytes;
      mime = out.mime;
    }
    return [
      {
        type: "input_image",
        image_url: `data:${mime};base64,${bytes.toString("base64")}`,
        detail: "auto",
      },
    ];
  }
  // PDF → rasterize to JPEGs (one part per page)
  const pages = await rasterizePdfToJpegs(a.bytes);
  return pages.map((p) => ({
    type: "input_image",
    image_url: `data:image/jpeg;base64,${p.jpeg.toString("base64")}`,
    detail: "auto",
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON parsing helpers
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
function tryJsonParse<T>(text: string): T | undefined {
  try {
    return JSON.parse(extractJsonBlob(text)) as T;
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
  const xai = getClient();

  // Intake.turn historically uses chat.completions for JSON object mode;
  // mirror that shape on Grok for parity.
  if (ctx.pass === "intake.turn") {
    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    messages.push({ role: "user", content: req.user });
    const completion = await xai.chat.completions.create({
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

  // All other passes → Responses API with rasterized/transcoded attachments.
  type AnyPart = GrokImagePart | { type: "input_text"; text: string };
  const inputContent: AnyPart[] = [];
  for (const a of req.attachments ?? []) {
    const parts = await attachmentToGrokParts(a);
    inputContent.push(...parts);
  }
  inputContent.push({ type: "input_text", text: req.user });

  const body: Record<string, unknown> = {
    model: ctx.model,
    instructions: req.system,
    input: [{ role: "user", content: inputContent }],
    max_output_tokens: req.maxOutputTokens,
    text: req.jsonSchema ? { format: { type: "json_object" } } : undefined,
  };
  if (req.reasoningEffort) body.reasoning = { effort: req.reasoningEffort };

  const response = await (xai.responses as unknown as {
    create: (b: Record<string, unknown>) => Promise<unknown>;
  }).create(body);
  const r = response as {
    output_text?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = r.output_text ?? "";
  const json = req.jsonSchema && text ? tryJsonParse<T>(text) : undefined;

  if (!text) throw new Error("Grok returned an empty response.");

  return {
    text,
    json,
    raw: response,
    usage: {
      inputTokens: r.usage?.input_tokens,
      outputTokens: r.usage?.output_tokens,
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
  const xai = getClient();

  // Agent Tools API — Responses only. allowed_domains cap = 5 per docs.x.ai.
  const webSearch: Record<string, unknown> = { type: "web_search" };
  if (req.allowedDomains?.length) {
    webSearch.allowed_domains = req.allowedDomains.slice(0, 5);
  } else if (req.blockedDomains?.length) {
    webSearch.excluded_domains = req.blockedDomains.slice(0, 5);
  }
  const tools: Array<Record<string, unknown>> = [webSearch];
  if (req.includeSocialSignals) tools.push({ type: "x_search" });

  const body: Record<string, unknown> = {
    model: ctx.model,
    instructions: req.system,
    input: req.user,
    tools,
    text: req.jsonSchema ? { format: { type: "json_object" } } : undefined,
  };
  if (typeof req.maxAgenticSteps === "number") body.max_turns = req.maxAgenticSteps;

  const response = await (xai.responses as unknown as {
    create: (b: Record<string, unknown>) => Promise<unknown>;
  }).create(body);
  const r = response as {
    output_text?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = r.output_text ?? "";
  const citations = citationsFromGrokResponse(response);
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
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// tts() / stt() — fall back to OpenAI in v1 (per capability matrix)
// ─────────────────────────────────────────────────────────────────────────────

function tts(req: TtsRequest, ctx: LlmContext): Promise<Buffer> {
  return openaiAdapter.tts(req, ctx);
}
function stt(req: SttRequest, ctx: LlmContext): Promise<string> {
  return openaiAdapter.stt(req, ctx);
}

export const grokAdapter: LlmAdapter = {
  id: "grok",
  complete,
  research,
  tts,
  stt,
};

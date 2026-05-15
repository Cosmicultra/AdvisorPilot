/**
 * Gemini adapter (@google/genai).
 *
 * Supports complete (extraction, intake.turn, synthesis.json) and research
 * (fast-grounded, agentic — both via `googleSearch` + optional `urlContext`).
 *
 * In v1:
 *   - TTS/STT fall back to OpenAI per the capability matrix.
 *   - deep-research is wired via the Interactions API but not actively
 *     exercised by any route — the registry would route there if an
 *     advisor chose Gemini + deep tier on a future Phase 5 UI.
 *
 * Notes per docs/multi-provider-llm-plan.md §2:
 *   - System instructions live in `systemInstruction`, not as a role:system
 *     message. Roles in `contents` are `user` / `model`.
 *   - PDFs and images pass through `inlineData`; HEIC native.
 *   - JSON output via `responseMimeType: "application/json"` (Gemini's
 *     schema is non-strict; we accept best-effort and never throw on
 *     parse failure — the route can fall through to text).
 *   - Citations come from `groundingMetadata`, no inline annotations.
 *   - `searchSuggestionsHtml` (ToS-required widget) is surfaced separately.
 */

import { GoogleGenAI } from "@google/genai";
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
import { citationsFromGeminiCandidate } from "../normalize/citations-gemini";
import { openaiAdapter } from "./openai";

// ─────────────────────────────────────────────────────────────────────────────
// Client singleton
// ─────────────────────────────────────────────────────────────────────────────

let _client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new LlmConfigError("Missing GEMINI_API_KEY in environment.");
  }
  if (_client) return _client;
  _client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return _client;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

function attachmentToPart(a: Attachment): GeminiPart {
  return {
    inlineData: {
      mimeType: a.mime,
      data: a.bytes.toString("base64"),
    },
  };
}

function mediaResolution(): string | undefined {
  return process.env.LLM_GEMINI_VISION_RESOLUTION?.trim() || undefined;
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
  groundingMetadata?: unknown;
  urlContextMetadata?: unknown;
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
  };
  text?: string;
}

function extractText(resp: GeminiResponse): string {
  if (typeof resp.text === "string" && resp.text) return resp.text;
  const parts = resp.candidates?.[0]?.content?.parts ?? [];
  return parts.map((p) => p.text ?? "").join("");
}

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
function tryParseJson<T>(text: string): T | undefined {
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
  const client = getClient();

  const parts: GeminiPart[] = [];
  for (const a of req.attachments ?? []) parts.push(attachmentToPart(a));
  parts.push({ text: req.user });

  // Gemini-3 supports combining structured JSON + tools in a single call;
  // earlier generations don't. We only set responseMimeType when a schema is
  // requested.
  const config: Record<string, unknown> = {};
  if (req.system) config.systemInstruction = { parts: [{ text: req.system }] };
  if (req.jsonSchema) config.responseMimeType = "application/json";
  if (req.maxOutputTokens) config.maxOutputTokens = req.maxOutputTokens;
  const mr = mediaResolution();
  if (mr) config.mediaResolution = mr;

  const response = (await client.models.generateContent({
    model: ctx.model,
    contents: [{ role: "user", parts }],
    config,
    // openai-style fallthrough property accepted by the SDK
  } as unknown as Parameters<typeof client.models.generateContent>[0])) as unknown as GeminiResponse;

  const text = extractText(response);
  const json = req.jsonSchema && text ? tryParseJson<T>(text) : undefined;

  return {
    text,
    json,
    raw: response,
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount,
      cachedInputTokens: response.usageMetadata?.cachedContentTokenCount,
      outputTokens: response.usageMetadata?.candidatesTokenCount,
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
  const client = getClient();

  // Domain whitelist hint goes in the prompt — Gemini's google_search tool
  // doesn't expose `allowed_domains` like OpenAI/Grok.
  const domainHint =
    req.allowedDomains?.length
      ? `\n\nPrefer sources from: ${req.allowedDomains.join(", ")}.`
      : "";
  const urlsHint =
    req.knownUrls?.length
      ? `\n\nAlso read these URLs in depth if relevant: ${req.knownUrls.slice(0, 20).join(", ")}.`
      : "";

  const parts: GeminiPart[] = [{ text: `${req.user}${domainHint}${urlsHint}` }];

  const tools: Array<Record<string, unknown>> = [{ googleSearch: {} }];
  if (req.knownUrls?.length) tools.push({ urlContext: {} });

  const config: Record<string, unknown> = { tools };
  if (req.system) config.systemInstruction = { parts: [{ text: req.system }] };
  if (req.jsonSchema) config.responseMimeType = "application/json";

  const response = (await client.models.generateContent({
    model: ctx.model,
    contents: [{ role: "user", parts }],
    config,
  } as unknown as Parameters<typeof client.models.generateContent>[0])) as unknown as GeminiResponse;

  const text = extractText(response);
  const candidate = response.candidates?.[0];
  const { citations, searchSuggestionsHtml } = citationsFromGeminiCandidate(candidate);
  const json = req.jsonSchema && text ? tryParseJson<T>(text) : undefined;

  return {
    text,
    json,
    citations,
    searchSuggestionsHtml,
    raw: response,
    usage: {
      inputTokens: response.usageMetadata?.promptTokenCount,
      cachedInputTokens: response.usageMetadata?.cachedContentTokenCount,
      outputTokens: response.usageMetadata?.candidatesTokenCount,
    },
    context: ctx,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// tts() / stt() — fall back to OpenAI in v1 (per capabilities matrix)
// ─────────────────────────────────────────────────────────────────────────────

function tts(req: TtsRequest, ctx: LlmContext): Promise<Buffer> {
  return openaiAdapter.tts(req, ctx);
}
function stt(req: SttRequest, ctx: LlmContext): Promise<string> {
  return openaiAdapter.stt(req, ctx);
}

export const geminiAdapter: LlmAdapter = {
  id: "gemini",
  complete,
  research,
  tts,
  stt,
};

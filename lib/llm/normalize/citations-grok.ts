/**
 * Normalize Grok / xAI citations.
 *
 * Grok 4.3 on the Responses API emits two citation channels (per docs.x.ai):
 *
 *   1. A flat `citations` array on the response, populated for every URL
 *      the agent visited during web_search / x_search.
 *   2. Inline annotations on text parts, `type: "url_citation"` with
 *      `start_index`/`end_index`. xAI also supports x_citation for tweets.
 *
 * The OpenAI normalizer handles channel 2 already; we extend by walking the
 * flat citations array if present (xAI-specific surface that OpenAI's SDK
 * doesn't expose by default).
 */

import type { Citation } from "../types";
import { citationsFromOpenAiResponse } from "./citations-openai";

interface RawGrokFlatCitation {
  type?: string;
  url?: string;
  title?: string;
}
interface RawGrokResponse {
  citations?: Array<string | RawGrokFlatCitation>;
}

export function citationsFromGrokResponse(response: unknown): Citation[] {
  // Start with anything the OpenAI normalizer can find (inline annotations,
  // web_search_call.action.sources).
  const inline = citationsFromOpenAiResponse(response);

  // Then layer in Grok's flat `citations` array — may contain plain strings
  // or `{ type, url, title }` objects.
  const seen = new Set(inline.map((c) => c.uri));
  if (response && typeof response === "object") {
    const flat = (response as RawGrokResponse).citations;
    if (Array.isArray(flat)) {
      for (const entry of flat) {
        const uri = typeof entry === "string" ? entry : entry.url;
        const title = typeof entry === "object" ? entry.title : undefined;
        const type = typeof entry === "object" ? entry.type : undefined;
        if (!uri || seen.has(uri)) continue;
        seen.add(uri);
        inline.push({
          uri,
          title,
          sourceType: type === "x_citation" ? "x" : "web",
        });
      }
    }
  }

  return inline;
}

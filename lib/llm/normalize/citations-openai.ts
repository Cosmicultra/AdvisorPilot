/**
 * Normalize OpenAI Responses API citations into our cross-provider `Citation[]`.
 *
 * Annotations live on the `output_text` content parts inside `response.output`.
 * Two annotation shapes appear in practice:
 *
 * - `web_search_preview` (legacy, used today): may or may not surface annotations
 *   inline. When it does, the type is `"url_citation"` and fields are
 *   `{ url, title, start_index, end_index }`.
 * - `web_search` (current, post-migration): always emits `url_citation`. When
 *   `include: ["web_search_call.action.sources"]` is set, a complete source list
 *   also lives at `response.output[i]` items of type `web_search_call`.
 *
 * This normalizer handles both; absent annotations return an empty array.
 */

import type { Citation } from "../types";

interface RawAnnotation {
  type?: string;
  url?: string;
  title?: string;
  start_index?: number;
  end_index?: number;
}

interface RawOutputItem {
  type?: string;
  content?: Array<{
    type?: string;
    text?: string;
    annotations?: RawAnnotation[];
  }>;
  // web_search_call shape:
  action?: {
    type?: string;
    sources?: Array<{ url?: string; title?: string }>;
  };
}

interface RawResponse {
  output?: RawOutputItem[];
}

export function citationsFromOpenAiResponse(response: unknown): Citation[] {
  const out: Citation[] = [];
  if (!response || typeof response !== "object") return out;
  const r = response as RawResponse;
  if (!Array.isArray(r.output)) return out;

  for (const item of r.output) {
    // Inline annotations on text parts
    if (Array.isArray(item.content)) {
      for (const part of item.content) {
        if (Array.isArray(part.annotations)) {
          for (const a of part.annotations) {
            if (a.type === "url_citation" && typeof a.url === "string") {
              out.push({
                uri: a.url,
                title: a.title,
                startIndex: typeof a.start_index === "number" ? a.start_index : undefined,
                endIndex: typeof a.end_index === "number" ? a.end_index : undefined,
                sourceType: "web",
              });
            }
          }
        }
      }
    }
    // Full source list (web_search_call.action.sources)
    if (item.type === "web_search_call" && item.action?.sources?.length) {
      for (const src of item.action.sources) {
        if (typeof src.url === "string") {
          out.push({
            uri: src.url,
            title: src.title,
            sourceType: "web",
          });
        }
      }
    }
  }

  // Deduplicate by uri (preserve first occurrence's metadata).
  const seen = new Set<string>();
  return out.filter((c) => {
    if (seen.has(c.uri)) return false;
    seen.add(c.uri);
    return true;
  });
}

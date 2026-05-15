/**
 * Normalize Gemini `groundingMetadata` into our cross-provider `Citation[]`.
 *
 * Shape (from @google/genai):
 *   candidate.groundingMetadata.{
 *     groundingChunks?: [{ web?: { uri?, title?, domain? }, ... }],
 *     groundingSupports?: [{
 *       groundingChunkIndices?: number[],
 *       segment?: { startIndex?, endIndex?, text? },
 *     }],
 *     webSearchQueries?: string[],
 *     searchEntryPoint?: { renderedContent?: string },  // ToS-required widget
 *   }
 *   candidate.urlContextMetadata.urlMetadata?: [{ retrievedUrl?, urlRetrievalStatus? }]
 *
 * Gemini does NOT return snippet text — only URI + title + segment offsets.
 */

import type { Citation } from "../types";

interface RawGroundingChunkWeb {
  uri?: string;
  title?: string;
  domain?: string;
}
interface RawGroundingChunk {
  web?: RawGroundingChunkWeb;
}
interface RawSegment {
  startIndex?: number;
  endIndex?: number;
  text?: string;
}
interface RawGroundingSupport {
  groundingChunkIndices?: number[];
  segment?: RawSegment;
}
interface RawGroundingMetadata {
  groundingChunks?: RawGroundingChunk[];
  groundingSupports?: RawGroundingSupport[];
  searchEntryPoint?: { renderedContent?: string };
  webSearchQueries?: string[];
}
interface RawUrlMetadata {
  retrievedUrl?: string;
  urlRetrievalStatus?: string;
}
interface RawUrlContextMetadata {
  urlMetadata?: RawUrlMetadata[];
}
interface RawCandidate {
  groundingMetadata?: RawGroundingMetadata;
  urlContextMetadata?: RawUrlContextMetadata;
}

export interface GeminiCitationsResult {
  citations: Citation[];
  searchSuggestionsHtml?: string;
}

export function citationsFromGeminiCandidate(candidate: unknown): GeminiCitationsResult {
  const out: Citation[] = [];
  let searchSuggestionsHtml: string | undefined;

  if (!candidate || typeof candidate !== "object") return { citations: out };
  const c = candidate as RawCandidate;

  const gm = c.groundingMetadata;
  const supportsByChunk = new Map<number, RawSegment[]>();
  if (gm?.groundingSupports?.length) {
    for (const s of gm.groundingSupports) {
      if (!s.segment) continue;
      for (const idx of s.groundingChunkIndices ?? []) {
        const arr = supportsByChunk.get(idx) ?? [];
        arr.push(s.segment);
        supportsByChunk.set(idx, arr);
      }
    }
  }

  if (gm?.groundingChunks?.length) {
    gm.groundingChunks.forEach((chunk, idx) => {
      const uri = chunk.web?.uri;
      if (!uri) return;
      const supports = supportsByChunk.get(idx) ?? [];
      const firstSupport = supports[0];
      out.push({
        uri,
        title: chunk.web?.title,
        chunkIndex: idx,
        startIndex: firstSupport?.startIndex,
        endIndex: firstSupport?.endIndex,
        sourceType: "web",
      });
    });
  }

  // url_context fetches → add as separate citations marked sourceType:"web".
  // De-duplicate by URI vs grounding chunks above.
  const seen = new Set(out.map((c0) => c0.uri));
  if (c.urlContextMetadata?.urlMetadata?.length) {
    for (const m of c.urlContextMetadata.urlMetadata) {
      const uri = m.retrievedUrl;
      if (uri && !seen.has(uri)) {
        out.push({ uri, sourceType: "web" });
        seen.add(uri);
      }
    }
  }

  if (gm?.searchEntryPoint?.renderedContent) {
    searchSuggestionsHtml = gm.searchEntryPoint.renderedContent;
  }

  return { citations: out, searchSuggestionsHtml };
}

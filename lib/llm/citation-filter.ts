/**
 * Restrict a model's claimed `sourceUrls` to the URLs that actually appeared
 * in the research pass's citation list. Fixes the historical bug where the
 * JSON pass would invent URLs from training-data memory when the research
 * pass had been told not to cite (see
 * docs/multi-provider-llm-plan.md §1 finding 2).
 */

import type { Citation } from "./types";

/**
 * Conservative URL normalization for set-membership comparison:
 * lowercase host, strip trailing slash, drop fragment. Preserves
 * query strings (they often disambiguate factsheet vs prospectus URLs).
 */
export function normalizeUrlForCompare(u: string): string {
  try {
    const parsed = new URL(u.trim());
    parsed.hash = "";
    let pathname = parsed.pathname.replace(/\/+$/, "");
    if (!pathname) pathname = "/";
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${pathname}${parsed.search}`;
  } catch {
    return u.trim().toLowerCase();
  }
}

export interface CitationFilterResult {
  kept: string[];
  dropped: string[];
}

export function filterUrlsToCitations(
  proposedUrls: string[],
  citations: Citation[]
): CitationFilterResult {
  if (citations.length === 0) {
    return { kept: [], dropped: [...proposedUrls] };
  }
  const allowed = new Set(citations.map((c) => normalizeUrlForCompare(c.uri)));
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const u of proposedUrls) {
    if (allowed.has(normalizeUrlForCompare(u))) kept.push(u);
    else dropped.push(u);
  }
  return { kept, dropped };
}

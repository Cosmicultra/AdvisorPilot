import { advisorFetch } from "@/lib/advisor-fetch";
import { flagLikelyDuplicateHoldings } from "@/lib/holding-merge";
import { validateHoldingLocally } from "@/lib/holding-validation";
import type { IntakeClient } from "@/lib/intake-config";
import {
  accountRefreshNeedsConfirmation,
  buildAutoResolutions,
  buildInitialResolutions,
  matchExtractedAccountsToExisting,
  mergeAccountRefresh,
  type AccountMatchResult,
  type AccountRefreshResolution,
  type MatchExtractedOptions,
} from "@/lib/crm/merge-account-holdings";
import {
  normalizeHoldingsForUi,
  type UiHolding,
} from "@/lib/saved-review-normalize";

export type StatementExtractInput = {
  files: File[];
  pageHints: string[];
  intakeClient: IntakeClient;
  demoMode?: boolean;
};

export type AccountRefreshMergePlan = {
  needsConfirmation: boolean;
  matchResults: AccountMatchResult[];
  initialResolutions: AccountRefreshResolution[];
  autoResolutions: AccountRefreshResolution[];
  mergedHoldings: UiHolding[] | null;
};

/** Normalize, validate, and flag duplicates on raw API extraction rows. */
export function postProcessExtractedHoldings(raw: unknown[]): UiHolding[] {
  const normalized = normalizeHoldingsForUi(raw).map((h) => ({
    ...h,
    ...validateHoldingLocally(h),
  }));
  return flagLikelyDuplicateHoldings(normalized);
}

/**
 * POST /api/analyze-statement for queued files. Throws on failure or empty extraction.
 */
export async function runStatementExtract(
  input: StatementExtractInput
): Promise<UiHolding[]> {
  if (input.files.length === 0) {
    throw new Error("Please upload at least one PDF, screenshot, or photo first.");
  }

  const formData = new FormData();
  for (const file of input.files) {
    formData.append("files", file);
  }
  formData.append("filePageHints", JSON.stringify(input.pageHints));
  formData.append("client", JSON.stringify(input.intakeClient));
  formData.append("demoMode", input.demoMode ? "true" : "false");

  const response = await advisorFetch("/api/analyze-statement", {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(
      (errorData as { error?: string } | null)?.error || "Statement analysis failed."
    );
  }

  const data = (await response.json()) as { holdings?: unknown[] };
  const extracted = Array.isArray(data.holdings) ? data.holdings : [];
  if (extracted.length === 0) {
    throw new Error(
      "No holdings were extracted from the statement. Try a clearer image or PDF."
    );
  }

  return postProcessExtractedHoldings(extracted);
}

/**
 * Plan account-refresh merge after extraction. When confirmation is not required,
 * `mergedHoldings` is populated immediately.
 */
export function planAccountRefreshMerge(
  priorHoldings: UiHolding[],
  extractedHoldings: UiHolding[],
  options: MatchExtractedOptions = {}
): AccountRefreshMergePlan {
  const matchResults = matchExtractedAccountsToExisting(
    extractedHoldings,
    priorHoldings,
    options
  );
  const needsConfirmation = accountRefreshNeedsConfirmation(matchResults);
  const autoResolutions = buildAutoResolutions(matchResults);
  const initialResolutions = buildInitialResolutions(matchResults, {
    ...options,
    existingHoldings: priorHoldings,
  });

  return {
    needsConfirmation,
    matchResults,
    initialResolutions,
    autoResolutions,
    mergedHoldings: needsConfirmation
      ? null
      : mergeAccountRefresh(priorHoldings, extractedHoldings, autoResolutions),
  };
}

/** Apply advisor-confirmed resolutions and return merged holdings. */
export function applyAccountRefreshResolutions(
  priorHoldings: UiHolding[],
  extractedHoldings: UiHolding[],
  resolutions: AccountRefreshResolution[]
): UiHolding[] {
  return mergeAccountRefresh(priorHoldings, extractedHoldings, resolutions);
}

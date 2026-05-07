export type HoldingValidationStatus = "validated" | "needs_review" | "unverified";

export type HoldingValidationMetadata = {
  provider: "local-heuristic";
  reason: string;
  validatedAt: string;
};

export type HoldingValidationResult = {
  normalizedSymbol: string;
  normalizedCusip: string;
  validationStatus: HoldingValidationStatus;
  validationMetadata: HoldingValidationMetadata;
};

const CUSIP_RE = /\b[0-9A-Z]{9}\b/;
const TICKER_RE = /\b[A-Z]{1,5}\b/;

function cleanToken(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

export function extractLikelyCusip(...values: unknown[]) {
  for (const value of values) {
    const match = cleanToken(value).match(CUSIP_RE);
    if (match) return match[0];
  }
  return "";
}

export function extractLikelySymbol(...values: unknown[]) {
  for (const value of values) {
    const text = cleanToken(value);
    if (/NEEDS\s+ADVISOR|MANUAL\s+TICKER|CASH\s+EQUIVALENT/.test(text)) continue;
    const firstDelimited = text.match(/^([A-Z]{1,5})(?:\s+|[.-])/);
    if (firstDelimited) return firstDelimited[1];
    const paren = text.match(/\(([A-Z]{1,5})\)/);
    if (paren) return paren[1];
    const generic = text.match(TICKER_RE);
    if (generic) return generic[0];
  }
  return "";
}

export function validateHoldingLocally(holding: {
  rawName?: unknown;
  suggested?: unknown;
  confidence?: unknown;
  status?: unknown;
  assetClass?: unknown;
}): HoldingValidationResult {
  const normalizedCusip = extractLikelyCusip(holding.suggested, holding.rawName);
  const normalizedSymbol = normalizedCusip ? "" : extractLikelySymbol(holding.suggested, holding.rawName);
  const confidence = Number(holding.confidence || 0);
  const status = String(holding.status || "").toLowerCase();
  const assetClass = String(holding.assetClass || "").toLowerCase();

  let validationStatus: HoldingValidationStatus = "unverified";
  let reason = "No ticker or CUSIP could be inferred locally.";

  if (normalizedCusip) {
    validationStatus = confidence >= 75 && status !== "review" ? "validated" : "needs_review";
    reason = "A CUSIP-like identifier was found; advisor should confirm issuer and maturity.";
  } else if (normalizedSymbol) {
    validationStatus = confidence >= 75 && status !== "review" ? "validated" : "needs_review";
    reason = "A ticker-like symbol was inferred from the selected holding label.";
  } else if (assetClass.includes("cash")) {
    validationStatus = "validated";
    reason = "Cash or money-market position does not require a market ticker for this workflow.";
  }

  return {
    normalizedSymbol,
    normalizedCusip,
    validationStatus,
    validationMetadata: {
      provider: "local-heuristic",
      reason,
      validatedAt: new Date().toISOString(),
    },
  };
}

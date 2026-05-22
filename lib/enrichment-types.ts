export type EnrichmentInputHolding = {
  rawName: string;
  suggested: string;
  assetClass: string;
  value: number;
  confidence: number;
  status: string;
  options: string[];
  annuityContract?: unknown;
  documentKind?: string;
};

export type EnrichmentPatch = {
  enrichmentCompletedAt: string;
  enrichmentResolvedTicker: string;
  enrichmentResolvedName: string;
  enrichmentShareClass: string;
  enrichmentMappedAssetClass: string;
  enrichmentSourceUrls: string[];
  enrichmentFigi: string;
  enrichmentFigiSecurityType: string;
  enrichmentFigiSkippedReason: string;
  enrichmentConfidence: number;
  enrichmentIsProprietaryOrThinData: boolean;
  enrichmentNeedsReview: boolean;
  enrichmentNotes: string;
  suggested: string;
  assetClass: string;
  confidence: number;
  status: string;
};

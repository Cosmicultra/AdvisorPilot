export const RISK_PROFILES = [
  "conservative",
  "moderate-conservative",
  "moderate",
  "moderate-growth",
  "aggressive",
] as const;

export type RiskProfileId = (typeof RISK_PROFILES)[number];

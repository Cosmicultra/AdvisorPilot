/**
 * Align extraction model status with confidence so stricter signals win.
 */

export function deriveHoldingStatus(modelStatus: unknown, confidence: number): string {
  const conf = Number.isFinite(Number(confidence)) ? Number(confidence) : 0;
  const ms = String(modelStatus ?? "").trim().toLowerCase();

  if (ms === "review") return "review";
  if (conf < 75) return "review";
  if (ms === "confirmed") return "confirmed";
  if (ms === "matched") return "matched";

  return conf >= 75 ? "matched" : "review";
}

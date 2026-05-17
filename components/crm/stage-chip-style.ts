/**
 * Stage chip color tokens — shared between the Roster row and the Profile
 * header so the chip looks identical in both places.
 *
 * Tokens come from docs/crm/00-fundamentals.md §6 (status tones). The
 * neutral fallback for "Stable" matches the design's pilot-light bg
 * with navy text.
 */

import type { CSSProperties } from "react";
import type { ClientStage } from "@/lib/crm/types";

/** Returns inline styles for a stage chip given the stage value. */
export function stageChipStyle(stage: ClientStage): CSSProperties {
  switch (stage) {
    case "Review due":
    case "At risk":
      return { backgroundColor: "#FDECEC", color: "#9B1C1C" };
    case "Upcoming":
      return { backgroundColor: "#FFF5E6", color: "#92400E" };
    case "Onboarding":
      return { backgroundColor: "#E6F4EE", color: "#065F46" };
    case "Prospect":
      return { backgroundColor: "var(--ap-pilot-light)", color: "var(--ap-navy)" };
    case "Stable":
    default:
      return {
        backgroundColor: "rgba(12, 25, 41, 0.04)",
        color: "var(--ap-gray)",
      };
  }
}

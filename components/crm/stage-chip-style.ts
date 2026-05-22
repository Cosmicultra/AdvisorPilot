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

/** Text color for lifecycle stages (dropdown + chips). */
export function stageTextColor(stage: ClientStage): string {
  switch (stage) {
    case "Engaged":
      return "#15803D";
    case "Onboarding":
      return "#B45309";
    case "Lead":
    case "Prospect":
      return "var(--ap-royal)";
    default:
      return "var(--ap-gray)";
  }
}

/** Returns inline styles for a stage chip given the stage value. */
export function stageChipStyle(stage: ClientStage): CSSProperties {
  switch (stage) {
    case "Lead":
    case "Prospect":
      return {
        backgroundColor: "rgba(15, 111, 222, 0.1)",
        color: stageTextColor(stage),
      };
    case "Onboarding":
      return { backgroundColor: "#FFF5E6", color: stageTextColor(stage) };
    case "Engaged":
      return { backgroundColor: "#E6F4EE", color: stageTextColor(stage) };
    case "Review due":
    case "At risk":
      return { backgroundColor: "#FDECEC", color: "#9B1C1C" };
    case "Upcoming":
      return { backgroundColor: "#FFF5E6", color: "#92400E" };
    case "Stable":
    default:
      return {
        backgroundColor: "rgba(12, 25, 41, 0.04)",
        color: "var(--ap-gray)",
      };
  }
}

/**
 * Chat tool registry.
 *
 * Adding a new tool = pushing an entry into `CHAT_TOOL_REGISTRY` below. The
 * runner picks up the new tool automatically; no other edits needed.
 *
 * Ordering matters slightly — `chatToolDefinitionsFromRegistry()` preserves
 * insertion order when handing the definitions array to the model. Put the
 * most-commonly-useful tools first so a model with truncated context still
 * sees them.
 */

import type { ChatToolDefinition } from "../types";
import type { ChatTool, ChatToolRegistry } from "./types";
import { computeTool } from "./compute";
import { generateReportContentTool } from "./generate-report-content";
import { manageClientTool } from "./manage-client";
import { manageNoteTool } from "./manage-note";
import { manageReportTool } from "./manage-report";
import { manageTaskTool } from "./manage-task";
import { queryCrmTool } from "./query-crm";
import { runAnalysisTool } from "./run-analysis";
import { runDeepResearchTool } from "./run-deep-research";
import { runEnrichHoldingsTool } from "./run-enrich-holdings";
import { runFeeAnalysisTool } from "./run-fee-analysis";

/**
 * Active tool set:
 *   PR 4   — query_crm (read)
 *   PR 4b  — + path op on query_crm
 *   PR 4c  — + aggregate / search ops on query_crm
 *   PR 4d  — + documents / research_jobs / advisor_profile list entities
 *   PR 5   — + manage_note / manage_task / manage_client (writes, T2/T3/T4)
 *   PR 6   — + compute (derived projections — allocation / holdings / accounts)
 *   PR 7   — + run_analysis / run_fee_analysis / run_enrich_holdings / run_deep_research
 *   PR 8   — + list:reports / get:reports on query_crm + manage_report
 *   PR 10  — + generate_report_content (markdown author w/ embedded charts)
 *
 * Order matters for prompt truncation: put the most-used tools first so
 * even a heavily truncated context still sees them. `query_crm` and
 * `compute` lead because they're called on most turns. Writes come next
 * because the advisor often pivots from reading to acting in the same
 * session. `manage_report` + `generate_report_content` sit adjacent so
 * the model sees both report-related tools together. `run_*` tools last
 * because they're heavyweight and rarer.
 */
const ENTRIES: ChatTool[] = [
  queryCrmTool,
  computeTool,
  manageNoteTool,
  manageTaskTool,
  manageClientTool,
  manageReportTool,
  generateReportContentTool,
  runAnalysisTool,
  runFeeAnalysisTool,
  runEnrichHoldingsTool,
  runDeepResearchTool,
];

export const CHAT_TOOL_REGISTRY: ChatToolRegistry = new Map(
  ENTRIES.map((t) => [t.name, t]),
);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive the JSON-Schema definitions array from a registry. Used by the
 * chat runner to populate `ChatStreamParams.tools` for the model each turn.
 *
 * Strips the `handler` field — the model never sees the executor; only
 * the runner does, and it dispatches by name from the same registry.
 */
export function chatToolDefinitionsFromRegistry(
  registry: ChatToolRegistry,
): ChatToolDefinition[] {
  const defs: ChatToolDefinition[] = [];
  for (const tool of registry.values()) {
    defs.push({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    });
  }
  return defs;
}

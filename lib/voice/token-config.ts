/**
 * Build the constrained Live API configuration for a session — used by
 * `/api/voice/token` when minting ephemeral tokens, and re-exported here so
 * the voice agent's frontend hook can reference the same tool surface
 * (defensive: the constraints are pinned server-side and the browser cannot
 * widen them).
 */

import type { VoiceSettings } from "./settings";

// Tool parameter shape follows Athena's convention: `type: "OBJECT"` /
// `"STRING"` uppercase for Gemini schema, and `enum` is preserved verbatim
// because Gemini's function-calling docs note it materially improves
// accuracy on fixed-value params.
export const VOICE_NAV_TOOLS: Array<Record<string, unknown>> = [
  {
    functionDeclarations: [
      {
        name: "get_context",
        description:
          "Snapshot what the advisor sees right now (active step, intake substep, active client, focus.description, last action). Always call this before answering 'where am I?' / 'what's this?'.",
        parameters: { type: "OBJECT", properties: {} },
      },
      {
        name: "navigate",
        description:
          "Switch the active top-level screen in the advisor product. Map advisor phrases as follows:\n  - 'client database' / 'my clients' / 'client list' / 'saved clients' / 'show all clients' → step='saved'\n  - 'intake' / 'new client questions' → step='intake'\n  - 'upload' / 'statement upload' / 'attach a statement' → step='upload'\n  - 'confirm holdings' / 'review holdings' → step='confirm'\n  - 'analysis' / 'portfolio review' / 'scores' → step='analysis'\n  - 'meeting guide' / 'meeting prep' / 'talking points page' → step='meeting'\n  - 'FIA' / 'annuity calculator' → step='fia'\n  - 'Roth' / 'Roth conversion' → step='roth'\n  - 'retirement income' / 'projection' → step='retIncome'\n  - 'report' / 'PDF report' → step='report'",
        parameters: {
          type: "OBJECT",
          properties: {
            step: {
              type: "STRING",
              description: "The destination screen.",
              enum: [
                "intake",
                "upload",
                "confirm",
                "analysis",
                "meeting",
                "fia",
                "roth",
                "retIncome",
                "report",
                "saved",
              ],
            },
          },
          required: ["step"],
        },
      },
      {
        name: "navigate_intake_step",
        description:
          "Within the intake step, jump to a specific question by zero-based index (0..9).",
        parameters: {
          type: "OBJECT",
          properties: {
            index: { type: "INTEGER", description: "Zero-based intake step index, 0..9." },
          },
          required: ["index"],
        },
      },
      {
        name: "open_client",
        description:
          "OPEN a specific saved client. Use this when the advisor says 'open <name>', 'pull up <name>', 'show me <name>', 'go to <name>'. Loads the client and navigates to their analysis screen. If multiple clients match the name, the tool returns the matches and you should disambiguate aloud ('Robert Garcia or Maria Garcia?').",
        parameters: {
          type: "OBJECT",
          properties: { name: { type: "STRING", description: "Client name or partial name." } },
          required: ["name"],
        },
      },
      {
        name: "start_new_client",
        description:
          "Reset the workflow and go to intake step 0. Confirm aloud first when unsaved changes are present.",
        parameters: { type: "OBJECT", properties: {} },
      },
      {
        name: "search_clients",
        description:
          "SEARCH THE CLIENT DATABASE. Returns up to 25 saved clients matching the given filters. Use this whenever the advisor wants to find, list, search, look up, or filter their client list — e.g. 'show me my clients', 'find John', 'who haven't I contacted in 90 days', 'who's conservative and over 65', 'who has portfolios over $1M with red flags', 'who's at risk'. Use `search` for name match; combine other filters freely. With NO filters it returns the full list of saved clients (the entire client database).",
        parameters: {
          type: "OBJECT",
          properties: {
            search: { type: "STRING", description: "Substring match on first or last name." },
            riskProfile: { type: "STRING", description: "Exact risk profile tier (e.g. 'Conservative')." },
            minAge: { type: "INTEGER", description: "Inclusive minimum age." },
            maxAge: { type: "INTEGER", description: "Inclusive maximum age." },
            minTotalValue: { type: "NUMBER", description: "Inclusive minimum portfolio value (USD)." },
            maxTotalValue: { type: "NUMBER", description: "Inclusive maximum portfolio value (USD)." },
            staleDays: { type: "INTEGER", description: "Minimum days since lastContactedAt — finds clients overdue for contact." },
            maxIncomeReadinessScore: { type: "INTEGER", description: "Max income-readiness score — finds at-risk clients (e.g. 50 for 'who's at risk')." },
            hasRedFlags: { type: "BOOLEAN", description: "True → only clients with at least one analysis red flag." },
            status: { type: "STRING", description: "Exact saved-review status." },
          },
        },
      },
      {
        name: "get_client_details",
        description:
          "Return the active client's profile, holdings summary, allocation, and top analysis findings. clientId optional; defaults to the currently active client.",
        parameters: {
          type: "OBJECT",
          properties: { clientId: { type: "STRING", description: "Saved review id." } },
        },
      },
      {
        name: "read_analysis_section",
        description:
          "Read aloud a specific section of the current analysis: synopsis | highlights | redFlags | recommendations | talkingPoints | objectionHandling.",
        parameters: {
          type: "OBJECT",
          properties: {
            section: {
              type: "STRING",
              description: "Section name.",
              enum: [
                "synopsis",
                "highlights",
                "redFlags",
                "recommendations",
                "talkingPoints",
                "objectionHandling",
              ],
            },
          },
          required: ["section"],
        },
      },
      {
        name: "explain_ui",
        description:
          "Walk-through helper: explain what the current screen does and what action the user usually takes next. Falls back to the current step if topic is omitted.",
        parameters: {
          type: "OBJECT",
          properties: { topic: { type: "STRING", description: "Optional topic to explain." } },
        },
      },
      // ── Phase 2 voice expansion: deeper client lenses ────────────────
      {
        name: "get_holdings_breakdown",
        description:
          "Get holdings + top 5 positions by weight for the active or specified client. Use when asked 'what does Sarah hold?' / 'what are her top positions?'.",
        parameters: {
          type: "OBJECT",
          properties: { clientId: { type: "STRING", description: "Saved review id; defaults to active." } },
        },
      },
      {
        name: "get_allocation_summary",
        description:
          "Get bucketed allocation (equity / fixed / cash / alts / etc.) with dollar values + percentages for the active or specified client.",
        parameters: {
          type: "OBJECT",
          properties: { clientId: { type: "STRING", description: "Saved review id; defaults to active." } },
        },
      },
      {
        name: "get_meeting_guide",
        description:
          "Get the advisor opening script, talking points, and objection-handling notes for the active or specified client. Use when prepping for a meeting.",
        parameters: {
          type: "OBJECT",
          properties: { clientId: { type: "STRING", description: "Saved review id; defaults to active." } },
        },
      },
      {
        name: "get_overlap_insights",
        description:
          "Get hidden concentration / fund-overlap notes from the active or specified client's analysis.",
        parameters: {
          type: "OBJECT",
          properties: { clientId: { type: "STRING", description: "Saved review id; defaults to active." } },
        },
      },
      {
        name: "get_roth_summary",
        description:
          "Get the saved Roth conversion worksheet summary (conversion amount, breakeven, recommendation) when one exists.",
        parameters: {
          type: "OBJECT",
          properties: { clientId: { type: "STRING", description: "Saved review id; defaults to active." } },
        },
      },
      {
        name: "client_overview",
        description:
          "Comprehensive synthesized overview of one client — profile, allocation, top positions, scores, top red flags + top recommendations — designed to be spoken as a 4-6 sentence briefing. Use when the advisor asks 'give me a quick rundown on Sarah'.",
        parameters: {
          type: "OBJECT",
          properties: { clientId: { type: "STRING", description: "Saved review id; defaults to active." } },
        },
      },
    ],
  },
];

/**
 * Resolve voice model + voice name applying:
 *   advisor profile (NULL → fall through) → env defaults → hardcoded defaults
 */
export function resolveVoiceSelection(settings: VoiceSettings): {
  model: string;
  voice: string;
} {
  return {
    model:
      settings.voiceModel ??
      process.env.LLM_VOICE_MODEL ??
      // Athena production default (gemini-adapter.ts:48). Other current
      // candidates: 'gemini-2.5-flash-preview-native-audio-dialog' (native
      // audio dialog tier).
      "gemini-3.1-flash-live-preview",
    voice: settings.voiceName ?? process.env.LLM_VOICE_NAME ?? "Aoede",
  };
}

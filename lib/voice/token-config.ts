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
        description: "Switch the active top-level step in the advisor product.",
        parameters: {
          type: "OBJECT",
          properties: {
            step: {
              type: "STRING",
              description: "The destination step.",
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
          "Find a saved client by name (fuzzy) and load them. Disambiguate aloud if multiple matches.",
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
        name: "list_clients",
        description:
          "List saved clients with optional filters (search by name, staleDays for last-contacted age, status).",
        parameters: {
          type: "OBJECT",
          properties: {
            search: { type: "STRING", description: "Match on first or last name." },
            staleDays: { type: "INTEGER", description: "Minimum days since lastContactedAt." },
            status: { type: "STRING", description: "Exact status value, e.g. 'Analyzed'." },
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

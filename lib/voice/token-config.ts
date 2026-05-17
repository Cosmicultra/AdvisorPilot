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
//
// Voice agent v3 surface — DRAMATICALLY simplified from v1/v2:
//   The voice agent now has exactly two tools — `navigate` and `chat`.
//   Every other capability the old voice surface had (read analysis,
//   list clients, summarize holdings, etc.) now goes through `chat`,
//   which queues a Nova (text orchestrator) request and reads the
//   result back to the advisor when the voice channel is next idle.
//
//   Rationale:
//     1. The orchestrator already knows how to answer ANY question
//        against the database with rich tool composition. Duplicating
//        that surface as voice tools meant two parallel implementations
//        and inconsistent answers between voice and text.
//     2. The legacy voice tools were tied to the old legacy-shell
//        in-memory state and stopped making sense after the CRM
//        refactor — `read_analysis_section` / `client_overview` /
//        `get_meeting_guide` etc. all assumed the legacy "active
//        review" model.
//     3. Voice latency budget is tight — having Nova do the heavy
//        lifting in the background while voice keeps chatting feels
//        more natural than blocking voice on each lookup.
//
//   The `chat` tool returns IMMEDIATELY with an acknowledgement so the
//   model can say "Looking into that..." without dead air. The actual
//   answer is injected back via session.sendText() once the orchestrator
//   completes AND the voice channel is idle (not listening/speaking).
//   See lib/voice/chat-bridge.ts for the queue + nudge implementation.
export const VOICE_NAV_TOOLS: Array<Record<string, unknown>> = [
  {
    functionDeclarations: [
      {
        name: "navigate",
        description:
          "Move the advisor to a different surface inside AdvisorPilot. Map common phrases as follows:\n  - 'clients' / 'my clients' / 'client list' / 'client database' → destination='clients'\n  - 'open <Name>' / 'pull up <Name>' / 'show me <Name>' → destination='client' with clientName='<Name>' (a single-client view)\n  - 'intake' / 'new client' / 'start a new client' → destination='intake'\n  - 'tasks' / 'my tasks' / 'to-do' → destination='tasks'\n  - 'reports' / 'my reports' → destination='reports'\n  - 'home' / 'dashboard' / 'workflow' → destination='home'\nUse this whenever the advisor wants to MOVE somewhere. Do not narrate the move (no \"OK, opening clients\") — the screen change is its own feedback.",
        parameters: {
          type: "OBJECT",
          properties: {
            destination: {
              type: "STRING",
              description: "Which top-level CRM surface to open.",
              enum: ["clients", "client", "intake", "tasks", "reports", "home"],
            },
            clientName: {
              type: "STRING",
              description:
                "Required when destination='client'. Substring match on first or last name; if ambiguous (multiple matches), the tool returns the candidates so you can disambiguate aloud.",
            },
          },
          required: ["destination"],
        },
      },
      {
        name: "chat",
        description:
          "Ask the chat orchestrator (Nova) anything the advisor wants answered or done. Use this for EVERY question that isn't pure navigation — e.g. 'who's overdue for review', 'summarize Sarah's portfolio', 'what's my AUM by stage', 'draft a follow-up email', 'create a task to call Bob next Tuesday', 'generate an income readiness report for the Smiths'. The orchestrator has full database access and can compose any report, run any analysis, or update any record.\n\nIMPORTANT — this tool is FIRE-AND-FORGET from your perspective:\n  1. It returns IMMEDIATELY with an acknowledgement (no answer yet).\n  2. You can keep talking, listen, navigate, even fire more chat() calls. The orchestrator runs in the background.\n  3. When the orchestrator finishes AND the line is quiet (you're not speaking, the advisor isn't speaking), the result is injected into the conversation for you to read aloud.\n\nSo when you call chat() you should briefly tell the advisor what you're looking into ('Let me check your AUM by stage — one sec...') and then go quiet. Don't fabricate an answer; wait for the result to come back to you.",
        parameters: {
          type: "OBJECT",
          properties: {
            prompt: {
              type: "STRING",
              description:
                "The full advisor question (or composed instruction) for the orchestrator. Make it self-contained — the orchestrator does NOT see the voice transcript, only this prompt. Include any client name / context the advisor mentioned in their voice utterance.",
            },
          },
          required: ["prompt"],
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

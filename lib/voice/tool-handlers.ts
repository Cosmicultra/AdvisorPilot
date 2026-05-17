/**
 * Voice agent tool dispatcher (client-side).
 *
 * Voice v3 surface — only TWO tools:
 *   1. navigate — routes the advisor between CRM surfaces; resolves
 *      client-name searches against /api/clients
 *   2. chat — fire-and-forget delegation to the Nova text orchestrator.
 *      Returns immediately with an acknowledgement; the orchestrator's
 *      actual answer flows back via `lib/voice/chat-bridge.ts` (queued
 *      until voice is idle, then injected via session.sendText()).
 *
 * Everything else the old voice surface did (list clients, read
 * analysis sections, summarize meetings, etc.) is now handled by
 * `chat()` — Nova has full database access via its own tool surface
 * and can answer ANY question more capably than a hand-rolled voice
 * lens could.
 *
 * Spec: docs/crm/60-chat-orchestrator.md (Nova) + voice rewrite in
 * docs/crm/60-chat-orchestrator.md (forthcoming).
 */

import { focusPayload, type VoiceAppState } from "./focus";
import type { FocusPayload } from "./types";

export type VoiceNavDestination =
  | "clients"
  | "client"
  | "intake"
  | "tasks"
  | "reports"
  | "home";

/**
 * Result payload returned by `actions.navigate()`. The voice tool
 * wraps it so the model can speak meaningful disambiguation (multiple
 * client matches) or confirmation (route opened).
 */
export type VoiceNavigateResult =
  | { ok: true; opened: string; clientName?: string }
  | { error: string }
  | {
      matches: Array<{
        id: string;
        firstName: string;
        lastName: string;
      }>;
      message: string;
    };

/**
 * Result payload returned by `actions.chat()`. Always a synchronous
 * acknowledgement — the real answer lands later via the bridge.
 */
export interface VoiceChatAck {
  queued: true;
  acknowledgement: string;
  /** Internal id correlating the queued request back to its later result. */
  queueId: string;
}

/**
 * Live "actions" the voice handlers can invoke — provided by the host
 * component that owns the VoiceSession (`<ChatWidget />`). Keeps the
 * voice runtime agnostic about React internals.
 *
 * v3 is dramatically slimmed: just three methods covering the two
 * new tools plus the focus snapshot that `focusPayload()` needs.
 */
export interface VoiceAppActions {
  /** Snapshot of where the advisor currently is (route + active client) — feeds `get_context` indirectly via `focusDescription`. */
  getState: () => VoiceAppState;
  /** Move the advisor to another CRM surface. */
  navigate: (args: {
    destination: VoiceNavDestination;
    clientName?: string;
  }) => Promise<VoiceNavigateResult>;
  /** Delegate a question to the chat orchestrator (fire-and-forget). */
  chat: (prompt: string) => Promise<VoiceChatAck>;
}

export type VoiceToolHandler = (
  args: Record<string, unknown>,
  actions: VoiceAppActions,
) => Promise<unknown> | unknown;

export const VOICE_TOOL_HANDLERS: Record<string, VoiceToolHandler> = {
  navigate: async (args, actions) => {
    const destination = String((args as { destination?: unknown }).destination ?? "");
    const allowed: VoiceNavDestination[] = [
      "clients",
      "client",
      "intake",
      "tasks",
      "reports",
      "home",
    ];
    if (!allowed.includes(destination as VoiceNavDestination)) {
      return {
        error: `Unknown destination "${destination}". Valid: ${allowed.join(", ")}.`,
      };
    }
    const clientNameRaw = (args as { clientName?: unknown }).clientName;
    const clientName =
      typeof clientNameRaw === "string" && clientNameRaw.trim().length > 0
        ? clientNameRaw.trim()
        : undefined;

    if (destination === "client" && !clientName) {
      return {
        error:
          "destination='client' requires `clientName`. Use destination='clients' for the roster, or pass clientName for a specific client (e.g. 'Sarah').",
      };
    }

    return await actions.navigate({
      destination: destination as VoiceNavDestination,
      clientName,
    });
  },

  chat: async (args, actions) => {
    const promptRaw = (args as { prompt?: unknown }).prompt;
    const prompt =
      typeof promptRaw === "string" && promptRaw.trim().length > 0
        ? promptRaw.trim()
        : null;
    if (!prompt) {
      return { error: "`prompt` is required and must be non-empty." };
    }
    return await actions.chat(prompt);
  },
};

/**
 * Re-export for any caller that still imports VoiceAppState through
 * tool-handlers. Real definition lives in focus.ts.
 */
export type { VoiceAppState };

/**
 * Build the focus payload — used by focus.ts and by the prompt
 * builder when minting a token (so the model gets a fresh snapshot at
 * session start). NOT exposed as a tool — the model gets focus baked
 * into its system prompt instead.
 */
export function buildFocusPayload(state: VoiceAppState): FocusPayload {
  return focusPayload(state);
}

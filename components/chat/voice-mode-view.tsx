"use client";

/**
 * <VoiceModeView /> — replaces <ChatInput /> at the bottom of the
 * chat widget when voice mode is ON.
 *
 * The view is intentionally minimal: a big centered mic icon that
 * pulses when listening, a state label, and a small "Switch back to
 * text" affordance. The conversation transcript above (in
 * <ChatMessageList />) keeps growing as voice turns get appended via
 * the chat reducer's APPEND_VOICE_TURN action, so the advisor sees
 * the full back-and-forth in one place — text turns and voice turns
 * interleaved with a small mic glyph distinguishing them.
 *
 * Lifecycle is owned by <ChatWidget /> — this component is a pure
 * presentational layer that reflects the current voice state and
 * fires `onToggleOff` when the advisor taps the small switch-back
 * link.
 */

import { Mic, MicOff } from "lucide-react";
import type { VoiceSessionState } from "@/lib/voice/types";

interface VoiceModeViewProps {
  /** Current state of the Gemini Live session. */
  state: VoiceSessionState;
  /** Last error from the voice session, if any. */
  error: string | null;
  /** Switch back to text mode (closes the voice session). */
  onToggleOff: () => void;
}

const STATE_COPY: Record<
  VoiceSessionState,
  { label: string; sublabel: string; pulse: boolean }
> = {
  idle: {
    label: "Voice ready",
    sublabel: "Connecting microphone…",
    pulse: false,
  },
  connecting: {
    label: "Connecting…",
    sublabel: "Starting voice session.",
    pulse: true,
  },
  listening: {
    label: "Listening",
    sublabel: "Speak naturally — I'm here.",
    pulse: true,
  },
  thinking: {
    label: "Thinking…",
    sublabel: "Working out a response.",
    pulse: false,
  },
  speaking: {
    label: "Speaking",
    sublabel: "Tap mic to interrupt.",
    pulse: true,
  },
  tool: {
    label: "Working on it",
    sublabel: "Running a tool in the background.",
    pulse: false,
  },
  expiring: {
    label: "Wrapping up",
    sublabel: "Session about to renew.",
    pulse: false,
  },
  disconnected: {
    label: "Voice off",
    sublabel: "Tap the mic to reconnect.",
    pulse: false,
  },
};

export function VoiceModeView({ state, error, onToggleOff }: VoiceModeViewProps) {
  const copy = STATE_COPY[state];
  const active = state !== "idle" && state !== "disconnected";

  return (
    <div
      className="flex flex-col items-center gap-3 border-t bg-white px-4 py-5"
      style={{ borderColor: "var(--ap-line, #E5E7EB)" }}
    >
      {/* Big mic — tap to switch back to text. The visual state
          (color + pulse) reflects the voice session lifecycle so the
          advisor knows whether the agent can hear them, is thinking,
          or is speaking back. */}
      <button
        type="button"
        onClick={onToggleOff}
        aria-label="Switch back to text mode"
        title="Switch back to text mode"
        className="relative flex h-16 w-16 items-center justify-center transition-opacity hover:opacity-90"
        style={{
          backgroundColor: active ? "var(--ap-royal)" : "var(--ap-navy)",
          color: "#FFFFFF",
          borderRadius: 999,
        }}
      >
        {state === "disconnected" ? (
          <MicOff size={28} strokeWidth={1.75} />
        ) : (
          <Mic size={28} strokeWidth={1.75} />
        )}
        {copy.pulse ? (
          <span
            aria-hidden="true"
            className="absolute inset-0 animate-ping"
            style={{
              backgroundColor: "var(--ap-royal)",
              opacity: 0.35,
              borderRadius: 999,
            }}
          />
        ) : null}
      </button>

      <div className="flex flex-col items-center gap-0.5 text-center">
        <span
          className="text-[13px] font-semibold"
          style={{ color: "var(--ap-navy)" }}
        >
          {copy.label}
        </span>
        <span className="text-[11px] text-slate-500">{copy.sublabel}</span>
      </div>

      {error ? (
        <div
          className="w-full max-w-[320px] px-3 py-2 text-[11.5px]"
          style={{
            backgroundColor: "#FEF2F2",
            color: "#9B1C1C",
            border: "1px solid #FECACA",
          }}
        >
          {error}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onToggleOff}
        className="text-[11px] font-medium underline-offset-2 hover:underline"
        style={{ color: "var(--ap-royal)" }}
      >
        Switch back to text
      </button>
    </div>
  );
}

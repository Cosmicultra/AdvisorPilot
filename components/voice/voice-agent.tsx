"use client";

/**
 * Global voice agent surface: mic button + low-profile caption overlay.
 *
 * Consumes a VoiceAppActions object from the host page (`app/app/page.tsx`)
 * so the tool handlers can navigate, look up clients, etc., via the host's
 * existing React state setters — without exposing the entire app state to
 * the agent.
 *
 * In v1 the host wires this minimally and the existing UI stays intact;
 * future phases extend the actions surface.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { VoiceSession } from "@/lib/voice/session";
import type { VoiceAppActions } from "@/lib/voice/tool-handlers";
import type { VoiceSessionState } from "@/lib/voice/types";

export interface VoiceAgentProps {
  actions: VoiceAppActions;
  /** Disable the mic button entirely (e.g. when the advisor hasn't opted in). */
  disabled?: boolean;
}

const STATE_LABELS: Record<VoiceSessionState, string> = {
  idle: "Voice off",
  connecting: "Connecting…",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  tool: "Working",
  expiring: "Wrapping up",
  disconnected: "Voice off",
};

export function VoiceAgent({ actions, disabled }: VoiceAgentProps) {
  const sessionRef = useRef<VoiceSession | null>(null);
  const [state, setState] = useState<VoiceSessionState>("idle");
  const [transcript, setTranscript] = useState<Array<{ role: "user" | "assistant"; text: string }>>([]);
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(async () => {
    if (sessionRef.current) {
      await sessionRef.current.close();
      sessionRef.current = null;
    }
    setState("idle");
  }, []);

  const start = useCallback(async () => {
    if (sessionRef.current) return;
    setError(null);
    setTranscript([]);
    const session = new VoiceSession(actions, {
      onState: setState,
      onTranscript: (role, text) => {
        setTranscript((prev) => {
          const copy = [...prev];
          // Coalesce consecutive deltas from the same role into one row.
          const last = copy[copy.length - 1];
          if (last && last.role === role) {
            copy[copy.length - 1] = { role, text: `${last.text}${text}` };
          } else {
            copy.push({ role, text });
          }
          return copy.slice(-12);
        });
      },
      onError: (e) => setError(e.message),
      onClose: () => {
        sessionRef.current = null;
        setState("idle");
      },
    });
    sessionRef.current = session;
    try {
      await session.start();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to start voice agent.");
      await stop();
    }
  }, [actions, stop]);

  // Pause when tab is hidden (battery + accidental capture).
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible" && sessionRef.current) {
        void stop();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [stop]);

  // Cmd/Ctrl + Shift + V toggles.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "V" && e.shiftKey && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (sessionRef.current) void stop();
        else void start();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [start, stop]);

  if (disabled) return null;

  const active = state !== "idle" && state !== "disconnected";

  return (
    <>
      <button
        type="button"
        onClick={() => (active ? void stop() : void start())}
        aria-label={active ? "Stop voice agent" : "Start voice agent"}
        className={`fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition ${
          active
            ? "bg-rose-600 text-white animate-pulse"
            : "bg-indigo-600 text-white hover:bg-indigo-500"
        }`}
      >
        <svg
          className="h-6 w-6"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
          <line x1="12" y1="19" x2="12" y2="22" />
          <line x1="8" y1="22" x2="16" y2="22" />
        </svg>
      </button>

      {active && (
        <div className="fixed bottom-24 right-6 z-40 max-w-md rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-indigo-600">
              {STATE_LABELS[state]}
            </span>
            <button
              type="button"
              onClick={() => void stop()}
              className="text-xs text-slate-500 hover:underline"
            >
              Stop
            </button>
          </div>
          {error && (
            <div className="mb-2 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
              {error}
            </div>
          )}
          <div className="max-h-40 overflow-y-auto">
            {transcript.length === 0 ? (
              <p className="text-xs text-slate-500">Try: &ldquo;Where am I?&rdquo; / &ldquo;Open Sarah.&rdquo;</p>
            ) : (
              transcript.map((t, i) => (
                <p
                  key={i}
                  className={`mb-1 text-xs ${
                    t.role === "user" ? "text-slate-900" : "text-slate-600"
                  }`}
                >
                  <span className="font-medium">{t.role === "user" ? "You:" : "Agent:"}</span>{" "}
                  {t.text}
                </p>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}

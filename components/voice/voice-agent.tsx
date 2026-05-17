"use client";

/**
 * <VoiceAgentController /> — headless component that owns a
 * VoiceSession lifecycle and emits events upward.
 *
 * Voice v3 — refactored from a self-rendering FAB into a controlled
 * primitive that mounts inside <ChatWidget />. The widget owns the
 * voice toggle UI; this component just runs the session when
 * `enabled={true}` and tears it down when `enabled={false}`.
 *
 * Events emitted:
 *   - onState(state)            voice session state changes
 *   - onTranscript(role, text)  user / assistant transcripts (raw)
 *   - onError(error)            session error (rare, fatal)
 *
 * The widget routes:
 *   - state          → VoiceModeView (visual indicator)
 *   - transcripts    → coalesced into ChatMessages via
 *                       `appendVoiceTurn` on the chat hook
 *   - errors         → VoiceModeView's error banner
 *
 * The Cmd/Ctrl+Shift+V global hotkey moved to ChatWidget — putting it
 * here would mean it fires even when the chat isn't open, which is
 * confusing now that voice lives inside chat.
 */

import { useEffect, useRef } from "react";
import { VoiceSession } from "@/lib/voice/session";
import type { VoiceAppActions } from "@/lib/voice/tool-handlers";
import type { VoiceSessionState } from "@/lib/voice/types";

export interface VoiceAgentControllerProps {
  /** Master switch — when true, the session runs; when false, it tears down. */
  enabled: boolean;
  /** Actions the voice tools dispatch through (navigate + chat). */
  actions: VoiceAppActions;
  /** State change pipe → drives VoiceModeView. */
  onState: (state: VoiceSessionState) => void;
  /** Transcript pipe → drives appendVoiceTurn on the chat hook. */
  onTranscript: (role: "user" | "assistant", text: string) => void;
  /** Error pipe → drives VoiceModeView's error banner. */
  onError?: (err: Error) => void;
  /** Optional: exposes the live session so the bridge can sendText() into it. */
  onSessionReady?: (session: VoiceSession | null) => void;
  /**
   * Fires when the voice agent invokes a tool (navigate or chat).
   * Host renders a pending ToolExecution card in the chat list so
   * voice tool calls look like text-chat tool calls. See
   * components/chat/chat-widget.tsx for the routing.
   */
  onToolCall?: (
    callId: string,
    name: string,
    args: Record<string, unknown>,
  ) => void;
  /**
   * Fires when a tool resolves (success or error). Host flips the
   * card to completed/error and stores the return value.
   */
  onToolResult?: (
    callId: string,
    name: string,
    result: unknown,
    error?: string,
  ) => void;
}

export function VoiceAgentController({
  enabled,
  actions,
  onState,
  onTranscript,
  onError,
  onSessionReady,
  onToolCall,
  onToolResult,
}: VoiceAgentControllerProps) {
  const sessionRef = useRef<VoiceSession | null>(null);
  // Hold a stable ref to the latest callbacks so the start/stop effect
  // doesn't tear down on every parent re-render. The session itself is
  // never re-created mid-life; the callbacks get the freshest values
  // because we read through the ref inside the wrapper functions.
  const callbacksRef = useRef({
    onState,
    onTranscript,
    onError,
    onSessionReady,
    onToolCall,
    onToolResult,
  });
  useEffect(() => {
    callbacksRef.current = {
      onState,
      onTranscript,
      onError,
      onSessionReady,
      onToolCall,
      onToolResult,
    };
  }, [onState, onTranscript, onError, onSessionReady, onToolCall, onToolResult]);

  useEffect(() => {
    if (!enabled) {
      // Tear down any in-flight session when enabled flips to false.
      const session = sessionRef.current;
      if (session) {
        sessionRef.current = null;
        callbacksRef.current.onSessionReady?.(null);
        void session.close();
      }
      return;
    }

    // Spin up a new session. The stable callbacksRef means the
    // session's event handlers always read the latest props.
    const session = new VoiceSession(actions, {
      onState: (state) => callbacksRef.current.onState(state),
      onTranscript: (role, text) =>
        callbacksRef.current.onTranscript(role, text),
      onError: (err) => callbacksRef.current.onError?.(err),
      onToolCall: (callId, name, args) =>
        callbacksRef.current.onToolCall?.(callId, name, args),
      onToolResult: (callId, name, result, error) =>
        callbacksRef.current.onToolResult?.(callId, name, result, error),
      onClose: () => {
        if (sessionRef.current === session) {
          sessionRef.current = null;
          callbacksRef.current.onSessionReady?.(null);
        }
      },
    });

    sessionRef.current = session;
    callbacksRef.current.onSessionReady?.(session);

    void session.start().catch((err) => {
      callbacksRef.current.onError?.(err instanceof Error ? err : new Error(String(err)));
      if (sessionRef.current === session) {
        sessionRef.current = null;
        callbacksRef.current.onSessionReady?.(null);
      }
    });

    return () => {
      if (sessionRef.current === session) {
        sessionRef.current = null;
        callbacksRef.current.onSessionReady?.(null);
      }
      void session.close();
    };
    // Only react to enabled / actions identity changes. Actions are
    // expected to be a stable reference from the host (memoize it
    // upstream); changes mean the host wants to swap out the dispatch
    // surface (rare).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, actions]);

  // Pause when the tab is hidden — saves battery and avoids accidental
  // capture if the advisor switches apps mid-meeting. The chat widget
  // re-enables when the tab becomes visible again only if it was on
  // before (handled in ChatWidget via the `enabled` prop).
  useEffect(() => {
    if (!enabled) return;
    const onVis = () => {
      if (document.visibilityState !== "visible" && sessionRef.current) {
        void sessionRef.current.close();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [enabled]);

  // No DOM — this is a pure side-effect component.
  return null;
}

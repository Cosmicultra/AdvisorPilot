"use client";

/**
 * The full chat widget — header, message list, status, error banner, input.
 *
 * Owns ONE hook instance (`useOrchestratorChat`) and threads its outputs
 * through the leaf components. Receives the advisor identity + the
 * collapse callback (`onClose`) from its parent (the launcher); everything
 * else (in-focus client name, route context for the system prompt) comes
 * from `useChatLocation`.
 *
 * Layout — a flex column inside a fixed-size popover panel:
 *
 *   ┌─────────────────────────────────┐
 *   │  ChatHeader                     │  ← shrink-0
 *   ├─────────────────────────────────┤
 *   │  ChatErrorBanner (when error)   │  ← shrink-0; only when state=error
 *   ├─────────────────────────────────┤
 *   │  ChatMessageList                │  ← flex-1 (scrolls)
 *   ├─────────────────────────────────┤
 *   │  ChatStatusBar (when not idle)  │  ← shrink-0
 *   ├─────────────────────────────────┤
 *   │  ChatInput                      │  ← shrink-0
 *   └─────────────────────────────────┘
 *
 * Bound to the design + behavior specs in
 * `docs/crm/60-chat-orchestrator.md §B.14` + §B.15 + §B.19.
 */

import { History } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getConversationBroadcast } from "@/lib/chat/conversation-broadcast";
import { useChatLocation } from "@/lib/chat/chat-location-context";
import { useOrchestratorChat } from "@/lib/chat/use-orchestrator-chat";
import type { AdvisorProfileForChat } from "@/lib/chat/use-advisor-profile";
import type { ChatWidgetSize } from "@/lib/chat/widget-size";
import { VoiceChatBridge } from "@/lib/voice/chat-bridge";
import type { VoiceAppActions } from "@/lib/voice/tool-handlers";
import type { VoiceSession } from "@/lib/voice/session";
import type { VoiceSessionState } from "@/lib/voice/types";
import { resolveVoiceNavigate } from "@/lib/voice/navigate-resolver";
import { VoiceAgentController } from "@/components/voice/voice-agent";
import { ChatErrorBanner } from "./chat-error-banner";
import { ChatHeader } from "./chat-header";
import { ChatHistorySidebar } from "./chat-history-sidebar";
import { ChatInput } from "./chat-input";
import { ChatMessageList } from "./chat-message-list";
import { ChatResumeBanner } from "./chat-resume-banner";
import { ChatStatusBar } from "./chat-status-bar";
import { VoiceModeView } from "./voice-mode-view";

interface ChatWidgetProps {
  advisor: AdvisorProfileForChat;
  /** Collapses the widget back to the launcher button. */
  onClose: () => void;
  /** Optional — whether to auto-focus the input when the widget mounts. */
  autoFocusInput?: boolean;
  /**
   * Current size of the surrounding panel. Drives the sidebar default
   * visibility (full opens with the sidebar visible; compact starts
   * collapsed to preserve horizontal real estate in the 380 px panel).
   */
  size?: ChatWidgetSize;
  /** Toggle between compact and full screen — wired to the header's size button. */
  onToggleSize?: () => void;
}

export function ChatWidget({
  advisor,
  onClose,
  autoFocusInput = true,
  size = "compact",
  onToggleSize,
}: ChatWidgetProps) {
  const location = useChatLocation();
  const chat = useOrchestratorChat({
    advisorEmail: advisor.email,
    defaultContext: {
      ...location.context,
      timezone: advisor.timezone ?? undefined,
    },
  });
  // Sidebar defaults: open on full-screen (lots of horizontal room),
  // collapsed on compact (would dominate the 380 px panel). Advisor
  // can still toggle from the header's History button.
  const [sidebarOpen, setSidebarOpen] = useState(size === "full");

  // ───────────────────────────────────────────────────────────────────
  // Voice mode (v3)
  // ───────────────────────────────────────────────────────────────────
  //
  // Voice is a layer on top of the text chat: when toggled on, the
  // <ChatInput /> is replaced by <VoiceModeView /> and a
  // <VoiceAgentController /> runs the Gemini Live session in the
  // background. Voice transcripts get appended to the same message
  // list (and persisted via the same conversation) as text turns, so
  // the advisor can see / search / scroll back the full history
  // regardless of which channel they used.
  //
  // The chat orchestrator can be invoked FROM voice via the `chat`
  // tool: voice calls `bridge.enqueueChat(prompt)`, gets a quick
  // acknowledgement, and keeps talking. When the orchestrator finishes
  // AND voice is back in "listening" state, the bridge injects the
  // result into the Live session so the agent reads it aloud.
  const pathname = usePathname() ?? "";

  // CRITICAL: use Next.js's client-side router (not window.location.assign)
  // so voice-driven navigation doesn't unmount the chat widget.
  //
  // The chat widget is mounted in app/app/layout.tsx → it persists
  // across every navigation within /app/*. window.location.assign()
  // would force a full-page reload, unmounting the whole React tree
  // including this widget AND the active VoiceSession — exactly what
  // we ran into when "navigate to CRM" closed voice mid-conversation.
  //
  // router.push() swaps only the page content. Layout, providers,
  // chat widget, voice session — all keep running. The voice agent
  // can chain navigations + chats without dropping the call.
  const router = useRouter();
  const navigateClient = useCallback(
    (href: string) => router.push(href),
    [router],
  );

  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceSessionState>("idle");
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const voiceSessionRef = useRef<VoiceSession | null>(null);
  const bridgeRef = useRef<VoiceChatBridge | null>(null);
  // Bridge queueId → voice session callId. Populated when actions.chat()
  // returns its synchronous { queueId } ack; consumed by the bridge's
  // onChatComplete / onError callbacks so the orchestrator's final
  // answer lands on the correct tool-card row in the chat message
  // list. Entries are deleted after consumption — at most a handful
  // live at any moment.
  const queueToCallIdRef = useRef<Map<string, string>>(new Map());

  // Build a STABLE VoiceAppActions surface — the object identity must
  // not change on navigation, because <VoiceAgentController />'s
  // start/stop effect has `actions` in its dep array. If we recreated
  // the object every time the pathname changed, the controller would
  // tear down + restart the VoiceSession on every router push (and
  // voice would die mid-call when the agent navigates).
  //
  // The trick: getState() reads through a ref that always holds the
  // latest snapshot, so the action surface stays referentially
  // stable while the data it returns is always fresh. The effect
  // below keeps the ref synced with the latest pathname / client.
  const focusRef = useRef({
    pathname,
    clientTab: null as string | null,
    activeClientId: null as string | null,
    activeClientName: null as string | null,
  });
  useEffect(() => {
    const clientTab =
      pathname.startsWith("/app/crm/") && pathname.split("/").length >= 5
        ? pathname.split("/")[4]
        : null;
    focusRef.current = {
      pathname,
      clientTab,
      activeClientId: location.client?.id ?? null,
      activeClientName: location.client?.name ?? null,
    };
  }, [pathname, location.client?.id, location.client?.name]);

  // navigateClient is a stable callback (deps: [router], and router
  // from useRouter() is stable across renders in Next.js). Including
  // it as the SOLE dep means voiceActions identity stays stable too.
  const voiceActions = useMemo<VoiceAppActions>(() => {
    return {
      getState: () => focusRef.current,
      navigate: async (args) =>
        await resolveVoiceNavigate(args, { pushRoute: navigateClient }),
      chat: async (prompt) => {
        const bridge = bridgeRef.current;
        if (!bridge) {
          return {
            queued: true,
            acknowledgement: "Voice is offline — please try again.",
            queueId: "noop",
          };
        }
        const { queueId, acknowledgement } = bridge.enqueueChat(prompt);
        return { queued: true, acknowledgement, queueId };
      },
    };
  }, [navigateClient]);

  // Lifecycle the bridge alongside voice. The bridge is recreated each
  // time voice toggles on; it's torn down (and any in-flight requests
  // aborted) when voice toggles off.
  useEffect(() => {
    if (!voiceOn) {
      bridgeRef.current?.close();
      bridgeRef.current = null;
      return;
    }
    const bridge = new VoiceChatBridge({
      advisorEmail: advisor.email,
      defaultContext: {
        pathname,
        clientId: location.client?.id ?? null,
        timezone: advisor.timezone ?? null,
      },
      conversationId: chat.conversationId,
      inject: (text) => voiceSessionRef.current?.sendText(text) ?? false,
      // Fires EXACTLY ONCE per chat() request when the orchestrator
      // completes. Update the corresponding voice chat-tool card with
      // the final answer (status: completed). Voice will also read
      // the answer aloud (via the bridge's inject path), so the same
      // text appears as both a tool result AND a transcript message —
      // tool card is the machine-readable record, transcript is the
      // spoken version.
      //
      // Mapping note: the bridge's queueId is NOT the voice session's
      // callId (they're generated independently). queueToCallIdRef
      // holds the queueId → callId mapping, populated by
      // handleVoiceToolResult when the synchronous chat() result
      // surfaces a queueId.
      onChatComplete: (queueId, text) => {
        const callId = queueToCallIdRef.current.get(queueId);
        if (!callId) return;
        queueToCallIdRef.current.delete(queueId);
        chat.updateVoiceToolResult(
          voiceToolMessageId(callId),
          callId,
          { answer: text },
        );
      },
      onError: (queueId, err) => {
        const callId = queueToCallIdRef.current.get(queueId);
        if (!callId) return;
        queueToCallIdRef.current.delete(queueId);
        chat.updateVoiceToolResult(
          voiceToolMessageId(callId),
          callId,
          undefined,
          err.message,
        );
      },
    });
    bridgeRef.current = bridge;
    return () => {
      bridge.close();
      if (bridgeRef.current === bridge) bridgeRef.current = null;
    };
    // We deliberately don't react to every chat.* / location.* change
    // — the bridge is meant to be a stable runtime per voice session.
    // The defaultContext snapshot from creation time is fine; future
    // chat() calls re-include their prompt in full so the orchestrator
    // doesn't depend on the bridge having a fresh route snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceOn, advisor.email]);

  // State changes from the VoiceSession → VoiceModeView (visual) AND
  // the bridge (nudge timing).
  const handleVoiceState = useCallback((state: VoiceSessionState) => {
    setVoiceState(state);
    bridgeRef.current?.notifyVoiceState(state);
  }, []);

  // Transcripts → message list. We coalesce consecutive same-role
  // deltas into ONE message (the Live API streams output token-by-
  // token, but the message list cares about completed turns).
  const transcriptBufferRef = useRef<{
    role: "user" | "assistant" | null;
    text: string;
    id: string | null;
    startedAt: number;
  }>({ role: null, text: "", id: null, startedAt: 0 });

  const flushTranscriptBuffer = useCallback(() => {
    const buf = transcriptBufferRef.current;
    if (!buf.role || !buf.text.trim() || !buf.id) return;
    chat.appendVoiceTurn({
      id: buf.id,
      role: buf.role,
      text: buf.text.trim(),
      ts: buf.startedAt,
      status: buf.role === "assistant" ? "complete" : undefined,
    });
    transcriptBufferRef.current = {
      role: null,
      text: "",
      id: null,
      startedAt: 0,
    };
  }, [chat]);

  const handleTranscript = useCallback(
    (role: "user" | "assistant", text: string) => {
      const buf = transcriptBufferRef.current;
      if (buf.role && buf.role !== role) flushTranscriptBuffer();
      if (!transcriptBufferRef.current.role) {
        transcriptBufferRef.current = {
          role,
          text,
          id: `voice_${role[0]}_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 7)}`,
          startedAt: Date.now(),
        };
      } else {
        transcriptBufferRef.current.text += text;
      }
    },
    [flushTranscriptBuffer],
  );

  // Flush the buffer whenever the agent finishes its turn (state →
  // listening) so the assistant's message lands as ONE row instead of
  // many fragments. Same for user turns (state changes from listening
  // → thinking when the agent picks up on a pause).
  useEffect(() => {
    if (voiceState === "listening" || voiceState === "thinking") {
      flushTranscriptBuffer();
    }
  }, [voiceState, flushTranscriptBuffer]);

  // Toggle voice on/off. Closing voice flushes any half-buffered
  // transcript so it doesn't get dropped.
  const toggleVoice = useCallback(() => {
    if (voiceOn) {
      flushTranscriptBuffer();
      setVoiceError(null);
    }
    setVoiceOn((on) => !on);
  }, [voiceOn, flushTranscriptBuffer]);

  // VoiceAgentController hands us its session on start so we can call
  // sendText() through it (via the bridge). We track it in a ref so
  // identity changes don't re-run the bridge effect.
  const handleVoiceSession = useCallback((session: VoiceSession | null) => {
    voiceSessionRef.current = session;
  }, []);

  // Reflect the Live API's error stream into the VoiceModeView banner.
  // Most errors are recoverable (network blips, mic permission) — we
  // surface but don't auto-close voice unless the SDK closes the
  // session on its own (handled by VoiceAgentController.onClose).
  const handleVoiceError = useCallback((err: Error) => {
    setVoiceError(err.message);
  }, []);

  // ─────────────────────────────────────────────────────────────────
  // Voice tool calls → chat tool cards
  // ─────────────────────────────────────────────────────────────────
  //
  // Render voice's navigate + chat tool calls as ToolExecution cards
  // in the chat message list — same affordance the text orchestrator's
  // tool calls get via the SSE tool:call / tool:result events. The
  // existing <ChatToolStack /> renderer in chat-message-bubble.tsx
  // handles both because we use the same ToolExecution shape.
  //
  // Per-call message id is stable so a tool's pending → completed
  // transition can locate its row.

  const handleVoiceToolCall = useCallback(
    (callId: string, name: string, args: Record<string, unknown>) => {
      // Flush any in-progress transcript first so the tool card
      // appears AFTER the user/agent turn that triggered it (visual
      // ordering). Without this flush, an in-flight transcript would
      // arrive in the list after the tool card and look out of order.
      flushTranscriptBuffer();

      const messageId = voiceToolMessageId(callId);
      chat.appendVoiceTurn({
        id: messageId,
        role: "assistant",
        text: "",
        ts: Date.now(),
        status: "complete",
        toolExecutions: [
          {
            callId,
            name,
            args,
            status: "pending",
            startedAt: Date.now(),
          },
        ],
      });
    },
    [chat, flushTranscriptBuffer],
  );

  const handleVoiceToolResult = useCallback(
    (callId: string, name: string, result: unknown, error?: string) => {
      const messageId = voiceToolMessageId(callId);

      // Special-case the `chat` tool: its synchronous result is just
      // the queue acknowledgement, not the orchestrator's answer.
      // Record the queueId → callId mapping so the bridge's
      // onChatComplete (above) can find this card later, and keep
      // the card in pending state until the orchestrator's answer
      // lands.
      if (
        name === "chat" &&
        !error &&
        result &&
        typeof result === "object" &&
        (result as { queued?: unknown }).queued === true
      ) {
        const queueId = (result as { queueId?: unknown }).queueId;
        if (typeof queueId === "string") {
          queueToCallIdRef.current.set(queueId, callId);
        }
        return;
      }

      chat.updateVoiceToolResult(messageId, callId, result, error);
    },
    [chat],
  );

  const handleClear = () => {
    chat.clear();
    // Surface to other tabs so their sidebars refetch and show the
    // fresh row that's about to be created on the next user message.
    getConversationBroadcast(advisor.email).send({
      type: "conversation_created",
      conversationId: chat.conversationId,
    });
  };

  const handleDismissError = () => {
    // The reducer keeps the banner visible after error → idle (explicit-ack
    // pattern). Calling clear() rotates the conversation id AND drops the
    // banner — most users will want this when they hit Dismiss.
    chat.clear();
  };

  const handleOpenConversation = async (id: string) => {
    await chat.openConversation(id);
    // On mobile-width screens we close the sidebar after a pick so the
    // chat body has room to breathe.
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  };

  // When a conversation was deleted (in this tab or another), if it was
  // the active one, rotate to a fresh conversation so the chat panel
  // doesn't keep pointing at a dead row.
  const handleConversationDeleted = (id: string) => {
    if (id === chat.conversationId) chat.clear();
  };

  // Sidebar placement (PR 24):
  //   - `full` mode: inline as a flex child (plenty of horizontal room,
  //     320 px column inside the widget)
  //   - `compact` mode: absolute overlay anchored to the widget's LEFT
  //     edge (right: 100%) so it appears next to the panel without
  //     eating into the 380 px chat column. The chat content stays put.
  //     Sidebar gets its own shadow + rounded corners to feel like its
  //     own card. We bump `top-12` so the sidebar header aligns with
  //     the chat content body, sitting BELOW the navy header.
  const sidebarIsOverlay = size === "compact";
  const sidebarClassName = sidebarIsOverlay
    ? "absolute right-full top-0 bottom-0 mr-2 w-[280px] bg-white shadow-2xl"
    : "w-[320px] flex-shrink-0";

  return (
    <section
      role="region"
      aria-label="Nova chat assistant"
      // `relative` is the positioning context for the compact-mode
      // sidebar overlay. We keep `overflow` UN-set on the section so the
      // overlay can extend outside the widget's box; the chat-content
      // sub-container has its own `overflow-hidden` to clip the
      // message list when it grows.
      className="relative flex h-full w-full bg-white shadow-2xl"
      style={{ borderColor: "var(--ap-line, #E5E7EB)" }}
    >
      {sidebarOpen ? (
        <ChatHistorySidebar
          advisorEmail={advisor.email}
          activeConversationId={chat.conversationId}
          onOpen={(id) => void handleOpenConversation(id)}
          onNewChat={() => {
            handleClear();
            // On compact width, collapse the overlay after starting a new
            // chat so the advisor can see the fresh chat-content area.
            if (size === "compact") setSidebarOpen(false);
          }}
          onDeleted={handleConversationDeleted}
          className={sidebarClassName}
        />
      ) : null}

      <div className="flex h-full w-full min-w-0 flex-1 flex-col overflow-hidden">
        <ChatHeader
          clientName={location.client?.name ?? null}
          onClear={handleClear}
          onClose={onClose}
          canClear={chat.canSend}
          size={size}
          onToggleSize={onToggleSize}
          conversationTitle={chat.conversationTitle}
          leftSlot={
            <button
              type="button"
              onClick={() => setSidebarOpen((v) => !v)}
              aria-label={sidebarOpen ? "Hide chat history" : "Show chat history"}
              aria-pressed={sidebarOpen}
              className="flex h-7 w-7 items-center justify-center rounded-sm transition-colors hover:bg-white/10"
            >
              <History size={14} strokeWidth={1.75} />
            </button>
          }
        />

        {chat.state === "error" && chat.error ? (
          <ChatErrorBanner
            message={chat.error}
            reason={chat.errorReason}
            requestId={chat.requestId}
            onRetry={chat.retry}
            onDismiss={handleDismissError}
          />
        ) : null}

        {chat.pendingResume && chat.state === "idle" ? (
          <ChatResumeBanner
            lastUserMessage={chat.pendingResume.lastUserMessage}
            onContinue={chat.continueResume}
            onDismiss={chat.dismissResume}
          />
        ) : null}

        <ChatMessageList
          messages={chat.messages}
          advisorName={advisor.displayName ?? null}
          clientName={location.client?.name ?? null}
          onPrompt={(text) =>
            void chat.send(text, {
              ...location.context,
              timezone: advisor.timezone ?? undefined,
            })
          }
        />

        <ChatStatusBar state={chat.state} />

        {voiceOn ? (
          <VoiceModeView
            state={voiceState}
            error={voiceError}
            onToggleOff={toggleVoice}
          />
        ) : (
          <ChatInput
            isStreaming={chat.isStreaming}
            canSend={chat.canSend}
            canAbort={chat.canAbort}
            onSend={(text) => {
              // The hook reads its `defaultContext` from props closure; passing
              // location.context again here is redundant but explicit — and it
              // means a future refactor that drops `defaultContext` still works.
              void chat.send(text, {
                ...location.context,
                timezone: advisor.timezone ?? undefined,
              });
              // Notify other tabs to refresh their sidebar once the turn
              // completes — fire here so the broadcast is queued even if
              // the user navigates away mid-stream. Other tabs receive the
              // event when the page is reopened.
              getConversationBroadcast(advisor.email).send({
                type: "turn_completed",
                conversationId: chat.conversationId,
              });
            }}
            onAbort={chat.abort}
            autoFocus={autoFocusInput}
            onToggleVoice={toggleVoice}
          />
        )}
      </div>

      {/* Headless voice agent — runs only when voiceOn=true. The
          controller owns the VoiceSession lifecycle and pipes state /
          transcripts / errors back into this widget. Outside the
          chat-content wrapper so its lifecycle is independent of any
          sub-tree re-render. */}
      <VoiceAgentController
        enabled={voiceOn}
        actions={voiceActions}
        onState={handleVoiceState}
        onTranscript={handleTranscript}
        onError={handleVoiceError}
        onSessionReady={handleVoiceSession}
        onToolCall={handleVoiceToolCall}
        onToolResult={handleVoiceToolResult}
      />
    </section>
  );
}

/**
 * Stable per-tool-call message id. Each voice tool gets its own
 * synthetic assistant message so the tool card is independently
 * addressable when its status flips from pending → completed /
 * error. The bridge uses the same id from the queueId side so
 * onChatComplete can find the right message to update.
 */
function voiceToolMessageId(callId: string): string {
  return `voice_tool_msg_${callId}`;
}

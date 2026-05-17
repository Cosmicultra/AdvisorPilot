"use client";

/**
 * Single message bubble.
 *
 * User messages: right-aligned, royal background, white text.
 * Assistant messages: left-aligned, white background with subtle border.
 *
 * Streaming behavior:
 *   - Assistant bubbles with status="streaming" show a blinking caret at
 *     the end of the text to make the streaming visible.
 *   - Assistant bubbles with status="aborted" show "(stopped)" in muted text.
 *   - Assistant bubbles with status="error" show "(failed)" in muted red.
 *   - status="incomplete" shows "(disconnected)" — server killed the stream
 *     before the terminal event landed.
 *
 * Tool executions render as compact inline cards above the message body —
 * one per call. Tools are deferred to PR 4, but the rendering is wired now
 * so the orchestrator can emit them whenever they ship.
 *
 * Markdown rendering uses `<StreamingMarkdown>` (lib/markdown/) which
 * progressively renders content as tokens stream in, including:
 *   - GFM tables / lists / headings / links
 *   - Custom `chart:chartjs` fenced blocks via Chart.js
 *   - Skeleton placeholders for in-flight code/chart blocks so the rest
 *     of the document stays visible during streaming
 * See `docs/crm/60-chat-orchestrator.md §B.15` for the design.
 *
 * User bubbles intentionally stay plain text — they're whatever the
 * advisor typed, no rendering required.
 */

import type { ChatMessage } from "@/lib/chat/chat-message-types";
import { StreamingMarkdown } from "@/lib/markdown/streaming-markdown";
import { ChatToolStack } from "./chat-tool-stack";

interface ChatMessageBubbleProps {
  message: ChatMessage;
}

export function ChatMessageBubble({ message }: ChatMessageBubbleProps) {
  if (message.role === "user") return <UserBubble message={message} />;
  return <AssistantBubble message={message} />;
}

function UserBubble({ message }: { message: ChatMessage }) {
  return (
    <div className="flex w-full justify-end">
      <div
        className="max-w-[85%] rounded-sm px-3 py-2 text-sm leading-5 text-white"
        style={{ backgroundColor: "var(--ap-royal)" }}
      >
        <p className="whitespace-pre-wrap break-words">{message.text}</p>
      </div>
    </div>
  );
}

function AssistantBubble({ message }: { message: ChatMessage }) {
  const isStreaming = message.status === "streaming";
  const tools = message.toolExecutions ?? [];

  return (
    <div className="flex w-full flex-col gap-1.5">
      {tools.length > 0 ? <ChatToolStack tools={tools} /> : null}

      <div
        className="max-w-[92%] rounded-sm border border-slate-200 bg-white px-3 py-2 text-sm leading-5 text-slate-800"
        style={{ borderColor: "var(--ap-line, #E5E7EB)" }}
      >
        {message.text ? (
          <div className="break-words">
            <StreamingMarkdown text={message.text} isStreaming={isStreaming} />
            {isStreaming ? <BlinkingCaret /> : null}
          </div>
        ) : isStreaming ? (
          <p className="text-slate-400 italic">…</p>
        ) : (
          <StatusLabel status={message.status} />
        )}
        {message.status === "aborted" ? (
          <span className="mt-1 block text-[11px] text-slate-400">(stopped)</span>
        ) : null}
        {message.status === "incomplete" ? (
          <span className="mt-1 block text-[11px] text-amber-600">
            (connection ended unexpectedly)
          </span>
        ) : null}
        {message.status === "error" && message.text ? (
          <span className="mt-1 block text-[11px] text-rose-600">(failed)</span>
        ) : null}
        {message.modelOverride ? (
          <span className="mt-1 block text-[10.5px] uppercase tracking-[0.06em] text-slate-400">
            via {message.modelOverride}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function StatusLabel({ status }: { status?: ChatMessage["status"] }) {
  if (status === "error") {
    return <span className="text-[12px] text-rose-600">Failed to generate a response.</span>;
  }
  return <span className="text-[12px] text-slate-400">—</span>;
}

function BlinkingCaret() {
  return (
    <span
      aria-hidden="true"
      className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-slate-500"
    />
  );
}

// Tool execution rendering moved to `chat-tool-stack.tsx`. The stack:
//   - Collapses multiple calls into a single header card
//   - Two-level disclosure: stack → per-tool → input/output
//   - Status dots (blue=running, green=ok, red=error) per user spec
// Kept as a breadcrumb for anyone wondering where the inline rows went.

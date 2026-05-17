"use client";

/**
 * Single-line status indicator below the message list — surfaces:
 *   - preflight       → "Thinking…"
 *   - streaming       → (hidden; the bubble's blinking caret carries this signal)
 *   - connection_slow → "Connection slow…"
 *   - reconnecting    → "Reconnecting…"
 *   - aborting        → "Stopping…"
 *   - idle / error    → (hidden)
 *
 * Kept tiny on purpose. The error banner (`chat-error-banner.tsx`) takes
 * over for terminal failures; this row is for transient in-flight signals.
 */

import { Loader2, WifiOff } from "lucide-react";
import type { ChatState } from "@/lib/chat/chat-state-machine";

interface ChatStatusBarProps {
  state: ChatState;
}

export function ChatStatusBar({ state }: ChatStatusBarProps) {
  const config = configForState(state);
  if (!config) return null;
  const Icon = config.icon;

  return (
    <div
      className="flex items-center gap-2 border-t px-3 py-1.5 text-[11px]"
      style={{
        borderColor: "var(--ap-line, #E5E7EB)",
        backgroundColor: config.tone === "warn" ? "#FEF3C7" : "#FFFFFF",
        color: config.tone === "warn" ? "#92400E" : "#475569",
      }}
      role={config.tone === "warn" ? "status" : undefined}
      aria-live={config.tone === "warn" ? "polite" : undefined}
    >
      <Icon
        size={11}
        strokeWidth={2.25}
        className={config.spin ? "animate-spin" : ""}
      />
      <span>{config.label}</span>
    </div>
  );
}

interface StatusConfig {
  label: string;
  icon: typeof Loader2;
  spin: boolean;
  tone: "info" | "warn";
}

function configForState(state: ChatState): StatusConfig | null {
  switch (state) {
    case "preflight":
      return { label: "Thinking…", icon: Loader2, spin: true, tone: "info" };
    case "aborting":
      return { label: "Stopping…", icon: Loader2, spin: true, tone: "info" };
    case "reconnecting":
      return {
        label: "Reconnecting…",
        icon: Loader2,
        spin: true,
        tone: "warn",
      };
    case "connection_slow":
      return {
        label: "Connection slow…",
        icon: WifiOff,
        spin: false,
        tone: "warn",
      };
    case "streaming":
    case "idle":
    case "error":
    default:
      return null;
  }
}

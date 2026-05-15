/**
 * Per-call structured logging for the LLM abstraction.
 *
 * Logs one line per `complete()` / `research()` / `tts()` / `stt()` call,
 * uniformly across providers. Use this to verify which provider+model
 * actually served a request, what it cost, and how long it took.
 *
 * Format:
 *   [llm] provider=openai model=gpt-4o pass=extraction duration=2340ms tokens=in:4521 out:1203 cached:0 status=ok advisor=user@example.com
 *
 * Toggle verbosity via LLM_LOG:
 *   - "off"    → silent
 *   - "info"   → one line per call (default)
 *   - "debug"  → also dumps fallbacks, capability decisions, request shapes
 */

import type { LlmContext, TokenUsage } from "./types";

export type LlmLogLevel = "off" | "info" | "debug";

function level(): LlmLogLevel {
  const raw = (process.env.LLM_LOG || "").trim().toLowerCase();
  if (raw === "off" || raw === "debug") return raw;
  return "info";
}

export function llmDebug(message: string, extra?: Record<string, unknown>): void {
  if (level() !== "debug") return;
  if (extra) {
    console.info(`[llm:debug] ${message}`, extra);
  } else {
    console.info(`[llm:debug] ${message}`);
  }
}

export interface LlmCallLog {
  ctx: LlmContext;
  durationMs: number;
  usage?: TokenUsage;
  /** Optional advisor identifier — used to scope logs without revealing PII. */
  advisorEmail?: string | null;
  /** Set when the call threw or returned an error response. */
  error?: string;
  /** When the resolved provider fell back to another (e.g. TTS → OpenAI). */
  fallbackFrom?: string;
  /** Extra free-form annotations (e.g. citation count for research calls). */
  extra?: Record<string, unknown>;
}

/**
 * Mask an email for logging: keep the first 2 chars + the domain.
 * `user@example.com` → `us***@example.com`. Disable with LLM_LOG_FULL_EMAIL=1
 * for local debugging only.
 */
function maskEmail(email: string): string {
  if (process.env.LLM_LOG_FULL_EMAIL === "1") return email;
  const at = email.indexOf("@");
  if (at < 1) return "anon";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  if (local.length <= 2) return `${local}${domain}`;
  return `${local.slice(0, 2)}***${domain}`;
}

export function logLlmCall(entry: LlmCallLog): void {
  if (level() === "off") return;
  const { ctx, durationMs, usage, advisorEmail, error, fallbackFrom, extra } = entry;
  const parts: string[] = [
    `provider=${ctx.provider}`,
    `model=${ctx.model}`,
    `pass=${ctx.pass}`,
    `duration=${Math.round(durationMs)}ms`,
  ];
  if (usage) {
    const tokenParts: string[] = [];
    if (typeof usage.inputTokens === "number") tokenParts.push(`in:${usage.inputTokens}`);
    if (typeof usage.outputTokens === "number") tokenParts.push(`out:${usage.outputTokens}`);
    if (typeof usage.cachedInputTokens === "number") tokenParts.push(`cached:${usage.cachedInputTokens}`);
    if (tokenParts.length) parts.push(`tokens=${tokenParts.join(" ")}`);
  }
  parts.push(`status=${error ? "error" : "ok"}`);
  if (fallbackFrom) parts.push(`fallback_from=${fallbackFrom}`);
  if (advisorEmail) parts.push(`advisor=${maskEmail(advisorEmail)}`);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined || v === null) continue;
      parts.push(`${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
    }
  }
  const line = `[llm] ${parts.join(" ")}`;
  if (error) {
    console.error(`${line} error="${error.replace(/"/g, "'")}"`);
  } else {
    console.info(line);
  }
}

/** Pull a best-effort advisor email out of the headers / request for logging. */
export function advisorEmailHint(
  request: Request | undefined,
  selectionEmail?: string | null
): string | null {
  if (selectionEmail) return selectionEmail;
  // Inspect the Authorization header for a JWT payload .email claim.
  // Decode-only — never validates; this is purely for log attribution.
  try {
    const auth = request?.headers.get("authorization");
    if (auth?.startsWith("Bearer ")) {
      const jwt = auth.slice(7).trim();
      const segment = jwt.split(".")[1];
      if (segment) {
        const padded = segment + "=".repeat((4 - (segment.length % 4)) % 4);
        const decoded = Buffer.from(padded, "base64").toString("utf-8");
        const payload = JSON.parse(decoded) as { email?: string };
        if (payload.email) return payload.email;
      }
    }
  } catch {
    // ignore — best-effort only
  }
  return null;
}

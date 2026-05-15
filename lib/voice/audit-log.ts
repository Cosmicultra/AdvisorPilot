/**
 * Voice agent tool-call audit log.
 *
 * Writes one row per tool call (shape only — never transcripts or raw
 * arguments). Routed through /api/voice/audit so the browser doesn't talk
 * to Supabase directly with admin credentials.
 *
 * Best-effort: failures log to console but never block the agent.
 */

import { advisorFetch } from "@/lib/advisor-fetch";

async function sha256Hex(text: string): Promise<string> {
  // SubtleCrypto is available in modern browsers; on the server we'd use
  // node's crypto. This helper is client-only.
  try {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest("SHA-256", enc);
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return "";
  }
}

export interface AuditEntry {
  tool: string;
  args: unknown;
  result: unknown;
  success: boolean;
  error?: string;
}

export async function recordVoiceAudit(entry: AuditEntry): Promise<void> {
  try {
    const argsHash = await sha256Hex(JSON.stringify(entry.args ?? {}));
    const resultHash = await sha256Hex(
      JSON.stringify(entry.success ? entry.result ?? {} : { __failed: true })
    );
    await advisorFetch("/api/voice/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: entry.tool,
        argsHash,
        resultHash,
        success: entry.success,
        error: entry.error?.slice(0, 500),
      }),
    });
  } catch (err) {
    console.warn("[voice/audit] failed to record:", err);
  }
}

/**
 * Voice session wrapper around @google/genai's `live.connect`.
 *
 * Modeled directly on the Athena desktop agent's GeminiAdapter +
 * voice-app-gateway pattern (see /Users/djperussina/Code/fragilepak-mcp-servers/
 * athena-desktop-agent/src/voice). Key fidelity points:
 *
 *   1. API key passed straight to `new GoogleGenAI({apiKey})` and reused
 *      across reconnects — no ephemeral-token dance in v1.
 *   2. Audio sent via `sendRealtimeInput({audio:{data, mimeType:"audio/pcm;rate=16000"}})`.
 *   3. Tool responses wrap output in `{result: stringifiedOutput}` per
 *      Athena's `sendToolResult` shape — Gemini parses this most reliably.
 *   4. `interrupted` on serverContent stops playback immediately.
 *   5. `goAway` schedules a reconnect via the saved sessionResumption handle.
 *   6. Mid-session text injection goes through `sendRealtimeInput({text})`
 *      — `sendClientContent` returns 1007 on gemini-3.1-flash-live-preview.
 */

import { GoogleGenAI, Modality, type Session } from "@google/genai";
import { advisorFetch } from "@/lib/advisor-fetch";
import { PlaybackQueue, startMicCapture, type CaptureHandle } from "./audio";
import { recordVoiceAudit } from "./audit-log";
import { VOICE_TOOL_HANDLERS, type VoiceAppActions } from "./tool-handlers";
import type { VoiceSessionState } from "./types";

export interface SessionEvents {
  onState?: (state: VoiceSessionState) => void;
  onTranscript?: (role: "user" | "assistant", text: string) => void;
  onVolume?: (rms: number) => void;
  onError?: (err: Error) => void;
  onClose?: () => void;
}

interface MintResponse {
  apiKey: string;
  model: string;
  voice: string;
  systemPrompt: string;
  tools: Array<Record<string, unknown>>;
  maxSessionMinutes?: number;
}

interface ServerMessage {
  serverContent?: {
    modelTurn?: {
      parts?: Array<{
        inlineData?: { mimeType?: string; data?: string };
        text?: string;
      }>;
    };
    interrupted?: boolean;
    turnComplete?: boolean;
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
  };
  toolCall?: {
    functionCalls?: Array<{
      id?: string;
      name?: string;
      args?: Record<string, unknown>;
    }>;
  };
  goAway?: { timeLeft?: string };
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean };
}

export class VoiceSession {
  private capture: CaptureHandle | null = null;
  private playback = new PlaybackQueue();
  private session: Session | null = null;
  private resumptionHandle: string | null = null;
  private state: VoiceSessionState = "idle";
  private events: SessionEvents;
  private actions: VoiceAppActions;
  private autoCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private mint: MintResponse | null = null;
  private speakingForResponse = false;
  private volumeRafScheduled = false;
  /**
   * True once the WS is open and ready for audio frames. Flipped false on
   * close / error / explicit teardown so the mic-frame fan-out stops
   * spamming `sendRealtimeInput` against a CLOSING WebSocket.
   */
  private sendReady = false;

  constructor(actions: VoiceAppActions, events: SessionEvents = {}) {
    this.actions = actions;
    this.events = events;
  }

  get currentState(): VoiceSessionState {
    return this.state;
  }

  private setState(s: VoiceSessionState) {
    this.state = s;
    if (this.events.onState) this.events.onState(s);
  }

  async start(): Promise<void> {
    this.setState("connecting");

    // advisorFetch attaches the Supabase JWT (when present) so email/password
    // accounts authenticate alongside Google session cookies.
    const tokenRes = await advisorFetch("/api/voice/token", { method: "POST" });
    if (!tokenRes.ok) {
      const body = await tokenRes.json().catch(() => ({}));
      throw new Error(body?.error || `Voice token mint failed (${tokenRes.status})`);
    }
    this.mint = (await tokenRes.json()) as MintResponse;

    await this.openConnection();

    const maxMinutes = this.mint.maxSessionMinutes ?? 15;
    this.autoCloseTimer = setTimeout(() => {
      this.setState("expiring");
      void this.close();
    }, maxMinutes * 60 * 1000);

    this.capture = await startMicCapture((b64) => {
      // Guard: only send when the WS is open. ScriptProcessor keeps firing
      // after disconnect; without this gate we'd spam "WebSocket is already
      // in CLOSING or CLOSED state" errors and drown the console.
      if (!this.session || !this.sendReady) return;
      try {
        this.session.sendRealtimeInput({
          audio: { data: b64, mimeType: "audio/pcm;rate=16000" },
        });
      } catch (err) {
        this.sendReady = false;
        if (this.events.onError) this.events.onError(err as Error);
      }
    });

    if (this.events.onVolume && !this.volumeRafScheduled) {
      this.volumeRafScheduled = true;
      const tick = () => {
        if (!this.capture || this.state === "disconnected") {
          this.volumeRafScheduled = false;
          return;
        }
        this.events.onVolume?.(this.capture.volumeRef.current);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }

  private async openConnection(): Promise<void> {
    if (!this.mint) throw new Error("Voice session has no mint payload.");
    const mint = this.mint;

    const ai = new GoogleGenAI({ apiKey: mint.apiKey });

    const sessionConfig: Record<string, unknown> = {
      responseModalities: [Modality.AUDIO],
      systemInstruction: mint.systemPrompt,
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: mint.voice } },
      },
      tools: mint.tools,
      contextWindowCompression: { slidingWindow: {} },
    };
    if (this.resumptionHandle) {
      sessionConfig.sessionResumption = { handle: this.resumptionHandle };
    }

    this.sendReady = false;
    this.session = await ai.live.connect({
      model: mint.model,
      config: sessionConfig,
      callbacks: {
        onopen: () => {
          this.sendReady = true;
          this.speakingForResponse = false;
          this.setState("listening");
        },
        onmessage: (msg: unknown) => this.handleMessage(msg as ServerMessage),
        onerror: (err: unknown) => {
          this.sendReady = false;
          const e = err instanceof Error ? err : new Error(String(err));
          if (this.events.onError) this.events.onError(e);
        },
        onclose: () => {
          this.sendReady = false;
          this.setState("disconnected");
          if (this.events.onClose) this.events.onClose();
        },
      } as Parameters<typeof ai.live.connect>[0]["callbacks"],
    } as Parameters<typeof ai.live.connect>[0]);
  }

  private async reconnect(): Promise<void> {
    try {
      const old = this.session;
      await this.openConnection();
      try {
        old?.close?.();
      } catch {
        // ignore
      }
    } catch (err) {
      if (this.events.onError) this.events.onError(err as Error);
    }
  }

  private async handleMessage(msg: ServerMessage): Promise<void> {
    if (msg.serverContent?.interrupted) {
      this.playback.stop();
      this.speakingForResponse = false;
      this.setState("listening");
    }
    const parts = msg.serverContent?.modelTurn?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        if (!this.speakingForResponse) {
          this.speakingForResponse = true;
          this.setState("speaking");
        }
        this.playback.pushPcm16Base64(part.inlineData.data);
      }
      if (part.text && this.events.onTranscript) {
        this.events.onTranscript("assistant", part.text);
      }
    }
    if (msg.serverContent?.inputTranscription?.text && this.events.onTranscript) {
      this.events.onTranscript("user", msg.serverContent.inputTranscription.text);
    }
    if (msg.serverContent?.outputTranscription?.text && this.events.onTranscript) {
      this.events.onTranscript("assistant", msg.serverContent.outputTranscription.text);
    }
    if (msg.serverContent?.turnComplete) {
      this.speakingForResponse = false;
      this.setState("listening");
    }
    if (msg.toolCall?.functionCalls?.length) {
      this.setState("tool");
      // Send each tool response separately so Gemini matches `id` -> response.
      for (const call of msg.toolCall.functionCalls) {
        const callId = call.id || `gemini-fc-${Date.now()}`;
        const name = call.name || "unknown";
        const handler = VOICE_TOOL_HANDLERS[name];
        let output: string;
        let success = true;
        let error: string | undefined;

        if (!handler) {
          output = `Unknown tool: ${name}`;
          success = false;
          error = output;
        } else {
          try {
            const result = await handler(call.args ?? {}, this.actions);
            output = typeof result === "string" ? result : JSON.stringify(result);
            if (output.length > 2000) output = output.slice(0, 2000) + "…[truncated]";
          } catch (err) {
            success = false;
            error = err instanceof Error ? err.message : "tool error";
            output = `Error: ${error}`;
          }
        }
        void recordVoiceAudit({
          tool: name,
          args: call.args ?? {},
          result: { output: output.slice(0, 200) },
          success,
          error,
        });
        try {
          this.session?.sendToolResponse({
            functionResponses: [
              {
                id: callId,
                name,
                response: { result: output },
              },
            ],
          });
        } catch (err) {
          if (this.events.onError) this.events.onError(err as Error);
        }
      }
      this.setState("listening");
    }
    if (msg.sessionResumptionUpdate?.newHandle) {
      this.resumptionHandle = msg.sessionResumptionUpdate.newHandle;
    }
    if (msg.goAway) {
      // Reconnect with the saved handle — Gemini gives ~30s notice.
      setTimeout(() => void this.reconnect(), 1000);
    }
  }

  async close(): Promise<void> {
    this.sendReady = false;
    if (this.autoCloseTimer) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }
    try {
      this.session?.close?.();
    } catch {
      // ignore
    }
    this.session = null;
    if (this.capture) {
      await this.capture.stop();
      this.capture = null;
    }
    await this.playback.close();
    this.setState("disconnected");
  }
}

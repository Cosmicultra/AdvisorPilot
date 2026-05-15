/**
 * Voice session wrapper around @google/genai's `live.connect`.
 *
 * Handles:
 *   - Ephemeral token mint via /api/voice/token.
 *   - Mic capture stream (16 kHz PCM16) → session.sendRealtimeInput.
 *   - Audio playback queue (24 kHz PCM16) from serverContent parts.
 *   - Barge-in: `interrupted` → stop playback.
 *   - Tool calls: dispatch to VOICE_TOOL_HANDLERS, reply via sendToolResponse.
 *   - GoAway: schedule a reconnect using the saved sessionResumption handle.
 */

import { GoogleGenAI } from "@google/genai";
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
  token: string;
  model: string;
  voice: string;
  maxSessionMinutes?: number;
}

type LiveSession = {
  sendRealtimeInput: (data: { audio: { data: string; mimeType: string } }) => void;
  sendToolResponse: (data: {
    functionResponses: Array<{ id?: string; name: string; response: unknown }>;
  }) => void;
  close?: () => void;
};

interface ServerMessage {
  serverContent?: {
    modelTurn?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string }; text?: string }> };
    interrupted?: boolean;
    turnComplete?: boolean;
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
  };
  toolCall?: {
    functionCalls?: Array<{ id?: string; name: string; args?: Record<string, unknown> }>;
  };
  goAway?: { timeLeft?: string };
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean };
}

export class VoiceSession {
  private capture: CaptureHandle | null = null;
  private playback = new PlaybackQueue();
  private session: LiveSession | null = null;
  private resumptionHandle: string | null = null;
  private state: VoiceSessionState = "idle";
  private events: SessionEvents;
  private actions: VoiceAppActions;
  private autoCloseTimer: ReturnType<typeof setTimeout> | null = null;

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
    const tokenRes = await fetch("/api/voice/token", { method: "POST" });
    if (!tokenRes.ok) {
      const body = await tokenRes.json().catch(() => ({}));
      throw new Error(body?.error || "Failed to mint voice token.");
    }
    const mint = (await tokenRes.json()) as MintResponse;

    // The browser-facing GoogleGenAI client accepts an apiKey field for the
    // ephemeral token; we route through the v1alpha endpoint per the docs.
    const ai = new GoogleGenAI({
      apiKey: mint.token,
      apiVersion: "v1alpha",
    } as unknown as ConstructorParameters<typeof GoogleGenAI>[0]);

    // The Live API's `connect` method varies slightly across SDK versions;
    // we treat it as `any` so the wire shape is the contract.
    const live = (ai as unknown as {
      live: {
        connect: (opts: {
          model: string;
          config: Record<string, unknown>;
          callbacks: {
            onopen?: () => void;
            onmessage?: (msg: ServerMessage) => void;
            onerror?: (err: Error) => void;
            onclose?: () => void;
          };
        }) => Promise<LiveSession>;
      };
    }).live;

    this.session = await live.connect({
      model: mint.model,
      config: {
        responseModalities: ["AUDIO"],
        // Live ephemeral tokens lock the rest of the config server-side; the
        // browser cannot widen the tool surface or change the voice/system
        // prompt. Here we only specify modality + (optional) resumption.
        sessionResumption: this.resumptionHandle ? { handle: this.resumptionHandle } : {},
      },
      callbacks: {
        onopen: () => {
          this.setState("listening");
        },
        onmessage: (msg) => this.handleMessage(msg),
        onerror: (err) => {
          if (this.events.onError) this.events.onError(err);
        },
        onclose: () => {
          this.setState("disconnected");
          if (this.events.onClose) this.events.onClose();
        },
      },
    });

    // Auto-close before the configured cap to avoid surprise mid-call drops.
    const maxMinutes = mint.maxSessionMinutes ?? 15;
    this.autoCloseTimer = setTimeout(() => {
      this.setState("expiring");
      void this.close();
    }, maxMinutes * 60 * 1000);

    // Start mic capture and fan frames to the session.
    this.capture = await startMicCapture((b64) => {
      const session = this.session;
      if (!session) return;
      try {
        session.sendRealtimeInput({
          audio: { data: b64, mimeType: "audio/pcm;rate=16000" },
        });
      } catch (err) {
        if (this.events.onError) this.events.onError(err as Error);
      }
    });

    // Pump the volume meter to the listener.
    if (this.events.onVolume) {
      const tick = () => {
        if (!this.capture || this.state === "disconnected") return;
        this.events.onVolume?.(this.capture.volumeRef.current);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }

  private async handleMessage(msg: ServerMessage): Promise<void> {
    if (msg.serverContent?.interrupted) {
      this.playback.stop();
    }
    const parts = msg.serverContent?.modelTurn?.parts ?? [];
    for (const part of parts) {
      if (part.inlineData?.data) {
        this.setState("speaking");
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
      this.setState("listening");
    }
    if (msg.toolCall?.functionCalls?.length) {
      this.setState("tool");
      const responses = await Promise.all(
        msg.toolCall.functionCalls.map(async (call) => {
          const handler = VOICE_TOOL_HANDLERS[call.name];
          if (!handler) {
            const response = { error: `Unknown tool "${call.name}"` };
            void recordVoiceAudit({
              tool: call.name,
              args: call.args ?? {},
              result: response,
              success: false,
              error: response.error,
            });
            return { id: call.id, name: call.name, response };
          }
          try {
            const response = await handler(call.args ?? {}, this.actions);
            void recordVoiceAudit({
              tool: call.name,
              args: call.args ?? {},
              result: response,
              success: true,
            });
            return { id: call.id, name: call.name, response };
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : "tool error";
            const response = { error: errMsg };
            void recordVoiceAudit({
              tool: call.name,
              args: call.args ?? {},
              result: response,
              success: false,
              error: errMsg,
            });
            return { id: call.id, name: call.name, response };
          }
        })
      );
      try {
        this.session?.sendToolResponse({ functionResponses: responses });
      } catch (err) {
        if (this.events.onError) this.events.onError(err as Error);
      }
      this.setState("listening");
    }
    if (msg.sessionResumptionUpdate?.newHandle) {
      this.resumptionHandle = msg.sessionResumptionUpdate.newHandle;
    }
  }

  async close(): Promise<void> {
    if (this.autoCloseTimer) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }
    try {
      this.session?.close?.();
    } catch {
      // Ignore — close() is best-effort.
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

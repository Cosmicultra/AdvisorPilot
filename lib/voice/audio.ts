/**
 * Audio capture + playback for the Gemini Live voice agent.
 *
 * - Capture:  getUserMedia → AudioContext (16 kHz mono PCM frames).
 * - Playback: AudioContext queue at 24 kHz; barge-in stops the queue.
 *
 * The browser delivers float32 samples; Gemini Live expects 16-bit PCM
 * little-endian base64. We convert in-place to keep memory pressure low.
 */

const CAPTURE_SAMPLE_RATE = 16000;
const PLAYBACK_SAMPLE_RATE = 24000;
const FRAME_SAMPLES = 1024; // ~64 ms per frame at 16 kHz

export interface CaptureHandle {
  stop: () => Promise<void>;
  volumeRef: { current: number };
}

function pcm16FromFloat32(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  let offset = 0;
  for (let i = 0; i < samples.length; i++) {
    let s = Math.max(-1, Math.min(1, samples[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    const intval = s | 0;
    out[offset++] = intval & 0xff;
    out[offset++] = (intval >> 8) & 0xff;
  }
  return out;
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export async function startMicCapture(
  onFrame: (base64Pcm16: string) => void
): Promise<CaptureHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  });

  const audioContext = new (window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext)({ sampleRate: CAPTURE_SAMPLE_RATE });
  await audioContext.resume();

  const source = audioContext.createMediaStreamSource(stream);
  // ScriptProcessor is deprecated but universally supported and trivial to
  // wire in a single file without an AudioWorklet module. It's fine for our
  // 64 ms cadence; AudioWorklet upgrade is a follow-up.
  const processor = audioContext.createScriptProcessor(FRAME_SAMPLES, 1, 1);
  const analyzer = audioContext.createAnalyser();
  analyzer.fftSize = 256;
  source.connect(analyzer);
  source.connect(processor);
  processor.connect(audioContext.destination);

  const volumeRef = { current: 0 };
  const analyzerBuffer = new Uint8Array(analyzer.frequencyBinCount);

  processor.onaudioprocess = (event) => {
    const samples = event.inputBuffer.getChannelData(0);
    const pcm = pcm16FromFloat32(samples);
    const b64 = base64FromBytes(pcm);
    onFrame(b64);
    analyzer.getByteFrequencyData(analyzerBuffer);
    let sum = 0;
    for (let i = 0; i < analyzerBuffer.length; i++) sum += analyzerBuffer[i];
    volumeRef.current = sum / analyzerBuffer.length / 128;
  };

  return {
    volumeRef,
    stop: async () => {
      processor.disconnect();
      source.disconnect();
      analyzer.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      await audioContext.close();
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Playback
// ─────────────────────────────────────────────────────────────────────────────

export class PlaybackQueue {
  private audioContext: AudioContext | null = null;
  private playheadTime = 0;
  private active: AudioBufferSourceNode[] = [];

  private ctx(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext)({ sampleRate: PLAYBACK_SAMPLE_RATE });
      this.playheadTime = this.audioContext.currentTime;
    }
    return this.audioContext;
  }

  /** Append a PCM16 chunk (base64 from Gemini Live) to the playback queue. */
  pushPcm16Base64(base64: string): void {
    const ctx = this.ctx();
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const sampleCount = bytes.length / 2;
    const float = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      const lo = bytes[i * 2];
      const hi = bytes[i * 2 + 1];
      let v = (hi << 8) | lo;
      if (v >= 0x8000) v -= 0x10000;
      float[i] = v / 0x8000;
    }

    const buffer = ctx.createBuffer(1, sampleCount, PLAYBACK_SAMPLE_RATE);
    buffer.getChannelData(0).set(float);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const startAt = Math.max(this.playheadTime, ctx.currentTime);
    source.start(startAt);
    this.playheadTime = startAt + buffer.duration;
    this.active.push(source);
    source.onended = () => {
      this.active = this.active.filter((s) => s !== source);
    };
  }

  /** Stop all queued audio immediately. Called on `interrupted` from server. */
  stop(): void {
    for (const s of this.active) {
      try {
        s.stop();
      } catch {
        // Already stopped — ignore.
      }
    }
    this.active = [];
    if (this.audioContext) this.playheadTime = this.audioContext.currentTime;
  }

  async close(): Promise<void> {
    this.stop();
    if (this.audioContext) await this.audioContext.close();
    this.audioContext = null;
  }
}

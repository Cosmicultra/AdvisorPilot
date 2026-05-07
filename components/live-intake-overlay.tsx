"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  applyIntakePatch,
  boostIdentityFromUtterance,
  canAdvanceIntakeStep,
  INTAKE_STEPS,
  type IntakeClient,
} from "@/lib/intake-config";
import {
  LIVE_INTAKE_DIGITAL_ACK_SCRIPT,
  LIVE_INTAKE_HANDOFF_QUESTION_SCRIPT,
  LIVE_INTAKE_OPENING_SCRIPT,
  LIVE_INTAKE_PAPER_SIGNOFF_SCRIPT,
  LIVE_INTAKE_UPLOAD_CLOSING_SCRIPT,
  buildStepConfirmationScript,
  classifyConfirmationReply,
  personalizeLiveIntakeScript,
  type LiveIntakeHandoffAction,
} from "@/lib/live-intake-scripts";

type Phase = "starting" | "listening" | "thinking" | "speaking";

type Props = {
  intakeStep: number;
  client: IntakeClient;
  setClient: React.Dispatch<React.SetStateAction<IntakeClient>>;
  /** Advisor's name as clients should hear it (e.g. signature / profile). */
  advisorDisplayName: string;
  onAdvanceStep: () => void;
  /** After handoff TTS; may mint link + send email for digital_email (async). */
  onCompleteToUpload: (handoff: LiveIntakeHandoffAction) => void | Promise<void>;
  onClose: () => void;
};

/**
 * Bars drawn around the circular logo. Higher counts feel smoother but cost
 * more per frame; ~64 strikes a good balance on retina screens.
 */
const BAR_COUNT = 64;
/** Silence duration that ends a speaking turn (ms). */
const SILENCE_MS = 1500;
/** Energy threshold (0-1) above which we consider the mic to be hearing speech. */
const SPEECH_LEVEL_THRESHOLD = 0.06;
/** Minimum speech we want before allowing a silence-triggered stop (ms). */
const MIN_SPEECH_MS = 350;
/** Hard cap on a single recording chunk to avoid runaway turns (ms). */
const MAX_RECORD_MS = 30_000;

function pickRecorderMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  for (const m of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

/**
 * Voice-level visualizer that draws bars in a ring around a center point.
 * The logo lives in the middle of this canvas via an absolutely-positioned
 * sibling element, so the bars appear to radiate outward from the logo.
 */
function CircularBars({ analyser, boost }: { analyser: AnalyserNode | null; boost: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animRef = useRef<number>(0);
  /** Smoothed per-bar height so motion looks fluid even with bursty audio. */
  const smoothedRef = useRef<Float32Array>(new Float32Array(BAR_COUNT));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;

    const data = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    const draw = () => {
      animRef.current = requestAnimationFrame(draw);
      const w = canvas.width;
      const h = canvas.height;
      ctx2d.clearRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      /** Inner radius — just outside the logo circle. */
      const innerR = w * 0.32;
      /** Maximum bar length at full volume. */
      const maxLen = w * 0.16;

      const step = data ? Math.floor(data.length / BAR_COUNT) : 0;
      if (data && analyser) analyser.getByteFrequencyData(data);

      const smoothed = smoothedRef.current;

      for (let i = 0; i < BAR_COUNT; i++) {
        let raw = 0;
        if (data && step > 0) {
          let sum = 0;
          for (let j = 0; j < step; j++) sum += data[i * step + j] ?? 0;
          raw = (sum / step / 255) * boost;
        }
        const target = Math.max(0.04, raw);
        smoothed[i] = smoothed[i] * 0.7 + target * 0.3;
        const barLen = Math.max(6, smoothed[i] * maxLen * 1.4);

        const angle = (i / BAR_COUNT) * Math.PI * 2 - Math.PI / 2;
        const x1 = cx + Math.cos(angle) * innerR;
        const y1 = cy + Math.sin(angle) * innerR;
        const x2 = cx + Math.cos(angle) * (innerR + barLen);
        const y2 = cy + Math.sin(angle) * (innerR + barLen);

        const gradient = ctx2d.createLinearGradient(x1, y1, x2, y2);
        gradient.addColorStop(0, "rgba(45, 212, 191, 0.95)");
        gradient.addColorStop(1, "rgba(59, 130, 246, 0.35)");
        ctx2d.strokeStyle = gradient;
        ctx2d.lineWidth = 4;
        ctx2d.lineCap = "round";
        ctx2d.beginPath();
        ctx2d.moveTo(x1, y1);
        ctx2d.lineTo(x2, y2);
        ctx2d.stroke();
      }
    };
    draw();

    return () => cancelAnimationFrame(animRef.current);
  }, [analyser, boost]);

  return (
    <canvas
      ref={canvasRef}
      width={520}
      height={520}
      className="block h-full w-full"
      aria-hidden
    />
  );
}

export function LiveIntakeOverlay({
  intakeStep,
  client,
  setClient,
  advisorDisplayName,
  onAdvanceStep,
  onCompleteToUpload,
  onClose,
}: Props) {
  const [mounted] = useState(true);
  const [phase, setPhase] = useState<Phase>("starting");
  const [hint, setHint] = useState<string | null>(null);
  const [logoOk, setLogoOk] = useState(true);
  /** Mic stream used by both the analyser (visualizer + VAD) and the recorder. */
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
  /** Visible transcript so the user can see whether the mic actually heard them. */
  const [transcriptDisplay, setTranscriptDisplay] = useState("");
  /** Internal counter — useful in dev logs even though we no longer render it. */
  const turnCountRef = useRef(0);

  /** False after unmount or when overlay is closed — stops in-flight TTS and async work. */
  const overlayActiveRef = useRef(false);
  /** Incremented on each mount cleanup so stale async (e.g. React Strict Mode) cannot resume TTS. */
  const sessionCounterRef = useRef(0);

  const clientRef = useRef(client);
  const intakeStepRef = useRef(intakeStep);
  /** Active recorder for the current speaking turn. */
  const recorderRef = useRef<MediaRecorder | null>(null);
  /** Audio chunks accumulated for the current speaking turn. */
  const audioChunksRef = useRef<Blob[]>([]);
  /** Mime type the active recorder is using (for filename guess). */
  const recorderMimeRef = useRef<string>("");
  /** True once we've heard speech-level audio in the current turn. */
  const sawSpeechRef = useRef(false);
  /** Time (ms) the current recording started. */
  const recordStartedAtRef = useRef(0);
  /** rAF id for the level-monitor loop. */
  const levelLoopRef = useRef<number>(0);
  /** Shared analyser used both by CircularBars and the silence detector. */
  const analyserRef = useRef<AnalyserNode | null>(null);
  /** AudioContext we own; closed on cleanup. */
  const audioContextRef = useRef<AudioContext | null>(null);
  /** Resolved Whisper text for the most recent finished turn. */
  const liveTranscriptRef = useRef("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processingRef = useRef(false);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  /**
   * Live intake mode:
   * - "goal": collecting answers for the current intake step
   * - "confirm": a step has been satisfied — waiting for "yes / no" before advancing
   * - "handoff": after goal is confirmed — asking paper vs digital vs advisor upload
   */
  const livePhaseRef = useRef<"goal" | "confirm" | "handoff">("goal");
  const onCompleteToUploadRef = useRef(onCompleteToUpload);
  const onAdvanceStepRef = useRef(onAdvanceStep);
  const advisorDisplayNameRef = useRef(advisorDisplayName);
  const flushTranscriptRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    onCompleteToUploadRef.current = onCompleteToUpload;
    onAdvanceStepRef.current = onAdvanceStep;
    advisorDisplayNameRef.current = advisorDisplayName;
    clientRef.current = client;
    intakeStepRef.current = intakeStep;
  }, [advisorDisplayName, client, intakeStep, onAdvanceStep, onCompleteToUpload]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const stopAudioPlayback = useCallback(() => {
    try {
      const a = audioElRef.current;
      if (a) {
        a.pause();
        a.src = "";
        a.load();
      }
    } catch {
      /* ignore */
    }
    audioElRef.current = null;
  }, []);

  const stopRecognition = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (levelLoopRef.current) {
      cancelAnimationFrame(levelLoopRef.current);
      levelLoopRef.current = 0;
    }
    const rec = recorderRef.current;
    if (rec) {
      try {
        if (rec.state !== "inactive") rec.stop();
      } catch {
        /* ignore */
      }
    }
    recorderRef.current = null;
    audioChunksRef.current = [];
    sawSpeechRef.current = false;
  }, []);

  const stopRecognitionRef = useRef(stopRecognition);
  useEffect(() => {
    stopRecognitionRef.current = stopRecognition;
  }, [stopRecognition]);

  const playTts = useCallback(
    async (text: string) => {
      const t = text.trim();
      const sessionAtStart = sessionCounterRef.current;
      const stillThisSession = () =>
        overlayActiveRef.current && sessionCounterRef.current === sessionAtStart;

      if (!t || !stillThisSession()) return;
      setPhase("speaking");
      stopRecognitionRef.current();
      stopAudioPlayback();
      try {
        const res = await fetch("/api/intake-tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: t }),
        });
        if (!stillThisSession()) return;
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || "Could not play voice.");
        }
        const blob = await res.blob();
        if (!stillThisSession()) return;
        const url = URL.createObjectURL(blob);
        await new Promise<void>((resolve, reject) => {
          if (!stillThisSession()) {
            URL.revokeObjectURL(url);
            resolve();
            return;
          }
          const audio = new Audio(url);
          audioElRef.current = audio;
          audio.onended = () => {
            URL.revokeObjectURL(url);
            if (audioElRef.current === audio) audioElRef.current = null;
            resolve();
          };
          audio.onerror = () => {
            URL.revokeObjectURL(url);
            if (audioElRef.current === audio) audioElRef.current = null;
            reject(new Error("Audio playback failed."));
          };
          void audio.play().catch(reject);
        });
      } catch (e) {
        if (stillThisSession()) {
          setHint(e instanceof Error ? e.message : "Voice playback failed.");
        }
      }
    },
    [stopAudioPlayback]
  );

  const playTtsRef = useRef(playTts);
  useEffect(() => {
    playTtsRef.current = playTts;
  }, [playTts]);

  const startRecognitionRef = useRef<(() => void) | null>(null);

  /** Stop the recorder and await its final blob. Returns null if nothing was recorded. */
  const finishRecordingForTranscript = useCallback(async (): Promise<Blob | null> => {
    const rec = recorderRef.current;
    if (!rec) return null;
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (levelLoopRef.current) {
      cancelAnimationFrame(levelLoopRef.current);
      levelLoopRef.current = 0;
    }

    const result = new Promise<Blob | null>((resolve) => {
      const onStop = () => {
        rec.removeEventListener("stop", onStop);
        const chunks = audioChunksRef.current;
        audioChunksRef.current = [];
        if (!chunks.length) {
          resolve(null);
          return;
        }
        const type = recorderMimeRef.current || "audio/webm";
        resolve(new Blob(chunks, { type }));
      };
      rec.addEventListener("stop", onStop);
      try {
        if (rec.state !== "inactive") rec.stop();
        else onStop();
      } catch {
        rec.removeEventListener("stop", onStop);
        resolve(null);
      }
    });

    recorderRef.current = null;
    return result;
  }, []);

  const transcribeBlob = useCallback(async (blob: Blob): Promise<string> => {
    const fd = new FormData();
    const ext = (blob.type.includes("ogg")
      ? "ogg"
      : blob.type.includes("mp4")
      ? "mp4"
      : "webm");
    fd.append("audio", blob, `speech.${ext}`);
    const res = await fetch("/api/intake-stt", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Could not transcribe audio.");
    return String(data.text ?? "").trim();
  }, []);

  const flushTranscript = useCallback(async () => {
    if (processingRef.current || !overlayActiveRef.current) return;

    const sessionAtFlush = sessionCounterRef.current;
    const stillThisSession = () =>
      overlayActiveRef.current && sessionCounterRef.current === sessionAtFlush;

    processingRef.current = true;
    setPhase("thinking");
    setHint(null);

    let raw = "";
    try {
      const blob = await finishRecordingForTranscript();
      if (!stillThisSession()) {
        processingRef.current = false;
        return;
      }
      if (!blob || blob.size < 500) {
        if (typeof console !== "undefined") {
          console.log("[LiveIntake] empty audio chunk — restarting mic");
        }
        processingRef.current = false;
        if (stillThisSession()) {
          setPhase("listening");
          startRecognitionRef.current?.();
        }
        return;
      }
      raw = (await transcribeBlob(blob)).trim();
      if (!stillThisSession()) {
        processingRef.current = false;
        return;
      }
      if (!raw) {
        if (typeof console !== "undefined") {
          console.log("[LiveIntake] Whisper returned empty text");
        }
        processingRef.current = false;
        if (stillThisSession()) {
          setPhase("listening");
          startRecognitionRef.current?.();
        }
        return;
      }
    } catch (e) {
      if (stillThisSession()) {
        setHint(e instanceof Error ? e.message : "Transcription failed.");
      }
      processingRef.current = false;
      if (stillThisSession()) {
        setPhase("listening");
        startRecognitionRef.current?.();
      }
      return;
    }

    liveTranscriptRef.current = raw;
    setTranscriptDisplay(raw);
    turnCountRef.current += 1;
    if (typeof console !== "undefined") {
      console.log("[LiveIntake] sending turn", { intakeStep: intakeStepRef.current, raw });
    }

    let suppressMicRestart = false;

    try {
      if (livePhaseRef.current === "confirm") {
        const verdict = classifyConfirmationReply(raw);
        const stepIdx = intakeStepRef.current;
        const lastStep = stepIdx === INTAKE_STEPS.length - 1;

        if (typeof console !== "undefined") {
          console.log("[LiveIntake] confirm verdict", { stepIdx, verdict, raw });
        }

        if (verdict === "yes") {
          if (lastStep) {
            livePhaseRef.current = "handoff";
            await playTtsRef.current(LIVE_INTAKE_HANDOFF_QUESTION_SCRIPT);
            return;
          }
          livePhaseRef.current = "goal";
          const cur = stepIdx;
          onAdvanceStepRef.current();
          if (cur < INTAKE_STEPS.length - 1) intakeStepRef.current = cur + 1;
          setTranscriptDisplay("");
          /** intakeStep effect plays the next opening + restarts the mic. */
          suppressMicRestart = true;
          return;
        }

        /** "no" → fall through; the user's reply will be processed as a normal turn for the same step. */
        livePhaseRef.current = "goal";
      }

      if (livePhaseRef.current === "handoff") {
        const res = await fetch("/api/intake-voice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "handoff",
            userText: raw,
            client: clientRef.current,
          }),
        });
        if (!stillThisSession()) return;
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Could not process.");

        const action: LiveIntakeHandoffAction =
          data.handoffAction === "paper" ||
          data.handoffAction === "digital_email" ||
          data.handoffAction === "advisor_upload"
            ? data.handoffAction
            : "none";

        if (action === "paper") {
          await playTtsRef.current(
            personalizeLiveIntakeScript(
              LIVE_INTAKE_PAPER_SIGNOFF_SCRIPT,
              clientRef.current,
              advisorDisplayNameRef.current
            )
          );
          if (!stillThisSession()) return;
          suppressMicRestart = true;
          await Promise.resolve(onCompleteToUploadRef.current("paper"));
          return;
        }

        if (action === "digital_email") {
          await playTtsRef.current(LIVE_INTAKE_DIGITAL_ACK_SCRIPT);
          if (!stillThisSession()) return;
          suppressMicRestart = true;
          await Promise.resolve(onCompleteToUploadRef.current("digital_email"));
          return;
        }

        if (action === "advisor_upload") {
          await playTtsRef.current(
            personalizeLiveIntakeScript(
              LIVE_INTAKE_UPLOAD_CLOSING_SCRIPT,
              clientRef.current,
              advisorDisplayNameRef.current
            )
          );
          if (!stillThisSession()) return;
          suppressMicRestart = true;
          await Promise.resolve(onCompleteToUploadRef.current("advisor_upload"));
          return;
        }

        if (data.assistantMessage) await playTtsRef.current(data.assistantMessage);
        if (!stillThisSession()) return;
        await playTtsRef.current(LIVE_INTAKE_HANDOFF_QUESTION_SCRIPT);
        return;
      }

      const res = await fetch("/api/intake-voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "turn",
          intakeStep: intakeStepRef.current,
          client: clientRef.current,
          userText: raw,
        }),
      });
      if (!stillThisSession()) return;
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not process.");

      let merged = clientRef.current;
      if (data.clientPatch && typeof data.clientPatch === "object") {
        merged = applyIntakePatch(merged, data.clientPatch as Partial<Record<keyof IntakeClient, unknown>>);
        clientRef.current = merged;
        setClient(merged);
      }

      const stepIdx = intakeStepRef.current;
      if (stepIdx === 0 && !canAdvanceIntakeStep(0, merged)) {
        const extra: Partial<IntakeClient> = {};
        boostIdentityFromUtterance(raw, extra);
        if (Object.keys(extra).length > 0) {
          merged = applyIntakePatch(merged, extra);
          clientRef.current = merged;
          setClient(merged);
        }
      }
      const serverAdvance = data.advance === true;
      const satisfied = canAdvanceIntakeStep(stepIdx, merged);

      if (typeof console !== "undefined") {
        console.log("[LiveIntake] turn result", {
          intakeStep: stepIdx,
          serverAdvance,
          satisfied,
          patch: data.clientPatch,
          merged,
        });
      }

      if (serverAdvance || satisfied) {
        /** Don't advance yet — read the answer back and wait for a yes/no. */
        livePhaseRef.current = "confirm";
        const confirmation = buildStepConfirmationScript(stepIdx, merged);
        await playTtsRef.current(confirmation);
        return;
      }

      if (data.assistantMessage) {
        await playTtsRef.current(data.assistantMessage);
      }
    } catch (e) {
      if (stillThisSession()) {
        setHint(e instanceof Error ? e.message : "Something went wrong.");
      }
    } finally {
      processingRef.current = false;
      if (suppressMicRestart) return;
      if (stillThisSession()) {
        setPhase("listening");
        startRecognitionRef.current?.();
      }
    }
  }, [finishRecordingForTranscript, setClient, transcribeBlob]);

  useEffect(() => {
    flushTranscriptRef.current = flushTranscript;
  }, [flushTranscript]);

  const startRecognition = useCallback(() => {
    if (!overlayActiveRef.current) return;
    if (typeof MediaRecorder === "undefined") {
      setHint("Audio recording isn't supported in this browser.");
      return;
    }

    const stream = mediaStreamRef.current;
    if (!stream) {
      // Setup will call us again once getUserMedia resolves.
      return;
    }

    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (levelLoopRef.current) {
      cancelAnimationFrame(levelLoopRef.current);
      levelLoopRef.current = 0;
    }
    if (recorderRef.current) {
      try {
        if (recorderRef.current.state !== "inactive") recorderRef.current.stop();
      } catch {
        /* ignore */
      }
      recorderRef.current = null;
    }

    audioChunksRef.current = [];
    sawSpeechRef.current = false;
    recordStartedAtRef.current = Date.now();
    liveTranscriptRef.current = "";

    const mime = pickRecorderMime();
    let rec: MediaRecorder;
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (e) {
      setHint(e instanceof Error ? e.message : "Could not start recorder.");
      return;
    }
    recorderMimeRef.current = rec.mimeType || mime || "audio/webm";
    recorderRef.current = rec;

    rec.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) audioChunksRef.current.push(ev.data);
    };
    rec.onerror = (ev) => {
      if (!overlayActiveRef.current) return;
      const msg = (ev as { error?: { message?: string } })?.error?.message || "Recorder error";
      setHint(msg);
    };

    try {
      rec.start(250); // emit chunks every 250ms so a stop() always has data
      setPhase("listening");
    } catch (e) {
      setHint(e instanceof Error ? e.message : "Could not start listening.");
      return;
    }

    // Audio-level VAD: while recording, monitor analyser energy and end the turn after sustained silence.
    const analyser = analyserRef.current;
    if (analyser) {
      const data = new Uint8Array(analyser.frequencyBinCount);
      let lastSpeechAt = 0;
      const tick = () => {
        if (!overlayActiveRef.current) return;
        if (recorderRef.current !== rec) return;

        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length / 255;

        const now = Date.now();
        const elapsed = now - recordStartedAtRef.current;

        if (avg > SPEECH_LEVEL_THRESHOLD) {
          if (!sawSpeechRef.current) sawSpeechRef.current = true;
          lastSpeechAt = now;
        }

        if (elapsed >= MAX_RECORD_MS) {
          void flushTranscriptRef.current?.();
          return;
        }

        if (
          sawSpeechRef.current &&
          elapsed >= MIN_SPEECH_MS &&
          lastSpeechAt > 0 &&
          now - lastSpeechAt >= SILENCE_MS
        ) {
          void flushTranscriptRef.current?.();
          return;
        }

        levelLoopRef.current = requestAnimationFrame(tick);
      };
      levelLoopRef.current = requestAnimationFrame(tick);
    }
  }, []);

  useEffect(() => {
    startRecognitionRef.current = startRecognition;
  }, [startRecognition]);

  const runOpeningForStep = useCallback(async (stepIndex: number) => {
    const sessionAtStart = sessionCounterRef.current;
    const stillThisSession = () =>
      overlayActiveRef.current && sessionCounterRef.current === sessionAtStart;

    if (!stillThisSession()) return;
    stopRecognitionRef.current();
    setPhase("starting");
    const res = await fetch("/api/intake-voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "opening",
        intakeStep: stepIndex,
        client: clientRef.current,
      }),
    });
    if (!stillThisSession()) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Could not load prompt.");
    if (data.assistantMessage) await playTtsRef.current(data.assistantMessage);
  }, []);

  /**
   * Tracks last step we ran a "step change" opening for. Bootstrap handles the initial step;
   * this effect only runs when intakeStep actually changes (not on Strict Mode's second effect pass).
   */
  const lastStepOpeningRef = useRef<number | null>(null);

  /** Run once when overlay opens — empty deps: never re-run because `flushTranscript` / other callbacks changed (that caused duplicate sessions + double voice). */
  useEffect(() => {
    livePhaseRef.current = "goal";
    sessionCounterRef.current += 1;
    const session = sessionCounterRef.current;
    overlayActiveRef.current = true;
    let cancelled = false;

    const stillThisSession = () =>
      !cancelled && overlayActiveRef.current && sessionCounterRef.current === session;

    async function setup() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        if (!stillThisSession()) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        mediaStreamRef.current = stream;

        try {
          const Ctx =
            window.AudioContext ||
            (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (Ctx) {
            const ctx = new Ctx();
            audioContextRef.current = ctx;
            const src = ctx.createMediaStreamSource(stream);
            const an = ctx.createAnalyser();
            an.fftSize = 512;
            an.smoothingTimeConstant = 0.65;
            src.connect(an);
            analyserRef.current = an;
            setAnalyser(an);
          }
        } catch (e) {
          if (typeof console !== "undefined") console.warn("[LiveIntake] analyser setup failed", e);
        }
      } catch {
        if (stillThisSession()) {
          setHint("Microphone access is needed for live intake.");
        }
      }

      if (!stillThisSession()) return;
      setPhase("starting");
      setHint(null);
      try {
        await playTtsRef.current(
          personalizeLiveIntakeScript(
            LIVE_INTAKE_OPENING_SCRIPT,
            clientRef.current,
            advisorDisplayNameRef.current
          )
        );
        if (!stillThisSession()) return;
        await runOpeningForStep(intakeStepRef.current);
      } catch (e) {
        if (stillThisSession()) {
          setHint(e instanceof Error ? e.message : "Could not start live intake.");
        }
      }

      if (!stillThisSession()) return;
      startRecognitionRef.current?.();
    }

    void setup();

    return () => {
      cancelled = true;
      overlayActiveRef.current = false;
      sessionCounterRef.current += 1;
      stopRecognitionRef.current();
      stopAudioPlayback();
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (levelLoopRef.current) {
        cancelAnimationFrame(levelLoopRef.current);
        levelLoopRef.current = 0;
      }
      analyserRef.current = null;
      setAnalyser(null);
      try {
        audioContextRef.current?.close();
      } catch {
        /* ignore */
      }
      audioContextRef.current = null;
      const stream = mediaStreamRef.current;
      mediaStreamRef.current = null;
      stream?.getTracks().forEach((tr) => tr.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only one live session per open; deps would duplicate mic + TTS
  }, []);

  useEffect(() => {
    const prev = lastStepOpeningRef.current;
    if (prev === null) {
      lastStepOpeningRef.current = intakeStep;
      return;
    }
    if (prev === intakeStep) return;
    lastStepOpeningRef.current = intakeStep;

    if (!overlayActiveRef.current) return;
    const sessionAtEffect = sessionCounterRef.current;
    let cancelled = false;
    const stillOk = () =>
      !cancelled && overlayActiveRef.current && sessionCounterRef.current === sessionAtEffect;

    void (async () => {
      stopRecognitionRef.current();
      try {
        await runOpeningForStep(intakeStep);
      } catch (e) {
        if (stillOk()) {
          setHint(e instanceof Error ? e.message : "Could not load next step.");
        }
      }
      if (stillOk()) startRecognitionRef.current?.();
    })();
    return () => {
      cancelled = true;
    };
  }, [intakeStep, runOpeningForStep]);

  const visualBoost = phase === "listening" ? 1.15 : phase === "speaking" ? 0.45 : 0.65;

  const ui = (
    <div className="fixed inset-0 z-[100] flex flex-col bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="flex items-center justify-end p-4">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-full text-white hover:bg-white/10"
          onClick={() => {
            overlayActiveRef.current = false;
            sessionCounterRef.current += 1;
            stopRecognitionRef.current();
            stopAudioPlayback();
            onClose();
          }}
          aria-label="Close live intake"
        >
          <X className="h-6 w-6" />
        </Button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-10 px-6 pb-16">
        {/* Circular logo with voice-level bars radiating around it. */}
        <div className="relative aspect-square w-full max-w-[460px]">
          <div className="absolute inset-0">
            <CircularBars analyser={analyser} boost={visualBoost} />
          </div>
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-[58%] w-[58%] overflow-hidden rounded-full bg-white shadow-2xl shadow-sky-500/30 ring-2 ring-sky-300/40">
              {logoOk ? (
                <Image
                  src="/logo.png"
                  alt=""
                  width={320}
                  height={320}
                  className="h-full w-full object-contain p-6"
                  onError={() => setLogoOk(false)}
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center font-serif text-5xl font-bold tracking-tight text-slate-900">
                  AP
                </span>
              )}
            </div>
          </div>
        </div>

        {transcriptDisplay && (
          <p className="max-w-xl rounded-2xl bg-white/5 px-5 py-3 text-center text-base text-slate-100">
            “{transcriptDisplay}”
          </p>
        )}

        {hint && (
          <p className="max-w-md text-center text-sm text-amber-200/90" role="alert">
            {hint}
          </p>
        )}
      </div>
    </div>
  );

  if (!mounted || typeof document === "undefined") return null;
  return createPortal(ui, document.body);
}

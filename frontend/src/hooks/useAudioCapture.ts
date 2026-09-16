"use client";

import { useCallback, useRef, useState, useEffect } from "react";

export type RecordingState = "idle" | "requesting" | "recording" | "paused";

interface UseAudioCaptureReturn {
  state: RecordingState;
  start: () => Promise<void>;
  stop: () => void;
  clear: () => void;
  transcript: string;
  setTranscript: React.Dispatch<React.SetStateAction<string>>;
  chunks: Blob[];
  addTranscriptChunk: (text: string) => void;
  wordCount: number;
  chunkCount: number;
  status: string;
  isSpeechActive: boolean;
  currentVolume: number;
}

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

export function useAudioCapture(): UseAudioCaptureReturn {
  const [state, setState] = useState<RecordingState>("idle");
  const [chunks, setChunks] = useState<Blob[]>([]);
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState("Ready — click Start Mic and speak naturally.");
  const [isSpeechActive, setIsSpeechActive] = useState(false);
  const [currentVolume, setCurrentVolume] = useState(0);

  const VAD_THRESHOLD = 0.008;
  const VAD_COOLDOWN_MS = 300;
  const SILENCE_TIMEOUT_MS = 1500;

  const vadRef = useRef<{
    isSpeech: boolean;
    lastTransitionTime: number;
    silenceStartTime: number | null;
    audioContext: AudioContext | null;
    analyser: AnalyserNode | null;
    dataArray: Uint8Array<ArrayBuffer> | null;
    animationFrameId: number | null;
  }>({
    isSpeech: false,
    lastTransitionTime: 0,
    silenceStartTime: null,
    audioContext: null,
    analyser: null,
    dataArray: null,
    animationFrameId: null,
  });

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const mimeTypeRef = useRef<string>("");
  const allRawChunksRef = useRef<Blob[]>([]);
  const savedBlobRef = useRef<Blob | null>(null);

  const wordCount = transcript ? transcript.split(/\s+/).filter(Boolean).length : 0;
  const chunkCount = chunks.length;

  const addTranscriptChunk = useCallback((text: string) => {
    setTranscript((prev) => (prev ? prev + " " + text : text));
  }, []);

  useEffect(() => {
    return () => {
      const vad = vadRef.current;
      if (vad.animationFrameId !== null) cancelAnimationFrame(vad.animationFrameId);
      if (vad.audioContext) vad.audioContext.close();
    };
  }, []);

  /* ----- stop capture ----- */
  const stop = useCallback(() => {
    const vad = vadRef.current;
    if (vad.animationFrameId !== null) {
      cancelAnimationFrame(vad.animationFrameId);
      vad.animationFrameId = null;
    }

    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (vad.audioContext) {
      vad.audioContext.close();
      vad.audioContext = null;
      vad.analyser = null;
      vad.dataArray = null;
    }

    setState("idle");
    setIsSpeechActive(false);
    setCurrentVolume(0);
    setStatus("⏸️ Stopped — review transcript and click Process to summarise.");
  }, []);

  /* ----- clear everything ----- */
  const clear = useCallback(() => {
    setChunks([]);
    setTranscript("");
    allRawChunksRef.current = [];
    savedBlobRef.current = null;
    setStatus("Ready — click Start Mic and speak naturally.");
  }, []);

  /* ----- start capture ----- */
  const start = useCallback(async () => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      setStatus("❌ getUserMedia not available. Use HTTPS or localhost.");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setStatus("❌ MediaRecorder not supported in this browser.");
      return;
    }

    setStatus("🎙️ Requesting microphone access...");
    setState("requesting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch (err: unknown) {
      let userMsg = "Unknown error";
      if (err instanceof DOMException) {
        switch (err.name) {
          case "NotAllowedError": userMsg = "Microphone permission denied."; break;
          case "NotFoundError": userMsg = "No microphone found."; break;
          case "NotReadableError": userMsg = "Microphone in use by another app."; break;
          default: userMsg = `${err.name}: ${err.message}`;
        }
      } else if (err instanceof Error) {
        userMsg = err.message;
      }
      setStatus(`❌ Mic access failed: ${userMsg}`);
      setState("idle");
      return;
    }

    streamRef.current = stream;

    // VAD setup
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;

    vadRef.current = {
      isSpeech: false,
      lastTransitionTime: Date.now(),
      silenceStartTime: null,
      audioContext,
      analyser,
      dataArray,
      animationFrameId: null,
    };

    const vadLoop = () => {
      const vad = vadRef.current;
      if (!vad.analyser || !vad.dataArray) return;

      vad.analyser.getByteTimeDomainData(vad.dataArray);
      let sum = 0;
      for (let i = 0; i < vad.dataArray.length; i++) {
        const v = (vad.dataArray[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / vad.dataArray.length);
      setCurrentVolume(rms);

      const now = Date.now();
      if (rms > VAD_THRESHOLD) {
        if (!vad.isSpeech && now - vad.lastTransitionTime > VAD_COOLDOWN_MS) {
          vad.isSpeech = true;
          vad.silenceStartTime = null;
          vad.lastTransitionTime = now;
          setIsSpeechActive(true);
          setStatus("🗣️ Speech detected — capturing audio");
        }
      } else if (vad.isSpeech) {
        if (vad.silenceStartTime === null) vad.silenceStartTime = now;
        if (now - vad.silenceStartTime > SILENCE_TIMEOUT_MS) {
          vad.isSpeech = false;
          vad.silenceStartTime = null;
          vad.lastTransitionTime = now;
          setIsSpeechActive(false);
          setStatus("⏸️ Silence detected — buffering paused");
        }
      }

      vad.animationFrameId = requestAnimationFrame(vadLoop);
    };
    vadLoop();

    // MediaRecorder setup
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : "";

    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch (err) {
      setStatus(`❌ Failed to create recorder: ${err instanceof Error ? err.message : err}`);
      stream.getTracks().forEach((t) => t.stop());
      vadRef.current.audioContext?.close();
      setState("idle");
      return;
    }

    recorderRef.current = recorder;
    mimeTypeRef.current = recorder.mimeType;
    allRawChunksRef.current = [];

    // Collect ALL chunks — no VAD filtering on chunks (VAD only for UI indicators)
    // Merging partial WebM chunks causes invalid_media_file errors on Groq
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        allRawChunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      const frameId = vadRef.current?.animationFrameId;
      if (frameId !== null && frameId !== undefined) {
        cancelAnimationFrame(frameId);
        if (vadRef.current) vadRef.current.animationFrameId = null;
      }

      const finalChunks = allRawChunksRef.current.splice(0);
      const savedMimeType = mimeTypeRef.current;
      recorderRef.current = null;
      mimeTypeRef.current = "";

      if (finalChunks.length > 0) {
        const blob = new Blob(finalChunks, { type: savedMimeType || "audio/webm" });
        if (blob.size > 100) {
          savedBlobRef.current = blob;
          setChunks([blob]);
          setStatus("✅ Recording saved — click Process to get AI summary.");
        } else {
          setChunks([]);
          savedBlobRef.current = null;
          setStatus("⚠️ Recording too small. Try speaking longer.");
        }
      } else {
        setChunks([]);
        savedBlobRef.current = null;
        setStatus("❌ No audio recorded. Check your microphone.");
      }
    };

    recorder.onerror = (event) => {
      console.error("[AudioCapture] Recorder error:", event);
    };

    try {
      // No timeslice — single blob at stop(), avoids WebM container fragmentation
      recorder.start();
    } catch (err) {
      setStatus(`❌ Failed to start recording: ${err instanceof Error ? err.message : err}`);
      stream.getTracks().forEach((t) => t.stop());
      vadRef.current.audioContext?.close();
      setState("idle");
      return;
    }

    setState("recording");
    setIsSpeechActive(false);
    setCurrentVolume(0);
    setStatus("🎙️ Recording — speak now. VAD is active.");
  }, []);

  return {
    state,
    start,
    stop,
    clear,
    transcript,
    setTranscript,
    chunks,
    addTranscriptChunk,
    wordCount,
    chunkCount,
    status,
    isSpeechActive,
    currentVolume,
  };
}

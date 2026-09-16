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
  /** Interim (live) text being spoken right now */
  interimTranscript: string;
  chunks: Blob[];
  addTranscriptChunk: (text: string) => void;
  wordCount: number;
  chunkCount: number;
  status: string;
  isSpeechActive: boolean;
  currentVolume: number;
}

// Extend window type for webkit SpeechRecognition
declare global {
  interface Window {
    webkitSpeechRecognition: typeof SpeechRecognition;
    SpeechRecognition: typeof SpeechRecognition;
  }
}

export function useAudioCapture(): UseAudioCaptureReturn {
  const [state, setState] = useState<RecordingState>("idle");
  const [chunks, setChunks] = useState<Blob[]>([]);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [status, setStatus] = useState("Ready — click Start Mic and speak naturally.");
  const [isSpeechActive, setIsSpeechActive] = useState(false);
  const [currentVolume, setCurrentVolume] = useState(0);

  // VAD config
  const VAD_THRESHOLD = 0.008;
  const VAD_COOLDOWN_MS = 300;
  const SILENCE_TIMEOUT_MS = 1500;

  const vadRef = useRef<{
    isSpeech: boolean;
    lastTransitionTime: number;
    silenceStartTime: number | null;
    audioContext: AudioContext | null;
    analyser: AnalyserNode | null;
    dataArray: Uint8Array | null;
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
  const recordedChunksRef = useRef<Blob[]>([]);
  const allRawChunksRef = useRef<Blob[]>([]);
  // Stable ref for saved blob — so handleSave works even before state updates
  const savedBlobRef = useRef<Blob | null>(null);

  // Web Speech API refs
  const speechRecRef = useRef<SpeechRecognition | null>(null);
  const isRecordingRef = useRef(false);

  const wordCount = transcript ? transcript.split(/\s+/).filter(Boolean).length : 0;
  // Show recording size in KB instead of blob count (more meaningful)
  const chunkCount = chunks.length > 0 ? Math.round(chunks[0].size / 1024) : 0;

  const addTranscriptChunk = useCallback((text: string) => {
    setTranscript((prev) => (prev ? prev + " " + text : text));
  }, []);

  useEffect(() => {
    return () => {
      const vad = vadRef.current;
      if (vad.animationFrameId !== null) cancelAnimationFrame(vad.animationFrameId);
      if (vad.audioContext) vad.audioContext.close();
      if (speechRecRef.current) speechRecRef.current.stop();
    };
  }, []);

  /** Start Web Speech API for live real-time display */
  const startSpeechRecognition = useCallback(() => {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      console.warn("[SpeechRec] Web Speech API not supported in this browser");
      return;
    }

    const rec = new SpeechRec();
    rec.continuous = true;
    rec.interimResults = true;
    // Auto-detect Hindi and English
    rec.lang = "hi-IN"; // Hindi primary; browser will also pick up English
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let interim = "";
      let finalText = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript + " ";
        } else {
          interim += result[0].transcript;
        }
      }

      if (finalText) {
        setTranscript((prev) => (prev ? prev + " " + finalText.trim() : finalText.trim()));
        setInterimTranscript("");
      } else {
        setInterimTranscript(interim);
      }
    };

    rec.onerror = (event) => {
      // network errors are common on free tiers — just log
      console.warn("[SpeechRec] Error:", event.error);
      if (event.error === "no-speech") {
        setInterimTranscript("");
      }
    };

    rec.onend = () => {
      setInterimTranscript("");
      // Auto-restart if still recording
      if (isRecordingRef.current) {
        console.log("[SpeechRec] Restarting continuous recognition...");
        try {
          rec.start();
        } catch {
          // ignore if already started
        }
      }
    };

    speechRecRef.current = rec;
    try {
      rec.start();
      console.log("[SpeechRec] Started continuous recognition (hi-IN / en)");
    } catch (err) {
      console.warn("[SpeechRec] Could not start:", err);
    }
  }, []);

  const stopSpeechRecognition = useCallback(() => {
    isRecordingRef.current = false;
    if (speechRecRef.current) {
      try { speechRecRef.current.stop(); } catch { /* ignore */ }
      speechRecRef.current = null;
    }
    setInterimTranscript("");
  }, []);

  /* ----- stop capture ----- */
  const stop = useCallback(() => {
    console.log("[AudioCapture] stop() called");
    isRecordingRef.current = false;
    stopSpeechRecognition();

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
  }, [stopSpeechRecognition]);

  /* ----- clear everything ----- */
  const clear = useCallback(() => {
    setChunks([]);
    setTranscript("");
    setInterimTranscript("");
    recordedChunksRef.current = [];
    allRawChunksRef.current = [];
    savedBlobRef.current = null;
    setStatus("Ready — click Start Mic and speak naturally.");
  }, []);

  /* ----- start capture ----- */
  const start = useCallback(async () => {
    console.log("[AudioCapture] start() called");

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
    isRecordingRef.current = true;

    // Start live speech recognition (real-time display)
    startSpeechRecognition();

    // Set up VAD for volume visualization
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

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
        }
      } else if (vad.isSpeech) {
        if (vad.silenceStartTime === null) vad.silenceStartTime = now;
        if (now - vad.silenceStartTime > SILENCE_TIMEOUT_MS) {
          vad.isSpeech = false;
          vad.silenceStartTime = null;
          vad.lastTransitionTime = now;
          setIsSpeechActive(false);
        }
      }

      vad.animationFrameId = requestAnimationFrame(vadLoop);
    };
    vadLoop();

    // Set up MediaRecorder for full audio capture (for save + Whisper fallback)
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
    recordedChunksRef.current = [];
    allRawChunksRef.current = [];

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        allRawChunksRef.current.push(event.data);
        if (vadRef.current?.isSpeech) {
          recordedChunksRef.current.push(event.data);
        }
      }
    };

    recorder.onstop = () => {
      // Cancel VAD loop if still running (may already be cancelled by stop())
      const frameId = vadRef.current?.animationFrameId;
      if (frameId !== null && frameId !== undefined) {
        cancelAnimationFrame(frameId);
        if (vadRef.current) vadRef.current.animationFrameId = null;
      }

      let finalChunks = recordedChunksRef.current.splice(0);
      const savedMimeType = mimeTypeRef.current;
      recorderRef.current = null;
      mimeTypeRef.current = "";

      if (finalChunks.length === 0 && allRawChunksRef.current.length > 0) {
        console.warn("[AudioCapture] VAD found no speech — using full audio");
        finalChunks = allRawChunksRef.current.splice(0);
      }
      allRawChunksRef.current = [];

      if (finalChunks.length > 0) {
        const blob = new Blob(finalChunks, { type: savedMimeType || "audio/webm" });
        if (blob.size > 100) {
          // Store in ref AND state so save works immediately
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

    // Use timeslice so we accumulate chunks during recording (also fixes save during recording)
    try {
      recorder.start(1000); // collect a chunk every 1s
      console.log("[AudioCapture] MediaRecorder started with 1s timeslice");
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
    setStatus("🎙️ Recording — speak in Hindi or English, text appears instantly.");
  }, [startSpeechRecognition]);

  return {
    state,
    start,
    stop,
    clear,
    transcript,
    setTranscript,
    interimTranscript,
    chunks,
    addTranscriptChunk,
    wordCount,
    chunkCount,
    status,
    isSpeechActive,
    currentVolume,
  };
}

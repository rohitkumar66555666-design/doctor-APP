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
  /** Whether speech is currently detected (for UI indicators) */
  isSpeechActive: boolean;
  /** Current RMS volume level (0-1 range) for visualization */
  currentVolume: number;
}

/**
 * Manages microphone capture via MediaRecorder with Voice Activity Detection (VAD).
 * Uses Web Audio API (AnalyserNode) for real-time RMS-based speech detection.
 * Automatically filters out silence periods to reduce unnecessary API payload.
 *
 * Groq Whisper needs a properly structured media file — concatenating
 * incremental MediaRecorder fragments breaks the container format.
 */
export function useAudioCapture(): UseAudioCaptureReturn {
  const [state, setState] = useState<RecordingState>("idle");
  const [chunks, setChunks] = useState<Blob[]>([]);
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState(
    "Ready — click Start Mic and speak naturally."
  );
  const [isSpeechActive, setIsSpeechActive] = useState(false);
  const [currentVolume, setCurrentVolume] = useState(0);

  // VAD Configuration
  const VAD_THRESHOLD = 0.008; // RMS threshold for speech detection (lowered for normal mic input)
  const VAD_COOLDOWN_MS = 300; // Minimum ms between silence->speech transitions
  const SILENCE_TIMEOUT_MS = 1500; // Silence duration before pausing recording
  const FALLBACK_TO_FULL_AUDIO = true; // If no speech detected, use all audio chunks

  // Refs for VAD state management
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
  // All recorded data fragments live here until recording stops
  const recordedChunksRef = useRef<Blob[]>([]);
  // Fallback: Store ALL raw chunks (including silence) for fallback if VAD fails
  const allRawChunksRef = useRef<Blob[]>([]);

  const wordCount = transcript
    ? transcript.split(/\s+/).filter(Boolean).length
    : 0;
  const chunkCount = chunks.length;

  const addTranscriptChunk = useCallback((text: string) => {
    setTranscript((prev) => (prev ? prev + " " + text : text));
  }, []);

  // Cleanup VAD on unmount
  useEffect(() => {
    return () => {
      const vad = vadRef.current;
      if (vad.animationFrameId !== null) {
        cancelAnimationFrame(vad.animationFrameId);
      }
      if (vad.audioContext) {
        vad.audioContext.close();
      }
    };
  }, []);

  /* ----- stop capture ----- */
  const stop = useCallback(() => {
    console.log("[AudioCapture] stop() called");

    // Cancel VAD animation frame
    const vad = vadRef.current;
    if (vad.animationFrameId !== null) {
      cancelAnimationFrame(vad.animationFrameId);
      vad.animationFrameId = null;
    }

    // Stop the MediaRecorder — this triggers ondataavailable (async)
    // then onstop (async). We MUST NOT read recordedChunksRef here
    // because ondataavailable hasn't fired yet.
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
    // recorderRef is cleared inside the onstop handler

    // Stop all media tracks immediately (no new data will arrive)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        console.log(`[AudioCapture] Stopping track: ${track.kind} (${track.label})`);
        track.stop();
      });
      streamRef.current = null;
    }

    // Close audio context if open
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
    console.log("[AudioCapture] Recording stop initiated, waiting for final data...");
  }, []);

  /* ----- clear everything ----- */
  const clear = useCallback(() => {
    setChunks([]);
    setTranscript("");
    recordedChunksRef.current = [];
    allRawChunksRef.current = [];
    setStatus("Ready — click Start Mic and speak naturally.");
    console.log("[AudioCapture] Cleared all data");
  }, []);

  /* ----- start capture ----- */
  const start = useCallback(async () => {
    console.log("[AudioCapture] start() called");

    // Step 1: Check browser support
    if (!navigator?.mediaDevices?.getUserMedia) {
      const msg =
        "navigator.mediaDevices.getUserMedia is not available. " +
        "This usually means the page is NOT served over HTTPS (or localhost).";
      console.error("[AudioCapture]", msg);
      setStatus(`❌ ${msg}`);
      return;
    }

    // Step 2: Check MediaRecorder support
    if (typeof MediaRecorder === "undefined") {
      const msg = "MediaRecorder is not supported in this browser.";
      console.error("[AudioCapture]", msg);
      setStatus(`❌ ${msg}`);
      return;
    }

    // Step 3: Request mic permission
    console.log("[AudioCapture] Requesting microphone permission...");
    setStatus("🎙️ Requesting microphone access...");
    setState("requesting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
    } catch (err: unknown) {
      console.error("[AudioCapture] getUserMedia failed:", err);
      let userMsg = "Unknown error";
      if (err instanceof DOMException) {
        switch (err.name) {
          case "NotAllowedError":
            userMsg =
              "Microphone permission was denied. Please allow mic access in your browser settings and reload.";
            break;
          case "NotFoundError":
            userMsg =
              "No microphone found. Please connect a microphone and try again.";
            break;
          case "NotReadableError":
            userMsg =
              "Microphone is in use by another application. Close other apps using the mic and try again.";
            break;
          case "OverconstrainedError":
            userMsg =
              "The requested audio constraints cannot be satisfied by this device. Try a different microphone.";
            break;
          default:
            userMsg = `${err.name}: ${err.message}`;
        }
      } else if (err instanceof Error) {
        userMsg = err.message;
      }
      setStatus(`❌ Mic access failed: ${userMsg}`);
      setState("idle");
      return;
    }

    console.log("[AudioCapture] Mic permission granted, tracks:", stream.getAudioTracks().length);
    streamRef.current = stream;

    // Step 4: Set up Web Audio API for VAD (Voice Activity Detection)
    console.log("[AudioCapture] Setting up VAD with AnalyserNode...");
    const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024; // Good balance between responsiveness and accuracy
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    source.connect(analyser);
    // Don't connect to destination - we don't want to output the audio
    // (it would create feedback if monitoring)
    vadRef.current = {
      isSpeech: false,
      lastTransitionTime: Date.now(),
      silenceStartTime: null,
      audioContext,
      analyser,
      dataArray: new Uint8Array(bufferLength),
      animationFrameId: null,
    };

    // Start VAD monitoring loop
    console.log("[AudioCapture] Starting VAD monitoring loop...");
    const vadLoop = () => {
      if (!vadRef.current.analyser || !vadRef.current.dataArray) return;

      // Get RMS (Root Mean Square) volume level
      const currentDataArray = vadRef.current.dataArray;
      if (!currentDataArray) return;
      vadRef.current.analyser.getByteTimeDomainData(currentDataArray);
      let sum = 0;
      for (let i = 0; i < currentDataArray.length; i++) {
        // Convert byte (0-255) to amplitude (-1 to 1)
        const value = (currentDataArray[i] - 128) / 128;
        sum += value * value;
      }
      const rms = Math.sqrt(sum / currentDataArray.length);

      // Update volume for UI visualization
      setCurrentVolume(rms);

      // VAD logic: detect speech vs silence
      const now = Date.now();
      const vad = vadRef.current;

      if (rms > VAD_THRESHOLD) {
        // Speech detected
        if (!vad.isSpeech) {
          // Transition from silence to speech
          if (now - vad.lastTransitionTime > VAD_COOLDOWN_MS) {
            vad.isSpeech = true;
            vad.silenceStartTime = null;
            vad.lastTransitionTime = now;
            setIsSpeechActive(true);
            setStatus("🗣️ Speech detected — capturing audio");
            console.log(`[AudioCapture] VAD: Speech started (RMS: ${rms.toFixed(4)})`);
          }
        }
      } else {
        // Silence detected
        if (vad.isSpeech) {
          // Start counting silence duration
          if (vad.silenceStartTime === null) {
            vad.silenceStartTime = now;
          }

          // If silence exceeds timeout, mark as paused
          if (vad.silenceStartTime !== null && now - vad.silenceStartTime > SILENCE_TIMEOUT_MS) {
            const silenceDuration = now - vad.silenceStartTime;
            vad.isSpeech = false;
            vad.silenceStartTime = null;
            vad.lastTransitionTime = now;
            setIsSpeechActive(false);
            setStatus("⏸️ Silence detected — buffering paused");
            console.log(`[AudioCapture] VAD: Silence timeout (silence: ${silenceDuration}ms)`);
          }
        }
      }

      // Continue monitoring
      vad.animationFrameId = requestAnimationFrame(vadLoop);
    };
    vadLoop();

    // Step 5: Set up MediaRecorder
    const mimeType =
      MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "";

    console.log("[AudioCapture] Using MIME type:", mimeType || "(browser default)");

    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch (err) {
      console.error("[AudioCapture] MediaRecorder creation failed:", err);
      setStatus(`❌ Failed to create recorder: ${err instanceof Error ? err.message : err}`);
      stream.getTracks().forEach((t) => t.stop());
      if (vadRef.current?.audioContext) {
        vadRef.current.audioContext.close();
      }
      setState("idle");
      return;
    }

    recorderRef.current = recorder;
    mimeTypeRef.current = recorder.mimeType;
    recordedChunksRef.current = [];

    // Collect data fragments — only push when speech is active (VAD filtering)
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        // Always store a copy in the raw buffer for fallback
        allRawChunksRef.current.push(event.data);
        
        // VAD Filtering: Only keep audio chunks when speech is active (VAD filtering)
        if (vadRef.current?.isSpeech) {
          recordedChunksRef.current.push(event.data);
          console.log(`[AudioCapture] ondataavailable (speech): ${event.data.size} bytes (total: ${recordedChunksRef.current.length})`);
        } else {
          // Silently discard non-speech chunks from speech buffer to reduce payload
          console.log(`[AudioCapture] ondataavailable (silence): ${event.data.size} bytes - DISCARDED (kept in fallback buffer)`);
        }
      }
    };

    recorder.onstop = () => {
      console.log("[AudioCapture] MediaRecorder onstop fired, speech fragments:", recordedChunksRef.current.length);
      // Cancel VAD animation frame
      if (vadRef.current?.animationFrameId !== null) {
        cancelAnimationFrame(vadRef.current.animationFrameId);
        vadRef.current.animationFrameId = null;
      }
      // This fires AFTER the final ondataavailable, so all data is ready
      let finalChunks = recordedChunksRef.current.splice(0);
      const savedMimeType = mimeTypeRef.current;
      recorderRef.current = null;
      mimeTypeRef.current = "";
      
      // Fallback: If no speech chunks were captured, use ALL raw audio fragments
      if (finalChunks.length === 0 && allRawChunksRef.current.length > 0 && FALLBACK_TO_FULL_AUDIO) {
        console.warn("[AudioCapture] ⚠ No speech detected by VAD — falling back to FULL audio buffer");
        console.log(`[AudioCapture] Fallback: Using ${allRawChunksRef.current.length} raw audio fragments`);
        finalChunks = allRawChunksRef.current.splice(0);
        setStatus("⚠️ VAD detected no speech — using full audio recording instead");
      } else if (finalChunks.length === 0) {
        console.warn("[AudioCapture] No audio data recorded at all");
        setStatus("❌ No audio recorded. Please check your microphone and try again.");
      }
      
      // Clear raw chunks ref
      allRawChunksRef.current = [];
      
      if (finalChunks.length > 0) {
        const blob = new Blob(finalChunks, { type: savedMimeType || "audio/webm" });
        if (blob.size > 100) {
          const mode = finalChunks.length === recordedChunksRef.current.length + allRawChunksRef.current.length 
            ? "(full audio - VAD fallback)" 
            : "(speech only)";
          console.log(`[AudioCapture] ✅ Final recording ${mode}: ${blob.size} bytes (${finalChunks.length} fragments)`);
          setChunks([blob]);
          setStatus(savedMimeType ? "✅ Recording saved" : "✅ Recording saved");
        } else {
          console.warn("[AudioCapture] Recording too small, discarding:", blob.size, "bytes");
          setChunks([]);
          setStatus("⚠️ Recording too small. Try speaking for longer.");
        }
      } else {
        console.warn("[AudioCapture] No audio data recorded");
        setChunks([]);
      }
    };

    recorder.onerror = (event) => {
      console.error("[AudioCapture] MediaRecorder error:", event);
      setStatus(`❌ Recorder error: ${event}`);
    };

    // Step 6: Start recording (no timeslice — collect everything until stop)
    try {
      recorder.start();
      console.log("[AudioCapture] MediaRecorder started, state:", recorder.state);
    } catch (err) {
      console.error("[AudioCapture] recorder.start() failed:", err);
      setStatus(`❌ Failed to start recording: ${err instanceof Error ? err.message : err}`);
      stream.getTracks().forEach((t) => t.stop());
      if (vadRef.current?.audioContext) {
        vadRef.current.audioContext.close();
      }
      setState("idle");
      return;
    }

    setState("recording");
    setIsSpeechActive(false);
    setCurrentVolume(0);
    setStatus("🎙️ Recording — speak now. VAD is active.");
    console.log("[AudioCapture] Recording state set to 'recording', VAD active");
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

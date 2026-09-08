"use client";

import { useCallback, useState } from "react";
import { useAudioCapture } from "@/hooks/useAudioCapture";
import { transcribeAudio, summarizeTranscript } from "@/lib/api";
import type { MedicalSummary } from "@/lib/api";

/* ------------------------------------------------------------------ */
/*  Small reusable pieces                                              */
/* ------------------------------------------------------------------ */

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-indigo-50 px-3 py-1 text-sm font-semibold text-indigo-700">
      <span className="uppercase text-xs tracking-wider text-indigo-500">
        {label}
      </span>
      {value}
    </span>
  );
}

/**
 * Visual volume meter showing real-time audio levels
 */
function VolumeMeter({ volume, isSpeechActive }: { volume: number; isSpeechActive: boolean }) {
  // Convert volume (0-1) to percentage, cap at 100%
  const percentage = Math.min(100, Math.round(volume * 200)); // Scale for better visibility
  
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs font-medium text-gray-500 w-16">Volume:</span>
      <div className="flex-1 h-3 overflow-hidden rounded-full bg-gray-200">
        <div
          className={`h-full rounded-full transition-all duration-75 ${isSpeechActive
              ? "bg-gradient-to-r from-green-400 to-green-600"
              : "bg-gray-400"
            }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className={`text-xs font-semibold ${isSpeechActive ? "text-green-600" : "text-gray-400"}`}>
        {isSpeechActive ? "SPEAKING" : "silent"}
      </span>
    </div>
  );
}

function SectionCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-indigo-600">
        {title}
      </h3>
      {children}
    </div>
  );
}

function TagList({ items }: { items: string[] }) {
  if (!items || items.length === 0) {
    return <p className="text-sm text-gray-400 italic">None noted</p>;
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((item, i) => (
        <li
          key={i}
          className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"
        >
          {item}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export default function Home() {
  const audio = useAudioCapture();
  const [summary, setSummary] = useState<MedicalSummary | null>(null);
  const [processing, setProcessing] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  // VAD visual state for status bar
  const vadStatusText = audio.state === "recording"
    ? (audio.isSpeechActive ? "🗣️ Speech detected — actively recording" : "⏸️ Silence — VAD paused buffering")
    : "";

  /* ---------- Transcribe all buffered chunks ---------- */
  const handleTranscribe = useCallback(async (): Promise<string> => {
    if (audio.chunks.length === 0) return "";
    setTranscribing(true);
    audio.setTranscript("");
    let finalTranscript = "";

    try {
      for (let i = 0; i < audio.chunks.length; i++) {
        audio.setTranscript((prev) =>
          prev ? prev + ` [chunk ${i + 1}/${audio.chunks.length}]` : `[Transcribing chunk ${i + 1}/${audio.chunks.length}...]`
        );
        const text = await transcribeAudio(audio.chunks[i]);
        finalTranscript = finalTranscript ? finalTranscript + " " + text : text;
        // Replace the "transcribing…" placeholder with actual text
        audio.setTranscript((prev) => {
          const placeholder = `[Transcribing chunk ${i + 1}/${audio.chunks.length}...]`;
          const placeholder2 = `[chunk ${i + 1}/${audio.chunks.length}]`;
          return prev
            .replace(placeholder, text)
            .replace(placeholder2, text);
        });
      }
    } catch (err) {
      console.error(err);
      const errMsg = `⚠️ Transcription error: ${err instanceof Error ? err.message : "Unknown"}`;
      audio.setTranscript(errMsg);
      finalTranscript = "";
    } finally {
      setTranscribing(false);
    }
    return finalTranscript;
  }, [audio]);

  /* ---------- Summarise ---------- */
  const handleSummarise = useCallback(async (text?: string) => {
    const transcriptText = text || audio.transcript;
    if (!transcriptText.trim()) {
      console.warn("[UI] Summarise skipped — no transcript text");
      return;
    }
    console.log("[UI] Summarise starting, transcript length:", transcriptText.length);
    setProcessing(true);
    try {
      const result = await summarizeTranscript(transcriptText);
      setSummary(result);
    } catch (err) {
      console.error("[UI] Summarise error:", err);
    } finally {
      setProcessing(false);
    }
  }, [audio.transcript]);

  /* ---------- Save recording ---------- */
  const handleSave = useCallback(() => {
    if (audio.chunks.length === 0) return;
    const blob = new Blob(audio.chunks, { type: "audio/webm" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recording-${Date.now()}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  }, [audio.chunks]);

  /* ---------- Copy summary ---------- */
  const handleCopy = useCallback(() => {
    if (!summary) return;

    const formatMedicalPrescription = (s: MedicalSummary): string => {
      const lines: string[] = [];

      // Header
      lines.push("═══════════════════════════════════════════════════════════");
      lines.push("                    MEDICAL PRESCRIPTION");
      lines.push("═══════════════════════════════════════════════════════════");
      lines.push("");

      // 1. Patient Details
      lines.push("───────────────────────────────────────────────────────────");
      lines.push("  👤 PATIENT DETAILS");
      lines.push("───────────────────────────────────────────────────────────");
      lines.push(`  Name:    ${s.patient_details.name || "— Not recorded —"}`);
      lines.push(`  Age:     ${s.patient_details.age ?? "— Not recorded —"}`);
      lines.push(`  Gender:  ${s.patient_details.gender || "— Not recorded —"}`);
      lines.push("");

      // 2. Clinical Summary
      if (s.clinical_summary) {
        lines.push("───────────────────────────────────────────────────────────");
        lines.push("  📋 CLINICAL SUMMARY");
        lines.push("───────────────────────────────────────────────────────────");
        lines.push(`  ${s.clinical_summary}`);
        lines.push("");
      }

      // 3. Chief Complaints
      if (s.chief_complaint && s.chief_complaint.length > 0) {
        lines.push("───────────────────────────────────────────────────────────");
        lines.push("  🔴 CHIEF COMPLAINTS");
        lines.push("───────────────────────────────────────────────────────────");
        s.chief_complaint.forEach((c, i) => {
          lines.push(`  ${i + 1}. ${c}`);
        });
        lines.push("");
      }

      // 4. History of Present Illness
      if (s.history_of_present_illness) {
        lines.push("───────────────────────────────────────────────────────────");
        lines.push("  📖 HISTORY OF PRESENT ILLNESS");
        lines.push("───────────────────────────────────────────────────────────");
        lines.push(`  ${s.history_of_present_illness}`);
        lines.push("");
      }

      // 5. Symptoms
      const posSymptoms = s.symptoms?.positive || [];
      const negSymptoms = s.symptoms?.negative || [];
      if (posSymptoms.length > 0 || negSymptoms.length > 0) {
        lines.push("───────────────────────────────────────────────────────────");
        lines.push("  🔍 SYMPTOMS");
        lines.push("───────────────────────────────────────────────────────────");
        if (posSymptoms.length > 0) {
          lines.push("  ✅ Positive Findings:");
          posSymptoms.forEach((sym) => {
            lines.push(`     • ${sym}`);
          });
        }
        if (negSymptoms.length > 0) {
          lines.push("  ❌ Negative Findings (Denied):");
          negSymptoms.forEach((sym) => {
            lines.push(`     • ${sym}`);
          });
        }
        lines.push("");
      }

      // 6. Past Medical History
      const pmh = s.past_medical_history || [];
      if (pmh.length > 0) {
        lines.push("───────────────────────────────────────────────────────────");
        lines.push("  📂 PAST MEDICAL HISTORY");
        lines.push("───────────────────────────────────────────────────────────");
        pmh.forEach((item) => {
          lines.push(`  • ${item}`);
        });
        lines.push("");
      }

      // 7. Medication History & Allergies
      const meds = s.medication_history?.medications || [];
      const allergies = s.medication_history?.allergies || [];
      if (meds.length > 0 || allergies.length > 0) {
        lines.push("───────────────────────────────────────────────────────────");
        lines.push("  💊 MEDICATION HISTORY & ALLERGIES");
        lines.push("───────────────────────────────────────────────────────────");
        if (meds.length > 0) {
          lines.push("  Current Medications:");
          meds.forEach((med) => {
            lines.push(`     • ${med}`);
          });
        }
        if (allergies.length > 0) {
          lines.push("  ⚠️  Known Allergies:");
          allergies.forEach((allergy) => {
            lines.push(`     • ${allergy}`);
          });
        }
        lines.push("");
      }

      // 8. Clinical Observations
      const observations = s.clinical_observations || [];
      if (observations.length > 0) {
        lines.push("───────────────────────────────────────────────────────────");
        lines.push("  🔬 CLINICAL OBSERVATIONS & EXAMINATIONS");
        lines.push("───────────────────────────────────────────────────────────");
        observations.forEach((obs) => {
          lines.push(`  • ${obs}`);
        });
        lines.push("");
      }

      // 9. Assessment
      if (s.assessment) {
        lines.push("───────────────────────────────────────────────────────────");
        lines.push("  🎯 ASSESSMENT (PROVISIONAL DIAGNOSIS)");
        lines.push("───────────────────────────────────────────────────────────");
        lines.push(`  ${s.assessment}`);
        lines.push("");
      }

      // 10. Plan
      const plan = s.plan || {};
      const investigations = plan.investigations || [];
      const prescriptions = plan.prescriptions || [];
      const followUp = plan.follow_up || "";
      
      if (investigations.length > 0 || prescriptions.length > 0 || followUp) {
        lines.push("───────────────────────────────────────────────────────────");
        lines.push("  📌 MANAGEMENT PLAN");
        lines.push("───────────────────────────────────────────────────────────");
        
        if (investigations.length > 0) {
          lines.push("  🔬 Investigations Ordered:");
          investigations.forEach((inv) => {
            lines.push(`     • ${inv}`);
          });
          lines.push("");
        }
        
        if (prescriptions.length > 0) {
          lines.push("  💉 Prescriptions:");
          prescriptions.forEach((rx) => {
            lines.push(`     • ${rx}`);
          });
          lines.push("");
        }
        
        if (followUp) {
          lines.push("  📅 Follow-up:");
          lines.push(`     ${followUp}`);
          lines.push("");
        }
      }

      // Footer
      lines.push("───────────────────────────────────────────────────────────");
      lines.push("  Generated by Medical Transcription Studio");
      lines.push("  ───────────────────────────────────────────────────────────");

      return lines.join("\n");
    };

    const formattedText = formatMedicalPrescription(summary);
    navigator.clipboard.writeText(formattedText);
    console.log("[UI] Copy to Prescription: Formatted medical text copied to clipboard");
  }, [summary]);

  /* ---------- Derived info ---------- */
  const pd = summary?.patient_details;

  return (
    <div className="flex min-h-screen flex-col">
      {/* ---- Top bar ---- */}
      <header className="border-b border-gray-200 bg-white px-6 py-4 shadow-sm">
        <h1 className="text-xl font-bold text-gray-800">
          🩺 Medical Transcription Studio
        </h1>
      </header>

      {/* ---- Two-column layout ---- */}
      <main className="flex flex-1 flex-col gap-6 p-6 lg:flex-row">
        {/* ===================== LEFT PANEL ===================== */}
        <section className="flex flex-1 flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          {/* Header row */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-bold text-gray-800">
              📝 Live Medical Transcription
            </h2>
            <div className="flex flex-wrap gap-2">
              {/* Start Mic */}
              <button
                onClick={() => {
                  console.log("[UI] Start Mic button clicked, current state:", audio.state);
                  audio.start();
                }}
                disabled={audio.state === "recording" || audio.state === "requesting"}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {audio.state === "requesting" ? "🎙️ Requesting…" : audio.state === "recording" ? "🔴 Recording (VAD active)" : "▶ Start Mic"}
              </button>
              {/* Stop */}
              <button
                onClick={() => {
                  console.log("[UI] Stop button clicked, current state:", audio.state);
                  audio.stop();
                }}
                disabled={audio.state !== "recording"}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ⏹ Stop
              </button>
              {/* Clear */}
              <button
                onClick={audio.clear}
                className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-300"
              >
                🗑 Clear
              </button>
              {/* Save Recording */}
              <button
                onClick={handleSave}
                disabled={audio.chunks.length === 0}
                className="rounded-lg border-2 border-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-600 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                💾 Save Recording
              </button>
            </div>
          </div>

          {/* Live indicators */}
          <div className="flex flex-col gap-3">
            <div className="flex gap-3">
              <Stat label="WORDS:" value={audio.wordCount} />
              <Stat label="CHUNKS:" value={audio.chunkCount} />
            </div>
            {/* VAD Volume Meter */}
            {audio.state === "recording" && (
              <VolumeMeter volume={audio.currentVolume} isSpeechActive={audio.isSpeechActive} />
            )}
          </div>

          {/* Live transcript */}
          <div className="flex flex-1 flex-col gap-2">
            <label className="text-xs font-bold uppercase tracking-wider text-gray-500">
              Live Transcript
            </label>
            <div className="flex-1 min-h-[200px] max-h-[50vh] overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 p-4 font-mono text-sm leading-relaxed text-gray-800">
              {audio.transcript || (
                <span className="text-gray-400 italic">
                  Transcript will appear here as you speak…
                </span>
              )}
            </div>
          </div>

          {/* Status bar */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              {audio.state === "recording" && (
                <span className={`inline-block h-2 w-2 rounded-full ${audio.isSpeechActive ? "bg-green-500 animate-pulse" : "bg-yellow-400"}`} />
              )}
              {audio.state === "recording" && audio.isSpeechActive && (
                <span className="text-xs font-medium text-green-600">SPEECH ACTIVE</span>
              )}
              {audio.state === "recording" && !audio.isSpeechActive && (
                <span className="text-xs font-medium text-yellow-500">VAD SILENCE</span>
              )}
              <span className="ml-2 flex-1 text-gray-600">{audio.status}</span>
            </div>
          </div>

          {/* Process button */}
          <button
            onClick={async () => {
              console.log("[UI] Process button clicked, chunks:", audio.chunks.length, "existing transcript:", audio.transcript.length > 0 ? "yes" : "no");
              let transcriptText = audio.transcript;
              // Step 1: Transcribe audio chunks if we have recordings and no transcript yet
              if (audio.chunks.length > 0 && !transcriptText) {
                console.log("[UI] Step 1: Transcribing", audio.chunks.length, "chunk(s)...");
                transcriptText = await handleTranscribe();
                console.log("[UI] Transcription result length:", transcriptText.length);
              }
              // Step 2: Summarise the transcript
              if (transcriptText.trim()) {
                console.log("[UI] Step 2: Summarising...");
                await handleSummarise(transcriptText);
              } else {
                console.warn("[UI] No transcript to summarise");
              }
            }}
            disabled={processing || transcribing}
            className="w-full rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 px-6 py-3.5 text-base font-bold text-white shadow-lg transition hover:from-indigo-700 hover:to-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {processing
              ? "⏳ Processing with AI…"
              : transcribing
                ? "🎙 Transcribing…"
                : "🤖 Process Transcript with AI"}
          </button>
        </section>

        {/* ===================== RIGHT PANEL ===================== */}
        <section className="flex flex-1 flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          {/* Header */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-800">
              📋 AI Medical Summary
            </h2>
            <button
              onClick={() => setSummary(null)}
              className="rounded-lg bg-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-300"
            >
              🗑 Clear
            </button>
          </div>

          {/* Patient info card */}
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5">
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-indigo-600">
              👤 Patient Information
            </h3>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Name:</span>{" "}
                <span className="font-semibold">{pd?.name || "—"}</span>
              </div>
              <div>
                <span className="text-gray-500">Age:</span>{" "}
                <span className="font-semibold">
                  {pd?.age ?? "—"}
                </span>
              </div>
              <div>
                <span className="text-gray-500">Gender:</span>{" "}
                <span className="font-semibold">{pd?.gender || "—"}</span>
              </div>
            </div>
          </div>

          {/* Structured cards – scrollable */}
          <div className="flex-1 space-y-4 overflow-y-auto pr-1">
            {/* 1. Clinical Summary */}
            <SectionCard title="📋 Clinical Summary">
              <p className="text-sm leading-relaxed text-gray-700">
                {summary?.clinical_summary || (
                  <span className="italic text-gray-400">
                    Awaiting summarisation…
                  </span>
                )}
              </p>
            </SectionCard>

            {/* 2. Chief Complaints */}
            <SectionCard title="🔴 Chief Complaints">
              <TagList items={summary?.chief_complaint ?? []} />
            </SectionCard>

            {/* 3. Symptoms */}
            <SectionCard title="🔍 Symptoms">
              <div className="space-y-3">
                <div>
                  <p className="mb-1 text-xs font-bold text-green-600">
                    ✅ Positive
                  </p>
                  <TagList items={summary?.symptoms?.positive ?? []} />
                </div>
                <div>
                  <p className="mb-1 text-xs font-bold text-red-500">
                    ❌ Negative (denied)
                  </p>
                  <TagList items={summary?.symptoms?.negative ?? []} />
                </div>
              </div>
            </SectionCard>

            {/* 4. History of Present Illness */}
            <SectionCard title="📖 History of Present Illness">
              <p className="text-sm leading-relaxed text-gray-700">
                {summary?.history_of_present_illness || (
                  <span className="italic text-gray-400">
                    Awaiting summarisation…
                  </span>
                )}
              </p>
            </SectionCard>

            {/* 5. Past Medical History */}
            <SectionCard title="📂 Past Medical History">
              <TagList items={summary?.past_medical_history ?? []} />
            </SectionCard>

            {/* 6. Medication History & Allergies */}
            <SectionCard title="💊 Medication History & Allergies">
              <div className="space-y-3">
                <div>
                  <p className="mb-1 text-xs font-bold text-blue-600">
                    💊 Medications
                  </p>
                  <TagList
                    items={summary?.medication_history?.medications ?? []}
                  />
                </div>
                <div>
                  <p className="mb-1 text-xs font-bold text-red-500">
                    ⚠️ Allergies
                  </p>
                  <TagList items={summary?.medication_history?.allergies ?? []} />
                </div>
              </div>
            </SectionCard>

            {/* 7. Clinical Observations */}
            <SectionCard title="🔬 Clinical Observations & Examinations">
              <TagList items={summary?.clinical_observations ?? []} />
            </SectionCard>

            {/* 8. Assessment */}
            <SectionCard title="🎯 Assessment (Provisional Diagnosis)">
              <p className="text-sm leading-relaxed text-gray-700">
                {summary?.assessment || (
                  <span className="italic text-gray-400">
                    Awaiting summarisation…
                  </span>
                )}
              </p>
            </SectionCard>

            {/* 9. Plan */}
            <SectionCard title="📌 Plan">
              <div className="space-y-3">
                <div>
                  <p className="mb-1 text-xs font-bold text-purple-600">
                    🔬 Investigations
                  </p>
                  <TagList items={summary?.plan?.investigations ?? []} />
                </div>
                <div>
                  <p className="mb-1 text-xs font-bold text-blue-600">
                    💉 Prescriptions
                  </p>
                  <TagList items={summary?.plan?.prescriptions ?? []} />
                </div>
                <div>
                  <p className="mb-1 text-xs font-bold text-orange-600">
                    📅 Follow-up
                  </p>
                  <p className="text-sm text-gray-700">
                    {summary?.plan?.follow_up || (
                      <span className="italic text-gray-400">
                        No follow-up specified
                      </span>
                    )}
                  </p>
                </div>
              </div>
            </SectionCard>
          </div>

          {/* Copy to Prescription button */}
          <button
            onClick={handleCopy}
            disabled={!summary}
            className="w-full rounded-xl border-2 border-emerald-500 px-6 py-3.5 text-base font-bold text-emerald-600 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            📋 Copy to Prescription
          </button>
        </section>
      </main>
    </div>
  );
}

// Relative URLs — requests go to the same origin (Next.js), which proxies
// to FastAPI via the rewrite rule in next.config.ts.
// Works on localhost, Ngrok, or any other host with zero configuration.
const API_BASE = "";

export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  console.log(`[API] transcribeAudio → ${API_BASE}/api/transcribe, blob size: ${audioBlob.size}`);

  const formData = new FormData();
  formData.append("audio", audioBlob, "recording.webm");

  try {
    const res = await fetch(`${API_BASE}/api/transcribe`, {
      method: "POST",
      // Do NOT set custom headers with FormData — the browser must
      // auto-generate the Content-Type with the correct multipart boundary.
      // Custom headers also trigger a CORS preflight that tunnel services
      // (Pinggy/Ngrok) can intercept and break.
      body: formData,
    });

    if (!res.ok) {
      let errMsg = await res.text();
      try {
        const parsed = JSON.parse(errMsg);
        if (parsed.detail) errMsg = parsed.detail;
      } catch {}
      throw new Error(`Transcription failed (${res.status}): ${errMsg}`);
    }

    const data = await res.json();
    console.log("[API] transcribeAudio success:", data.transcript?.substring(0, 80));
    return data.transcript;
  } catch (error) {
    console.error("[API] transcribeAudio FAILED:", error);
    if (error instanceof TypeError && error.message === "Failed to fetch") {
      throw new Error(
        `Cannot reach backend at ${API_BASE}. ` +
        `Make sure your FastAPI server is running (uvicorn main:app --port 8000) ` +
        `and that the URL in NEXT_PUBLIC_API_URL is correct.`
      );
    }
    throw error;
  }
}

export interface MedicalSummary {
  patient_details: {
    name: string;
    age: number | null;
    gender: string;
  };
  clinical_summary: string;
  chief_complaint: string[];
  symptoms: { positive: string[]; negative: string[] };
  history_of_present_illness: string;
  past_medical_history: string[];
  medication_history: { medications: string[]; allergies: string[] };
  clinical_observations: string[];
  assessment: string;
  plan: {
    investigations: string[];
    prescriptions: string[];
    follow_up: string;
  };
}

export async function summarizeTranscript(
  transcript: string
): Promise<MedicalSummary> {
  console.log(`[API] summarizeTranscript → ${API_BASE}/api/summarize, length: ${transcript.length}`);

  try {
    const res = await fetch(`${API_BASE}/api/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript }),
    });

    if (!res.ok) {
      let errMsg = await res.text();
      try {
        const parsed = JSON.parse(errMsg);
        if (parsed.detail) errMsg = parsed.detail;
      } catch {}
      throw new Error(`Summarization failed (${res.status}): ${errMsg}`);
    }

    const data = await res.json();
    console.log("[API] summarizeTranscript success:", data.patient_details);
    return data;
  } catch (error) {
    console.error("[API] summarizeTranscript FAILED:", error);
    if (error instanceof TypeError && error.message === "Failed to fetch") {
      throw new Error(
        `Cannot reach backend at ${API_BASE}. ` +
        `Make sure your FastAPI server is running.`
      );
    }
    throw error;
  }
}
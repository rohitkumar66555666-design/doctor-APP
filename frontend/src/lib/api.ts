const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ||
  "https://doctor-app-j8og.onrender.com";

export const API_BASE = BACKEND_URL;

/** Fetch with automatic retry — handles Render free-tier cold starts (~30-50s) */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 2,
  timeoutMs = 60000
): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);
      return res;
    } catch (err) {
      clearTimeout(timer);
      const isLast = attempt === retries;
      if (isLast) throw err;
      console.warn(`[API] Attempt ${attempt} failed, retrying...`, err);
      // Wait 3s before retry
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error("All retries exhausted");
}

export async function transcribeAudio(audioBlob: Blob): Promise<string> {
  console.log(`[API] transcribeAudio → ${API_BASE}/api/transcribe, blob size: ${audioBlob.size}`);

  const formData = new FormData();
  formData.append("audio", audioBlob, "recording.webm");

  try {
    const res = await fetchWithRetry(`${API_BASE}/api/transcribe`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      let errMsg = await res.text();
      try {
        const parsed = JSON.parse(errMsg);
        if (parsed.detail) errMsg = parsed.detail;
      } catch { /* ignore */ }
      throw new Error(`Transcription failed (${res.status}): ${errMsg}`);
    }

    const data = await res.json();
    console.log("[API] transcribeAudio success:", data.transcript?.substring(0, 80));
    return data.transcript;
  } catch (error) {
    console.error("[API] transcribeAudio FAILED:", error);
    if (
      error instanceof TypeError && error.message === "Failed to fetch" ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw new Error(
        `Server is waking up — please wait ~30 seconds and try again. (${API_BASE})`
      );
    }
    throw error;
  }
}

export interface MedicalSummary {
  patient_details: { name: string; age: number | null; gender: string };
  clinical_summary: string;
  chief_complaint: string[];
  symptoms: { positive: string[]; negative: string[] };
  history_of_present_illness: string;
  past_medical_history: string[];
  medication_history: { medications: string[]; allergies: string[] };
  clinical_observations: string[];
  assessment: string;
  plan: { investigations: string[]; prescriptions: string[]; follow_up: string };
}

export async function summarizeTranscript(transcript: string): Promise<MedicalSummary> {
  console.log(`[API] summarizeTranscript → ${API_BASE}/api/summarize, length: ${transcript.length}`);

  try {
    const res = await fetchWithRetry(`${API_BASE}/api/summarize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transcript }),
    });

    if (!res.ok) {
      let errMsg = await res.text();
      try {
        const parsed = JSON.parse(errMsg);
        if (parsed.detail) errMsg = parsed.detail;
      } catch { /* ignore */ }
      throw new Error(`Summarization failed (${res.status}): ${errMsg}`);
    }

    const data = await res.json();
    console.log("[API] summarizeTranscript success:", data.patient_details);
    return data;
  } catch (error) {
    console.error("[API] summarizeTranscript FAILED:", error);
    if (
      error instanceof TypeError && error.message === "Failed to fetch" ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw new Error(
        `Server is waking up — please wait ~30 seconds and try again. (${API_BASE})`
      );
    }
    throw error;
  }
}

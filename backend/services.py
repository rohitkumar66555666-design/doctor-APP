"""
Services layer – handles all Groq API interactions (100% Free):
  1. Whisper speech-to-text transcription (whisper-large-v3-turbo)
  2. Qwen 3.6-27B structured medical summarisation (qwen/qwen3.6-27b)
"""

import os
import json
import httpx
from dotenv import load_dotenv
from groq import Groq
from schemas import MedicalSummary

# 1. Environment variables load karein
load_dotenv()

# 2. Key fetch karein
api_key = os.getenv("GROQ_API_KEY", "")

# 3. Explicit HTTP Client initialize karein (proxies bypass karne ke liye)
http_client = httpx.Client()
client = Groq(api_key=api_key, http_client=http_client) if api_key else None


# Languages we explicitly support forcing (ISO-639-1 codes)
SUPPORTED_LANGUAGES = {"en", "hi"}


def _whisper_transcribe(audio_bytes: bytes, filename: str, language: str | None = None):
    """Low-level Groq Whisper call. verbose_json gives us detected language + segment confidences."""
    kwargs: dict = {
        "file": (filename, audio_bytes),
        "model": "whisper-large-v3-turbo",
        "response_format": "verbose_json",
        "temperature": 0.0,
    }
    if language:
        kwargs["language"] = language  # Force Whisper to decode in this language
    return client.audio.transcriptions.create(**kwargs)


def _segment_confidence(response) -> tuple[float, float]:
    """Return (avg_logprob, avg_no_speech_prob) across segments. Closer-to-0 logprob = better."""
    segments = getattr(response, "segments", None) or []
    logprobs: list[float] = []
    no_speech: list[float] = []
    for seg in segments:
        if isinstance(seg, dict):
            lp, ns = seg.get("avg_logprob"), seg.get("no_speech_prob")
        else:
            lp, ns = getattr(seg, "avg_logprob", None), getattr(seg, "no_speech_prob", None)
        if lp is not None:
            logprobs.append(float(lp))
        if ns is not None:
            no_speech.append(float(ns))
    avg_lp = sum(logprobs) / len(logprobs) if logprobs else -1.0
    avg_ns = sum(no_speech) / len(no_speech) if no_speech else 0.0
    return avg_lp, avg_ns


def _has_devanagari(text: str) -> bool:
    """True if the text contains Devanagari (Hindi) characters."""
    return any("\u0900" <= ch <= "\u097f" for ch in text)


async def transcribe_audio(
    audio_bytes: bytes,
    filename: str = "recording.webm",
    language: str = "auto",
) -> str:
    """
    Language-aware transcription:
      - language="en"/"hi"  -> Whisper is FORCED to decode in that language (most reliable).
      - language="auto"     -> Whisper auto-detects, with a strong Hindi fallback:
                               * If it detects some other language (Indian users), retry as Hindi.
                               * If it detects English but confidence is low AND the Hindi pass
                                 scores clearly better, prefer the Hindi transcript (fixes the
                                 common "Hindi speech -> English text" mis-detection).
    """
    if not client:
        raise ValueError("GROQ_API_KEY is missing. Please check your backend/.env file.")

    whisper_filename = filename
    if not filename.endswith((".webm", ".mp4", ".ogg", ".wav", ".m4a", ".mp3")):
        whisper_filename = "recording.webm"

    lang = (language or "auto").strip().lower()

    # ---- 1. Explicit language: force decoding (strongest, zero ambiguity) ----
    if lang in SUPPORTED_LANGUAGES:
        response = _whisper_transcribe(audio_bytes, whisper_filename, language=lang)
        return (response.text or "").strip()

    # ---- 2. Auto mode: let Whisper detect the language ----
    response = _whisper_transcribe(audio_bytes, whisper_filename)
    detected = (getattr(response, "language", "") or "").lower()
    text = (response.text or "").strip()

    # ---- 3. Detected some other language (mr, bn, pa...) -> Indian users, retry as Hindi ----
    if detected and detected not in SUPPORTED_LANGUAGES:
        retry = _whisper_transcribe(audio_bytes, whisper_filename, language="hi")
        return ((retry.text or "") or text).strip()

    # ---- 4. English detected but low confidence -> try Hindi, keep the better one ----
    if detected == "en":
        lp1, ns1 = _segment_confidence(response)
        low_confidence = lp1 < -0.75 or ns1 > 0.35
        # Devanagari in the "English" text means it's actually Hinglish — already fine
        if low_confidence and not _has_devanagari(text):
            retry = _whisper_transcribe(audio_bytes, whisper_filename, language="hi")
            lp2, ns2 = _segment_confidence(retry)
            # Combined score: less-negative logprob and lower no-speech = better transcript.
            # Require a clear margin (+0.05) before switching, to avoid false flips.
            score1 = lp1 - (0.5 * ns1)
            score2 = lp2 - (0.5 * ns2)
            if score2 > score1 + 0.05:
                return (retry.text or text).strip()

    return text


def _clean_json(raw: str) -> dict:
    """Strip markdown fences and extract valid JSON from model output."""
    text = raw.strip()
    # Remove ```json ... ``` wrappers if present
    if text.startswith("```"):
        # Find the first and last triple-backtick lines
        lines = text.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        text = "\n".join(lines).strip()
    return json.loads(text)


async def summarize_transcript(transcript: str) -> MedicalSummary:
    """
    Feed the transcript to openai/gpt-oss-120b on Groq.
    JSON mode is enforced by the prompt (not response_format) because
    some models on Groq don't support response_format={type: json_object}.
    """
    if not client:
        raise ValueError("GROQ_API_KEY is missing. Please check your backend/.env file.")

    schema_instruction = (
        "You are an expert medical scribe. Analyse the following clinical transcription "
        "and produce a structured medical summary.\n\n"
        "RESPOND WITH VALID JSON ONLY — no markdown, no explanation, no code fences.\n\n"
        "JSON SCHEMA:\n"
        "{\n"
        '  "patient_details": {"name": "string", "age": "number or null", "gender": "string"},\n'
        '  "clinical_summary": "string",\n'
        '  "chief_complaint": ["string"],\n'
        '  "symptoms": {"positive": ["string"], "negative": ["string"]},\n'
        '  "history_of_present_illness": "string",\n'
        '  "past_medical_history": ["string"],\n'
        '  "medication_history": {"medications": ["string"], "allergies": ["string"]},\n'
        '  "clinical_observations": ["string"],\n'
        '  "assessment": "string",\n'
        '  "plan": {"investigations": ["string"], "prescriptions": ["string"], "follow_up": "string"}\n'
        "}\n\n"
        "RULES:\n"
        "- Only include information explicitly stated or clearly inferred from the transcript.\n"
        "- Keep 'negative' symptoms separate from 'positive'.\n"
        "- Use an empty string '' or empty list [] when the transcript contains no information for a field.\n"
        "- For patient_details, use sensible defaults (name '', age null, gender '') when not mentioned."
    )

    response = client.chat.completions.create(
        model="openai/gpt-oss-120b",
        messages=[
            {"role": "system", "content": schema_instruction},
            {"role": "user", "content": transcript},
        ],
        temperature=0.2,
    )

    raw_json = response.choices[0].message.content or "{}"
    parsed_data = _clean_json(raw_json)

    # Parse dict into Pydantic MedicalSummary object
    return MedicalSummary(**parsed_data)
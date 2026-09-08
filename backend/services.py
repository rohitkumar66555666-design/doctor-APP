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


async def transcribe_audio(audio_bytes: bytes, filename: str = "recording.webm") -> str:
    """Send audio bytes to Groq Whisper and return the transcript text."""
    if not client:
        raise ValueError("GROQ_API_KEY is missing. Please check your backend/.env file.")

    whisper_filename = filename
    if not filename.endswith((".webm", ".mp4", ".ogg", ".wav", ".m4a", ".mp3")):
        whisper_filename = "recording.webm"

    # Send audio to Groq Whisper Large V3 Turbo
    transcription = client.audio.transcriptions.create(
        file=(whisper_filename, audio_bytes),
        model="whisper-large-v3-turbo",
        response_format="json",
    )
    return transcription.text


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
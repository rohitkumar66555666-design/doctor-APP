"""
FastAPI backend for the Live Medical Transcription app.

Run with:
    uvicorn main:app --host 0.0.0.0 --port $PORT

For Render deployment, the PORT environment variable is set automatically.
"""

import os

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import APIStatusError

from schemas import TranscriptRequest, TranscriptResponse, MedicalSummary
from services import transcribe_audio, summarize_transcript

app = FastAPI(title="Medical Transcription API", version="1.0.0")

# Allow all origins (Ngrok, Pinggy, Mobile Browsers, Render, Vercel)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/transcribe", response_model=TranscriptResponse)
async def api_transcribe(audio: UploadFile = File(...)):
    """Accept an audio blob, send it to Groq Whisper, and return the transcript."""
    audio_bytes = await audio.read()
    filename = audio.filename or "recording.webm"
    try:
        transcript = await transcribe_audio(audio_bytes, filename)
    except APIStatusError as e:
        raise HTTPException(
            status_code=e.status_code,
            detail=f"Groq API error ({e.status_code}): {e.message}",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")
    return TranscriptResponse(transcript=transcript)


@app.post("/api/summarize", response_model=MedicalSummary)
async def api_summarize(payload: TranscriptRequest):
    """Accept a transcript string and return a structured medical summary."""
    try:
        summary = await summarize_transcript(payload.transcript)
    except APIStatusError as e:
        raise HTTPException(
            status_code=e.status_code,
            detail=f"Groq API error ({e.status_code}): {e.message}",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Summarization failed: {e}")
    return summary


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
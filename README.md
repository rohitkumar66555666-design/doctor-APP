# Medical Transcription Studio

A production-ready AI medical scribe application that captures live consultation audio, transcribes it with Whisper, filters silence with Voice Activity Detection (VAD), and converts the full transcript into a structured clinical summary.

- **Frontend:** Vercel  
- **Backend API:** Render (FastAPI)

Live links:

- Frontend: https://doctor-app-seven-tan.vercel.app
- Backend API Docs: https://doctor-app-j8og.onrender.com/docs

---

## Overview

Medical Transcription Studio is built for clinicians who want a fast, structured note-taking workflow:

1. Record a live consultation from the browser microphone.
2. Silence and background noise are filtered out in real time using VAD.
3. Speech is transcribed with Groq Whisper.
4. The final transcript is sent to an LLM for structured medical extraction.
5. A clean, copy-paste-ready medical summary is generated for record keeping.

---

## Tech Stack

### Frontend

- Next.js 16.3.4
- React 19.2.8
- TypeScript 5
- Tailwind CSS 4 (with PostCSS)
- Web Audio API for VAD
- MediaRecorder API for microphone capture
- Native `fetch` for API communication

### Backend

- Python 3.10+
- FastAPI 0.115.0
- Uvicorn 0.30.6 (with standard extras)
- Pydantic 2.9.2
- Groq SDK 0.11.0
- python-multipart 0.0.9
- python-dotenv 1.0.1
- httpx 0.27.2
- openai 1.50.0

### AI Services

- **ASR:** Groq Whisper `whisper-large-v3-turbo`
- **LLM Summarization:** Groq `openai/gpt-oss-120b`

### Hosting

- Frontend: Vercel
- Backend: Render

---

## Key Features

- **Live microphone capture** using `MediaRecorder`
- **Voice Activity Detection (VAD)** powered by the Web Audio API `AnalyserNode`
  - Real-time RMS-based speech/silence classification
  - Silence filtering to reduce unnecessary audio payload
  - Visual speech/silence state indicator
  - Fallback to full audio when VAD yields no speech
- **Automatic speech-to-text transcription** via Groq Whisper
- **Live transcript display** updated as audio is processed
- **Structured medical summarization** from the full transcript
- **9-field medical output structure:**
  - Patient details
  - Chief complaint
  - History of present illness
  - Symptoms (positive and negative kept separate)
  - Past medical history
  - Medication history and allergies
  - Clinical observations and examination findings
  - Assessment / provisional diagnosis
  - Plan, including investigations, prescriptions, and follow-up
- **Copy to Prescription** for a clean, human-readable formatted report
- **FastAPI backend** with:
  - CORS enabled for frontend hosting flexibility
  - Dynamic port binding for Render deployment
  - Pydantic-validated request/response models
  - OpenAPI docs at `/docs`

---

## Project Structure

```
.
├── backend
│   ├── main.py
│   ├── services.py
│   ├── schemas.py
│   ├── requirements.txt
│   └── .env.example
├── frontend
│   ├── src
│   │   ├── app
│   │   │   ├── page.tsx
│   │   │   ├── layout.tsx
│   │   │   ├── globals.css
│   │   │   └── api
│   │   │       ├── transcribe
│   │   │       └── summarize
│   │   ├── hooks
│   │   │   └── useAudioCapture.ts
│   │   └── lib
│   │       └── api.ts
│   ├── package.json
│   ├── next.config.ts
│   ├── tsconfig.json
│   ├── .env.example
│   └── README.md
└── README.md
```

---

## Backend API Endpoints

- `GET /api/health`
- `POST /api/transcribe`
- `POST /api/summarize`

Interactive API docs:

- Swagger UI: https://doctor-app-j8og.onrender.com/docs

---

## Local Development

### 1. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Create a local `.env` file in `backend/` using `.env.example` as a template.

```bash
cp backend/.env.example backend/.env
```

Then add your `GROQ_API_KEY` to `backend/.env`.

Run the server:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The backend API docs will be available at:

- http://localhost:8000/docs

### 2. Frontend

```bash
cd frontend
npm install
```

If you need to point the frontend to a different backend during local development, create a local env file:

```bash
cp frontend/.env.example frontend/.env.local
```

And set:

```
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
```

Run the frontend:

```bash
npm run dev
```

The app will usually be available at:

- http://localhost:3000

---

## Environment Variables

### Backend

| Variable         | Required | Description                          |
|------------------|----------|--------------------------------------|
| `GROQ_API_KEY`   | Yes      | Groq API key for Whisper and LLM     |
| `OPENAI_API_KEY` | No       | Present in `.env.example` template   |

Example `backend/.env`:

```
GROQ_API_KEY=your_groq_api_key_here
```

### Frontend

| Variable                        | Required | Description                              |
|---------------------------------|----------|------------------------------------------|
| `NEXT_PUBLIC_BACKEND_URL`       | No       | Backend base URL used by the frontend    |

If `NEXT_PUBLIC_BACKEND_URL` is not set, the frontend defaults to:

- `https://doctor-app-j8og.onrender.com`

For local development, set it to:

- `http://localhost:8000`

---

## Usage Flow

1. Open the app.
2. Click **Start Mic** and allow microphone access.
3. Speak during the consultation.
4. Stop recording when finished.
5. Click **Process Transcript with AI**.
6. Review the structured medical summary.
7. Use **Copy to Prescription** to copy a formatted report into your notes.

---

## Notes

- VAD is bias-tuned to be less aggressive for normal microphone input.
- If VAD detects no speech, the app falls back to the full recorded audio buffer.
- The frontend calls the backend directly in production using an absolute backend URL.
- The backend uses dynamic port binding for Render compatibility.

---

## License

This project is provided as-is for development and demo use.

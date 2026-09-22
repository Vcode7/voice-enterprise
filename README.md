# Voice ERP - Multimodal Voice & OCR Document Processing System

A full-stack, enterprise-grade Voice & Vision ERP system. It combines Next.js web interfaces, Python FastAPI microservices, PaddleOCR + TrOCR handwritten document extraction, Chandra V2 layout vision processing, and automated LLM inference (Groq with local Ollama failover).

---

## Project Architecture

```text
voice-entry/
├── frontend/             # Next.js 15 (App Router, Tailwind CSS, TypeScript, React 19)
│   ├── app/              # Application routes, pages, and layout views
│   ├── components/       # Reusable UI components & scanning panels
│   ├── lib/              # Client libraries (Groq, Ollama, SAP, API client)
│   ├── hooks/            # Custom React hooks (voice recording, templates)
│   ├── types/            # Shared TypeScript data models & schemas
│   ├── public/           # Static web assets & icons
│   ├── Dockerfile        # Production multi-stage Docker build for Next.js
│   ├── package.json      # Frontend dependencies & npm scripts
│   └── next.config.js    # Next.js rewrites, headers, and reverse proxy
├── backend/              # Python FastAPI & SQLite backend service
│   ├── app/              # FastAPI application, routers, services, & core config
│   │   ├── routers/      # API endpoints (OCR, Groq, Gemini, SAP storage, templates)
│   │   ├── services/     # OCR pipeline, Ollama LLM, Groq failover, TrOCR
│   │   ├── db/           # SQLite repositories and database initialization
│   │   └── models/       # Pydantic request & response schemas
│   ├── data/             # Persistent SQLite database (`voice_erp.db`)
│   ├── Dockerfile        # Containerized Python 3.10 slim environment
│   └── requirements.txt  # Python packages & dependencies
├── docker-compose.yml    # Multi-container orchestration (Frontend + Backend)
├── .env.example          # Environment variables template
└── README.md             # Project documentation & setup instructions
```

---

## Quick Start with Docker

Run the entire stack (Frontend + Backend) in isolated containers using Docker Compose.

### 1. Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running.
- (Optional) [Ollama](https://ollama.com/) running on your host machine at `http://127.0.0.1:11434` for local LLM inference.

### 2. Configure Environment
Copy the example environment file:
```bash
cp .env.example .env
```

Set any optional API keys in `.env`:
```env
# Optional Groq API Key (If omitted, system automatically falls back to local Ollama)
GROQ_API_KEY=your_groq_api_key_here

# Ollama Host URL (Accessible from inside containers via host gateway)
OLLAMA_BASE_URL=http://host.docker.internal:11434
```

### 3. Build & Run Containers
Launch both services:
```bash
docker compose up --build
```

To run in the background (detached mode):
```bash
docker compose up -d
```

### 4. Service Endpoints
| Service | URL | Description |
| :--- | :--- | :--- |
| **Frontend Web App** | `http://localhost:3000` | Next.js scanning, voice dictation, and ERP dashboard |
| **Backend API** | `http://localhost:8000` | FastAPI REST API |
| **Interactive API Docs** | `http://localhost:8000/docs` | Swagger UI for all backend endpoints |
| **SQLite Database** | `./backend/data/voice_erp.db` | Persisted on host volume |

### 5. Stop Containers
```bash
docker compose down
```

---

## Local Development (Without Docker)

You can run both the frontend and backend natively on your development machine.

### Backend Setup (FastAPI & SQLite)

1. Open a terminal in the `backend/` directory:
   ```bash
   cd backend
   ```

2. Create and activate a Python virtual environment:
   ```bash
   # Windows PowerShell:
   python -m venv .venv
   .venv\Scripts\Activate.ps1

   # Linux / macOS:
   python3 -m venv .venv
   source .venv/bin/activate
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Start the FastAPI development server:
   ```bash
   uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
   ```
   Backend will be running at `http://127.0.0.1:8000`.

---

### Frontend Setup (Next.js)

1. Open a separate terminal in the `frontend/` directory:
   ```bash
   cd frontend
   ```

2. Install npm packages:
   ```bash
   npm install
   ```

3. Configure local environment:
   ```bash
   cp .env.example .env.local
   ```

4. Start the Next.js development server:
   ```bash
   npm run dev
   ```
   Frontend will be running at `http://localhost:3000`.

---

## Local LLM Inference via Ollama

The system is engineered to automatically detect whether a Groq API key is present:
- **Groq Configured**: Uses the configured Groq model for low-latency cloud inference.
- **No Groq Key Configured / Failover**: Automatically routes requests to **Ollama** running locally on the host machine.
- **Strict Model Priority**:
  1. **Qwen** (Highest priority) — Automatically selected if any Qwen model is downloaded in Ollama (e.g. `qwen2.5:7b`, `qwen2.5:14b`).
  2. **Gemma** — Used if Qwen is not downloaded (e.g. `gemma-4-E4B`, `gemma2`).
  3. Default fallback: `qwen2.5:7b`.

> **Note for Docker Users**: In `docker-compose.yml`, `OLLAMA_BASE_URL` is set to `http://host.docker.internal:11434`, enabling containers to seamlessly connect to Ollama running on your host machine without extra configuration.

---

## Environment Variables Reference

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` (frontend), `8000` (backend) | Service listening port |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Backend API URL for client-side browser requests |
| `INTERNAL_BACKEND_URL` | `http://backend:8000` | Backend API URL for Docker container SSR rewrites |
| `PADDLE_BACKEND_URL` | `http://backend:8000/ocr/paddle-vl`| OCR endpoint for document parsing |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama API endpoint (`host.docker.internal` in Docker) |
| `GROQ_API_KEY` | `""` | Optional Groq key for cloud LLM inference |
| `SQLITE_DB_PATH` | `/app/data/voice_erp.db` | Location of SQLite database file |
| `CORS_ORIGINS` | `http://localhost:3000,...` | Allowed CORS origins for FastAPI |

---

## Validation & Code Checks

To verify TypeScript and type integrity across the frontend:
```bash
cd frontend
npx tsc --noEmit
```

To verify backend modules and routes:
```bash
cd backend
python -c "import app.main; print('Backend modules loaded successfully!')"
```

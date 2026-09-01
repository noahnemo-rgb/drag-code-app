# Syntax Mobile IDE

A React Native / Expo mobile IDE with a FastAPI backend: multi-file editor, code runner, Gemini AI assistant, and a snippets marketplace.

## Prerequisites

- Node.js 20+ and Yarn 1.x
- Python 3.11+
- Docker (optional, for local MongoDB)
- For `/api/run`: `python3`, `node`, and preferably a global `tsx` (`npm i -g tsx`)

## Quick start

### 1. Environment files

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Edit `backend/.env` and set `EMERGENT_LLM_KEY` if you want AI chat. Edit `frontend/.env` if the API is not on `http://localhost:8000`.

### 2. MongoDB

```bash
docker compose up -d
```

Or point `MONGO_URL` at any reachable MongoDB instance.

### 3. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

Health check: `GET http://localhost:8000/api/` → `{ "message": "Syntax Mobile IDE API" }`.

### 4. Frontend

```bash
cd frontend
yarn install
yarn start
```

Then open in Expo Go, an emulator, or press `w` for web. The app calls `${EXPO_PUBLIC_BACKEND_URL}/api/...`.

## Architecture

| Layer | Stack |
|-------|--------|
| App | Expo 54 / React Native / expo-router |
| API | FastAPI + Motor (MongoDB) |
| AI | Emergent Integrations → Gemini (`gemini-3.1-pro-preview`) |
| Runner | Host subprocesses (`python3` / `node` / `tsx`) with a 10s timeout |

Projects and files can sync **local** (AsyncStorage) or **cloud** (MongoDB). Chat, snippets, and `/run` always use the API.

## Known production gaps

These are intentional follow-ups, not covered by the quick start:

- `/api/run` is **not sandboxed** — do not expose a public runner without isolation.
- Cloud projects/files/chat have **no user auth** yet.
- Snippet authorship is device-id based (client-supplied), not real accounts.
- `emergentintegrations` may not be on public PyPI; use the Emergent-provided environment or wheel.

## Tests

```bash
cd backend
pytest tests/ -v
```

Backend tests historically targeted a hosted preview URL; prefer a local API + Mongo when iterating.

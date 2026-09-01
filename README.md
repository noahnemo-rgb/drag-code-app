# Syntax Mobile IDE

A React Native / Expo mobile IDE with a FastAPI backend: multi-file editor, sandboxed code runner, OpenRouter AI assistant, and a snippets marketplace.

## Prerequisites

- Node.js 20+ and Yarn 1.x
- Python 3.11+
- Docker (optional, for local MongoDB and stronger `/api/run` isolation)
- For `/api/run`: `python3`, `node`, and preferably a global `tsx` (`npm i -g tsx`)

## Quick start

### 1. Environment files

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Edit `backend/.env` and set `OPENROUTER_API_KEY` (and optionally `OPENROUTER_MODEL`). Edit `frontend/.env` if the API is not on `http://localhost:8000`.

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

Health check: `GET http://localhost:8000/api/` → includes `chat_provider: "openrouter"`.

### 4. Frontend

```bash
cd frontend
yarn install
yarn start
```

Then open in Expo Go, an emulator, or press `w` for web. The app calls `${EXPO_PUBLIC_BACKEND_URL}/api/...` and sends `X-Device-Id` for cloud tenant isolation.

## Architecture

| Layer | Stack |
|-------|--------|
| App | Expo / React Native / expo-router |
| API | FastAPI + Motor (MongoDB) |
| AI | OpenRouter (`OPENROUTER_MODEL`, default `openai/gpt-4o-mini`) |
| Runner | Isolated temp dir + resource limits; Docker `--network=none` when available |

Projects and files can sync **local** (AsyncStorage) or **cloud** (MongoDB, scoped by `X-Device-Id`). Chat, snippets, and `/run` always use the API.

## Known production gaps

- `/api/run` isolation is best-effort (temp dir + rlimits / optional Docker). Prefer a dedicated sandbox host for public deploys.
- Device-id tenancy is not cryptographic auth — sufficient for single-user installs, not multi-user accounts.
- Snippet authorship remains device-id based.

## Tests

```bash
cd backend
pytest tests/ -v
```

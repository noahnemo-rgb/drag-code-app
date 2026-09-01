# Syntax Mobile IDE

React Native / Expo mobile IDE with a FastAPI backend: multi-file editor, sandboxed code runner, OpenRouter AI assistant, JWT accounts, and a snippets marketplace.

## Prerequisites

- Node.js 20+ and Yarn 1.x
- Python 3.11+
- Docker (optional, for local MongoDB + dedicated runner isolation)
- For `/api/run` without Docker: `python3`, `node`, and preferably a global `tsx` (`npm i -g tsx`)

## Quick start

### 1. Environment files

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Edit `backend/.env` and set `JWT_SECRET` and `OPENROUTER_API_KEY` (plus optional `OPENROUTER_MODEL`). Edit `frontend/.env` if the API is not on `http://localhost:8000`.

### 2. MongoDB (+ optional full stack)

```bash
docker compose up -d mongo
# Or mongo + api + runner:
# docker compose up -d
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

Optional dedicated runner (Docker-first sandbox):

```bash
# another shell, from backend/
REQUIRE_DOCKER=false uvicorn runner_app:app --host 0.0.0.0 --port 8001
# then set RUNNER_URL=http://127.0.0.1:8001 in backend/.env
```

Health: `GET http://localhost:8000/api/` → `chat_provider: "openrouter"`, `auth_required: true`.

### 4. Frontend

```bash
cd frontend
yarn install
yarn start
```

Open in Expo Go, an emulator, or press `w` for web. Cloud sync, AI chat, and snippet publish require a Syntax account (`/auth`). The app sends `Authorization: Bearer <jwt>` after login.

## Architecture

| Layer | Stack |
|-------|--------|
| App | Expo / React Native / expo-router |
| API | FastAPI + Motor (MongoDB) |
| Auth | Email/password accounts, bcrypt hashes, JWT sessions |
| AI | OpenRouter (`OPENROUTER_MODEL`, default `openai/gpt-4o-mini`) |
| Runner | Dedicated `runner_app` (Docker `--network=none`) or local process sandbox |

Projects/files sync **local** (AsyncStorage) or **cloud** (MongoDB, scoped by authenticated `owner_id`). Chat and `/run` always use the API and require login when `REQUIRE_AUTH=true`.

## Tests

```bash
cd backend
# Mongo must be reachable (docker compose up -d mongo)
pytest tests/test_local_api.py -v
```

GitHub Actions (`.github/workflows/ci.yml`) runs the same suite against a Mongo service container.

## Known production gaps

- Process sandbox is a development fallback — prefer `RUNNER_URL` + `REQUIRE_DOCKER=true` for public deploys.
- OpenRouter key is required for AI chat; without it `/api/chat/stream` returns an error.

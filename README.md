# Syntax Mobile IDE

A React Native / Expo mobile IDE with a FastAPI backend: multi-file editor, sandboxed code runner, client-side AI (Puter on web, OpenRouter BYOK on mobile), and a snippets marketplace.

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

Edit `frontend/.env` if the API is not on `http://localhost:8000`. The backend does **not** need an LLM API key — AI runs on the client.

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

Health check: `GET http://localhost:8000/api/` → includes `run_daily_limit`.

### 4. Frontend

```bash
cd frontend
yarn install
yarn start
```

Then open in Expo Go, an emulator, or press `w` for web. The app sends `X-Device-Id` for cloud sync and run rate limits.

### 5. Enable AI

| Platform | Setup |
|----------|--------|
| **Web** | Open the AI screen and send a message — sign in to Puter when prompted. Usage is billed to the user's Puter account. |
| **iOS / Android** | Tap the gear icon on the AI screen → paste an [OpenRouter](https://openrouter.ai/keys) API key. The key stays on the device and is sent only to OpenRouter. |

## Architecture

| Layer | Stack |
|-------|--------|
| App | Expo / React Native / expo-router |
| API | FastAPI + Motor (MongoDB) — projects, files, snippets, sandboxed `/run` |
| AI (web) | [Puter.js](https://docs.puter.com/) — user-pays, no server key |
| AI (mobile) | OpenRouter BYOK from device keychain |
| Runner | Isolated temp dir + resource limits; Docker `--network=none` when available; `RUN_DAILY_LIMIT` per device |

Chat history is stored **locally** (AsyncStorage). Cloud sync remains device-scoped via `X-Device-Id`.

## Known production gaps

- `/api/run` isolation is best-effort (temp dir + rlimits / optional Docker). Prefer a dedicated sandbox host for public deploys.
- Device-id tenancy is not cryptographic auth — sufficient for single-user installs, not multi-user accounts.
- Snippet authorship remains device-id based.

## Tests

```bash
cd backend
pytest tests/ -v
```

Set `SYNTAX_TEST_BASE_URL=http://localhost:8000` to test a local API instance.

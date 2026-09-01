# Syntax Mobile IDE

React Native / Expo mobile IDE with a FastAPI backend: multi-file editor, sandboxed code runner, JWT accounts, client-side AI (Puter on web, OpenRouter BYOK on mobile), optional server OpenRouter chat, dedicated runner, and a snippets marketplace.

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

Edit `backend/.env` and set `JWT_SECRET` (required when `REQUIRE_AUTH=true`). Optionally set `OPENROUTER_API_KEY` for server-side `/api/chat/stream`. Client AI does not need a server LLM key. Edit `frontend/.env` if the API is not on `http://localhost:8000`.

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

Health: `GET http://localhost:8000/api/` → `chat_provider: "openrouter"`, `auth_required: true`, plus `tiers` run limits and optional `runner_url`.

### 4. Frontend

```bash
cd frontend
yarn install
yarn start
```

Open in Expo Go, an emulator, or press `w` for web. Cloud sync and snippet publish require a Syntax account (`/auth`). The app sends `Authorization: Bearer <jwt>` after login, plus `X-Device-Id` and `X-Tier` for usage limits.

### 5. Enable AI

| Platform | Setup |
|----------|--------|
| **Web** | Open the AI screen and send a message — sign in to Puter when prompted. Usage is billed to the user's Puter account. |
| **iOS / Android** | Tap the gear icon on the AI screen → paste an [OpenRouter](https://openrouter.ai/keys) API key. The key stays on the device and is sent only to OpenRouter. |

Optional: configure `OPENROUTER_API_KEY` on the server for authenticated `/api/chat/stream`.

### 6. Free vs Pro (dev scaffold)

Open the file drawer → **Plan & usage** to see quotas and toggle Free/Pro until billing is wired.

| Feature | Free | Pro |
|---------|------|-----|
| Code runs / day (server) | 10 | 50 |
| AI messages / month (device) | 25 | 500 |
| Snippet publishes / month | 3 | 100 |
| Cloud sync | login required | login + Pro |
| Semantic snippet search | — | ✓ |

See `docs/LAPTOP_CHECKLIST.md` for EAS build steps on your laptop.

## Architecture

| Layer | Stack |
|-------|--------|
| App | Expo / React Native / expo-router |
| API | FastAPI + Motor (MongoDB) |
| Auth | Email/password accounts, bcrypt hashes, JWT sessions |
| AI (web) | [Puter.js](https://docs.puter.com/) — user-pays, no server key |
| AI (mobile) | OpenRouter BYOK from device keychain |
| AI (optional server) | OpenRouter via `/api/chat/stream` when `OPENROUTER_API_KEY` is set |
| Runner | Dedicated `runner_app` (Docker `--network=none`) or local process sandbox; per-tier daily run limits |

Projects/files sync **local** (AsyncStorage) or **cloud** (MongoDB, scoped by authenticated `owner_id`). Chat history for client AI is local; server chat (when used) is JWT-scoped.

## Expo / EAS (shared builds & OTA updates)

Local `yarn start` / Expo Go is unchanged for day-to-day coding.

To ship installable builds and over-the-air JS updates to testers:

1. Follow **[docs/EAS.md](docs/EAS.md)** (one-time `eas login` → `eas init` → `eas update:configure`).
2. Build a preview APK/IPA: `cd frontend && yarn eas:build:preview`
3. Push JS-only changes: `yarn eas:update:preview` (or merge to `main` once `EXPO_TOKEN` is set for CI).

EAS Update does **not** apply inside Expo Go — only to apps built with EAS Build.

## Tests

```bash
cd backend
# Mongo must be reachable (docker compose up -d mongo)
pytest tests/test_local_api.py -v
```

GitHub Actions (`.github/workflows/ci.yml`) runs the same suite against a Mongo service container with `SANDBOX_USE_DOCKER=false`.

## Known production gaps

- Process sandbox is a development fallback — prefer `RUNNER_URL` + `REQUIRE_DOCKER=true` for public deploys.
- `/api/run` isolation is best-effort without a dedicated runner host.
- Free/Pro is a client + server scaffold until billing is wired.

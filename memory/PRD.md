# Syntax Mobile IDE — Product Requirements

## Overview
A React Native / Expo mobile IDE that lets users code within a GUI. Dark utility aesthetic (Amber on Obsidian), monospaced editor, quick-symbol keyboard strip, drawer-based file explorer, code runner console, and multi-turn OpenRouter AI assistant.

## Core Features
- **Accounts** — Register / login with email + password. JWT bearer sessions. Cloud projects, files, chat, and snippet authorship are scoped to the authenticated user.
- **Multi-file editor** — Projects → Files, create/rename/delete, autosave. Syntax highlighting for JavaScript, TypeScript, Python, HTML, CSS.
- **Find & Replace** — In-editor toolbar with find input, live match counter, Aa case toggle, prev/next, Replace / Replace All.
- **Code runner** — Python/JS/TS via the API. Prefer a dedicated runner (`RUNNER_URL`) spawning Docker `--network=none` containers; local process sandbox is a fallback. HTML preview on-device via WebView.
- **AI Assistant (OpenRouter)** — Multi-turn streaming chat (`OPENROUTER_MODEL`, default `openai/gpt-4o-mini`) with session persistence and editor-matched syntax highlighting on code blocks (Copy + Insert-at-Cursor).
- **Explain Selection** — Amber "Explain with AI" pill sends the selection to `/ai` with an auto-composed prompt.
- **Snippets Marketplace** — Public feed. Publish/edit/delete require login (`author_id`). Star by JWT user id (or device id fallback). **MINE** filters to your snippets.
- **Local vs Cloud storage** — Toggle in the file explorer drawer. Switching to cloud prompts login when no JWT session exists.

## Backend endpoints (`/api`)
- `GET /` — health (`chat_provider`, `auth_required`, `runner_url`)
- `POST /auth/register`, `POST /auth/login`, `GET /auth/me`
- `POST|GET|PATCH|DELETE /projects…` (JWT, owner-scoped)
- `POST|GET|PATCH|DELETE /files…` (JWT, owner-scoped)
- `POST /run` — `{language, code}` → `{stdout, stderr, exit_code, duration_ms, sandbox}` (JWT; proxies to runner when configured)
- `POST /chat/stream`, `GET|DELETE /chat/history/{session_id}` (JWT)
- `POST|GET|PATCH|DELETE /snippets…`, `POST /snippets/{id}/star`, `GET /snippets/{id}/starred`

## Screens
1. **Editor (`/`)** — menu, filename+language, account, AI, Run; drawer explorer; run console.
2. **Auth (`/auth`)** — register / sign in / sign out.
3. **AI (`/ai`)** — streaming chat, code blocks with Copy.
4. **Snippets (`/snippets`)** — marketplace feed, publish, mine, star, edit.

## Design tokens
- Surface #111 / secondary #1A1A1A / tertiary #262626
- Brand Amber #FFB000, success #4CAF50, error #F44336
- SpaceMono for code; system font for UI
- No blue/purple/indigo, no glassmorphism

## Notes
- `JWT_SECRET` + `OPENROUTER_API_KEY` in `backend/.env`.
- TypeScript run falls back to Node unless `tsx` is on PATH.
- Cloud tenancy is JWT `owner_id` / `author_id`.
- CI: `.github/workflows/ci.yml` runs `tests/test_local_api.py` against MongoDB.

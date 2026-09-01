# Syntax Mobile IDE — Product Requirements

## Overview
A React Native / Expo mobile IDE that lets users code within a GUI. Dark utility aesthetic (Amber on Obsidian), monospaced editor, quick-symbol keyboard strip, drawer-based file explorer, code runner console, JWT accounts, client-side AI (Puter.js on web, OpenRouter BYOK on mobile), optional server OpenRouter chat, Free/Pro usage limits, and a snippets marketplace with semantic search for Pro.

## Core Features
- **Accounts** — Register / login with email + password. JWT bearer sessions. Cloud projects, files, server chat, and snippet authorship are scoped to the authenticated user.
- **Multi-file editor** — Projects → Files, create/rename/delete, autosave. Syntax highlighting for JavaScript, TypeScript, Python, HTML, CSS. Line numbers, monospace font, quick-symbol strip.
- **Find & Replace** — In-editor toolbar with find input, live match counter, Aa case toggle, prev/next, Replace / Replace All.
- **Code runner** — Python/JS/TS via the API. Prefer a dedicated runner (`RUNNER_URL`) spawning Docker `--network=none` containers; local process sandbox is a fallback (`SANDBOX_USE_DOCKER`). HTML preview on-device via WebView. Per-user daily run quotas by Free/Pro tier (`X-Tier`).
- **AI Assistant** — Multi-turn streaming chat with local session history. **Web:** Puter.js (user signs in to Puter). **Mobile:** OpenRouter BYOK from device keychain. Optional server `/api/chat/stream` when `OPENROUTER_API_KEY` is configured. Code blocks support Copy + Insert-at-Cursor.
- **Explain Selection** — Amber "Explain with AI" pill sends the selection to `/ai` with an auto-composed prompt.
- **Snippets Marketplace** — Public feed. Publish/edit/delete require login (`author_id`). Star by JWT user id (or device id fallback). Keyword search for everyone; semantic (`mode=semantic`) for Pro. **MINE** filters to your snippets.
- **Local vs Cloud storage** — Toggle in the file explorer drawer. Switching to cloud requires login; Pro gate applies via Plan & usage.
- **Plan & usage** — Drawer sheet shows Free/Pro quotas (runs, snippet publishes, AI messages) with a dev tier toggle until billing exists.

## Backend endpoints (`/api`)
- `GET /` — health (`chat_provider`, `auth_required`, `runner_url`, `tiers`)
- `POST /auth/register`, `POST /auth/login`, `GET /auth/me`
- `GET /usage` — JWT + `X-Tier` → run / snippet-publish quotas
- `POST|GET|PATCH|DELETE /projects…` (JWT, owner-scoped)
- `POST|GET|PATCH|DELETE /files…` (JWT, owner-scoped)
- `POST /run` — `{language, code}` → `{stdout, stderr, exit_code, duration_ms, sandbox}` (JWT; tier quota; proxies to runner when configured)
- `POST /chat/stream`, `GET|DELETE /chat/history/{session_id}` (JWT; optional server OpenRouter)
- `POST|GET|PATCH|DELETE /snippets…` (`mode=keyword|semantic`), `POST /snippets/{id}/star`, `GET /snippets/{id}/starred`

## Screens
1. **Editor (`/`)** — menu, filename+language, account, AI, Run; drawer explorer (Plan & usage); run console.
2. **Auth (`/auth`)** — register / sign in / sign out.
3. **AI (`/ai`)** — streaming client AI chat, provider settings, code blocks with Copy.
4. **Snippets (`/snippets`)** — marketplace feed, keyword/semantic search, publish, mine, star, edit.

## Design tokens
- Surface #111 / secondary #1A1A1A / tertiary #262626
- Brand Amber #FFB000, success #4CAF50, error #F44336
- SpaceMono for code; system font for UI
- No blue/purple/indigo, no glassmorphism

## Notes
- `JWT_SECRET` in `backend/.env` (required when `REQUIRE_AUTH=true`). `OPENROUTER_API_KEY` optional for server chat.
- Client AI needs no server LLM key (Puter web / BYOK mobile).
- TypeScript run falls back to Node unless `tsx` is on PATH.
- Cloud tenancy is JWT `owner_id` / `author_id` (not device-id ownership).
- CI: `.github/workflows/ci.yml` runs `tests/test_local_api.py` against MongoDB with `SANDBOX_USE_DOCKER=false`.
- See `docs/EAS.md` / `docs/LAPTOP_CHECKLIST.md` for EAS builds and OTA updates.

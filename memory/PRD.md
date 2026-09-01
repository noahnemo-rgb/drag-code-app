# Syntax Mobile IDE — Product Requirements

## Overview
A React Native / Expo mobile IDE app that lets users code within a GUI. Dark utility aesthetic (Amber on Obsidian), monospaced editor, quick-symbol keyboard strip, drawer-based file explorer, code runner console, and multi-turn OpenRouter AI assistant.

## Core Features
- **Multi-file editor** — Projects → Files, create/rename/delete, autosave. Syntax highlighting for JavaScript, TypeScript, Python, HTML, CSS. Line numbers, monospace font, quick-symbol strip.
- **Find & Replace** — In-editor toolbar (search icon in header) with find input, live match counter (`N/M`), Aa case toggle, prev/next chevrons, single Replace, Replace All, and a close button.
- **Code runner** — Executes Python/JS/TS on the FastAPI backend. TS uses globally-installed `tsx`. HTML preview rendered on-device via WebView. Output shown in a bottom-sheet Console. 10s timeout.
- **AI Assistant (OpenRouter)** — Multi-turn chat via OpenRouter’s OpenAI-compatible API (`OPENROUTER_MODEL`, default `openai/gpt-4o-mini`) with streaming responses, session persistence, and code blocks that are **syntax-highlighted with the same tokenizer as the editor** and carry both Copy and Insert-at-Cursor actions.
- **Explain Selection** — Selecting text in the editor reveals an amber "Explain with AI" pill above the symbol strip; tapping it navigates to the AI screen with an auto-composed, auto-sent prompt.
- **Snippets Marketplace** — Public feed of code snippets. Publish (author, title, description, language, tags, code — prefilled from the active file), browse with language chips & search, star (idempotent per-device), tap to view detail with syntax-highlighted code, Insert-at-Cursor into the editor. **MINE tab** filters to snippets you posted with a delete affordance. **Edit** button on your own snippet's detail sheet opens a prefilled form that PATCHes the snippet server-side (author-only).
- **Local vs Cloud storage** — Toggle in file explorer drawer (AsyncStorage vs MongoDB).

## Backend endpoints (`/api`)
- `GET /` — health
- `POST /projects`, `GET /projects`, `GET /projects/{id}`, `PATCH /projects/{id}`, `DELETE /projects/{id}`
- `POST /files`, `GET /files?project_id=…`, `GET /files/{id}`, `PATCH /files/{id}`, `DELETE /files/{id}`
- `POST /run` — `{language, code}` → `{stdout, stderr, exit_code, duration_ms}`
- `POST /chat/stream` — streaming plain-text response
- `GET /chat/history/{session_id}` — persisted messages
- `DELETE /chat/history/{session_id}` — clear
- `POST /snippets`, `GET /snippets?language=&q=`, `GET /snippets/{id}`, `PATCH /snippets/{id}` (author-only), `POST /snippets/{id}/star` (idempotent toggle by device_id), `GET /snippets/{id}/starred?device_id=…`, `DELETE /snippets/{id}?device_id=…` (author-only)

## Screens
1. **Editor (`/`)** — header (menu, filename+language, AI, Run), gutter+overlay-highlighted TextInput, symbol strip, drawer file explorer, run console bottom sheet.
2. **AI Assistant (`/ai`)** — chat bubbles, code block renderer with Copy, streaming responses, clear session.

## Design tokens
- Surface #111 / secondary #1A1A1A / tertiary #262626
- Brand Amber #FFB000, success #4CAF50, error #F44336
- SpaceMono for code, system font for UI
- Radius 8/12, spacing 4/8/12/16/24
- No blue/purple/indigo, no glassmorphism

## Business enhancement idea
Add a **Snippets Marketplace** where users publish saved AI-generated snippets to a public feed — increases retention and creates viral loops with copy-to-clipboard sharing.

## Notes
- OPENROUTER_API_KEY configured in backend/.env (plus optional OPENROUTER_MODEL).
- TypeScript execution falls back to Node (annotations must be JS-compatible unless `tsx` is on PATH).
- Cloud projects/files/chat are scoped by the `X-Device-Id` header.

# Syntax Mobile IDE — Product Requirements

## Overview
A React Native / Expo mobile IDE app that lets users code within a GUI. Dark utility aesthetic (Amber on Obsidian), monospaced editor, quick-symbol keyboard strip, drawer-based file explorer, code runner console, and multi-turn Gemini 3 Pro AI assistant.

## Core Features
- **Multi-file editor** — Projects → Files, create/rename/delete, autosave. Syntax highlighting for JavaScript, TypeScript, Python, HTML, CSS. Line numbers, monospace font, quick-symbol strip.
- **Code runner** — Executes Python/JS/TS on the FastAPI backend (subprocess with 10s timeout); HTML preview rendered on-device via WebView. Output shown in a bottom-sheet Console.
- **AI Assistant (Gemini 3 Pro / `gemini-3.1-pro-preview`)** — Multi-turn chat with streaming responses, session persistence, and code blocks with Copy action. Powered by `emergentintegrations` + EMERGENT_LLM_KEY.
- **Local vs Cloud storage** — Toggle in file explorer drawer. Local uses AsyncStorage; Cloud uses backend MongoDB (`/api/projects`, `/api/files`).

## Backend endpoints (`/api`)
- `GET /` — health
- `POST /projects`, `GET /projects`, `GET /projects/{id}`, `PATCH /projects/{id}`, `DELETE /projects/{id}`
- `POST /files`, `GET /files?project_id=…`, `GET /files/{id}`, `PATCH /files/{id}`, `DELETE /files/{id}`
- `POST /run` — `{language, code}` → `{stdout, stderr, exit_code, duration_ms}`
- `POST /chat/stream` — streaming plain-text response
- `GET /chat/history/{session_id}` — persisted messages
- `DELETE /chat/history/{session_id}` — clear

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
- EMERGENT_LLM_KEY configured in backend/.env.
- TypeScript execution falls back to Node (annotations must be JS-compatible unless `tsx` is on PATH).

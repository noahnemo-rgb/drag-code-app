# Vector search roadmap (snippets)

Syntax IDE uses **MongoDB text search** today for Pro-tier “semantic” snippet discovery. This is a deliberate scaffold — not a full vector database yet.

## Current (Phase 1)

- **Backend:** `snippet_search.py` + text index on `title`, `description`, `tags`, `code`
- **API:** `GET /api/snippets?q=...&mode=semantic` (Pro tier via `X-Tier: pro`)
- **Frontend:** Snippets screen → **Semantic (Pro)** search mode

Good for: keyword + relevance ranking without extra infrastructure.

## Phase 2 — embeddings on publish (recommended next)

When a user publishes a snippet:

1. Call an embedding model (OpenRouter, Gemini, or local) **from the client** or a small worker you control
2. Store `embedding: float[]` on the snippet document
3. Search with MongoDB Atlas Vector Search or a dedicated vector DB

## Phase 3 — vector DB options

| Service | When to choose |
|---------|----------------|
| **MongoDB Atlas Vector Search** | Already on MongoDB; lowest migration cost |
| **Pinecone** | Managed, serverless, fast at scale |
| **Qdrant Cloud** | Cost-conscious, self-host option later |
| **Supabase pgvector** | If you add Postgres auth + billing in one place |

## Phase 4 — project RAG (AI knows my repo)

- Chunk cloud-synced files per device/project
- Embed chunks; retrieve top-k into AI system prompt
- Gate behind Pro; run retrieval client-side or via a thin backend that never holds LLM keys

## What not to do

- Do **not** put your OpenRouter/Puter billing keys on the server for user chat — keep the client-side model from PR #4.
- Do **not** embed on every keystroke; embed on publish or on explicit “index project” action.

"""Snippet search helpers — MongoDB text index today; vector DB hook for later."""
from __future__ import annotations

from typing import Any, Dict, List, Optional


async def ensure_snippet_indexes(db) -> None:
    """Create text index for keyword/semantic-ish search (MongoDB $text)."""
    existing = await db.snippets.index_information()
    if "snippet_text_search" not in existing:
        # language_override must NOT be "language" — snippets use that field for
        # programming language (python/javascript/...), which is not a Mongo text locale.
        await db.snippets.create_index(
            [
                ("title", "text"),
                ("description", "text"),
                ("tags", "text"),
                ("code", "text"),
            ],
            name="snippet_text_search",
            default_language="english",
            language_override="search_language",
        )


def build_snippet_filter(
    *,
    language: Optional[str],
    q: Optional[str],
    mode: str,
    safe_regex: str,
) -> Dict[str, Any]:
    filt: Dict[str, Any] = {}
    if language:
        filt["language"] = language
    if not q:
        return filt

    if mode == "semantic":
        # MongoDB full-text search across indexed fields.
        filt["$text"] = {"$search": q[:200]}
        return filt

    filt["$or"] = [
        {"title": {"$regex": safe_regex, "$options": "i"}},
        {"description": {"$regex": safe_regex, "$options": "i"}},
        {"tags": {"$regex": safe_regex, "$options": "i"}},
        {"code": {"$regex": safe_regex, "$options": "i"}},
    ]
    return filt


def snippet_sort_for_mode(mode: str) -> List[tuple]:
    if mode == "semantic":
        return [("score", {"$meta": "textScore"}), ("created_at", -1)]
    return [("created_at", -1)]


def snippet_projection_for_mode(mode: str) -> Optional[Dict[str, Any]]:
    if mode == "semantic":
        return {"_id": 0, "score": {"$meta": "textScore"}}
    return {"_id": 0}

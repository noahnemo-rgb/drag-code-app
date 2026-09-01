"""OpenRouter chat completions streaming helper."""
from __future__ import annotations

import json
import logging
from typing import AsyncIterator, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


async def stream_openrouter(
    *,
    api_key: str,
    model: str,
    messages: List[Dict[str, str]],
    site_url: str = "https://syntax.ide",
    app_name: str = "Syntax Mobile IDE",
    timeout_sec: float = 120.0,
) -> AsyncIterator[str]:
    """
    Yield plain-text content deltas from OpenRouter's OpenAI-compatible SSE stream.
    """
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": site_url,
        "X-Title": app_name,
    }
    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
    }

    async with httpx.AsyncClient(timeout=timeout_sec) as client:
        async with client.stream("POST", OPENROUTER_URL, headers=headers, json=payload) as resp:
            if resp.status_code >= 400:
                body = (await resp.aread()).decode("utf-8", errors="replace")
                raise RuntimeError(f"OpenRouter HTTP {resp.status_code}: {body[:500]}")

            async for line in resp.aiter_lines():
                if not line:
                    continue
                # SSE comments / keepalives
                if line.startswith(":"):
                    continue
                if not line.startswith("data: "):
                    continue
                data = line[6:].strip()
                if data == "[DONE]":
                    break
                try:
                    chunk = json.loads(data)
                except json.JSONDecodeError:
                    logger.debug("skip non-json SSE line: %s", data[:80])
                    continue

                err = chunk.get("error")
                if err:
                    msg = err.get("message") if isinstance(err, dict) else str(err)
                    raise RuntimeError(f"OpenRouter stream error: {msg}")

                choices = chunk.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                content = delta.get("content")
                if content:
                    yield content


def build_messages(
    system_prompt: str,
    history: List[Dict[str, str]],
    user_text: str,
) -> List[Dict[str, str]]:
    """Assemble OpenAI-style messages: system + prior turns + current user."""
    msgs: List[Dict[str, str]] = [{"role": "system", "content": system_prompt}]
    for h in history:
        role = h.get("role")
        content = h.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            msgs.append({"role": role, "content": content})
    msgs.append({"role": "user", "content": user_text})
    return msgs

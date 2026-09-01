"""Dedicated Syntax runner — Docker-first code execution microservice."""
from __future__ import annotations

import logging
import os
from typing import Optional

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from sandbox_run import docker_available, run_isolated

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("syntax.runner")

REQUIRE_DOCKER = os.environ.get("REQUIRE_DOCKER", "true").lower() in ("1", "true", "yes")
RUNNER_API_KEY = (os.environ.get("RUNNER_API_KEY") or "").strip()
RUN_TIMEOUT_SEC = int(os.environ.get("RUN_TIMEOUT_SEC", "10"))

app = FastAPI(title="Syntax Runner", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RunBody(BaseModel):
    language: str
    code: str = Field(..., max_length=100_000)


class RunResult(BaseModel):
    stdout: str
    stderr: str
    exit_code: int
    duration_ms: int
    sandbox: str


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "syntax-runner",
        "docker": docker_available(),
        "require_docker": REQUIRE_DOCKER,
    }


@app.post("/run", response_model=RunResult)
async def run_code(
    body: RunBody,
    x_runner_key: Optional[str] = Header(default=None),
):
    if RUNNER_API_KEY and (x_runner_key or "") != RUNNER_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid runner key")
    stdout, stderr, code, duration, mode = await run_isolated(
        language=body.language,
        code=body.code,
        timeout_sec=RUN_TIMEOUT_SEC,
        require_docker=REQUIRE_DOCKER,
    )
    if mode == "unavailable":
        raise HTTPException(status_code=503, detail=stderr or "Sandbox unavailable")
    if mode == "unsupported":
        raise HTTPException(status_code=400, detail=stderr or f"Unsupported language: {body.language}")
    return RunResult(
        stdout=stdout,
        stderr=stderr,
        exit_code=code,
        duration_ms=duration,
        sandbox=mode,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8001")))

"""Best-effort isolated code execution for /api/run.

Uses a private temp directory, scrubbed env, resource limits (Unix), and a hard
timeout. If Docker is available, prefers an ephemeral `--network=none` container.
This is NOT a full multi-tenant sandbox (no seccomp/gVisor), but it is a large
improvement over bare host subprocesses.
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Tuple

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_SEC = 10
MAX_OUTPUT_CHARS = 20_000
DOCKER_MEMORY = "128m"
DOCKER_CPUS = "0.5"


def _docker_available() -> bool:
    if not shutil.which("docker"):
        return False
    try:
        r = subprocess.run(
            ["docker", "info"],
            capture_output=True,
            timeout=3,
        )
        return r.returncode == 0
    except Exception:
        return False


def _resource_preexec():
    """Limit CPU time and address space for the child (Unix only)."""
    try:
        import resource

        # 8s CPU, ~256MB address space
        resource.setrlimit(resource.RLIMIT_CPU, (8, 8))
        resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_NPROC, (32, 32))
        resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
        resource.setrlimit(resource.RLIMIT_FSIZE, (8 * 1024 * 1024, 8 * 1024 * 1024))
    except Exception:
        pass


def _scrubbed_env(workdir: str) -> dict:
    path = os.environ.get("PATH", "/usr/bin:/bin")
    return {
        "PATH": path,
        "HOME": workdir,
        "TMPDIR": workdir,
        "TEMP": workdir,
        "TMP": workdir,
        "LANG": "C.UTF-8",
        "PYTHONDONTWRITEBYTECODE": "1",
        "NODE_OPTIONS": "--max-old-space-size=128",
    }


async def run_isolated(
    *,
    language: str,
    code: str,
    timeout_sec: int = DEFAULT_TIMEOUT_SEC,
) -> Tuple[str, str, int, int]:
    """
    Returns (stdout, stderr, exit_code, duration_ms).
    """
    start = datetime.now()
    work = tempfile.mkdtemp(prefix="syntax-run-")
    try:
        if language == "python":
            script = Path(work) / "main.py"
            script.write_text(code, encoding="utf-8")
            if _docker_available():
                cmd = [
                    "docker", "run", "--rm",
                    "--network=none",
                    "--memory", DOCKER_MEMORY,
                    "--cpus", DOCKER_CPUS,
                    "--pids-limit", "64",
                    "-v", f"{work}:/work:ro",
                    "-w", "/work",
                    "python:3.12-alpine",
                    "python", "-I", "main.py",
                ]
                return await _exec(cmd, work, timeout_sec, start, use_preexec=False)
            cmd = ["python3", "-I", str(script)]
            return await _exec(cmd, work, timeout_sec, start, use_preexec=True)

        if language == "javascript":
            script = Path(work) / "main.js"
            script.write_text(code, encoding="utf-8")
            if _docker_available():
                cmd = [
                    "docker", "run", "--rm",
                    "--network=none",
                    "--memory", DOCKER_MEMORY,
                    "--cpus", DOCKER_CPUS,
                    "--pids-limit", "64",
                    "-v", f"{work}:/work:ro",
                    "-w", "/work",
                    "node:20-alpine",
                    "node", "main.js",
                ]
                return await _exec(cmd, work, timeout_sec, start, use_preexec=False)
            cmd = ["node", str(script)]
            return await _exec(cmd, work, timeout_sec, start, use_preexec=True)

        if language == "typescript":
            script = Path(work) / "main.ts"
            script.write_text(code, encoding="utf-8")
            tsx = shutil.which("tsx")
            if _docker_available() and not tsx:
                # Transpile-less fallback: run via node after stripping isn't great;
                # prefer host tsx when present. Without tsx, use node on .mjs copy.
                mjs = Path(work) / "main.mjs"
                mjs.write_text(code, encoding="utf-8")
                cmd = [
                    "docker", "run", "--rm",
                    "--network=none",
                    "--memory", DOCKER_MEMORY,
                    "--cpus", DOCKER_CPUS,
                    "--pids-limit", "64",
                    "-v", f"{work}:/work:ro",
                    "-w", "/work",
                    "node:20-alpine",
                    "node", "main.mjs",
                ]
                return await _exec(cmd, work, timeout_sec, start, use_preexec=False)
            if tsx:
                cmd = [tsx, str(script)]
            else:
                mjs = Path(work) / "main.mjs"
                mjs.write_text(code, encoding="utf-8")
                cmd = ["node", str(mjs)]
            return await _exec(cmd, work, timeout_sec, start, use_preexec=True)

        return ("", f"Unsupported language for sandbox: {language}", 1, 0)
    finally:
        shutil.rmtree(work, ignore_errors=True)


async def _exec(
    cmd: List[str],
    workdir: str,
    timeout_sec: int,
    start: datetime,
    *,
    use_preexec: bool,
) -> Tuple[str, str, int, int]:
    env = _scrubbed_env(workdir)
    kwargs = {
        "stdout": asyncio.subprocess.PIPE,
        "stderr": asyncio.subprocess.PIPE,
        "cwd": workdir,
        "env": env,
    }
    if use_preexec and os.name == "posix":
        kwargs["preexec_fn"] = _resource_preexec

    try:
        proc = await asyncio.create_subprocess_exec(*cmd, **kwargs)
    except FileNotFoundError as e:
        duration = int((datetime.now() - start).total_seconds() * 1000)
        return ("", f"Runtime not found: {e}", 127, duration)

    try:
        stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=timeout_sec)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.wait()
        duration = int((datetime.now() - start).total_seconds() * 1000)
        return ("", f"Execution timed out after {timeout_sec}s.", -1, duration)

    duration = int((datetime.now() - start).total_seconds() * 1000)
    stdout = stdout_b.decode("utf-8", errors="replace")[:MAX_OUTPUT_CHARS]
    stderr = stderr_b.decode("utf-8", errors="replace")[:MAX_OUTPUT_CHARS]
    code = proc.returncode if proc.returncode is not None else -1
    return (stdout, stderr, code, duration)

"""Best-effort / Docker-first isolated code execution for Syntax IDE.

Modes:
  - docker: ephemeral `--network=none` container (preferred)
  - process: private temp dir + scrubbed env + Unix rlimits (dev fallback)

Set require_docker=True (or REQUIRE_DOCKER=true) to refuse process fallback.
"""
from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import List, Tuple

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT_SEC = 10
MAX_OUTPUT_CHARS = 20_000
DOCKER_MEMORY = os.environ.get("DOCKER_MEMORY", "128m")
DOCKER_CPUS = os.environ.get("DOCKER_CPUS", "0.5")


def _use_docker_sandbox() -> bool:
    """Prefer Docker when available unless explicitly disabled (e.g. CI)."""
    pref = os.environ.get("SANDBOX_USE_DOCKER", "auto").lower()
    if pref in ("0", "false", "no"):
        return False
    return docker_available()


def docker_available() -> bool:
    if not shutil.which("docker"):
        return False
    try:
        r = subprocess.run(["docker", "info"], capture_output=True, timeout=3)
        return r.returncode == 0
    except Exception:
        return False


def _python_bin() -> str:
    """Interpreter for process sandbox — same binary as the API when possible."""
    return shutil.which("python3") or shutil.which("python") or sys.executable


def _resource_preexec() -> None:
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_CPU, (8, 8))
        resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_NPROC, (32, 32))
        resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
        resource.setrlimit(resource.RLIMIT_FSIZE, (8 * 1024 * 1024, 8 * 1024 * 1024))
    except Exception:
        pass


def _scrubbed_env(workdir: str) -> dict:
    path = os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin")
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
    require_docker: bool = False,
) -> Tuple[str, str, int, int, str]:
    """
    Returns (stdout, stderr, exit_code, duration_ms, sandbox_mode).
    """
    start = datetime.now()
    use_docker = _use_docker_sandbox()
    if require_docker and not use_docker:
        return ("", "Docker sandbox required but unavailable.", 503, 0, "unavailable")

    work = tempfile.mkdtemp(prefix="syntax-run-")
    try:
        if language == "python":
            script = Path(work) / "main.py"
            script.write_text(code, encoding="utf-8")
            if use_docker:
                cmd = [
                    "docker", "run", "--rm",
                    "--network=none",
                    "--memory", DOCKER_MEMORY,
                    "--cpus", DOCKER_CPUS,
                    "--pids-limit", "64",
                    "--read-only",
                    "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
                    "-v", f"{work}:/work:ro",
                    "-w", "/work",
                    "--user", "65534:65534",
                    "python:3.12-alpine",
                    "python", "-I", "main.py",
                ]
                out = await _exec(cmd, work, timeout_sec, start, use_preexec=False)
                return (*out, "docker")
            cmd = [_python_bin(), "-I", str(script)]
            out = await _exec(cmd, work, timeout_sec, start, use_preexec=True)
            return (*out, "process")

        if language == "javascript":
            script = Path(work) / "main.js"
            script.write_text(code, encoding="utf-8")
            if use_docker:
                cmd = [
                    "docker", "run", "--rm",
                    "--network=none",
                    "--memory", DOCKER_MEMORY,
                    "--cpus", DOCKER_CPUS,
                    "--pids-limit", "64",
                    "--read-only",
                    "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
                    "-v", f"{work}:/work:ro",
                    "-w", "/work",
                    "--user", "65534:65534",
                    "node:20-alpine",
                    "node", "main.js",
                ]
                out = await _exec(cmd, work, timeout_sec, start, use_preexec=False)
                return (*out, "docker")
            cmd = ["node", str(script)]
            out = await _exec(cmd, work, timeout_sec, start, use_preexec=True)
            return (*out, "process")

        if language == "typescript":
            script = Path(work) / "main.ts"
            script.write_text(code, encoding="utf-8")
            tsx = shutil.which("tsx")
            if use_docker:
                # Prefer node on a .mjs copy inside alpine (no tsx in stock image).
                mjs = Path(work) / "main.mjs"
                mjs.write_text(code, encoding="utf-8")
                cmd = [
                    "docker", "run", "--rm",
                    "--network=none",
                    "--memory", DOCKER_MEMORY,
                    "--cpus", DOCKER_CPUS,
                    "--pids-limit", "64",
                    "--read-only",
                    "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
                    "-v", f"{work}:/work:ro",
                    "-w", "/work",
                    "--user", "65534:65534",
                    "node:20-alpine",
                    "node", "main.mjs",
                ]
                out = await _exec(cmd, work, timeout_sec, start, use_preexec=False)
                return (*out, "docker")
            if tsx:
                cmd = [tsx, str(script)]
            else:
                mjs = Path(work) / "main.mjs"
                mjs.write_text(code, encoding="utf-8")
                cmd = ["node", str(mjs)]
            out = await _exec(cmd, work, timeout_sec, start, use_preexec=True)
            return (*out, "process")

        return ("", f"Unsupported language for sandbox: {language}", 1, 0, "unsupported")
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

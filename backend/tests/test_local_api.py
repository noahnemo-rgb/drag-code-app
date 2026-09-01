"""Local API tests for Syntax Mobile IDE.

Starts uvicorn against a real MongoDB (CI service or local mongod).
"""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path

import pytest
import requests

ROOT = Path(__file__).resolve().parents[1]

os.environ.setdefault("MONGO_URL", "mongodb://127.0.0.1:27017")
os.environ.setdefault("DB_NAME", "syntax_ide_test")
os.environ.setdefault("JWT_SECRET", "test-syntax-secret")
os.environ.setdefault("REQUIRE_AUTH", "true")
os.environ.setdefault("REQUIRE_DOCKER", "false")
os.environ.setdefault("OPENROUTER_API_KEY", "")
os.environ.setdefault("RUNNER_URL", "")


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def api_base():
    port = _free_port()
    env = os.environ.copy()
    env["DB_NAME"] = f"syntax_ide_test_{uuid.uuid4().hex[:8]}"
    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "server:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            "--log-level",
            "warning",
        ],
        cwd=str(ROOT),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    base = f"http://127.0.0.1:{port}/api"
    deadline = time.time() + 30
    last_err = None
    try:
        while time.time() < deadline:
            if proc.poll() is not None:
                out = (proc.stdout.read() or b"").decode("utf-8", errors="replace")
                raise RuntimeError(f"uvicorn exited early:\n{out}")
            try:
                r = requests.get(f"{base}/", timeout=1)
                if r.status_code == 200:
                    break
            except Exception as exc:  # noqa: BLE001
                last_err = exc
                time.sleep(0.2)
        else:
            raise RuntimeError(f"API did not become ready: {last_err}")
        yield base
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


@pytest.fixture(scope="session")
def s(api_base):
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    sess.base = api_base  # type: ignore[attr-defined]
    return sess


def _register(s: requests.Session, email: str | None = None, password: str = "password123"):
    email = email or f"user_{uuid.uuid4().hex[:8]}@example.com"
    r = s.post(
        f"{s.base}/auth/register",
        json={"email": email, "password": password, "display_name": "Tester"},
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert "access_token" in data
    assert data["user"]["email"] == email
    return data


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_health(s):
    r = s.get(f"{s.base}/")
    assert r.status_code == 200
    body = r.json()
    assert body["chat_provider"] == "openrouter"
    assert body["auth_required"] is True


def test_auth_register_login_me(s):
    reg = _register(s, email="alice@example.com")
    token = reg["access_token"]

    bad = s.post(f"{s.base}/auth/login", json={"email": "alice@example.com", "password": "wrongpass1"})
    assert bad.status_code == 401

    ok = s.post(f"{s.base}/auth/login", json={"email": "alice@example.com", "password": "password123"})
    assert ok.status_code == 200
    assert ok.json()["user"]["id"] == reg["user"]["id"]

    me = s.get(f"{s.base}/auth/me", headers=_auth(token))
    assert me.status_code == 200
    assert me.json()["email"] == "alice@example.com"


def test_projects_require_auth_and_are_tenant_scoped(s):
    denied = s.get(f"{s.base}/projects")
    assert denied.status_code == 401

    a = _register(s, email="a@example.com")
    b = _register(s, email="b@example.com")

    created = s.post(f"{s.base}/projects", json={"name": "A Proj"}, headers=_auth(a["access_token"]))
    assert created.status_code == 200, created.text
    proj_id = created.json()["id"]
    assert created.json()["owner_id"] == a["user"]["id"]

    listed_a = s.get(f"{s.base}/projects", headers=_auth(a["access_token"]))
    assert any(p["id"] == proj_id for p in listed_a.json())

    listed_b = s.get(f"{s.base}/projects", headers=_auth(b["access_token"]))
    assert all(p["id"] != proj_id for p in listed_b.json())

    stolen = s.get(f"{s.base}/projects/{proj_id}", headers=_auth(b["access_token"]))
    assert stolen.status_code == 404


def test_files_crud_scoped(s):
    a = _register(s)
    headers = _auth(a["access_token"])
    proj = s.post(f"{s.base}/projects", json={"name": "Files"}, headers=headers).json()

    created = s.post(
        f"{s.base}/files",
        json={"project_id": proj["id"], "name": "main.py", "language": "python", "content": "print(1)"},
        headers=headers,
    )
    assert created.status_code == 200, created.text
    file_id = created.json()["id"]

    listed = s.get(f"{s.base}/files", params={"project_id": proj["id"]}, headers=headers)
    assert any(f["id"] == file_id for f in listed.json())

    patched = s.patch(f"{s.base}/files/{file_id}", json={"content": "print(2)"}, headers=headers)
    assert patched.status_code == 200
    assert patched.json()["content"] == "print(2)"

    deleted = s.delete(f"{s.base}/files/{file_id}", headers=headers)
    assert deleted.status_code == 200


def test_run_python_process_sandbox(s):
    a = _register(s)
    headers = _auth(a["access_token"])
    r = s.post(f"{s.base}/run", json={"language": "python", "code": "print(2+2)"}, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["exit_code"] == 0
    assert "4" in body["stdout"]
    assert body.get("sandbox") in ("process", "docker")


def test_run_html_noop(s):
    a = _register(s)
    r = s.post(
        f"{s.base}/run",
        json={"language": "html", "code": "<h1>hi</h1>"},
        headers=_auth(a["access_token"]),
    )
    assert r.status_code == 200
    assert r.json()["exit_code"] == 0


def test_snippets_authorship(s):
    a = _register(s, email="author@example.com")
    b = _register(s, email="other@example.com")
    headers_a = _auth(a["access_token"])
    headers_b = _auth(b["access_token"])

    created = s.post(
        f"{s.base}/snippets",
        json={
            "title": "Hello",
            "code": "print('hi')",
            "language": "python",
            "description": "demo",
            "tags": ["test"],
        },
        headers=headers_a,
    )
    assert created.status_code == 200, created.text
    snip = created.json()
    assert snip["author_id"] == a["user"]["id"]

    listed = s.get(f"{s.base}/snippets")
    assert listed.status_code == 200
    assert any(x["id"] == snip["id"] for x in listed.json())

    denied = s.delete(f"{s.base}/snippets/{snip['id']}", headers=headers_b)
    assert denied.status_code == 403

    starred = s.post(f"{s.base}/snippets/{snip['id']}/star", json={}, headers=headers_a)
    assert starred.status_code == 200
    assert starred.json()["stars"] == 1
    check = s.get(f"{s.base}/snippets/{snip['id']}/starred", headers=headers_a)
    assert check.json()["starred"] is True

    deleted = s.delete(f"{s.base}/snippets/{snip['id']}", headers=headers_a)
    assert deleted.status_code == 200

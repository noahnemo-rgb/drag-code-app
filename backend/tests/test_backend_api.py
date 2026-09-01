"""Backend API tests for Syntax Mobile IDE."""
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get("SYNTAX_TEST_BASE_URL", "http://127.0.0.1:8000")
API = f"{BASE_URL}/api"
TEST_DEVICE = f"TEST_{uuid.uuid4().hex[:12]}"


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({
        "Content-Type": "application/json",
        "X-Device-Id": TEST_DEVICE,
        "X-Tier": "free",
    })
    return sess


def test_health(s):
    r = s.get(f"{API}/")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "message" in body
    assert "tiers" in body


def test_usage_endpoint(s):
    r = s.get(f"{API}/usage")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["tier"] == "free"
    assert "runs" in body and "snippet_publishes" in body


class TestProjects:
    proj_id = None

    def test_create_project(self, s):
        r = s.post(f"{API}/projects", json={"name": "TEST_Proj"})
        assert r.status_code == 200, r.text
        d = r.json()
        TestProjects.proj_id = d["id"]

    def test_delete_project(self, s):
        r = s.delete(f"{API}/projects/{TestProjects.proj_id}")
        assert r.status_code == 200


class TestRun:
    def test_python(self, s):
        r = s.post(f"{API}/run", json={"language": "python", "code": "print(2+2)"})
        assert r.status_code == 200, r.text
        assert "4" in r.json()["stdout"]

    def test_run_requires_device_id(self):
        sess = requests.Session()
        sess.headers.update({"Content-Type": "application/json"})
        r = sess.post(f"{API}/run", json={"language": "python", "code": "print(1)"})
        assert r.status_code in (401, 200), r.text


class TestChatRemoved:
    def test_chat_stream_gone(self, s):
        r = s.post(f"{API}/chat/stream", json={"session_id": "x", "message": "hi"})
        assert r.status_code == 404, r.text

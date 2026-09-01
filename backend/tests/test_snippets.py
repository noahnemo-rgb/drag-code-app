"""Snippet API tests."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("SYNTAX_TEST_BASE_URL", "http://127.0.0.1:8000")
API = f"{BASE_URL}/api"
DEVICE = f"TEST_SNIP_{uuid.uuid4().hex[:8]}"


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({
        "Content-Type": "application/json",
        "X-Device-Id": DEVICE,
        "X-Tier": "free",
    })
    return sess


def test_list_snippets_empty_ok(s):
    r = s.get(f"{API}/snippets")
    assert r.status_code == 200
    assert isinstance(r.json(), list)

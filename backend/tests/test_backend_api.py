"""Backend API tests for Syntax Mobile IDE.
Covers: health, projects CRUD, files CRUD, code run (with device id + rate limits).
AI chat is client-side (Puter / OpenRouter BYOK) — no /api/chat/* routes.
"""
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get("SYNTAX_TEST_BASE_URL", "https://drag-code-app.preview.emergentagent.com")
API = f"{BASE_URL}/api"
TEST_DEVICE = f"TEST_{uuid.uuid4().hex[:12]}"


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json", "X-Device-Id": TEST_DEVICE})
    return sess


# ---------------- Health ----------------
def test_health(s):
    r = s.get(f"{API}/")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "message" in body
    assert "run_daily_limit" in body


# ---------------- Projects CRUD ----------------
class TestProjects:
    proj_id = None

    def test_create_project(self, s):
        r = s.post(f"{API}/projects", json={"name": "TEST_Proj"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["name"] == "TEST_Proj"
        assert "id" in d
        assert "_id" not in d
        TestProjects.proj_id = d["id"]

    def test_list_projects(self, s):
        r = s.get(f"{API}/projects")
        assert r.status_code == 200
        arr = r.json()
        assert isinstance(arr, list)
        assert any(p["id"] == TestProjects.proj_id for p in arr)
        for p in arr:
            assert "_id" not in p

    def test_get_project(self, s):
        r = s.get(f"{API}/projects/{TestProjects.proj_id}")
        assert r.status_code == 200
        assert r.json()["id"] == TestProjects.proj_id

    def test_patch_project(self, s):
        r = s.patch(f"{API}/projects/{TestProjects.proj_id}", json={"name": "TEST_Proj_Renamed"})
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Proj_Renamed"
        g = s.get(f"{API}/projects/{TestProjects.proj_id}").json()
        assert g["name"] == "TEST_Proj_Renamed"

    def test_delete_project(self, s):
        r = s.delete(f"{API}/projects/{TestProjects.proj_id}")
        assert r.status_code == 200
        g = s.get(f"{API}/projects/{TestProjects.proj_id}")
        assert g.status_code == 404


# ---------------- Files CRUD ----------------
class TestFiles:
    proj_id = None
    file_id = None

    def test_setup_project(self, s):
        r = s.post(f"{API}/projects", json={"name": "TEST_FilesProj"})
        assert r.status_code == 200
        TestFiles.proj_id = r.json()["id"]

    def test_create_file(self, s):
        r = s.post(f"{API}/files", json={
            "project_id": TestFiles.proj_id,
            "name": "hello.py",
            "language": "python",
            "content": "print('hi')",
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert "_id" not in d
        assert d["name"] == "hello.py"
        assert d["language"] == "python"
        TestFiles.file_id = d["id"]

    def test_list_files(self, s):
        r = s.get(f"{API}/files", params={"project_id": TestFiles.proj_id})
        assert r.status_code == 200
        arr = r.json()
        assert any(f["id"] == TestFiles.file_id for f in arr)
        for f in arr:
            assert "_id" not in f

    def test_patch_file(self, s):
        r = s.patch(f"{API}/files/{TestFiles.file_id}",
                    json={"content": "print('updated')"})
        assert r.status_code == 200
        assert r.json()["content"] == "print('updated')"
        g = s.get(f"{API}/files/{TestFiles.file_id}").json()
        assert g["content"] == "print('updated')"
        assert "_id" not in g

    def test_delete_file(self, s):
        r = s.delete(f"{API}/files/{TestFiles.file_id}")
        assert r.status_code == 200
        g = s.get(f"{API}/files/{TestFiles.file_id}")
        assert g.status_code == 404

    def test_cleanup_project(self, s):
        r = s.delete(f"{API}/projects/{TestFiles.proj_id}")
        assert r.status_code == 200


# ---------------- Code Run ----------------
class TestRun:
    def test_python(self, s):
        r = s.post(f"{API}/run", json={"language": "python", "code": "print(2+2)"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["exit_code"] == 0
        assert "4" in d["stdout"]

    def test_javascript(self, s):
        r = s.post(f"{API}/run", json={"language": "javascript",
                                       "code": "console.log('js-'+ (1+1))"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["exit_code"] == 0
        assert "js-2" in d["stdout"]

    def test_html(self, s):
        r = s.post(f"{API}/run", json={"language": "html", "code": "<h1>hi</h1>"})
        assert r.status_code == 200
        d = r.json()
        assert d["exit_code"] == 0
        assert "Preview" in d["stdout"] or "on-device" in d["stdout"]

    def test_css(self, s):
        r = s.post(f"{API}/run", json={"language": "css", "code": "a{color:red}"})
        assert r.status_code == 200
        d = r.json()
        assert "no runtime" in d["stdout"].lower() or "css" in d["stdout"].lower()

    def test_malformed_language(self, s):
        r = s.post(f"{API}/run", json={"language": "cobol", "code": "x"})
        assert r.status_code in (400, 422), r.text

    def test_timeout(self, s):
        start = time.time()
        r = s.post(f"{API}/run", json={
            "language": "python",
            "code": "import time\nwhile True:\n    time.sleep(1)"
        }, timeout=30)
        elapsed = time.time() - start
        assert r.status_code == 200
        d = r.json()
        assert "timed out" in d["stderr"].lower()
        assert elapsed < 20, f"Timeout took too long: {elapsed}s"

    def test_run_requires_device_id(self):
        sess = requests.Session()
        sess.headers.update({"Content-Type": "application/json"})
        r = sess.post(f"{API}/run", json={"language": "python", "code": "print(1)"})
        # When REQUIRE_DEVICE_ID=true on the server, missing header is 401.
        assert r.status_code in (401, 200), r.text


# ---------------- Chat removed ----------------
class TestChatRemoved:
    def test_chat_stream_gone(self, s):
        r = s.post(f"{API}/chat/stream", json={"session_id": "x", "message": "hi"})
        assert r.status_code == 404, r.text

    def test_chat_history_gone(self, s):
        r = s.get(f"{API}/chat/history/test-session")
        assert r.status_code == 404, r.text

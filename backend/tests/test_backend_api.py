"""Backend API tests for Syntax Mobile IDE.
Covers: health, projects CRUD, files CRUD, code run, chat stream + history.
"""
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ.get("SYNTAX_TEST_BASE_URL", "http://localhost:8000")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ---------------- Health ----------------
def test_health(s):
    r = s.get(f"{API}/")
    assert r.status_code == 200, r.text
    assert "message" in r.json()


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
        # verify persistence
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
        # Pydantic Literal validation returns 422; treat 400/422 as acceptable
        assert r.status_code in (400, 422), r.text

    def test_timeout(self, s):
        # Should time out at ~10s
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


# ---------------- Chat ----------------
class TestChat:
    session_id = f"TEST_{uuid.uuid4().hex[:8]}"

    def test_chat_stream(self, s):
        r = s.post(f"{API}/chat/stream", json={
            "session_id": TestChat.session_id,
            "message": "Say hi in 5 words",
        }, stream=True, timeout=60)
        assert r.status_code == 200, r.text
        chunks = []
        for chunk in r.iter_content(chunk_size=None, decode_unicode=True):
            if chunk:
                chunks.append(chunk)
            if sum(len(c) for c in chunks) > 500:
                break
        r.close()
        body = "".join(chunks)
        assert len(body) > 0, "Expected streamed text from Gemini"
        assert "[Error:" not in body, f"Chat returned error: {body}"

    def test_history_after_chat(self, s):
        # Allow persistence to complete
        time.sleep(3)
        r = s.get(f"{API}/chat/history/{TestChat.session_id}")
        assert r.status_code == 200
        msgs = r.json()
        assert len(msgs) >= 1, f"Expected saved messages, got {msgs}"
        for m in msgs:
            assert "_id" not in m
            assert m["role"] in ("user", "assistant")

    def test_clear_history(self, s):
        r = s.delete(f"{API}/chat/history/{TestChat.session_id}")
        assert r.status_code == 200
        g = s.get(f"{API}/chat/history/{TestChat.session_id}").json()
        assert g == []

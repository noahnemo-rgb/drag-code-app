"""Snippets Marketplace + TypeScript run regression tests."""
import uuid
import pytest
import requests

BASE_URL = "https://drag-code-app.preview.emergentagent.com"
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


class TestSnippets:
    created_ids: list = []
    device_a = f"TEST_dev_{uuid.uuid4().hex[:8]}"
    device_b = f"TEST_dev_{uuid.uuid4().hex[:8]}"
    snippet_id = None

    def test_create_snippet(self, s):
        payload = {
            "author": "TEST_Ada",
            "author_device": TestSnippets.device_a,
            "title": "TEST_Fib",
            "description": "Fibonacci helper",
            "language": "python",
            "code": "def fib(n):\n    return n if n < 2 else fib(n-1)+fib(n-2)",
            "tags": ["math", "recursion"],
        }
        r = s.post(f"{API}/snippets", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "_id" not in d
        assert d["stars"] == 0
        assert d["language"] == "python"
        assert d["title"] == "TEST_Fib"
        assert d["tags"] == ["math", "recursion"]
        # ISO created_at check
        assert "T" in d["created_at"]
        TestSnippets.snippet_id = d["id"]
        TestSnippets.created_ids.append(d["id"])

    def test_create_missing_title_returns_400(self, s):
        r = s.post(f"{API}/snippets", json={
            "author": "x", "title": "  ", "language": "python", "code": "x",
        })
        assert r.status_code == 400

    def test_list_all(self, s):
        r = s.get(f"{API}/snippets")
        assert r.status_code == 200
        arr = r.json()
        assert isinstance(arr, list)
        assert any(x["id"] == TestSnippets.snippet_id for x in arr)
        for x in arr:
            assert "_id" not in x

    def test_list_filter_language(self, s):
        r = s.get(f"{API}/snippets", params={"language": "python"})
        assert r.status_code == 200
        arr = r.json()
        assert all(x["language"] == "python" for x in arr)
        assert any(x["id"] == TestSnippets.snippet_id for x in arr)

    def test_list_filter_language_none_match(self, s):
        # Create a unique-tag JS snippet, then filter to python => must not appear
        r = s.post(f"{API}/snippets", json={
            "author": "TEST_Grace", "author_device": TestSnippets.device_b,
            "title": "TEST_JSOnly", "language": "javascript",
            "code": "console.log(1)", "tags": []
        })
        assert r.status_code == 200
        jsid = r.json()["id"]
        TestSnippets.created_ids.append(jsid)
        r = s.get(f"{API}/snippets", params={"language": "python"})
        assert not any(x["id"] == jsid for x in r.json())

    def test_search_query(self, s):
        r = s.get(f"{API}/snippets", params={"q": "fib"})
        assert r.status_code == 200
        arr = r.json()
        assert any(x["id"] == TestSnippets.snippet_id for x in arr)
        # case-insensitive
        r2 = s.get(f"{API}/snippets", params={"q": "FIB"})
        assert any(x["id"] == TestSnippets.snippet_id for x in r2.json())
        # search by tag
        r3 = s.get(f"{API}/snippets", params={"q": "recursion"})
        assert any(x["id"] == TestSnippets.snippet_id for x in r3.json())

    def test_get_detail_and_404(self, s):
        r = s.get(f"{API}/snippets/{TestSnippets.snippet_id}")
        assert r.status_code == 200
        assert r.json()["id"] == TestSnippets.snippet_id
        r2 = s.get(f"{API}/snippets/nonexistent-id-xyz")
        assert r2.status_code == 404

    def test_star_toggle_idempotent(self, s):
        sid = TestSnippets.snippet_id
        dev = TestSnippets.device_a
        # starred? -> false initially
        r0 = s.get(f"{API}/snippets/{sid}/starred", params={"device_id": dev})
        assert r0.json()["starred"] is False

        # star once => stars=1
        r1 = s.post(f"{API}/snippets/{sid}/star", json={"device_id": dev})
        assert r1.status_code == 200
        assert r1.json()["stars"] == 1
        r1b = s.get(f"{API}/snippets/{sid}/starred", params={"device_id": dev})
        assert r1b.json()["starred"] is True

        # star again with same device_id => decrement to 0
        r2 = s.post(f"{API}/snippets/{sid}/star", json={"device_id": dev})
        assert r2.status_code == 200
        assert r2.json()["stars"] == 0
        r2b = s.get(f"{API}/snippets/{sid}/starred", params={"device_id": dev})
        assert r2b.json()["starred"] is False

        # star with 2 different devices => stars=2
        s.post(f"{API}/snippets/{sid}/star", json={"device_id": dev})
        r3 = s.post(f"{API}/snippets/{sid}/star", json={"device_id": TestSnippets.device_b})
        assert r3.json()["stars"] == 2

    def test_patch_updates_fields(self, s):
        sid = TestSnippets.snippet_id
        payload = {
            "device_id": TestSnippets.device_a,
            "title": "TEST_Fib_v2",
            "description": "Updated description",
            "language": "javascript",
            "code": "console.log('fib');",
            "tags": ["updated", "js"],
        }
        r = s.patch(f"{API}/snippets/{sid}", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "_id" not in d
        assert d["id"] == sid
        assert d["title"] == "TEST_Fib_v2"
        assert d["description"] == "Updated description"
        assert d["language"] == "javascript"
        assert d["code"] == "console.log('fib');"
        assert d["tags"] == ["updated", "js"]
        # verify persistence via GET
        g = s.get(f"{API}/snippets/{sid}")
        assert g.status_code == 200
        gj = g.json()
        assert gj["title"] == "TEST_Fib_v2"
        assert gj["language"] == "javascript"
        assert gj["tags"] == ["updated", "js"]

    def test_patch_partial_only_specified_fields(self, s):
        sid = TestSnippets.snippet_id
        # Only update title; other fields must remain intact
        r = s.patch(f"{API}/snippets/{sid}", json={
            "device_id": TestSnippets.device_a,
            "title": "TEST_Fib_v3",
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["title"] == "TEST_Fib_v3"
        # remained from previous patch
        assert d["language"] == "javascript"
        assert d["tags"] == ["updated", "js"]
        assert d["code"] == "console.log('fib');"

    def test_patch_no_fields_is_noop(self, s):
        sid = TestSnippets.snippet_id
        before = s.get(f"{API}/snippets/{sid}").json()
        r = s.patch(f"{API}/snippets/{sid}", json={"device_id": TestSnippets.device_a})
        assert r.status_code == 200, r.text
        after = r.json()
        # All top-level fields identical
        for k in ("id", "title", "description", "language", "code", "tags", "author", "author_device", "stars", "created_at"):
            assert before.get(k) == after.get(k), f"field '{k}' changed unexpectedly"

    def test_patch_forbidden_wrong_device(self, s):
        sid = TestSnippets.snippet_id
        r = s.patch(f"{API}/snippets/{sid}", json={
            "device_id": "not-the-author",
            "title": "hack",
        })
        assert r.status_code == 403
        # ensure title unchanged
        g = s.get(f"{API}/snippets/{sid}").json()
        assert g["title"] != "hack"

    def test_patch_unknown_id_returns_404(self, s):
        r = s.patch(f"{API}/snippets/nonexistent-id-xyz", json={
            "device_id": TestSnippets.device_a,
            "title": "whatever",
        })
        assert r.status_code == 404

    def test_delete_forbidden_wrong_device(self, s):
        sid = TestSnippets.snippet_id
        r = s.delete(f"{API}/snippets/{sid}", params={"device_id": "not-the-author"})
        assert r.status_code == 403
        # still exists
        assert s.get(f"{API}/snippets/{sid}").status_code == 200

    def test_delete_allowed_and_cascade_stars(self, s):
        sid = TestSnippets.snippet_id
        r = s.delete(f"{API}/snippets/{sid}", params={"device_id": TestSnippets.device_a})
        assert r.status_code == 200
        # gone
        assert s.get(f"{API}/snippets/{sid}").status_code == 404
        # starred should now return false since stars cascaded
        rs = s.get(f"{API}/snippets/{sid}/starred", params={"device_id": TestSnippets.device_b})
        assert rs.json()["starred"] is False
        TestSnippets.created_ids.remove(sid)

    def test_zzz_cleanup(self, s):
        for sid in list(TestSnippets.created_ids):
            s.delete(f"{API}/snippets/{sid}", params={"device_id": TestSnippets.device_b})
        # best-effort with device_a too
        for sid in list(TestSnippets.created_ids):
            s.delete(f"{API}/snippets/{sid}", params={"device_id": TestSnippets.device_a})


class TestTypeScriptRun:
    def test_ts_annotation_runs(self, s):
        code = "const g: number = 42; console.log(g);"
        r = s.post(f"{API}/run", json={"language": "typescript", "code": code}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["exit_code"] == 0, d
        assert "42" in d["stdout"], d

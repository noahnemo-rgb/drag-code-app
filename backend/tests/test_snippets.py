"""Legacy remote snippets tests — skipped; use test_local_api.py."""
import pytest

pytestmark = pytest.mark.skip(
    reason="Remote Emergent preview suite replaced by local test_local_api.py",
)


def test_placeholder():
    assert True

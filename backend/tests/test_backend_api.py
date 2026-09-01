"""Legacy remote preview tests — skipped in favor of local CI suite.

See tests/test_local_api.py which runs against the ASGI app + MongoDB.
"""
import pytest

pytestmark = pytest.mark.skip(
    reason="Remote Emergent preview suite replaced by local test_local_api.py",
)


def test_placeholder():
    assert True

"""Live login test against real Gradescope. Opt-in via GS_LIVE=1."""
from __future__ import annotations

import os

import pytest

from gradescope_bot.gs_client import GSClient

pytestmark = pytest.mark.skipif(
    os.environ.get("GS_LIVE") != "1",
    reason="Set GS_LIVE=1 to run live Gradescope tests",
)


def test_live_login_and_list_courses() -> None:
    client = GSClient()
    client.login()
    courses = client.get_courses()
    assert "student" in courses
    assert isinstance(courses["student"], dict)

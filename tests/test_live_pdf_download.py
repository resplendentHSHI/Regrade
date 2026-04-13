"""Live PDF download test. Opt-in via GS_LIVE=1 and GS_TEST_SUBMISSION env vars."""
from __future__ import annotations

import os

import pytest

from gradescope_bot.gs_client import GSClient

pytestmark = pytest.mark.skipif(
    os.environ.get("GS_LIVE") != "1",
    reason="Set GS_LIVE=1 to run live Gradescope tests",
)


def test_live_pdf_download_starts_with_pdf_magic() -> None:
    course_id = os.environ["GS_TEST_COURSE_ID"]
    assignment_id = os.environ["GS_TEST_ASSIGNMENT_ID"]
    submission_id = os.environ["GS_TEST_SUBMISSION_ID"]

    client = GSClient()
    client.login()
    content = client.download_submission_pdf(course_id, assignment_id, submission_id)

    assert content[:4] == b"%PDF"
    assert len(content) > 1000

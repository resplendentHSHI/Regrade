"""Tests for the PDF download path. Uses a mock session to avoid real network."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from gradescope_bot import config
from gradescope_bot.gs_client import GSClient


def _mock_client(pdf_bytes: bytes, status_code: int = 200) -> GSClient:
    client = GSClient()
    # Bypass real login
    fake_conn = MagicMock()
    fake_session = MagicMock()
    fake_response = MagicMock(content=pdf_bytes, status_code=status_code)
    fake_response.raise_for_status = MagicMock()
    fake_session.get.return_value = fake_response
    fake_conn.session = fake_session
    client._conn = fake_conn
    return client


def test_download_submission_pdf_returns_bytes() -> None:
    pdf = b"%PDF-1.4\n%fake content\n"
    client = _mock_client(pdf)

    result = client.download_submission_pdf("1222348", "7841492", "400080463")

    assert result == pdf
    client._conn.session.get.assert_called_once_with(
        "https://www.gradescope.com/courses/1222348/assignments/7841492/submissions/400080463.pdf"
    )


def test_download_submission_pdf_raises_when_response_not_pdf() -> None:
    client = _mock_client(b"<html>login page</html>")
    with pytest.raises(ValueError, match="not a PDF"):
        client.download_submission_pdf("1", "2", "3")

"""Tests for Google OAuth token verification."""
from __future__ import annotations

from unittest.mock import patch, MagicMock

import pytest

from poko_server.auth import verify_google_token, get_current_user_email


def test_verify_valid_token():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "email": "alice@gmail.com",
        "email_verified": "true",
    }
    with patch("poko_server.auth.httpx.get", return_value=mock_response):
        email = verify_google_token("valid-token-123")
        assert email == "alice@gmail.com"


def test_verify_invalid_token():
    mock_response = MagicMock()
    mock_response.status_code = 400
    mock_response.json.return_value = {"error": "invalid_token"}
    with patch("poko_server.auth.httpx.get", return_value=mock_response):
        email = verify_google_token("bad-token")
        assert email is None


def test_verify_unverified_email():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "email": "alice@gmail.com",
        "email_verified": "false",
    }
    with patch("poko_server.auth.httpx.get", return_value=mock_response):
        email = verify_google_token("unverified-token")
        assert email is None


def test_verify_network_error():
    with patch("poko_server.auth.httpx.get", side_effect=Exception("network error")):
        email = verify_google_token("some-token")
        assert email is None

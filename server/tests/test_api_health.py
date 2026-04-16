"""Tests for the health endpoint and app basics."""
from __future__ import annotations

from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client(db_conn):
    from poko_server.api import app
    return TestClient(app)


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "uptime_seconds" in data


def test_unauthenticated_request_returns_401(client):
    resp = client.get("/users/me/stats")
    assert resp.status_code in (401, 422)


def test_auth_verify_creates_user(client, db_conn):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "email": "test@gmail.com",
        "email_verified": "true",
    }
    with patch("poko_server.auth.httpx.get", return_value=mock_response):
        resp = client.post(
            "/auth/verify",
            headers={"Authorization": "Bearer test-token"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "test@gmail.com"
        assert data["user_id"] is not None

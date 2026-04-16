"""Tests for score sync and metrics endpoints."""
from __future__ import annotations

from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient

from poko_server import db


def _mock_auth(email: str = "test@gmail.com"):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"email": email, "email_verified": "true"}
    return patch("poko_server.auth.httpx.get", return_value=mock_response)


@pytest.fixture()
def client(db_conn):
    from poko_server.api import app
    return TestClient(app)


@pytest.fixture()
def auth_headers():
    return {"Authorization": "Bearer test-token"}


def test_score_sync_no_prior_scores(client, auth_headers, db_conn):
    with _mock_auth():
        resp = client.post("/scores/sync", headers=auth_headers,
            json={"scores": [{"course_id": "1001", "assignment_id": "2001",
                              "score": 85.0, "max_score": 100.0}]})
    assert resp.status_code == 200
    data = resp.json()
    assert data["changes_detected"] == 0


def test_score_sync_detects_increase_with_job(client, auth_headers, db_conn):
    """Score increases are only credited when a completed Poko job exists."""
    from poko_server import db as poko_db
    with _mock_auth():
        # Establish baseline score
        client.post("/scores/sync", headers=auth_headers,
            json={"scores": [{"course_id": "1001", "assignment_id": "2001",
                              "score": 85.0, "max_score": 100.0}]})
        # Create a completed job for this assignment
        user = poko_db.get_user_by_email("test@gmail.com")
        job = poko_db.create_job(
            user_id=user["id"], pdf_hash="testhash", course_id="1001",
            assignment_id="2001", assignment_name="HW1", course_name="MATH 101",
        )
        poko_db.update_job_status(job["id"], "complete")
        # Sync with higher score
        resp = client.post("/scores/sync", headers=auth_headers,
            json={"scores": [{"course_id": "1001", "assignment_id": "2001",
                              "score": 90.0, "max_score": 100.0}]})
    assert resp.status_code == 200
    data = resp.json()
    assert data["changes_detected"] == 1
    assert data["total_points_delta"] == 5.0


def test_score_sync_no_credit_without_job(client, auth_headers, db_conn):
    """Score increases are NOT credited when no Poko job exists."""
    with _mock_auth():
        client.post("/scores/sync", headers=auth_headers,
            json={"scores": [{"course_id": "1001", "assignment_id": "2001",
                              "score": 85.0, "max_score": 100.0}]})
        resp = client.post("/scores/sync", headers=auth_headers,
            json={"scores": [{"course_id": "1001", "assignment_id": "2001",
                              "score": 90.0, "max_score": 100.0}]})
    assert resp.status_code == 200
    data = resp.json()
    assert data["changes_detected"] == 0
    assert data["total_points_delta"] == 0.0


def test_stats_reflect_score_changes(client, auth_headers, db_conn):
    from poko_server import db as poko_db
    with _mock_auth():
        # Establish baseline
        client.post("/scores/sync", headers=auth_headers,
            json={"scores": [{"course_id": "1001", "assignment_id": "2001",
                              "score": 85.0, "max_score": 100.0}]})
        # Create completed job so increase is attributed to Poko
        user = poko_db.get_user_by_email("test@gmail.com")
        job = poko_db.create_job(
            user_id=user["id"], pdf_hash="statshash", course_id="1001",
            assignment_id="2001", assignment_name="HW1", course_name="MATH 101",
        )
        poko_db.update_job_status(job["id"], "complete")
        # Sync with higher score
        client.post("/scores/sync", headers=auth_headers,
            json={"scores": [{"course_id": "1001", "assignment_id": "2001",
                              "score": 90.0, "max_score": 100.0}]})
        resp = client.get("/users/me/stats", headers=auth_headers)
    data = resp.json()
    assert data["points_recovered"] == 5.0

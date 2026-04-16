"""Tests for job upload, poll, result, and delete endpoints."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient

FIXTURES = Path(__file__).parent / "fixtures"


def _mock_auth():
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"email": "test@gmail.com", "email_verified": "true"}
    return patch("poko_server.auth.httpx.get", return_value=mock_response)


@pytest.fixture()
def client(db_conn):
    from poko_server.api import app
    return TestClient(app)


@pytest.fixture()
def auth_headers():
    return {"Authorization": "Bearer test-token"}


def test_upload_pdf(client, auth_headers, tmp_data_dir):
    pdf_bytes = (FIXTURES / "sample.pdf").read_bytes()
    with _mock_auth():
        resp = client.post("/jobs", headers=auth_headers,
            files={"file": ("hw1.pdf", pdf_bytes, "application/pdf")},
            data={"course_id": "1001", "assignment_id": "2001",
                  "assignment_name": "HW1", "course_name": "MATH 101"})
    assert resp.status_code == 201
    data = resp.json()
    assert data["status"] == "uploaded"
    assert "job_id" in data


def test_upload_non_pdf_rejected(client, auth_headers, tmp_data_dir):
    with _mock_auth():
        resp = client.post("/jobs", headers=auth_headers,
            files={"file": ("hw1.txt", b"not a pdf", "text/plain")},
            data={"course_id": "1001", "assignment_id": "2001",
                  "assignment_name": "HW1", "course_name": "MATH 101"})
    assert resp.status_code == 400


def test_upload_duplicate_returns_existing(client, auth_headers, tmp_data_dir):
    pdf_bytes = (FIXTURES / "sample.pdf").read_bytes()
    with _mock_auth():
        resp1 = client.post("/jobs", headers=auth_headers,
            files={"file": ("hw1.pdf", pdf_bytes, "application/pdf")},
            data={"course_id": "1001", "assignment_id": "2001",
                  "assignment_name": "HW1", "course_name": "MATH 101"})
        resp2 = client.post("/jobs", headers=auth_headers,
            files={"file": ("hw1.pdf", pdf_bytes, "application/pdf")},
            data={"course_id": "1001", "assignment_id": "2001",
                  "assignment_name": "HW1", "course_name": "MATH 101"})
    assert resp1.json()["job_id"] == resp2.json()["job_id"]


def test_job_status(client, auth_headers, tmp_data_dir):
    pdf_bytes = (FIXTURES / "sample.pdf").read_bytes()
    with _mock_auth():
        upload_resp = client.post("/jobs", headers=auth_headers,
            files={"file": ("hw1.pdf", pdf_bytes, "application/pdf")},
            data={"course_id": "1001", "assignment_id": "2001",
                  "assignment_name": "HW1", "course_name": "MATH 101"})
        job_id = upload_resp.json()["job_id"]
        status_resp = client.get(f"/jobs/{job_id}/status", headers=auth_headers)
    assert status_resp.status_code == 200
    assert status_resp.json()["status"] == "uploaded"


def test_delete_job(client, auth_headers, tmp_data_dir):
    pdf_bytes = (FIXTURES / "sample.pdf").read_bytes()
    with _mock_auth():
        upload_resp = client.post("/jobs", headers=auth_headers,
            files={"file": ("hw1.pdf", pdf_bytes, "application/pdf")},
            data={"course_id": "1001", "assignment_id": "2001",
                  "assignment_name": "HW1", "course_name": "MATH 101"})
        job_id = upload_resp.json()["job_id"]
        del_resp = client.delete(f"/jobs/{job_id}", headers=auth_headers)
    assert del_resp.status_code == 200


def test_job_not_found(client, auth_headers, tmp_data_dir):
    with _mock_auth():
        resp = client.get("/jobs/nonexistent/status", headers=auth_headers)
    assert resp.status_code == 404

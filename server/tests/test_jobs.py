"""Tests for job upload, poll, result, and delete endpoints."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient

from poko_server import db, config
from poko_server.jobs import process_pending_jobs

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


def test_process_pending_job(db_conn, tmp_data_dir):
    """End-to-end: upload → process → result available."""
    user = db.create_user("process-test@gmail.com")
    job = db.create_job(user_id=user["id"], pdf_hash="proc123", course_id="1001",
                        assignment_id="2001", assignment_name="HW1", course_name="MATH 101")
    job_dir = config.UPLOAD_DIR / job["id"]
    job_dir.mkdir(parents=True, exist_ok=True)
    (job_dir / "submission.pdf").write_bytes((FIXTURES / "sample.pdf").read_bytes())

    with patch.object(config, "CLAUDE_PRESCREEN_BINARY", str(FIXTURES / "fake_prescreen_yes.sh")), \
         patch.object(config, "CLAUDE_BINARY", str(FIXTURES / "fake_claude_ok.sh")):
        counts = process_pending_jobs()

    assert counts["processed"] == 1
    assert counts["complete"] == 1
    updated = db.get_job(job["id"])
    assert updated["status"] == "complete"
    assert updated["result_json"] is not None
    assert updated["draft_md"] is not None


def test_process_no_pending_jobs(db_conn, tmp_data_dir):
    counts = process_pending_jobs()
    assert counts["processed"] == 0


def test_process_job_sends_notification_for_critical(db_conn, tmp_data_dir):
    """When analysis finds critical issues, send_notification is called."""
    from poko_server import config
    user = db.create_user("notify-test@gmail.com")
    job = db.create_job(user_id=user["id"], pdf_hash="notify123", course_id="1001",
                        assignment_id="2001", assignment_name="HW7", course_name="MATH 268")
    job_dir = config.UPLOAD_DIR / job["id"]
    job_dir.mkdir(parents=True, exist_ok=True)
    (job_dir / "submission.pdf").write_bytes((FIXTURES / "sample.pdf").read_bytes())

    with patch.object(config, "CLAUDE_PRESCREEN_BINARY", str(FIXTURES / "fake_prescreen_yes.sh")), \
         patch.object(config, "CLAUDE_BINARY", str(FIXTURES / "fake_claude_ok.sh")), \
         patch("poko_server.jobs.send_notification") as mock_send, \
         patch("poko_server.jobs.should_notify", return_value=True):
        process_pending_jobs()

    mock_send.assert_called_once()
    call_args = mock_send.call_args
    assert call_args[0][0] == "notify-test@gmail.com"
    assert "HW7" in call_args[0][1]

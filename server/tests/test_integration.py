"""End-to-end integration test: upload → worker processes → poll result → delete."""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient

from poko_server import config, db
from poko_server.jobs import process_pending_jobs

FIXTURES = Path(__file__).parent / "fixtures"


def _mock_auth(email: str = "integration@gmail.com"):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"email": email, "email_verified": "true"}
    return patch("poko_server.auth.httpx.get", return_value=mock_response)


@pytest.fixture()
def client(db_conn):
    from poko_server.api import app
    return TestClient(app)


def test_full_flow(client, db_conn, tmp_data_dir):
    """Upload PDF → process → poll status → fetch result → delete."""
    pdf_bytes = (FIXTURES / "sample.pdf").read_bytes()
    headers = {"Authorization": "Bearer test-token"}

    with _mock_auth():
        # 1. Upload
        upload_resp = client.post("/jobs", headers=headers,
            files={"file": ("hw7.pdf", pdf_bytes, "application/pdf")},
            data={"course_id": "1001", "assignment_id": "2001",
                  "assignment_name": "HW7", "course_name": "MATH 268"})
        assert upload_resp.status_code == 201
        job_id = upload_resp.json()["job_id"]

        # 2. Status should be uploaded
        status_resp = client.get(f"/jobs/{job_id}/status", headers=headers)
        assert status_resp.json()["status"] == "uploaded"

    # 3. Process (simulate worker)
    with patch.object(config, "CLAUDE_PRESCREEN_BINARY", str(FIXTURES / "fake_prescreen_yes.sh")), \
         patch.object(config, "CLAUDE_BINARY", str(FIXTURES / "fake_claude_ok.sh")), \
         patch("poko_server.jobs.send_notification"), \
         patch("poko_server.jobs.should_notify", return_value=False):
        counts = process_pending_jobs()
    assert counts["complete"] == 1

    with _mock_auth():
        # 4. Status should be complete
        status_resp = client.get(f"/jobs/{job_id}/status", headers=headers)
        assert status_resp.json()["status"] == "complete"

        # 5. Fetch result
        result_resp = client.get(f"/jobs/{job_id}/result", headers=headers)
        assert result_resp.status_code == 200
        data = result_resp.json()
        assert data["result_json"] is not None
        parsed = json.loads(data["result_json"])
        assert parsed["kept_issue_count"] == 1
        assert data["draft_md"] is not None
        assert "Clairaut" in data["draft_md"]

        # 6. Delete
        del_resp = client.delete(f"/jobs/{job_id}", headers=headers)
        assert del_resp.status_code == 200

        # 7. Verify gone
        status_resp = client.get(f"/jobs/{job_id}/status", headers=headers)
        assert status_resp.status_code == 404


def test_score_sync_flow(client, db_conn, tmp_data_dir):
    """Sync scores twice with a completed job, verify increase detection and metrics."""
    headers = {"Authorization": "Bearer test-token"}

    with _mock_auth():
        # First sync: baseline
        client.post("/scores/sync", headers=headers,
            json={"scores": [{"course_id": "1001", "assignment_id": "2001",
                              "score": 85.0, "max_score": 100.0}]})

        # Create a completed job so the increase is attributed to Poko
        user = db.get_user_by_email("integration@gmail.com")
        job = db.create_job(
            user_id=user["id"], pdf_hash="intghash", course_id="1001",
            assignment_id="2001", assignment_name="HW1", course_name="MATH 101",
        )
        db.update_job_status(job["id"], "complete")

        # Second sync: score increased
        sync_resp = client.post("/scores/sync", headers=headers,
            json={"scores": [{"course_id": "1001", "assignment_id": "2001",
                              "score": 89.0, "max_score": 100.0}]})
        assert sync_resp.json()["changes_detected"] == 1
        assert sync_resp.json()["total_points_delta"] == 4.0

        # Verify stats
        stats_resp = client.get("/users/me/stats", headers=headers)
        assert stats_resp.json()["points_recovered"] == 4.0

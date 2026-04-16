"""Tests for production-readiness features: backup, admin endpoints, graceful shutdown."""
from __future__ import annotations

import time
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from poko_server import config, db
from poko_server.db import backup_db, get_all_users_with_stats


# ── Fixtures ───────────────────────────────────────────────────────────

@pytest.fixture()
def client(db_conn):
    from poko_server.api import app
    return TestClient(app)


# ── backup_db ──────────────────────────────────────────────────────────

def test_backup_returns_none_when_no_db(tmp_data_dir):
    """backup_db returns None when the DB file doesn't exist yet."""
    result = backup_db()
    assert result is None


def test_backup_creates_file(db_conn, tmp_data_dir):
    """backup_db creates a timestamped file in data/backups/."""
    db.create_user("backup-test@gmail.com")
    result = backup_db()
    assert result is not None
    assert result.exists()
    assert result.name.startswith("poko_")
    assert result.suffix == ".db"


def test_backup_prunes_old_files(db_conn, tmp_data_dir):
    """backup_db keeps only the last N backups."""
    db.create_user("prune-test@gmail.com")
    # Create 7 backups; keep=5 should prune 2
    for _ in range(7):
        backup_db(keep=5)

    backup_dir = config.DATA_DIR / "backups"
    kept = sorted(backup_dir.glob("poko_*.db"))
    assert len(kept) == 5


# ── get_all_users_with_stats ───────────────────────────────────────────

def test_get_all_users_empty(db_conn):
    rows = get_all_users_with_stats()
    assert rows == []


def test_get_all_users_with_stats_values(db_conn):
    user = db.create_user("stats-user@gmail.com")
    db.update_user_metrics(user["id"], assignments_analyzed_delta=3, points_recovered_delta=7.5)
    rows = get_all_users_with_stats()
    assert len(rows) == 1
    row = rows[0]
    assert row["email"] == "stats-user@gmail.com"
    assert row["assignments_analyzed"] == 3
    assert row["points_recovered"] == 7.5
    assert "created_at" in row


# ── /admin/users endpoint ─────────────────────────────────────────────

def test_admin_users_no_secret_configured(client):
    """When ADMIN_SECRET is empty, endpoint is always forbidden."""
    with patch.object(config, "ADMIN_SECRET", ""):
        resp = client.get("/admin/users?secret=anything")
    assert resp.status_code == 403


def test_admin_users_wrong_secret(client):
    with patch.object(config, "ADMIN_SECRET", "correct-secret"):
        resp = client.get("/admin/users?secret=wrong-secret")
    assert resp.status_code == 403


def test_admin_users_correct_secret(client, db_conn):
    db.create_user("admin-test@gmail.com")
    with patch.object(config, "ADMIN_SECRET", "correct-secret"):
        resp = client.get("/admin/users?secret=correct-secret")
    assert resp.status_code == 200
    data = resp.json()
    assert "users" in data
    emails = [u["email"] for u in data["users"]]
    assert "admin-test@gmail.com" in emails
    # Verify response shape
    user_row = next(u for u in data["users"] if u["email"] == "admin-test@gmail.com")
    assert "created_at" in user_row
    assert "assignments_analyzed" in user_row
    assert "points_recovered" in user_row


# ── Worker graceful shutdown ──────────────────────────────────────────

def test_stop_worker_sets_event():
    """stop_worker sets the internal stop event so the worker exits."""
    from poko_server.jobs import _stop_event, start_worker, stop_worker
    _stop_event.clear()
    t = start_worker(poll_interval=60.0)
    assert t.is_alive()
    stop_worker()
    assert _stop_event.is_set()
    # Thread is daemon so it won't block process exit; just verify event is set


# ── Stale job skip (missing upload dir) ───────────────────────────────

def test_worker_skips_jobs_without_upload_dir(db_conn, tmp_data_dir):
    """process_pending_jobs skips uploaded jobs whose directory doesn't exist."""
    from poko_server.jobs import process_pending_jobs
    user = db.create_user("stale-job@gmail.com")
    # Create job row but do NOT create the upload directory
    db.create_job(
        user_id=user["id"], pdf_hash="stale123", course_id="1001",
        assignment_id="9999", assignment_name="Stale", course_name="MATH 999",
    )
    counts = process_pending_jobs()
    # Job should have been skipped, not processed
    assert counts["processed"] == 0

"""Tests for the database layer."""
from __future__ import annotations

from poko_server.db import (
    create_tables,
    create_user,
    get_user_by_email,
    create_job,
    get_job,
    update_job_status,
    list_jobs_by_status,
    upsert_score_snapshot,
    get_previous_score,
    update_user_metrics,
    get_user_metrics,
)


def test_create_and_get_user(db_conn):
    user = create_user("alice@gmail.com")
    assert user["email"] == "alice@gmail.com"
    assert user["id"] is not None
    fetched = get_user_by_email("alice@gmail.com")
    assert fetched["id"] == user["id"]


def test_get_nonexistent_user(db_conn):
    assert get_user_by_email("nobody@gmail.com") is None


def test_create_and_get_job(db_conn):
    user = create_user("bob@gmail.com")
    job = create_job(
        user_id=user["id"], pdf_hash="abc123", course_id="1001",
        assignment_id="2001", assignment_name="HW1", course_name="MATH 101",
    )
    assert job["status"] == "uploaded"
    assert job["pdf_hash"] == "abc123"
    fetched = get_job(job["id"])
    assert fetched["user_id"] == user["id"]


def test_duplicate_pdf_hash_returns_existing_job(db_conn):
    user = create_user("carol@gmail.com")
    job1 = create_job(user_id=user["id"], pdf_hash="samehash", course_id="1001",
                      assignment_id="2001", assignment_name="HW1", course_name="MATH 101")
    job2 = create_job(user_id=user["id"], pdf_hash="samehash", course_id="1001",
                      assignment_id="2001", assignment_name="HW1", course_name="MATH 101")
    assert job1["id"] == job2["id"]


def test_update_job_status(db_conn):
    user = create_user("dave@gmail.com")
    job = create_job(user_id=user["id"], pdf_hash="xyz", course_id="1001",
                     assignment_id="2001", assignment_name="HW1", course_name="MATH 101")
    update_job_status(job["id"], "analyzing")
    fetched = get_job(job["id"])
    assert fetched["status"] == "analyzing"


def test_list_jobs_by_status(db_conn):
    user = create_user("eve@gmail.com")
    create_job(user_id=user["id"], pdf_hash="a", course_id="1", assignment_id="1",
               assignment_name="HW1", course_name="C1")
    job2 = create_job(user_id=user["id"], pdf_hash="b", course_id="1", assignment_id="2",
                      assignment_name="HW2", course_name="C1")
    update_job_status(job2["id"], "analyzing")
    uploaded = list_jobs_by_status("uploaded")
    assert len(uploaded) == 1
    analyzing = list_jobs_by_status("analyzing")
    assert len(analyzing) == 1


def test_score_snapshot_upsert(db_conn):
    user = create_user("frank@gmail.com")
    assert get_previous_score(user["id"], "1001", "2001") is None
    upsert_score_snapshot(user["id"], "1001", "2001", 85.0, 100.0)
    prev = get_previous_score(user["id"], "1001", "2001")
    assert prev["score"] == 85.0
    upsert_score_snapshot(user["id"], "1001", "2001", 90.0, 100.0)
    prev = get_previous_score(user["id"], "1001", "2001")
    assert prev["score"] == 90.0


def test_user_metrics(db_conn):
    user = create_user("grace@gmail.com")
    metrics = get_user_metrics(user["id"])
    assert metrics["points_recovered"] == 0.0
    assert metrics["pages_reviewed"] == 0
    assert metrics["assignments_analyzed"] == 0
    update_user_metrics(user["id"], points_recovered_delta=5.0,
                        pages_reviewed_delta=10, assignments_analyzed_delta=1)
    metrics = get_user_metrics(user["id"])
    assert metrics["points_recovered"] == 5.0
    assert metrics["pages_reviewed"] == 10
    assert metrics["assignments_analyzed"] == 1

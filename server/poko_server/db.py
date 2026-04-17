"""SQLite database layer for the Poko server."""
from __future__ import annotations

import shutil
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from poko_server import config

_local = threading.local()


def get_connection() -> sqlite3.Connection:
    """Return a per-thread SQLite connection to the configured DB path."""
    if not hasattr(_local, "connection") or _local.connection is None:
        config.DATA_DIR.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(config.DB_PATH), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        _local.connection = conn
    return _local.connection


def close_connection() -> None:
    """Close and reset the per-thread connection."""
    if hasattr(_local, "connection") and _local.connection is not None:
        _local.connection.close()
        _local.connection = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# Keep backward-compatible alias
_now = _now_iso


def create_tables() -> None:
    """Create all required tables if they don't exist."""
    conn = get_connection()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id                 TEXT PRIMARY KEY,
            email              TEXT UNIQUE NOT NULL,
            created_at         TEXT NOT NULL,
            notification_prefs TEXT DEFAULT 'on'
        );

        CREATE TABLE IF NOT EXISTS courses (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     TEXT NOT NULL REFERENCES users(id),
            course_id   TEXT NOT NULL,
            course_name TEXT NOT NULL,
            enabled     INTEGER DEFAULT 1,
            policy_ack_at TEXT,
            UNIQUE(user_id, course_id)
        );

        CREATE TABLE IF NOT EXISTS jobs (
            id              TEXT PRIMARY KEY,
            user_id         TEXT NOT NULL REFERENCES users(id),
            pdf_hash        TEXT NOT NULL,
            course_id       TEXT NOT NULL,
            assignment_id   TEXT NOT NULL,
            assignment_name TEXT NOT NULL,
            course_name     TEXT NOT NULL,
            status          TEXT NOT NULL DEFAULT 'uploaded',
            result_json     TEXT,
            draft_md        TEXT,
            created_at      TEXT NOT NULL,
            completed_at    TEXT,
            UNIQUE(user_id, pdf_hash)
        );

        CREATE TABLE IF NOT EXISTS score_snapshots (
            id            TEXT PRIMARY KEY,
            user_id       TEXT NOT NULL REFERENCES users(id),
            course_id     TEXT NOT NULL,
            assignment_id TEXT NOT NULL,
            score         REAL NOT NULL,
            max_score     REAL NOT NULL,
            recorded_at   TEXT NOT NULL,
            UNIQUE(user_id, course_id, assignment_id)
        );

        CREATE TABLE IF NOT EXISTS metrics (
            user_id              TEXT PRIMARY KEY REFERENCES users(id),
            points_recovered     REAL NOT NULL DEFAULT 0.0,
            pages_reviewed       INTEGER NOT NULL DEFAULT 0,
            assignments_analyzed INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS server_analytics (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type  TEXT NOT NULL,
            user_id     TEXT,
            detail      TEXT,
            created_at  TEXT NOT NULL
        );
    """)
    conn.commit()


# ── Backup ────────────────────────────────────────────────────────────────────

def backup_db(keep: int = 5) -> Optional[Path]:
    """Copy the SQLite DB to data/backups/poko_YYYYMMDD_HHMMSS.db.

    Returns the path of the new backup, or None if the DB does not exist yet.
    Keeps only the most recent *keep* backups (deletes older ones).
    """
    db_path = config.DB_PATH
    if not db_path.exists():
        return None

    backup_dir = config.DATA_DIR / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
    dest = backup_dir / f"poko_{stamp}.db"
    shutil.copy2(str(db_path), str(dest))

    # Prune old backups, keeping the *keep* most recent
    existing = sorted(backup_dir.glob("poko_*.db"))
    for old in existing[:-keep]:
        old.unlink(missing_ok=True)

    return dest


# ── Users ──────────────────────────────────────────────────────────────────────

def create_user(email: str) -> dict[str, Any]:
    """Insert a user (idempotent) and return the user row as a dict."""
    conn = get_connection()
    user_id = uuid.uuid4().hex
    now = _now_iso()
    conn.execute(
        "INSERT OR IGNORE INTO users (id, email, created_at) VALUES (?, ?, ?)",
        (user_id, email, now),
    )
    conn.execute(
        "INSERT OR IGNORE INTO metrics (user_id) VALUES (?)",
        (user_id,),
    )
    conn.commit()
    return get_user_by_email(email)  # type: ignore[return-value]


def get_user_by_email(email: str) -> Optional[dict]:
    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM users WHERE email = ?", (email,)
    ).fetchone()
    return dict(row) if row else None


def get_user_by_id(user_id: str) -> Optional[dict]:
    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    return dict(row) if row else None


# ── Jobs ───────────────────────────────────────────────────────────────────────

def create_job(
    *,
    user_id: str,
    pdf_hash: str,
    course_id: str,
    assignment_id: str,
    assignment_name: str,
    course_name: str,
) -> dict:
    """Create a job, deduplicating on (user_id, pdf_hash)."""
    conn = get_connection()
    existing = conn.execute(
        "SELECT * FROM jobs WHERE user_id = ? AND pdf_hash = ?",
        (user_id, pdf_hash),
    ).fetchone()
    if existing:
        return dict(existing)

    job_id = uuid.uuid4().hex
    now = _now()
    conn.execute(
        """
        INSERT INTO jobs
            (id, user_id, pdf_hash, course_id, assignment_id,
             assignment_name, course_name, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'uploaded', ?)
        """,
        (job_id, user_id, pdf_hash, course_id, assignment_id,
         assignment_name, course_name, now),
    )
    conn.commit()
    return get_job(job_id)  # type: ignore[return-value]


def get_job(job_id: str) -> Optional[dict]:
    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM jobs WHERE id = ?", (job_id,)
    ).fetchone()
    return dict(row) if row else None


def update_job_status(
    job_id: str,
    status: str,
    result_json: Optional[str] = None,
    draft_md: Optional[str] = None,
) -> None:
    conn = get_connection()
    completed_at = _now() if status in ("complete", "failed") else None
    conn.execute(
        """
        UPDATE jobs
        SET status = ?,
            result_json = COALESCE(?, result_json),
            draft_md = COALESCE(?, draft_md),
            completed_at = COALESCE(?, completed_at)
        WHERE id = ?
        """,
        (status, result_json, draft_md, completed_at, job_id),
    )
    conn.commit()


def list_jobs_for_user(user_id: str) -> list[dict]:
    """Return all jobs for a user, including results if present."""
    conn = get_connection()
    rows = conn.execute(
        """
        SELECT id, pdf_hash, course_id, assignment_id, assignment_name,
               course_name, status, result_json, draft_md,
               created_at, completed_at
        FROM jobs
        WHERE user_id = ?
        ORDER BY created_at DESC
        """,
        (user_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def list_jobs_by_status(status: str) -> list[dict]:
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM jobs WHERE status = ?", (status,)
    ).fetchall()
    return [dict(r) for r in rows]


def delete_job(job_id: str) -> None:
    conn = get_connection()
    conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
    conn.commit()


# ── Score snapshots ────────────────────────────────────────────────────────────

def upsert_score_snapshot(
    user_id: str,
    course_id: str,
    assignment_id: str,
    score: float,
    max_score: float,
) -> None:
    conn = get_connection()
    snapshot_id = uuid.uuid4().hex
    now = _now()
    conn.execute(
        """
        INSERT INTO score_snapshots
            (id, user_id, course_id, assignment_id, score, max_score, recorded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, course_id, assignment_id)
        DO UPDATE SET score = excluded.score,
                      max_score = excluded.max_score,
                      recorded_at = excluded.recorded_at
        """,
        (snapshot_id, user_id, course_id, assignment_id, score, max_score, now),
    )
    conn.commit()


def get_previous_score(
    user_id: str,
    course_id: str,
    assignment_id: str,
) -> Optional[dict]:
    conn = get_connection()
    row = conn.execute(
        """
        SELECT * FROM score_snapshots
        WHERE user_id = ? AND course_id = ? AND assignment_id = ?
        """,
        (user_id, course_id, assignment_id),
    ).fetchone()
    return dict(row) if row else None


# ── Metrics ────────────────────────────────────────────────────────────────────

def get_user_metrics(user_id: str) -> Optional[dict]:
    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM metrics WHERE user_id = ?", (user_id,)
    ).fetchone()
    return dict(row) if row else None


def update_user_metrics(
    user_id: str,
    *,
    points_recovered_delta: float = 0.0,
    pages_reviewed_delta: int = 0,
    assignments_analyzed_delta: int = 0,
) -> None:
    conn = get_connection()
    conn.execute(
        """
        UPDATE metrics
        SET points_recovered     = points_recovered + ?,
            pages_reviewed       = pages_reviewed + ?,
            assignments_analyzed = assignments_analyzed + ?
        WHERE user_id = ?
        """,
        (points_recovered_delta, pages_reviewed_delta,
         assignments_analyzed_delta, user_id),
    )
    conn.commit()


# ── Server Analytics ───────────────────────────────────────────────────

def log_event(event_type: str, user_id: str | None = None, detail: str = "") -> None:
    conn = get_connection()
    conn.execute(
        "INSERT INTO server_analytics (event_type, user_id, detail, created_at) VALUES (?, ?, ?, ?)",
        (event_type, user_id, detail, _now()),
    )
    conn.commit()


def get_all_users_with_stats() -> list[dict[str, Any]]:
    """Return all users with their aggregate metrics."""
    conn = get_connection()
    rows = conn.execute(
        """
        SELECT u.email, u.created_at,
               COALESCE(m.assignments_analyzed, 0) AS assignments_analyzed,
               COALESCE(m.points_recovered, 0.0)   AS points_recovered
        FROM users u
        LEFT JOIN metrics m ON m.user_id = u.id
        ORDER BY u.created_at
        """
    ).fetchall()
    return [dict(r) for r in rows]


def get_server_stats() -> dict[str, Any]:
    """Aggregate server-wide analytics."""
    conn = get_connection()
    total_users = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    total_jobs = conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0]
    jobs_complete = conn.execute("SELECT COUNT(*) FROM jobs WHERE status = 'complete'").fetchone()[0]
    jobs_failed = conn.execute("SELECT COUNT(*) FROM jobs WHERE status = 'failed'").fetchone()[0]
    total_points = conn.execute("SELECT COALESCE(SUM(points_recovered), 0) FROM metrics").fetchone()[0]
    total_pages = conn.execute("SELECT COALESCE(SUM(pages_reviewed), 0) FROM metrics").fetchone()[0]
    total_analyzed = conn.execute("SELECT COALESCE(SUM(assignments_analyzed), 0) FROM metrics").fetchone()[0]
    api_requests_today = conn.execute(
        "SELECT COUNT(*) FROM server_analytics WHERE event_type = 'api_request' AND created_at >= date('now')"
    ).fetchone()[0]
    api_requests_total = conn.execute(
        "SELECT COUNT(*) FROM server_analytics WHERE event_type = 'api_request'"
    ).fetchone()[0]

    return {
        "total_users": total_users,
        "total_jobs": total_jobs,
        "jobs_complete": jobs_complete,
        "jobs_failed": jobs_failed,
        "total_points_recovered": total_points,
        "total_pages_reviewed": total_pages,
        "total_assignments_analyzed": total_analyzed,
        "api_requests_today": api_requests_today,
        "api_requests_total": api_requests_total,
    }

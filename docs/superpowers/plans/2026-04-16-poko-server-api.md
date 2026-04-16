# Poko Server API + Auth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Poko server — a FastAPI service that receives graded PDFs from authenticated clients, runs the two-stage Claude analysis pipeline, returns structured results, and sends email notifications for critical findings.

**Architecture:** Standalone FastAPI server in `server/` with SQLite for persistence. Reuses the existing analyzer prompts and two-stage pipeline (sonnet prescreen → opus max). Google OAuth tokens are verified per-request. PDFs are deleted immediately after analysis.

**Tech Stack:** Python 3.13, FastAPI, SQLite (via stdlib `sqlite3`), `httpx` (for Google token verification), SMTP (via stdlib `smtplib`), pytest

**Test runner:** Due to a ROS plugin collision in this conda env, always run tests with:
```bash
cd /home/hshi/Desktop/Gradescope-Bot && PYTHONPATH=/home/hshi/Desktop/Gradescope-Bot/server python -m pytest server/tests/ -v
```

---

## File Structure

```
server/
├── poko_server/
│   ├── __init__.py
│   ├── config.py            # All server constants + env vars
│   ├── db.py                # SQLite schema, connection, CRUD helpers
│   ├── auth.py              # Google OAuth token verification
│   ├── api.py               # FastAPI app + all route handlers
│   ├── jobs.py              # Job lifecycle: create, process, poll, cleanup
│   ├── analyzer.py          # Two-stage Claude pipeline (adapted from gradescope_bot)
│   ├── notifications.py     # SMTP email sending
│   └── metrics.py           # Score tracking + user stats aggregation
├── prompts/
│   ├── regrade_check.md     # Copied from existing prompts/
│   └── regrade_prescreen.md # Copied from existing prompts/
├── tests/
│   ├── conftest.py          # Shared fixtures (tmp DB, test client, fake auth)
│   ├── test_db.py
│   ├── test_auth.py
│   ├── test_api_health.py
│   ├── test_jobs.py
│   ├── test_analyzer.py
│   ├── test_scores.py
│   ├── test_notifications.py
│   └── fixtures/
│       ├── sample.pdf                # Minimal valid PDF for upload tests
│       ├── fake_claude_ok.sh         # Shell script test double
│       ├── fake_claude_fail.sh
│       ├── fake_prescreen_yes.sh
│       └── fake_prescreen_no.sh
├── pyproject.toml
└── .env.example
```

---

### Task 1: Project Scaffold + Config

**Files:**
- Create: `server/pyproject.toml`
- Create: `server/poko_server/__init__.py`
- Create: `server/poko_server/config.py`
- Create: `server/.env.example`
- Create: `server/tests/__init__.py`
- Create: `server/tests/conftest.py`

- [ ] **Step 1: Create pyproject.toml**

```toml
[project]
name = "poko-server"
version = "0.1.0"
description = "Poko server — AI-powered grading analysis"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.110",
  "uvicorn[standard]>=0.27",
  "python-multipart>=0.0.9",
  "httpx>=0.27",
  "python-dotenv>=1.0",
]

[project.optional-dependencies]
dev = [
  "pytest>=8.0",
  "pytest-asyncio>=0.23",
]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
include = ["poko_server*"]

[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
```

- [ ] **Step 2: Create config.py**

```python
"""All server constants. No logic, no side effects at import time."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# ── Paths ──────────────────────────────────────────────────────────────
SERVER_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = SERVER_ROOT / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
DB_PATH = DATA_DIR / "poko.db"
PROMPTS_DIR = SERVER_ROOT / "prompts"
REGRADE_PROMPT = PROMPTS_DIR / "regrade_check.md"
PRESCREEN_PROMPT = PROMPTS_DIR / "regrade_prescreen.md"

# ── Auth ───────────────────────────────────────────────────────────────
GOOGLE_TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo"

# ── Analyzer ───────────────────────────────────────────────────────────
CLAUDE_BINARY = os.environ.get("CLAUDE_BINARY", "claude")
CLAUDE_MODEL = "opus"
CLAUDE_EFFORT = "max"
CLAUDE_MAX_TURNS = 20
CLAUDE_MAX_BUDGET_USD = 5.00
CLAUDE_TIMEOUT_SEC = 1200

CLAUDE_PRESCREEN_BINARY = os.environ.get("CLAUDE_PRESCREEN_BINARY", CLAUDE_BINARY)
CLAUDE_PRESCREEN_MODEL = "sonnet"
CLAUDE_PRESCREEN_EFFORT = "medium"
CLAUDE_PRESCREEN_MAX_TURNS = 6
CLAUDE_PRESCREEN_MAX_BUDGET_USD = 0.50
CLAUDE_PRESCREEN_TIMEOUT_SEC = 300

# ── Notifications ──────────────────────────────────────────────────────
NOTIFICATION_EMAIL = os.environ.get("NOTIFICATION_EMAIL", "")
NOTIFICATION_EMAIL_PASSWORD = os.environ.get("NOTIFICATION_EMAIL_PASSWORD", "")
SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))

# ── Rate limits ────────────────────────────────────────────────────────
MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024  # 50 MB
JOBS_PER_USER_PER_DAY = 50
REQUESTS_PER_USER_PER_HOUR = 100
JOB_RESULT_RETENTION_DAYS = 7

# ── Server ─────────────────────────────────────────────────────────────
SERVER_HOST = os.environ.get("SERVER_HOST", "0.0.0.0")
SERVER_PORT = int(os.environ.get("SERVER_PORT", "8080"))
```

- [ ] **Step 3: Create .env.example**

```
NOTIFICATION_EMAIL=you@gmail.com
NOTIFICATION_EMAIL_PASSWORD=app-password-here
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
CLAUDE_BINARY=claude
SERVER_HOST=0.0.0.0
SERVER_PORT=8080
```

- [ ] **Step 4: Create __init__.py files**

`server/poko_server/__init__.py` — empty file.

`server/tests/__init__.py` — empty file.

- [ ] **Step 5: Create tests/conftest.py**

```python
"""Shared test fixtures for the Poko server."""
from __future__ import annotations

import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

from poko_server import config


@pytest.fixture()
def tmp_data_dir(tmp_path: Path):
    """Redirect all config paths to a temp directory."""
    data = tmp_path / "data"
    data.mkdir()
    uploads = data / "uploads"
    uploads.mkdir()
    db_path = data / "poko.db"

    with patch.object(config, "DATA_DIR", data), \
         patch.object(config, "UPLOAD_DIR", uploads), \
         patch.object(config, "DB_PATH", db_path):
        yield tmp_path


@pytest.fixture()
def db_conn(tmp_data_dir: Path):
    """Create an in-memory DB with the schema applied."""
    from poko_server.db import create_tables, get_connection
    create_tables()
    conn = get_connection()
    yield conn
    conn.close()
```

- [ ] **Step 6: Commit**

```bash
git add server/
git commit -m "feat(server): scaffold project with config and test fixtures"
```

---

### Task 2: Database Schema + CRUD

**Files:**
- Create: `server/poko_server/db.py`
- Create: `server/tests/test_db.py`

- [ ] **Step 1: Write failing tests**

```python
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
        user_id=user["id"],
        pdf_hash="abc123",
        course_id="1001",
        assignment_id="2001",
        assignment_name="HW1",
        course_name="MATH 101",
    )
    assert job["status"] == "uploaded"
    assert job["pdf_hash"] == "abc123"

    fetched = get_job(job["id"])
    assert fetched["user_id"] == user["id"]


def test_duplicate_pdf_hash_returns_existing_job(db_conn):
    user = create_user("carol@gmail.com")
    job1 = create_job(
        user_id=user["id"],
        pdf_hash="samehash",
        course_id="1001",
        assignment_id="2001",
        assignment_name="HW1",
        course_name="MATH 101",
    )
    job2 = create_job(
        user_id=user["id"],
        pdf_hash="samehash",
        course_id="1001",
        assignment_id="2001",
        assignment_name="HW1",
        course_name="MATH 101",
    )
    assert job1["id"] == job2["id"]


def test_update_job_status(db_conn):
    user = create_user("dave@gmail.com")
    job = create_job(
        user_id=user["id"],
        pdf_hash="xyz",
        course_id="1001",
        assignment_id="2001",
        assignment_name="HW1",
        course_name="MATH 101",
    )
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/hshi/Desktop/Gradescope-Bot && PYTHONPATH=/home/hshi/Desktop/Gradescope-Bot/server python -m pytest server/tests/test_db.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'poko_server.db'`

- [ ] **Step 3: Implement db.py**

```python
"""SQLite database layer: schema, connection, CRUD helpers."""
from __future__ import annotations

import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from poko_server import config

_connection: sqlite3.Connection | None = None


def get_connection() -> sqlite3.Connection:
    global _connection
    if _connection is None:
        config.DATA_DIR.mkdir(parents=True, exist_ok=True)
        _connection = sqlite3.connect(str(config.DB_PATH), check_same_thread=False)
        _connection.row_factory = sqlite3.Row
        _connection.execute("PRAGMA journal_mode=WAL")
        _connection.execute("PRAGMA foreign_keys=ON")
    return _connection


def close_connection() -> None:
    global _connection
    if _connection is not None:
        _connection.close()
        _connection = None


def create_tables() -> None:
    conn = get_connection()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            notification_prefs TEXT DEFAULT 'on',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS courses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL REFERENCES users(id),
            course_id TEXT NOT NULL,
            course_name TEXT NOT NULL,
            enabled INTEGER DEFAULT 1,
            policy_ack_at TEXT,
            UNIQUE(user_id, course_id)
        );

        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL REFERENCES users(id),
            pdf_hash TEXT NOT NULL,
            course_id TEXT NOT NULL,
            assignment_id TEXT NOT NULL,
            assignment_name TEXT NOT NULL DEFAULT '',
            course_name TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'uploaded',
            result_json TEXT,
            draft_md TEXT,
            created_at TEXT NOT NULL,
            completed_at TEXT,
            UNIQUE(user_id, pdf_hash)
        );

        CREATE TABLE IF NOT EXISTS score_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL REFERENCES users(id),
            course_id TEXT NOT NULL,
            assignment_id TEXT NOT NULL,
            score REAL NOT NULL,
            max_score REAL NOT NULL,
            recorded_at TEXT NOT NULL,
            UNIQUE(user_id, course_id, assignment_id)
        );

        CREATE TABLE IF NOT EXISTS metrics (
            user_id TEXT PRIMARY KEY REFERENCES users(id),
            points_recovered REAL DEFAULT 0.0,
            pages_reviewed INTEGER DEFAULT 0,
            assignments_analyzed INTEGER DEFAULT 0
        );
    """)
    conn.commit()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return dict(row)


# ── Users ──────────────────────────────────────────────────────────────

def create_user(email: str) -> dict[str, Any]:
    conn = get_connection()
    existing = get_user_by_email(email)
    if existing is not None:
        return existing
    user_id = uuid.uuid4().hex
    now = _now_iso()
    conn.execute(
        "INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)",
        (user_id, email, now),
    )
    conn.execute(
        "INSERT INTO metrics (user_id) VALUES (?)",
        (user_id,),
    )
    conn.commit()
    return {"id": user_id, "email": email, "created_at": now}


def get_user_by_email(email: str) -> dict[str, Any] | None:
    conn = get_connection()
    row = conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    return _row_to_dict(row)


# ── Jobs ───────────────────────────────────────────────────────────────

def create_job(
    user_id: str,
    pdf_hash: str,
    course_id: str,
    assignment_id: str,
    assignment_name: str,
    course_name: str,
) -> dict[str, Any]:
    conn = get_connection()
    existing = conn.execute(
        "SELECT * FROM jobs WHERE user_id = ? AND pdf_hash = ?",
        (user_id, pdf_hash),
    ).fetchone()
    if existing is not None:
        return dict(existing)

    job_id = uuid.uuid4().hex
    now = _now_iso()
    conn.execute(
        """INSERT INTO jobs (id, user_id, pdf_hash, course_id, assignment_id,
           assignment_name, course_name, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'uploaded', ?)""",
        (job_id, user_id, pdf_hash, course_id, assignment_id,
         assignment_name, course_name, now),
    )
    conn.commit()
    return {
        "id": job_id, "user_id": user_id, "pdf_hash": pdf_hash,
        "course_id": course_id, "assignment_id": assignment_id,
        "assignment_name": assignment_name, "course_name": course_name,
        "status": "uploaded", "result_json": None, "draft_md": None,
        "created_at": now, "completed_at": None,
    }


def get_job(job_id: str) -> dict[str, Any] | None:
    conn = get_connection()
    row = conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
    return _row_to_dict(row)


def update_job_status(
    job_id: str,
    status: str,
    result_json: str | None = None,
    draft_md: str | None = None,
) -> None:
    conn = get_connection()
    completed_at = _now_iso() if status in ("complete", "failed") else None
    conn.execute(
        """UPDATE jobs SET status = ?, result_json = COALESCE(?, result_json),
           draft_md = COALESCE(?, draft_md), completed_at = COALESCE(?, completed_at)
           WHERE id = ?""",
        (status, result_json, draft_md, completed_at, job_id),
    )
    conn.commit()


def list_jobs_by_status(status: str) -> list[dict[str, Any]]:
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM jobs WHERE status = ? ORDER BY created_at", (status,)
    ).fetchall()
    return [dict(r) for r in rows]


def delete_job(job_id: str) -> bool:
    conn = get_connection()
    cursor = conn.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
    conn.commit()
    return cursor.rowcount > 0


# ── Score Snapshots ────────────────────────────────────────────────────

def get_previous_score(
    user_id: str, course_id: str, assignment_id: str
) -> dict[str, Any] | None:
    conn = get_connection()
    row = conn.execute(
        """SELECT * FROM score_snapshots
           WHERE user_id = ? AND course_id = ? AND assignment_id = ?""",
        (user_id, course_id, assignment_id),
    ).fetchone()
    return _row_to_dict(row)


def upsert_score_snapshot(
    user_id: str, course_id: str, assignment_id: str,
    score: float, max_score: float,
) -> None:
    conn = get_connection()
    now = _now_iso()
    conn.execute(
        """INSERT INTO score_snapshots (user_id, course_id, assignment_id, score, max_score, recorded_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, course_id, assignment_id)
           DO UPDATE SET score = excluded.score, max_score = excluded.max_score,
                         recorded_at = excluded.recorded_at""",
        (user_id, course_id, assignment_id, score, max_score, now),
    )
    conn.commit()


# ── Metrics ────────────────────────────────────────────────────────────

def get_user_metrics(user_id: str) -> dict[str, Any]:
    conn = get_connection()
    row = conn.execute("SELECT * FROM metrics WHERE user_id = ?", (user_id,)).fetchone()
    if row is None:
        return {"points_recovered": 0.0, "pages_reviewed": 0, "assignments_analyzed": 0}
    return dict(row)


def update_user_metrics(
    user_id: str,
    points_recovered_delta: float = 0.0,
    pages_reviewed_delta: int = 0,
    assignments_analyzed_delta: int = 0,
) -> None:
    conn = get_connection()
    conn.execute(
        """UPDATE metrics SET
           points_recovered = points_recovered + ?,
           pages_reviewed = pages_reviewed + ?,
           assignments_analyzed = assignments_analyzed + ?
           WHERE user_id = ?""",
        (points_recovered_delta, pages_reviewed_delta, assignments_analyzed_delta, user_id),
    )
    conn.commit()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/hshi/Desktop/Gradescope-Bot && PYTHONPATH=/home/hshi/Desktop/Gradescope-Bot/server python -m pytest server/tests/test_db.py -v`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/poko_server/db.py server/tests/test_db.py
git commit -m "feat(server): add SQLite database layer with users, jobs, scores, metrics"
```

---

### Task 3: Google OAuth Token Verification

**Files:**
- Create: `server/poko_server/auth.py`
- Create: `server/tests/test_auth.py`

- [ ] **Step 1: Write failing tests**

```python
"""Tests for Google OAuth token verification."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch, MagicMock

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/hshi/Desktop/Gradescope-Bot && PYTHONPATH=/home/hshi/Desktop/Gradescope-Bot/server python -m pytest server/tests/test_auth.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'poko_server.auth'`

- [ ] **Step 3: Implement auth.py**

```python
"""Google OAuth token verification."""
from __future__ import annotations

import logging

import httpx
from fastapi import Header, HTTPException

from poko_server import config, db

log = logging.getLogger(__name__)


def verify_google_token(access_token: str) -> str | None:
    """Verify a Google OAuth access token. Returns the email or None."""
    try:
        resp = httpx.get(
            config.GOOGLE_TOKENINFO_URL,
            params={"access_token": access_token},
            timeout=10.0,
        )
    except Exception:
        log.warning("Google token verification failed: network error")
        return None

    if resp.status_code != 200:
        return None

    data = resp.json()
    if data.get("email_verified") != "true":
        return None

    return data.get("email")


def get_current_user_email(authorization: str = Header(...)) -> str:
    """FastAPI dependency: extract and verify the Bearer token.

    Returns the user's email. Creates a user record if first login.
    Raises 401 on invalid token.
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    token = authorization[len("Bearer "):]
    email = verify_google_token(token)
    if email is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user = db.get_user_by_email(email)
    if user is None:
        db.create_user(email)

    return email
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/hshi/Desktop/Gradescope-Bot && PYTHONPATH=/home/hshi/Desktop/Gradescope-Bot/server python -m pytest server/tests/test_auth.py -v`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/poko_server/auth.py server/tests/test_auth.py
git commit -m "feat(server): add Google OAuth token verification"
```

---

### Task 4: FastAPI App + Health Endpoint

**Files:**
- Create: `server/poko_server/api.py`
- Create: `server/tests/test_api_health.py`

- [ ] **Step 1: Write failing tests**

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/hshi/Desktop/Gradescope-Bot && PYTHONPATH=/home/hshi/Desktop/Gradescope-Bot/server python -m pytest server/tests/test_api_health.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'poko_server.api'`

- [ ] **Step 3: Implement api.py (skeleton with health + auth verify)**

```python
"""FastAPI application and route handlers."""
from __future__ import annotations

import time
import logging

from fastapi import Depends, FastAPI

from poko_server import db
from poko_server.auth import get_current_user_email

log = logging.getLogger(__name__)

app = FastAPI(title="Poko Server", version="0.1.0")
_start_time = time.monotonic()


@app.on_event("startup")
def startup():
    db.create_tables()


@app.on_event("shutdown")
def shutdown():
    db.close_connection()


@app.get("/health")
def health():
    return {
        "status": "ok",
        "uptime_seconds": round(time.monotonic() - _start_time, 1),
    }


@app.post("/auth/verify")
def auth_verify(email: str = Depends(get_current_user_email)):
    user = db.get_user_by_email(email)
    return {"email": email, "user_id": user["id"]}


@app.get("/users/me/stats")
def user_stats(email: str = Depends(get_current_user_email)):
    user = db.get_user_by_email(email)
    metrics = db.get_user_metrics(user["id"])
    return {
        "email": email,
        "points_recovered": metrics["points_recovered"],
        "pages_reviewed": metrics["pages_reviewed"],
        "assignments_analyzed": metrics["assignments_analyzed"],
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/hshi/Desktop/Gradescope-Bot && PYTHONPATH=/home/hshi/Desktop/Gradescope-Bot/server python -m pytest server/tests/test_api_health.py -v`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/poko_server/api.py server/tests/test_api_health.py
git commit -m "feat(server): add FastAPI app with health and auth verify endpoints"
```

---

### Task 5: Job Upload Endpoint

**Files:**
- Modify: `server/poko_server/api.py`
- Create: `server/tests/test_jobs.py`
- Create: `server/tests/fixtures/sample.pdf`

- [ ] **Step 1: Create a minimal valid PDF fixture**

```python
# Run this once to create the fixture:
# python -c "
# from pathlib import Path
# pdf = b'%PDF-1.0\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF'
# Path('server/tests/fixtures').mkdir(parents=True, exist_ok=True)
# Path('server/tests/fixtures/sample.pdf').write_bytes(pdf)
# "
```

Run that Python snippet to generate `server/tests/fixtures/sample.pdf`.

- [ ] **Step 2: Write failing tests**

```python
"""Tests for job upload, poll, result, and delete endpoints."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient


FIXTURES = Path(__file__).parent / "fixtures"


def _mock_auth():
    """Patch Google token verification to return a test email."""
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "email": "test@gmail.com",
        "email_verified": "true",
    }
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
        resp = client.post(
            "/jobs",
            headers=auth_headers,
            files={"file": ("hw1.pdf", pdf_bytes, "application/pdf")},
            data={
                "course_id": "1001",
                "assignment_id": "2001",
                "assignment_name": "HW1",
                "course_name": "MATH 101",
            },
        )
    assert resp.status_code == 201
    data = resp.json()
    assert data["status"] == "uploaded"
    assert "job_id" in data


def test_upload_non_pdf_rejected(client, auth_headers, tmp_data_dir):
    with _mock_auth():
        resp = client.post(
            "/jobs",
            headers=auth_headers,
            files={"file": ("hw1.txt", b"not a pdf", "text/plain")},
            data={
                "course_id": "1001",
                "assignment_id": "2001",
                "assignment_name": "HW1",
                "course_name": "MATH 101",
            },
        )
    assert resp.status_code == 400


def test_upload_duplicate_returns_existing(client, auth_headers, tmp_data_dir):
    pdf_bytes = (FIXTURES / "sample.pdf").read_bytes()
    with _mock_auth():
        resp1 = client.post(
            "/jobs",
            headers=auth_headers,
            files={"file": ("hw1.pdf", pdf_bytes, "application/pdf")},
            data={"course_id": "1001", "assignment_id": "2001",
                  "assignment_name": "HW1", "course_name": "MATH 101"},
        )
        resp2 = client.post(
            "/jobs",
            headers=auth_headers,
            files={"file": ("hw1.pdf", pdf_bytes, "application/pdf")},
            data={"course_id": "1001", "assignment_id": "2001",
                  "assignment_name": "HW1", "course_name": "MATH 101"},
        )
    assert resp1.json()["job_id"] == resp2.json()["job_id"]


def test_job_status(client, auth_headers, tmp_data_dir):
    pdf_bytes = (FIXTURES / "sample.pdf").read_bytes()
    with _mock_auth():
        upload_resp = client.post(
            "/jobs",
            headers=auth_headers,
            files={"file": ("hw1.pdf", pdf_bytes, "application/pdf")},
            data={"course_id": "1001", "assignment_id": "2001",
                  "assignment_name": "HW1", "course_name": "MATH 101"},
        )
        job_id = upload_resp.json()["job_id"]

        status_resp = client.get(
            f"/jobs/{job_id}/status",
            headers=auth_headers,
        )
    assert status_resp.status_code == 200
    assert status_resp.json()["status"] == "uploaded"


def test_delete_job(client, auth_headers, tmp_data_dir):
    pdf_bytes = (FIXTURES / "sample.pdf").read_bytes()
    with _mock_auth():
        upload_resp = client.post(
            "/jobs",
            headers=auth_headers,
            files={"file": ("hw1.pdf", pdf_bytes, "application/pdf")},
            data={"course_id": "1001", "assignment_id": "2001",
                  "assignment_name": "HW1", "course_name": "MATH 101"},
        )
        job_id = upload_resp.json()["job_id"]

        del_resp = client.delete(f"/jobs/{job_id}", headers=auth_headers)
    assert del_resp.status_code == 200


def test_job_not_found(client, auth_headers, tmp_data_dir):
    with _mock_auth():
        resp = client.get("/jobs/nonexistent/status", headers=auth_headers)
    assert resp.status_code == 404
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /home/hshi/Desktop/Gradescope-Bot && PYTHONPATH=/home/hshi/Desktop/Gradescope-Bot/server python -m pytest server/tests/test_jobs.py -v`
Expected: FAIL — endpoints not yet defined

- [ ] **Step 4: Add job endpoints to api.py**

Add the following to `server/poko_server/api.py`:

```python
import hashlib
from fastapi import File, Form, HTTPException, UploadFile

from poko_server import config


@app.post("/jobs", status_code=201)
def upload_job(
    file: UploadFile = File(...),
    course_id: str = Form(...),
    assignment_id: str = Form(...),
    assignment_name: str = Form(""),
    course_name: str = Form(""),
    email: str = Depends(get_current_user_email),
):
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF uploads accepted")

    content = file.file.read()
    if len(content) > config.MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 50 MB)")

    pdf_hash = hashlib.sha256(content).hexdigest()
    user = db.get_user_by_email(email)

    job = db.create_job(
        user_id=user["id"],
        pdf_hash=pdf_hash,
        course_id=course_id,
        assignment_id=assignment_id,
        assignment_name=assignment_name,
        course_name=course_name,
    )

    if job["status"] == "uploaded" and job["completed_at"] is None:
        job_dir = config.UPLOAD_DIR / job["id"]
        job_dir.mkdir(parents=True, exist_ok=True)
        (job_dir / "submission.pdf").write_bytes(content)

    return {"job_id": job["id"], "status": job["status"]}


@app.get("/jobs/{job_id}/status")
def job_status(job_id: str, email: str = Depends(get_current_user_email)):
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    user = db.get_user_by_email(email)
    if job["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job_id": job_id, "status": job["status"]}


@app.get("/jobs/{job_id}/result")
def job_result(job_id: str, email: str = Depends(get_current_user_email)):
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    user = db.get_user_by_email(email)
    if job["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] not in ("complete", "failed"):
        raise HTTPException(status_code=409, detail=f"Job is still {job['status']}")
    return {
        "job_id": job_id,
        "status": job["status"],
        "result_json": job["result_json"],
        "draft_md": job["draft_md"],
    }


@app.delete("/jobs/{job_id}")
def delete_job(job_id: str, email: str = Depends(get_current_user_email)):
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    user = db.get_user_by_email(email)
    if job["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Job not found")

    job_dir = config.UPLOAD_DIR / job_id
    if job_dir.exists():
        import shutil
        shutil.rmtree(job_dir)
    db.delete_job(job_id)
    return {"deleted": True}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/hshi/Desktop/Gradescope-Bot && PYTHONPATH=/home/hshi/Desktop/Gradescope-Bot/server python -m pytest server/tests/test_jobs.py -v`
Expected: All 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add server/poko_server/api.py server/tests/test_jobs.py server/tests/fixtures/
git commit -m "feat(server): add job upload, status, result, and delete endpoints"
```

---

### Task 6: Analyzer Adaptation

**Files:**
- Create: `server/poko_server/analyzer.py`
- Create: `server/tests/test_analyzer.py`
- Create: `server/tests/fixtures/fake_claude_ok.sh`
- Create: `server/tests/fixtures/fake_claude_fail.sh`
- Create: `server/tests/fixtures/fake_prescreen_yes.sh`
- Create: `server/tests/fixtures/fake_prescreen_no.sh`
- Copy: `prompts/regrade_check.md` → `server/prompts/regrade_check.md`
- Copy: `prompts/regrade_prescreen.md` → `server/prompts/regrade_prescreen.md`

- [ ] **Step 1: Copy prompts from existing bot**

```bash
mkdir -p server/prompts
cp prompts/regrade_check.md server/prompts/regrade_check.md
cp prompts/regrade_prescreen.md server/prompts/regrade_prescreen.md
```

- [ ] **Step 2: Create shell script test doubles**

`server/tests/fixtures/fake_claude_ok.sh`:
```bash
#!/usr/bin/env bash
# Fake Claude that writes a canned analysis.json with one kept issue.
ADD_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --add-dir) ADD_DIR="$2"; shift 2 ;;
    *) shift ;;
  esac
done

if [[ -z "$ADD_DIR" ]]; then
  echo "ERROR: --add-dir not provided" >&2
  exit 1
fi

cat > "$ADD_DIR/analysis.json" <<'ENDJSON'
{
  "item_id": "test-item",
  "model": "opus",
  "overall_verdict": "needs_review",
  "summary": "Found one issue with Q3.",
  "issues": [
    {
      "question": "Q3",
      "category": "rubric_misapplication",
      "severity": "high",
      "confidence_tier": "critical",
      "rubric_item_cited": "Clairaut's theorem",
      "points_disputed": 4,
      "reasoning": "Conditions were stated correctly.",
      "keep": true
    }
  ],
  "kept_issue_count": 1
}
ENDJSON

cat > "$ADD_DIR/regrade_draft.md" <<'ENDDRAFT'
# Regrade Requests — HW7

## Question 3 — Clairaut's theorem

**Requesting regrade for:** 4 points deducted under "Clairaut's theorem"

**Reason for request:**
The conditions for Clairaut's theorem were stated correctly.
ENDDRAFT

cat "$ADD_DIR/analysis.json"
```

`server/tests/fixtures/fake_claude_fail.sh`:
```bash
#!/usr/bin/env bash
echo "ERROR: analysis failed" >&2
exit 1
```

`server/tests/fixtures/fake_prescreen_yes.sh`:
```bash
#!/usr/bin/env bash
ADD_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --add-dir) ADD_DIR="$2"; shift 2 ;;
    *) shift ;;
  esac
done
cat > "$ADD_DIR/prescreen.json" <<'EOF'
{"has_regradable_content": true, "reason": "Contains rubric annotations"}
EOF
cat "$ADD_DIR/prescreen.json"
```

`server/tests/fixtures/fake_prescreen_no.sh`:
```bash
#!/usr/bin/env bash
ADD_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --add-dir) ADD_DIR="$2"; shift 2 ;;
    *) shift ;;
  esac
done
cat > "$ADD_DIR/prescreen.json" <<'EOF'
{"has_regradable_content": false, "reason": "Auto-graded quiz, no rubric"}
EOF
cat "$ADD_DIR/prescreen.json"
```

Make all scripts executable: `chmod +x server/tests/fixtures/fake_*.sh`

- [ ] **Step 3: Write failing tests**

```python
"""Tests for the server-side analyzer (subprocess-based, using shell script fakes)."""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from poko_server import config

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture()
def job_dir(tmp_data_dir: Path) -> Path:
    """Create a job directory with a minimal PDF."""
    d = config.UPLOAD_DIR / "test-job"
    d.mkdir(parents=True, exist_ok=True)
    pdf_bytes = (FIXTURES / "sample.pdf").read_bytes()
    (d / "submission.pdf").write_bytes(pdf_bytes)
    return d


def test_analyze_with_prescreen_yes_and_full_pass(job_dir):
    from poko_server.analyzer import analyze_job

    with patch.object(config, "CLAUDE_PRESCREEN_BINARY", str(FIXTURES / "fake_prescreen_yes.sh")), \
         patch.object(config, "CLAUDE_BINARY", str(FIXTURES / "fake_claude_ok.sh")):
        result = analyze_job("test-job", job_dir)

    assert result["status"] == "complete"
    assert result["kept_issue_count"] == 1
    assert result["draft_md"] is not None
    assert "Clairaut" in result["draft_md"]
    parsed = json.loads(result["result_json"])
    assert parsed["issues"][0]["confidence_tier"] == "critical"


def test_analyze_with_prescreen_no(job_dir):
    from poko_server.analyzer import analyze_job

    with patch.object(config, "CLAUDE_PRESCREEN_BINARY", str(FIXTURES / "fake_prescreen_no.sh")):
        result = analyze_job("test-job", job_dir)

    assert result["status"] == "complete"
    assert result["kept_issue_count"] == 0
    assert result["result_json"] is not None
    parsed = json.loads(result["result_json"])
    assert parsed["overall_verdict"] == "no_issues_found"


def test_analyze_with_failed_subprocess(job_dir):
    from poko_server.analyzer import analyze_job

    with patch.object(config, "CLAUDE_PRESCREEN_BINARY", str(FIXTURES / "fake_prescreen_yes.sh")), \
         patch.object(config, "CLAUDE_BINARY", str(FIXTURES / "fake_claude_fail.sh")):
        result = analyze_job("test-job", job_dir)

    assert result["status"] == "failed"
    assert result["error"] is not None


def test_analyze_missing_pdf(tmp_data_dir):
    from poko_server.analyzer import analyze_job

    empty_dir = config.UPLOAD_DIR / "no-pdf-job"
    empty_dir.mkdir(parents=True, exist_ok=True)
    result = analyze_job("no-pdf-job", empty_dir)
    assert result["status"] == "failed"
    assert "missing" in result["error"].lower()
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd /home/hshi/Desktop/Gradescope-Bot && PYTHONPATH=/home/hshi/Desktop/Gradescope-Bot/server python -m pytest server/tests/test_analyzer.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'poko_server.analyzer'`

- [ ] **Step 5: Implement analyzer.py**

```python
"""Server-side analyzer: two-stage Claude pipeline (sonnet prescreen + opus max)."""
from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path
from typing import Any

from poko_server import config

log = logging.getLogger(__name__)

PRESCREEN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["has_regradable_content", "reason"],
    "additionalProperties": False,
    "properties": {
        "has_regradable_content": {"type": "boolean"},
        "reason": {"type": "string"},
    },
}

VERDICT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": [
        "item_id", "model", "overall_verdict", "summary", "issues", "kept_issue_count",
    ],
    "additionalProperties": False,
    "properties": {
        "item_id": {"type": "string"},
        "model": {"type": "string"},
        "overall_verdict": {"type": "string", "enum": ["needs_review", "no_issues_found"]},
        "summary": {"type": "string"},
        "issues": {
            "type": "array",
            "items": {
                "type": "object",
                "required": [
                    "question", "category", "severity", "confidence_tier",
                    "rubric_item_cited", "points_disputed", "reasoning", "keep",
                ],
                "additionalProperties": False,
                "properties": {
                    "question": {"type": "string"},
                    "category": {
                        "type": "string",
                        "enum": [
                            "arithmetic_mismatch", "rubric_misapplication",
                            "missed_correct_work", "unclear_deduction",
                            "partial_credit_too_low",
                        ],
                    },
                    "severity": {"type": "string", "enum": ["low", "medium", "high"]},
                    "confidence_tier": {
                        "type": "string",
                        "enum": ["critical", "strong", "marginal"],
                    },
                    "rubric_item_cited": {"type": "string"},
                    "points_disputed": {"type": "number"},
                    "reasoning": {"type": "string"},
                    "keep": {"type": "boolean"},
                },
            },
        },
        "kept_issue_count": {"type": "integer", "minimum": 0},
    },
}


def _count_pdf_pages(pdf_path: Path) -> int:
    try:
        result = subprocess.run(
            ["pdfinfo", str(pdf_path)], capture_output=True, text=True, timeout=10
        )
        for line in result.stdout.splitlines():
            if line.startswith("Pages:"):
                return int(line.split()[1])
    except (FileNotFoundError, subprocess.TimeoutExpired, ValueError):
        pass
    return 10


def _render_prompt(template_path: Path, **kwargs: Any) -> str:
    template = template_path.read_text(encoding="utf-8")
    return template.format(**kwargs)


def _run_prescreen(job_dir: Path, pdf_pages: int) -> tuple[bool, str]:
    """Cheap sonnet prescreen. Returns (has_content, reason). Fails safe to True."""
    prompt = _render_prompt(
        config.PRESCREEN_PROMPT,
        pdf_path=str(job_dir / "submission.pdf"),
        pdf_pages=pdf_pages,
        output_path=str(job_dir / "prescreen.json"),
    )
    cmd = [
        config.CLAUDE_PRESCREEN_BINARY, "-p", prompt,
        "--model", config.CLAUDE_PRESCREEN_MODEL,
        "--effort", config.CLAUDE_PRESCREEN_EFFORT,
        "--output-format", "json",
        "--json-schema", json.dumps(PRESCREEN_SCHEMA),
        "--permission-mode", "acceptEdits",
        "--add-dir", str(job_dir),
        "--max-turns", str(config.CLAUDE_PRESCREEN_MAX_TURNS),
        "--max-budget-usd", str(config.CLAUDE_PRESCREEN_MAX_BUDGET_USD),
    ]

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=config.CLAUDE_PRESCREEN_TIMEOUT_SEC,
        )
    except subprocess.TimeoutExpired:
        return True, "prescreen timed out"

    if result.returncode != 0:
        return True, f"prescreen exit {result.returncode}"

    prescreen_path = job_dir / "prescreen.json"
    if not prescreen_path.exists():
        return True, "prescreen output missing"

    try:
        data = json.loads(prescreen_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return True, "prescreen invalid JSON"

    return bool(data.get("has_regradable_content", True)), str(data.get("reason", ""))


def analyze_job(job_id: str, job_dir: Path) -> dict[str, Any]:
    """Run two-stage analysis on a job. Returns a result dict with status, result_json, draft_md, error."""
    pdf_path = job_dir / "submission.pdf"
    if not pdf_path.exists():
        return {"status": "failed", "error": "submission.pdf missing",
                "result_json": None, "draft_md": None, "kept_issue_count": 0}

    pages = _count_pdf_pages(pdf_path)

    # Stage 1: prescreen
    has_content, reason = _run_prescreen(job_dir, pages)
    if not has_content:
        no_issues = {
            "item_id": job_id, "model": "prescreen",
            "overall_verdict": "no_issues_found",
            "summary": f"Prescreen skipped: {reason}",
            "issues": [], "kept_issue_count": 0,
        }
        return {
            "status": "complete", "result_json": json.dumps(no_issues),
            "draft_md": None, "kept_issue_count": 0, "error": None,
        }

    # Stage 2: full opus analysis
    prompt = _render_prompt(
        config.REGRADE_PROMPT,
        pdf_path=str(pdf_path),
        pdf_pages=pages,
        output_path=str(job_dir / "analysis.json"),
        draft_path=str(job_dir / "regrade_draft.md"),
        item_id=job_id,
    )
    cmd = [
        config.CLAUDE_BINARY, "-p", prompt,
        "--model", config.CLAUDE_MODEL,
        "--effort", config.CLAUDE_EFFORT,
        "--output-format", "json",
        "--json-schema", json.dumps(VERDICT_SCHEMA),
        "--permission-mode", "acceptEdits",
        "--add-dir", str(job_dir),
        "--max-turns", str(config.CLAUDE_MAX_TURNS),
        "--max-budget-usd", str(config.CLAUDE_MAX_BUDGET_USD),
    ]

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=config.CLAUDE_TIMEOUT_SEC,
        )
    except subprocess.TimeoutExpired:
        return {"status": "failed", "error": f"claude timed out after {config.CLAUDE_TIMEOUT_SEC}s",
                "result_json": None, "draft_md": None, "kept_issue_count": 0}

    if result.returncode != 0:
        return {"status": "failed", "error": f"claude exit {result.returncode}: {result.stderr[:500]}",
                "result_json": None, "draft_md": None, "kept_issue_count": 0}

    analysis_path = job_dir / "analysis.json"
    if not analysis_path.exists():
        return {"status": "failed", "error": "analysis.json not written",
                "result_json": None, "draft_md": None, "kept_issue_count": 0}

    try:
        verdict = json.loads(analysis_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return {"status": "failed", "error": f"invalid analysis JSON: {e}",
                "result_json": None, "draft_md": None, "kept_issue_count": 0}

    draft_path = job_dir / "regrade_draft.md"
    draft_md = draft_path.read_text(encoding="utf-8") if draft_path.exists() else None
    kept = int(verdict.get("kept_issue_count", 0))

    return {
        "status": "complete",
        "result_json": json.dumps(verdict),
        "draft_md": draft_md,
        "kept_issue_count": kept,
        "error": None,
    }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /home/hshi/Desktop/Gradescope-Bot && PYTHONPATH=/home/hshi/Desktop/Gradescope-Bot/server python -m pytest server/tests/test_analyzer.py -v`
Expected: All 4 tests PASS

- [ ] **Step 7: Commit**

```bash
git add server/poko_server/analyzer.py server/tests/test_analyzer.py server/tests/fixtures/ server/prompts/
git commit -m "feat(server): add two-stage analyzer with confidence tiers and shell script fakes"
```

---

### Task 7: Job Processing Pipeline

**Files:**
- Create: `server/poko_server/jobs.py`
- Modify: `server/poko_server/api.py`
- Modify: `server/tests/test_jobs.py` (add processing tests)

- [ ] **Step 1: Write failing tests**

Append to `server/tests/test_jobs.py`:

```python
from poko_server import db
from poko_server.jobs import process_pending_jobs


def test_process_pending_job(db_conn, tmp_data_dir):
    """End-to-end: upload → process → result available."""
    from poko_server import config

    user = db.create_user("process-test@gmail.com")
    job = db.create_job(
        user_id=user["id"], pdf_hash="proc123", course_id="1001",
        assignment_id="2001", assignment_name="HW1", course_name="MATH 101",
    )
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/hshi/Desktop/Gradescope-Bot && PYTHONPATH=/home/hshi/Desktop/Gradescope-Bot/server python -m pytest server/tests/test_jobs.py::test_process_pending_job -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'poko_server.jobs'`

- [ ] **Step 3: Implement jobs.py**

```python
"""Job lifecycle: process pending uploads, cleanup old results."""
from __future__ import annotations

import logging
import shutil
from datetime import datetime, timedelta, timezone

from poko_server import config, db
from poko_server.analyzer import analyze_job

log = logging.getLogger(__name__)


def process_pending_jobs() -> dict[str, int]:
    """Find all uploaded jobs, analyze them, update DB. Returns counters."""
    counters = {"processed": 0, "complete": 0, "failed": 0}
    pending = db.list_jobs_by_status("uploaded")

    for job in pending:
        job_id = job["id"]
        job_dir = config.UPLOAD_DIR / job_id
        log.info("Processing job %s", job_id)

        db.update_job_status(job_id, "analyzing")
        result = analyze_job(job_id, job_dir)

        db.update_job_status(
            job_id,
            status=result["status"],
            result_json=result.get("result_json"),
            draft_md=result.get("draft_md"),
        )

        # Delete PDF immediately after analysis
        pdf_path = job_dir / "submission.pdf"
        if pdf_path.exists():
            pdf_path.unlink()

        counters["processed"] += 1
        if result["status"] == "complete":
            counters["complete"] += 1
        else:
            counters["failed"] += 1

    return counters


def cleanup_old_jobs(retention_days: int = config.JOB_RESULT_RETENTION_DAYS) -> int:
    """Delete completed/failed jobs older than retention_days. Returns count deleted."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    cutoff_iso = cutoff.isoformat()
    conn = db.get_connection()
    rows = conn.execute(
        """SELECT id FROM jobs
           WHERE status IN ('complete', 'failed')
             AND completed_at IS NOT NULL
             AND completed_at < ?""",
        (cutoff_iso,),
    ).fetchall()

    deleted = 0
    for row in rows:
        job_id = row["id"]
        job_dir = config.UPLOAD_DIR / job_id
        if job_dir.exists():
            shutil.rmtree(job_dir)
        db.delete_job(job_id)
        deleted += 1

    return deleted


def recover_interrupted_jobs() -> int:
    """On server restart, re-queue any jobs stuck in 'analyzing' state."""
    stuck = db.list_jobs_by_status("analyzing")
    for job in stuck:
        log.warning("Recovering stuck job %s → uploaded", job["id"])
        db.update_job_status(job["id"], "uploaded")
    return len(stuck)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/hshi/Desktop/Gradescope-Bot && PYTHONPATH=/home/hshi/Desktop/Gradescope-Bot/server python -m pytest server/tests/test_jobs.py -v`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/poko_server/jobs.py server/tests/test_jobs.py
git commit -m "feat(server): add job processing pipeline with PDF cleanup and crash recovery"
```

---

### Task 8: Score Sync + Metrics Endpoints

**Files:**
- Create: `server/poko_server/metrics.py`
- Modify: `server/poko_server/api.py`
- Create: `server/tests/test_scores.py`

- [ ] **Step 1: Write failing tests**

```python
"""Tests for score sync and metrics endpoints."""
from __future__ import annotations

from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient

from poko_server import db


def _mock_auth(email: str = "test@gmail.com"):
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "email": email,
        "email_verified": "true",
    }
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
        resp = client.post(
            "/scores/sync",
            headers=auth_headers,
            json={
                "scores": [
                    {"course_id": "1001", "assignment_id": "2001",
                     "score": 85.0, "max_score": 100.0}
                ]
            },
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["changes_detected"] == 0


def test_score_sync_detects_increase(client, auth_headers, db_conn):
    with _mock_auth():
        # First sync: baseline
        client.post(
            "/scores/sync",
            headers=auth_headers,
            json={
                "scores": [
                    {"course_id": "1001", "assignment_id": "2001",
                     "score": 85.0, "max_score": 100.0}
                ]
            },
        )
        # Second sync: score went up
        resp = client.post(
            "/scores/sync",
            headers=auth_headers,
            json={
                "scores": [
                    {"course_id": "1001", "assignment_id": "2001",
                     "score": 90.0, "max_score": 100.0}
                ]
            },
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["changes_detected"] == 1
    assert data["total_points_delta"] == 5.0


def test_stats_reflect_score_changes(client, auth_headers, db_conn):
    with _mock_auth():
        client.post(
            "/scores/sync",
            headers=auth_headers,
            json={
                "scores": [
                    {"course_id": "1001", "assignment_id": "2001",
                     "score": 85.0, "max_score": 100.0}
                ]
            },
        )
        client.post(
            "/scores/sync",
            headers=auth_headers,
            json={
                "scores": [
                    {"course_id": "1001", "assignment_id": "2001",
                     "score": 90.0, "max_score": 100.0}
                ]
            },
        )
        resp = client.get("/users/me/stats", headers=auth_headers)

    data = resp.json()
    assert data["points_recovered"] == 5.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/hshi/Desktop/Gradescope-Bot && PYTHONPATH=/home/hshi/Desktop/Gradescope-Bot/server python -m pytest server/tests/test_scores.py -v`
Expected: FAIL — `/scores/sync` endpoint not defined

- [ ] **Step 3: Implement metrics.py**

```python
"""Score change detection and metrics aggregation."""
from __future__ import annotations

import logging
from typing import Any

from poko_server import db

log = logging.getLogger(__name__)


def process_score_sync(
    user_id: str, scores: list[dict[str, Any]]
) -> dict[str, Any]:
    """Compare incoming scores against stored snapshots, detect increases.

    Returns {changes_detected: int, total_points_delta: float, details: [...]}.
    """
    changes = []
    total_delta = 0.0

    for entry in scores:
        course_id = entry["course_id"]
        assignment_id = entry["assignment_id"]
        new_score = float(entry["score"])
        max_score = float(entry["max_score"])

        prev = db.get_previous_score(user_id, course_id, assignment_id)

        if prev is not None and new_score > prev["score"]:
            delta = new_score - prev["score"]
            total_delta += delta
            changes.append({
                "course_id": course_id,
                "assignment_id": assignment_id,
                "old_score": prev["score"],
                "new_score": new_score,
                "delta": delta,
            })
            log.info("Score increase for user %s: %s/%s +%.1f",
                     user_id, course_id, assignment_id, delta)

        db.upsert_score_snapshot(user_id, course_id, assignment_id, new_score, max_score)

    if total_delta > 0:
        db.update_user_metrics(user_id, points_recovered_delta=total_delta)

    return {
        "changes_detected": len(changes),
        "total_points_delta": total_delta,
        "details": changes,
    }
```

- [ ] **Step 4: Add score sync endpoint to api.py**

Add the following to `server/poko_server/api.py`:

```python
from pydantic import BaseModel
from poko_server.metrics import process_score_sync


class ScoreEntry(BaseModel):
    course_id: str
    assignment_id: str
    score: float
    max_score: float


class ScoreSyncRequest(BaseModel):
    scores: list[ScoreEntry]


@app.post("/scores/sync")
def score_sync(
    body: ScoreSyncRequest,
    email: str = Depends(get_current_user_email),
):
    user = db.get_user_by_email(email)
    result = process_score_sync(
        user_id=user["id"],
        scores=[s.model_dump() for s in body.scores],
    )
    return result
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/hshi/Desktop/Gradescope-Bot && PYTHONPATH=/home/hshi/Desktop/Gradescope-Bot/server python -m pytest server/tests/test_scores.py -v`
Expected: All 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add server/poko_server/metrics.py server/poko_server/api.py server/tests/test_scores.py
git commit -m "feat(server): add score sync endpoint with change detection and metrics"
```

---

### Task 9: Email Notifications

**Files:**
- Create: `server/poko_server/notifications.py`
- Create: `server/tests/test_notifications.py`

- [ ] **Step 1: Write failing tests**

```python
"""Tests for email notifications."""
from __future__ import annotations

import json
from unittest.mock import patch, MagicMock

import pytest

from poko_server.notifications import should_notify, build_email_body, send_notification


def _make_result_json(issues: list[dict]) -> str:
    return json.dumps({
        "item_id": "test",
        "model": "opus",
        "overall_verdict": "needs_review",
        "summary": "Found issues.",
        "issues": issues,
        "kept_issue_count": len([i for i in issues if i.get("keep")]),
    })


def test_should_notify_critical_issues():
    result = _make_result_json([
        {"question": "Q3", "category": "rubric_misapplication", "severity": "high",
         "confidence_tier": "critical", "rubric_item_cited": "X",
         "points_disputed": 4, "reasoning": "Wrong.", "keep": True}
    ])
    assert should_notify(result) is True


def test_should_not_notify_strong_only():
    result = _make_result_json([
        {"question": "Q3", "category": "rubric_misapplication", "severity": "medium",
         "confidence_tier": "strong", "rubric_item_cited": "X",
         "points_disputed": 2, "reasoning": "Maybe.", "keep": True}
    ])
    assert should_notify(result) is False


def test_should_not_notify_no_issues():
    result = json.dumps({
        "item_id": "test", "model": "prescreen",
        "overall_verdict": "no_issues_found", "summary": "Clean.",
        "issues": [], "kept_issue_count": 0,
    })
    assert should_notify(result) is False


def test_build_email_body():
    result = _make_result_json([
        {"question": "Q3", "category": "rubric_misapplication", "severity": "high",
         "confidence_tier": "critical", "rubric_item_cited": "Clairaut's theorem",
         "points_disputed": 4, "reasoning": "Conditions stated correctly.", "keep": True}
    ])
    body = build_email_body("alice@gmail.com", "HW7", "MATH 268", result)
    assert "Poko" in body
    assert "Q3" in body
    assert "+4" in body
    assert "MATH 268" in body


def test_send_notification_calls_smtp():
    with patch("poko_server.notifications.smtplib.SMTP") as mock_smtp_class:
        mock_smtp = MagicMock()
        mock_smtp_class.return_value.__enter__ = MagicMock(return_value=mock_smtp)
        mock_smtp_class.return_value.__exit__ = MagicMock(return_value=False)

        with patch("poko_server.notifications.config.NOTIFICATION_EMAIL", "bot@test.com"), \
             patch("poko_server.notifications.config.NOTIFICATION_EMAIL_PASSWORD", "pass123"), \
             patch("poko_server.notifications.config.SMTP_HOST", "smtp.test.com"), \
             patch("poko_server.notifications.config.SMTP_PORT", 587):
            send_notification("alice@gmail.com", "Test Subject", "Test body")

        mock_smtp.sendmail.assert_called_once()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/hshi/Desktop/Gradescope-Bot && PYTHONPATH=/home/hshi/Desktop/Gradescope-Bot/server python -m pytest server/tests/test_notifications.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'poko_server.notifications'`

- [ ] **Step 3: Implement notifications.py**

```python
"""Email notifications for critical regrade findings."""
from __future__ import annotations

import json
import logging
import smtplib
from email.message import EmailMessage

from poko_server import config

log = logging.getLogger(__name__)


def should_notify(result_json: str) -> bool:
    """Return True if the result contains at least one critical-tier kept issue."""
    try:
        data = json.loads(result_json)
    except (json.JSONDecodeError, TypeError):
        return False

    for issue in data.get("issues", []):
        if issue.get("keep") and issue.get("confidence_tier") == "critical":
            return True
    return False


def build_email_body(
    user_email: str,
    assignment_name: str,
    course_name: str,
    result_json: str,
) -> str:
    """Build the notification email body from analysis results."""
    data = json.loads(result_json)
    critical_issues = [
        i for i in data.get("issues", [])
        if i.get("keep") and i.get("confidence_tier") == "critical"
    ]

    lines = [
        f"Subject: Poko found an obvious grading error in {assignment_name}",
        "",
        f"Hi,",
        "",
        f"Poko reviewed your graded assignments and found something that looks like a clear mistake:",
        "",
    ]

    for issue in critical_issues:
        q = issue.get("question", "?")
        cat = issue.get("category", "").replace("_", " ")
        pts = issue.get("points_disputed", 0)
        reasoning = issue.get("reasoning", "")
        lines.append(f"  {q} — {cat.title()} (+{pts} pts possible)")
        lines.append(f"  {reasoning}")
        lines.append("")

    lines.append(f"Course: {course_name}")
    lines.append("")
    lines.append("Open the app to review the full draft and decide whether to submit a regrade.")
    lines.append("")
    lines.append("— Poko")

    return "\n".join(lines)


def send_notification(to_email: str, subject: str, body: str) -> bool:
    """Send an email via SMTP. Returns True on success."""
    if not config.NOTIFICATION_EMAIL or not config.NOTIFICATION_EMAIL_PASSWORD:
        log.warning("Notification email not configured; skipping send")
        return False

    msg = EmailMessage()
    msg["From"] = config.NOTIFICATION_EMAIL
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body)

    try:
        with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT) as smtp:
            smtp.starttls()
            smtp.login(config.NOTIFICATION_EMAIL, config.NOTIFICATION_EMAIL_PASSWORD)
            smtp.sendmail(config.NOTIFICATION_EMAIL, to_email, msg.as_string())
        log.info("Notification sent to %s: %s", to_email, subject)
        return True
    except Exception:
        log.exception("Failed to send notification to %s", to_email)
        return False
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/hshi/Desktop/Gradescope-Bot && PYTHONPATH=/home/hshi/Desktop/Gradescope-Bot/server python -m pytest server/tests/test_notifications.py -v`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/poko_server/notifications.py server/tests/test_notifications.py
git commit -m "feat(server): add email notifications for critical regrade findings"
```

---

### Task 10: Wire Notifications into Job Processing

**Files:**
- Modify: `server/poko_server/jobs.py`
- Modify: `server/tests/test_jobs.py`

- [ ] **Step 1: Write failing test**

Append to `server/tests/test_jobs.py`:

```python
from poko_server.jobs import process_pending_jobs


def test_process_job_sends_notification_for_critical(db_conn, tmp_data_dir):
    """When analysis finds critical issues, send_notification is called."""
    from poko_server import config

    user = db.create_user("notify-test@gmail.com")
    job = db.create_job(
        user_id=user["id"], pdf_hash="notify123", course_id="1001",
        assignment_id="2001", assignment_name="HW7", course_name="MATH 268",
    )
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/hshi/Desktop/Gradescope-Bot && PYTHONPATH=/home/hshi/Desktop/Gradescope-Bot/server python -m pytest server/tests/test_jobs.py::test_process_job_sends_notification_for_critical -v`
Expected: FAIL — `send_notification` not imported in `jobs.py`

- [ ] **Step 3: Wire notifications into jobs.py**

Update `server/poko_server/jobs.py` — add imports at the top:

```python
from poko_server.notifications import should_notify, send_notification, build_email_body
```

Then in `process_pending_jobs()`, after updating the job status for a completed job, add notification logic:

```python
        if result["status"] == "complete":
            counters["complete"] += 1
            # Send notification for critical findings
            if result.get("result_json") and should_notify(result["result_json"]):
                user = db.get_user_by_email_by_id(job["user_id"])
                if user:
                    body = build_email_body(
                        user["email"],
                        job["assignment_name"],
                        job["course_name"],
                        result["result_json"],
                    )
                    send_notification(
                        user["email"],
                        f"Poko found an obvious grading error in {job['assignment_name']}",
                        body,
                    )
```

Also add a helper to `db.py`:

```python
def get_user_by_id(user_id: str) -> dict[str, Any] | None:
    conn = get_connection()
    row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return _row_to_dict(row)
```

And update the jobs.py reference to use `db.get_user_by_id(job["user_id"])` instead of `db.get_user_by_email_by_id`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/hshi/Desktop/Gradescope-Bot && PYTHONPATH=/home/hshi/Desktop/Gradescope-Bot/server python -m pytest server/tests/test_jobs.py -v`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add server/poko_server/jobs.py server/poko_server/db.py server/tests/test_jobs.py
git commit -m "feat(server): wire email notifications into job processing pipeline"
```

---

### Task 11: Startup Hooks + Server Entry Point

**Files:**
- Modify: `server/poko_server/api.py`
- Create: `server/poko_server/__main__.py`

- [ ] **Step 1: Update api.py startup hook**

Update the `startup` function in `server/poko_server/api.py`:

```python
from poko_server.jobs import recover_interrupted_jobs, cleanup_old_jobs

@app.on_event("startup")
def startup():
    db.create_tables()
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    recovered = recover_interrupted_jobs()
    if recovered:
        log.info("Recovered %d interrupted jobs", recovered)
    cleaned = cleanup_old_jobs()
    if cleaned:
        log.info("Cleaned up %d old jobs", cleaned)
```

- [ ] **Step 2: Create __main__.py**

```python
"""Entry point: python -m poko_server"""
import uvicorn

from poko_server import config

if __name__ == "__main__":
    uvicorn.run(
        "poko_server.api:app",
        host=config.SERVER_HOST,
        port=config.SERVER_PORT,
        log_level="info",
    )
```

- [ ] **Step 3: Verify server starts**

Run: `cd /home/hshi/Desktop/Gradescope-Bot/server && timeout 5 python -m poko_server || true`
Expected: Server starts, prints "Uvicorn running on http://0.0.0.0:8080", then exits after 5s timeout.

- [ ] **Step 4: Commit**

```bash
git add server/poko_server/api.py server/poko_server/__main__.py
git commit -m "feat(server): add startup recovery, cleanup, and server entry point"
```

---

### Task 12: Background Job Worker

**Files:**
- Modify: `server/poko_server/api.py`
- Modify: `server/poko_server/jobs.py`

The server needs to process uploaded jobs asynchronously. Rather than adding a separate worker process, we'll use a background thread that polls for pending jobs.

- [ ] **Step 1: Add worker to jobs.py**

```python
import threading
import time


def _worker_loop(poll_interval: float = 10.0) -> None:
    """Background thread that polls for pending jobs and processes them."""
    while True:
        try:
            counts = process_pending_jobs()
            if counts["processed"] > 0:
                log.info("Worker processed %d jobs: %d complete, %d failed",
                         counts["processed"], counts["complete"], counts["failed"])
        except Exception:
            log.exception("Worker error during job processing")
        time.sleep(poll_interval)


def start_worker(poll_interval: float = 10.0) -> threading.Thread:
    """Start the background job worker thread."""
    t = threading.Thread(target=_worker_loop, args=(poll_interval,), daemon=True)
    t.start()
    log.info("Background job worker started (poll every %.0fs)", poll_interval)
    return t
```

- [ ] **Step 2: Start worker on app startup**

Update `server/poko_server/api.py` startup hook:

```python
from poko_server.jobs import recover_interrupted_jobs, cleanup_old_jobs, start_worker

@app.on_event("startup")
def startup():
    db.create_tables()
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    recovered = recover_interrupted_jobs()
    if recovered:
        log.info("Recovered %d interrupted jobs", recovered)
    cleaned = cleanup_old_jobs()
    if cleaned:
        log.info("Cleaned up %d old jobs", cleaned)
    start_worker()
```

- [ ] **Step 3: Commit**

```bash
git add server/poko_server/api.py server/poko_server/jobs.py
git commit -m "feat(server): add background worker thread for async job processing"
```

---

### Task 13: Full Integration Test

**Files:**
- Create: `server/tests/test_integration.py`

- [ ] **Step 1: Write integration test**

```python
"""End-to-end integration test: upload → worker processes → poll result → delete."""
from __future__ import annotations

import json
import time
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
    mock_response.json.return_value = {
        "email": email,
        "email_verified": "true",
    }
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
        upload_resp = client.post(
            "/jobs",
            headers=headers,
            files={"file": ("hw7.pdf", pdf_bytes, "application/pdf")},
            data={"course_id": "1001", "assignment_id": "2001",
                  "assignment_name": "HW7", "course_name": "MATH 268"},
        )
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
    """Sync scores twice, verify increase detection and metrics."""
    headers = {"Authorization": "Bearer test-token"}

    with _mock_auth():
        # First sync: baseline
        client.post(
            "/scores/sync",
            headers=headers,
            json={"scores": [
                {"course_id": "1001", "assignment_id": "2001",
                 "score": 85.0, "max_score": 100.0}
            ]},
        )

        # Second sync: score increased
        sync_resp = client.post(
            "/scores/sync",
            headers=headers,
            json={"scores": [
                {"course_id": "1001", "assignment_id": "2001",
                 "score": 89.0, "max_score": 100.0}
            ]},
        )
        assert sync_resp.json()["changes_detected"] == 1
        assert sync_resp.json()["total_points_delta"] == 4.0

        # Verify stats
        stats_resp = client.get("/users/me/stats", headers=headers)
        assert stats_resp.json()["points_recovered"] == 4.0
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /home/hshi/Desktop/Gradescope-Bot && PYTHONPATH=/home/hshi/Desktop/Gradescope-Bot/server python -m pytest server/tests/test_integration.py -v`
Expected: All 2 tests PASS

- [ ] **Step 3: Run the full test suite**

Run: `cd /home/hshi/Desktop/Gradescope-Bot && PYTHONPATH=/home/hshi/Desktop/Gradescope-Bot/server python -m pytest server/tests/ -v`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add server/tests/test_integration.py
git commit -m "test(server): add full integration tests for upload→analyze→result flow"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] § 2.1 Components: server, Tauri app (server only in this plan) — Task 1-4
- [x] § 2.2 Data flow: upload → analyze → result → delete — Tasks 5-7, 13
- [x] § 2.3 Resilience: retry, dedup, crash recovery — Tasks 5, 7, 11
- [x] § 3.1 Gmail OAuth: token verification — Task 3
- [x] § 3.3 User record: email, metrics — Tasks 2, 8
- [x] § 5.2 Two-stage pipeline: prescreen + opus — Task 6
- [x] § 5.3 Confidence tiers: critical/strong/marginal — Task 6 (schema)
- [x] § 6 Score change detection — Task 8
- [x] § 7 Email notifications: critical only — Tasks 9-10
- [x] § 9.1 All endpoints: /auth/verify, /jobs, /jobs/{id}/status, /jobs/{id}/result, DELETE /jobs/{id}, /scores/sync, /users/me/stats, /health — Tasks 4-5, 7-8
- [x] § 9.2 Job lifecycle: uploaded → analyzing → complete/failed — Task 7
- [x] § 9.3 Database: all 5 tables — Task 2
- [x] § 10 Privacy: PDF deleted immediately — Task 7
- [x] § 16.2 Server rate limits — Task 1 (config), enforcement deferred to API middleware in client plan

**Placeholder scan:** No TBDs, TODOs, or placeholders found.

**Type consistency:** `create_job`, `get_job`, `update_job_status`, `delete_job`, `get_user_by_email`, `create_user`, `get_user_by_id`, `upsert_score_snapshot`, `get_previous_score`, `get_user_metrics`, `update_user_metrics` — all signatures match across tasks.

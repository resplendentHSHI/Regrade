# Gradescope Regrade Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal bot that pulls graded Gradescope submissions once daily at 2 AM local time, analyzes them with `claude -p --effort max` for reasonable regrade candidates, and serves a localhost dashboard for review.

**Architecture:** Two Python processes sharing `data/` on disk — a long-running heartbeat daemon (fetcher + analyzer pipeline, 2 AM scheduler with catch-up and suspend-resume) and an ad-hoc FastAPI web UI that reads queue state from the filesystem. The filesystem is the only persistence layer. No database.

**Tech Stack:** Python 3.11+, `gradescopeapi` 1.8.0 (login + course enumeration), `requests` (custom scraping on `gradescopeapi`'s session), `beautifulsoup4` (dashboard HTML parsing), `fastapi` + `uvicorn` + `jinja2` + `markdown-it-py` (web UI), `pytest` (tests), `claude` CLI from Claude Code (analyzer subprocess).

**Spec:** `docs/superpowers/specs/2026-04-13-gradescope-regrade-bot-design.md`

**Note on workspace:** This plan assumes execution in the existing `/home/hshi/Desktop/Gradescope-Bot` directory. A dedicated git worktree was not created; changes go to `master`. `.gitignore` and the spec are already committed.

---

## Task 1: Project scaffolding

**Files:**
- Create: `pyproject.toml`
- Create: `gradescope_bot/__init__.py`
- Create: `gradescope_bot/templates/.gitkeep`
- Create: `gradescope_bot/static/.gitkeep`
- Create: `prompts/.gitkeep`
- Create: `tests/__init__.py`
- Create: `tests/conftest.py`
- Create: `tests/fixtures/.gitkeep`
- Create: `tests/fixtures/fake_claude/.gitkeep`
- Create: `.env.example`
- Copy: `18100 Dashboard _ Gradescope.html` → `tests/fixtures/dashboard_sample.html`
- Copy: `submission_398420660.pdf` → `tests/fixtures/sample_graded.pdf`

- [ ] **Step 1: Write `pyproject.toml`**

```toml
[project]
name = "gradescope-bot"
version = "0.1.0"
description = "Personal Gradescope regrade-checker bot"
requires-python = ">=3.11"
dependencies = [
  "gradescopeapi==1.8.0",
  "beautifulsoup4>=4.12",
  "requests>=2.31",
  "fastapi>=0.110",
  "uvicorn[standard]>=0.27",
  "jinja2>=3.1",
  "markdown-it-py>=3.0",
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
include = ["gradescope_bot*"]

[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
```

- [ ] **Step 2: Create package skeleton**

```bash
mkdir -p gradescope_bot/templates gradescope_bot/static prompts tests/fixtures/fake_claude
touch gradescope_bot/__init__.py tests/__init__.py
touch gradescope_bot/templates/.gitkeep gradescope_bot/static/.gitkeep prompts/.gitkeep
touch tests/fixtures/.gitkeep tests/fixtures/fake_claude/.gitkeep
```

- [ ] **Step 3: Write `tests/conftest.py`**

```python
"""Shared pytest fixtures and path constants."""
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def dashboard_html() -> str:
    """Real saved Gradescope course dashboard HTML (18-100 Spring 2026)."""
    return (FIXTURES / "dashboard_sample.html").read_text(encoding="utf-8")


@pytest.fixture
def sample_pdf_path() -> Path:
    """Real 10-page graded PDF from smoke test #1 (HW08 ADCs)."""
    return FIXTURES / "sample_graded.pdf"


@pytest.fixture
def tmp_data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point gradescope_bot.config.DATA_DIR at a tmp directory for the test."""
    from gradescope_bot import config

    data = tmp_path / "data"
    data.mkdir()
    monkeypatch.setattr(config, "DATA_DIR", data)
    monkeypatch.setattr(config, "QUEUE_DIR", data / "queue")
    monkeypatch.setattr(config, "HEARTBEAT_STATE", data / "heartbeat_state.json")
    monkeypatch.setattr(config, "RATE_LIMIT_STATE", data / "rate_limit_state.json")
    monkeypatch.setattr(config, "HEARTBEAT_LOG", data / "heartbeat.log")
    monkeypatch.setattr(config, "HEARTBEAT_PID", data / "heartbeat.pid")
    (data / "queue").mkdir()
    return data
```

- [ ] **Step 4: Write `.env.example`**

```
GS_EMAIL=you@example.com
GS_PASSWORD=changeme
```

- [ ] **Step 5: Copy real fixtures into `tests/fixtures/`**

```bash
cp "18100 Dashboard _ Gradescope.html" tests/fixtures/dashboard_sample.html
cp submission_398420660.pdf tests/fixtures/sample_graded.pdf
ls -la tests/fixtures/
```

Expected: `dashboard_sample.html` (~20-30 KB) and `sample_graded.pdf` (~2.3 MB) visible.

- [ ] **Step 6: Install in editable mode**

```bash
pip install -e ".[dev]"
```

Expected: installs the package and dev deps, including `gradescopeapi==1.8.0` (already installed per audit), `beautifulsoup4`, `fastapi`, `pytest`.

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml gradescope_bot/ prompts/ tests/ .env.example
git commit -m "Add project scaffolding and test fixtures"
```

---

## Task 2: Config module

**Files:**
- Create: `gradescope_bot/config.py`

- [ ] **Step 1: Write `gradescope_bot/config.py`**

```python
"""All tunable constants for the bot. No logic, no side effects at import time."""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

# ── Paths ────────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / "data"
QUEUE_DIR = DATA_DIR / "queue"
HEARTBEAT_STATE = DATA_DIR / "heartbeat_state.json"
RATE_LIMIT_STATE = DATA_DIR / "rate_limit_state.json"
HEARTBEAT_LOG = DATA_DIR / "heartbeat.log"
HEARTBEAT_PID = DATA_DIR / "heartbeat.pid"
PROMPTS_DIR = PROJECT_ROOT / "prompts"
REGRADE_PROMPT = PROMPTS_DIR / "regrade_check.md"

# ── Gradescope ───────────────────────────────────────────────────────────────
GS_BASE_URL = "https://www.gradescope.com"
GS_EMAIL = os.environ.get("GS_EMAIL", "")
GS_PASSWORD = os.environ.get("GS_PASSWORD", "")

# ── Rate limiting (conservative, circuit-breaker style) ──────────────────────
MIN_REQUEST_SPACING_SEC = 2.0
REQUEST_SPACING_JITTER_SEC = 0.5
PER_RUN_CAP = 50
DAILY_CAP = 150
BACKOFF_INITIAL_SEC = 30
BACKOFF_MAX_SEC = 480
BACKOFF_MAX_RETRIES = 5
HTTP_TIMEOUT_SEC = (60, 60)  # (connect, read)

# ── Scheduler ────────────────────────────────────────────────────────────────
HEARTBEAT_HOUR_LOCAL = 2
HEARTBEAT_MINUTE_LOCAL = 0
BACKFILL_DAYS = 7

# ── Analyzer ─────────────────────────────────────────────────────────────────
CLAUDE_BINARY = os.environ.get("CLAUDE_BINARY", "claude")  # overridable for tests
CLAUDE_MODEL = "opus"
CLAUDE_EFFORT = "max"
CLAUDE_MAX_TURNS = 20
CLAUDE_MAX_BUDGET_USD = 5.00
CLAUDE_TIMEOUT_SEC = 1200

# ── Web UI ───────────────────────────────────────────────────────────────────
SERVER_HOST = "127.0.0.1"
SERVER_PORT = 8765
```

- [ ] **Step 2: Smoke-test the import**

```bash
python -c "from gradescope_bot import config; print(config.PROJECT_ROOT, config.DATA_DIR)"
```

Expected: prints the absolute project root and `data/` path. No errors.

- [ ] **Step 3: Commit**

```bash
git add gradescope_bot/config.py
git commit -m "Add config module with all constants"
```

---

## Task 3: Storage module (state.json helpers)

**Files:**
- Create: `gradescope_bot/storage.py`
- Test: `tests/test_storage.py`

- [ ] **Step 1: Write the failing test** at `tests/test_storage.py`

```python
"""Tests for state.json round-trip and queue scanning."""
from __future__ import annotations

from pathlib import Path

import pytest

from gradescope_bot import storage


def _make_state(item_id: str, status: str = "pending_analysis", issue_count: int = 0) -> dict:
    return {
        "id": item_id,
        "title": "Homework 1",
        "course_id": "1222348",
        "assignment_id": "7453474",
        "submission_id": "381362479",
        "tags": ["course:18-100", "type:homework"],
        "score": 8.0,
        "max_score": 10.0,
        "due_date": None,
        "first_seen_local": "2026-04-13T02:00:00-04:00",
        "downloaded_at": None,
        "analyzed_at": None,
        "reviewed_at": None,
        "pdf_sha256": None,
        "status": status,
        "summary": "",
        "issue_count": issue_count,
        "error": None,
    }


def test_write_and_read_state_roundtrip(tmp_data_dir: Path) -> None:
    state = _make_state("1222348_7453474")
    storage.write_state("1222348_7453474", state)

    loaded = storage.read_state("1222348_7453474")

    assert loaded == state


def test_list_items_returns_all_queue_folders(tmp_data_dir: Path) -> None:
    storage.write_state("1222348_1", _make_state("1222348_1", status="needs_review", issue_count=2))
    storage.write_state("1222348_2", _make_state("1222348_2", status="no_issues_found"))
    storage.write_state("1222348_3", _make_state("1222348_3", status="pending_analysis"))

    items = storage.list_items()

    assert {i["id"] for i in items} == {"1222348_1", "1222348_2", "1222348_3"}


def test_list_items_filters_by_status(tmp_data_dir: Path) -> None:
    storage.write_state("1222348_1", _make_state("1222348_1", status="needs_review", issue_count=1))
    storage.write_state("1222348_2", _make_state("1222348_2", status="no_issues_found"))

    needs_review = storage.list_items(status="needs_review")

    assert len(needs_review) == 1
    assert needs_review[0]["id"] == "1222348_1"


def test_update_state_merges_fields(tmp_data_dir: Path) -> None:
    storage.write_state("1222348_1", _make_state("1222348_1"))

    storage.update_state("1222348_1", status="needs_review", issue_count=3, summary="test")

    loaded = storage.read_state("1222348_1")
    assert loaded["status"] == "needs_review"
    assert loaded["issue_count"] == 3
    assert loaded["summary"] == "test"
    assert loaded["title"] == "Homework 1"  # untouched


def test_item_dir_creates_folder(tmp_data_dir: Path) -> None:
    d = storage.item_dir("1222348_7453474")
    assert d.exists()
    assert d.is_dir()
    assert d.name == "1222348_7453474"


def test_read_state_returns_none_for_missing(tmp_data_dir: Path) -> None:
    assert storage.read_state("does_not_exist") is None


def test_list_items_skips_corrupt_folders(tmp_data_dir: Path, caplog: pytest.LogCaptureFixture) -> None:
    storage.write_state("good_1", _make_state("good_1"))
    # Create a queue subfolder with no state.json
    (tmp_data_dir / "queue" / "bad_1").mkdir()

    items = storage.list_items()

    assert len(items) == 1
    assert items[0]["id"] == "good_1"
```

- [ ] **Step 2: Run to verify fail**

```bash
pytest tests/test_storage.py -v
```

Expected: all FAIL with `ModuleNotFoundError: gradescope_bot.storage`.

- [ ] **Step 3: Implement `gradescope_bot/storage.py`**

```python
"""Filesystem-backed queue: one folder per item, state.json is the source of truth."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from gradescope_bot import config

log = logging.getLogger(__name__)


def item_dir(item_id: str) -> Path:
    """Return the queue folder for an item, creating it if missing."""
    d = config.QUEUE_DIR / item_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _state_path(item_id: str) -> Path:
    return item_dir(item_id) / "state.json"


def read_state(item_id: str) -> dict[str, Any] | None:
    """Load state.json for an item. Returns None if missing."""
    path = config.QUEUE_DIR / item_id / "state.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def write_state(item_id: str, state: dict[str, Any]) -> None:
    """Atomically write state.json for an item."""
    path = _state_path(item_id)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, indent=2), encoding="utf-8")
    tmp.replace(path)


def update_state(item_id: str, **fields: Any) -> dict[str, Any]:
    """Merge the given fields into an existing state.json and persist."""
    state = read_state(item_id)
    if state is None:
        raise FileNotFoundError(f"No state.json for {item_id}")
    state.update(fields)
    write_state(item_id, state)
    return state


def list_items(status: str | None = None) -> list[dict[str, Any]]:
    """Scan QUEUE_DIR and return all state.json contents, optionally filtered by status."""
    if not config.QUEUE_DIR.exists():
        return []
    out: list[dict[str, Any]] = []
    for sub in sorted(config.QUEUE_DIR.iterdir()):
        if not sub.is_dir():
            continue
        state_file = sub / "state.json"
        if not state_file.exists():
            log.warning("Queue folder %s missing state.json; skipping", sub.name)
            continue
        try:
            state = json.loads(state_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            log.warning("Corrupt state.json in %s: %s", sub.name, e)
            continue
        if status is not None and state.get("status") != status:
            continue
        out.append(state)
    return out
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_storage.py -v
```

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add gradescope_bot/storage.py tests/test_storage.py
git commit -m "Add storage module with state.json helpers"
```

---

## Task 4: Rate limiter

**Files:**
- Create: `gradescope_bot/rate_limit.py`
- Test: `tests/test_rate_limiter.py`

- [ ] **Step 1: Write the failing test** at `tests/test_rate_limiter.py`

```python
"""Tests for the token-bucket-ish rate limiter with per-run and daily caps."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from gradescope_bot import rate_limit


class FakeClock:
    def __init__(self, start: float = 1_000_000.0) -> None:
        self.now = start
        self.sleeps: list[float] = []

    def time(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


@pytest.fixture
def clock() -> FakeClock:
    return FakeClock()


@pytest.fixture
def limiter(tmp_data_dir: Path, clock: FakeClock) -> rate_limit.RateLimiter:
    return rate_limit.RateLimiter(
        min_spacing=2.0,
        jitter=0.0,  # deterministic for tests
        per_run_cap=3,
        daily_cap=5,
        clock=clock.time,
        sleep=clock.sleep,
        now_local=lambda: datetime(2026, 4, 13, 2, 0, 0, tzinfo=timezone.utc),
    )


def test_first_request_does_not_sleep(limiter: rate_limit.RateLimiter, clock: FakeClock) -> None:
    limiter.wait()
    assert clock.sleeps == []


def test_second_request_sleeps_to_enforce_spacing(limiter: rate_limit.RateLimiter, clock: FakeClock) -> None:
    limiter.wait()
    limiter.wait()
    assert clock.sleeps == [2.0]


def test_per_run_cap_raises(limiter: rate_limit.RateLimiter) -> None:
    limiter.wait()
    limiter.wait()
    limiter.wait()
    with pytest.raises(rate_limit.RatePerRunExhausted):
        limiter.wait()


def test_daily_cap_persists_across_limiter_instances(tmp_data_dir: Path, clock: FakeClock) -> None:
    for _ in range(3):
        rate_limit.RateLimiter(
            min_spacing=0.0, jitter=0.0, per_run_cap=100, daily_cap=5,
            clock=clock.time, sleep=clock.sleep,
            now_local=lambda: datetime(2026, 4, 13, 2, 0, 0, tzinfo=timezone.utc),
        ).wait()
    # Fourth and fifth requests succeed
    for _ in range(2):
        rate_limit.RateLimiter(
            min_spacing=0.0, jitter=0.0, per_run_cap=100, daily_cap=5,
            clock=clock.time, sleep=clock.sleep,
            now_local=lambda: datetime(2026, 4, 13, 2, 0, 0, tzinfo=timezone.utc),
        ).wait()
    # Sixth request — daily cap hit
    limiter = rate_limit.RateLimiter(
        min_spacing=0.0, jitter=0.0, per_run_cap=100, daily_cap=5,
        clock=clock.time, sleep=clock.sleep,
        now_local=lambda: datetime(2026, 4, 13, 2, 0, 0, tzinfo=timezone.utc),
    )
    with pytest.raises(rate_limit.DailyCapExhausted):
        limiter.wait()


def test_daily_cap_resets_on_new_day(tmp_data_dir: Path, clock: FakeClock) -> None:
    # Day 1: hit the cap
    day1 = datetime(2026, 4, 13, 2, 0, 0, tzinfo=timezone.utc)
    for _ in range(5):
        rate_limit.RateLimiter(
            min_spacing=0.0, jitter=0.0, per_run_cap=100, daily_cap=5,
            clock=clock.time, sleep=clock.sleep, now_local=lambda: day1,
        ).wait()
    # Day 2: should reset
    day2 = datetime(2026, 4, 14, 2, 0, 0, tzinfo=timezone.utc)
    limiter = rate_limit.RateLimiter(
        min_spacing=0.0, jitter=0.0, per_run_cap=100, daily_cap=5,
        clock=clock.time, sleep=clock.sleep, now_local=lambda: day2,
    )
    limiter.wait()  # should not raise
```

- [ ] **Step 2: Run to verify fail**

```bash
pytest tests/test_rate_limiter.py -v
```

Expected: FAIL with `ModuleNotFoundError: gradescope_bot.rate_limit`.

- [ ] **Step 3: Implement `gradescope_bot/rate_limit.py`**

```python
"""Token-bucket-ish rate limiter with per-run and daily hard caps."""
from __future__ import annotations

import json
import random
import time
from datetime import datetime
from typing import Callable

from gradescope_bot import config


class RatePerRunExhausted(Exception):
    """Raised when the per-run request cap is reached."""


class DailyCapExhausted(Exception):
    """Raised when the daily request cap is reached."""


class RateLimiter:
    """Enforces minimum inter-request spacing and hard per-run and per-day caps.

    The daily counter is persisted to disk so it survives process restarts
    and applies across both the heartbeat daemon and any --run-now invocations.
    """

    def __init__(
        self,
        min_spacing: float = config.MIN_REQUEST_SPACING_SEC,
        jitter: float = config.REQUEST_SPACING_JITTER_SEC,
        per_run_cap: int = config.PER_RUN_CAP,
        daily_cap: int = config.DAILY_CAP,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
        now_local: Callable[[], datetime] = lambda: datetime.now().astimezone(),
    ) -> None:
        self._min_spacing = min_spacing
        self._jitter = jitter
        self._per_run_cap = per_run_cap
        self._daily_cap = daily_cap
        self._clock = clock
        self._sleep = sleep
        self._now_local = now_local
        self._last_request_time: float | None = None
        self._run_count = 0

    def _load_daily_state(self) -> dict:
        path = config.RATE_LIMIT_STATE
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
        return {"day_local": "", "requests_used": 0, "daily_cap": self._daily_cap}

    def _save_daily_state(self, state: dict) -> None:
        path = config.RATE_LIMIT_STATE
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(state), encoding="utf-8")
        tmp.replace(path)

    def wait(self) -> None:
        """Block until the next request is allowed. Raises on cap exhaustion."""
        today = self._now_local().strftime("%Y-%m-%d")
        state = self._load_daily_state()
        if state.get("day_local") != today:
            state = {"day_local": today, "requests_used": 0, "daily_cap": self._daily_cap}

        if state["requests_used"] >= self._daily_cap:
            raise DailyCapExhausted(
                f"Daily cap {self._daily_cap} hit for {today}"
            )

        if self._run_count >= self._per_run_cap:
            raise RatePerRunExhausted(
                f"Per-run cap {self._per_run_cap} hit"
            )

        if self._last_request_time is not None:
            elapsed = self._clock() - self._last_request_time
            target = self._min_spacing + (random.uniform(0, self._jitter) if self._jitter else 0.0)
            if elapsed < target:
                self._sleep(target - elapsed)

        self._last_request_time = self._clock()
        self._run_count += 1
        state["requests_used"] += 1
        self._save_daily_state(state)
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_rate_limiter.py -v
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add gradescope_bot/rate_limit.py tests/test_rate_limiter.py
git commit -m "Add rate limiter with per-run and daily caps"
```

---

## Task 5: GSClient — login wrapper + session rate limiting

**Files:**
- Create: `gradescope_bot/gs_client.py`

- [ ] **Step 1: Write `gradescope_bot/gs_client.py` (login + session hook only; parsers come in Task 6)**

```python
"""Thin wrapper over gradescopeapi's authenticated session with our rate limiter installed."""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

import requests
from gradescopeapi.classes.connection import GSConnection

from gradescope_bot import config
from gradescope_bot.rate_limit import (
    DailyCapExhausted,
    RateLimiter,
    RatePerRunExhausted,
)

log = logging.getLogger(__name__)


@dataclass
class AssignmentRow:
    assignment_id: str
    submission_id: str | None
    name: str
    score: float | None
    max_score: float | None
    due_date: datetime | None
    status: Literal["graded", "submitted", "no_submission", "late", "unknown"]


class GSClient:
    """Wraps gradescopeapi with our rate limiter and custom scrapers.

    The rate limiter is installed by monkey-patching the requests.Session.request
    method so EVERY network call through gradescopeapi or our own helpers
    goes through the token bucket and daily cap.
    """

    def __init__(self, limiter: RateLimiter | None = None) -> None:
        self._limiter = limiter or RateLimiter()
        self._conn: GSConnection | None = None
        self._account = None  # set after login

    @property
    def session(self) -> requests.Session:
        if self._conn is None:
            raise RuntimeError("GSClient not logged in; call login() first")
        return self._conn.session

    def login(self) -> None:
        if not config.GS_EMAIL or not config.GS_PASSWORD:
            raise RuntimeError("GS_EMAIL and GS_PASSWORD must be set in .env")
        self._conn = GSConnection()
        self._install_rate_limit(self._conn.session)
        self._conn.login(config.GS_EMAIL, config.GS_PASSWORD)
        # get_account() is exposed as .account after login in gradescopeapi
        self._account = self._conn.account

    def get_courses(self) -> dict:
        """Return {'student': {course_id: Course}, 'instructor': {...}}."""
        if self._account is None:
            raise RuntimeError("Not logged in")
        return self._account.get_courses()

    # ── Private ────────────────────────────────────────────────────────────

    def _install_rate_limit(self, session: requests.Session) -> None:
        """Replace session.request with a rate-limited version."""
        original = session.request
        limiter = self._limiter

        def rate_limited(method, url, **kwargs):
            limiter.wait()
            kwargs.setdefault("timeout", config.HTTP_TIMEOUT_SEC)
            retries_left = config.BACKOFF_MAX_RETRIES
            backoff = config.BACKOFF_INITIAL_SEC
            while True:
                resp = original(method, url, **kwargs)
                if resp.status_code in (429, 503) and retries_left > 0:
                    log.warning("%s %s → %s, backing off %ss", method, url, resp.status_code, backoff)
                    time.sleep(backoff)
                    retries_left -= 1
                    backoff = min(backoff * 2, config.BACKOFF_MAX_SEC)
                    limiter.wait()
                    continue
                return resp

        session.request = rate_limited  # type: ignore[method-assign]
```

- [ ] **Step 2: Smoke-test the import**

```bash
python -c "from gradescope_bot.gs_client import GSClient, AssignmentRow; print('ok')"
```

Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add gradescope_bot/gs_client.py
git commit -m "Add GSClient login wrapper with session-level rate limiting"
```

---

## Task 6: Dashboard HTML parser

**Files:**
- Modify: `gradescope_bot/gs_client.py` (add `fetch_course_dashboard`)
- Test: `tests/test_gs_client_parsing.py`

- [ ] **Step 1: Inspect the real fixture to know what we're parsing against**

```bash
python -c "
from bs4 import BeautifulSoup
html = open('tests/fixtures/dashboard_sample.html').read()
soup = BeautifulSoup(html, 'html.parser')
rows = soup.select('tr[role=row]')
print(f'Found {len(rows)} rows')
for r in rows[:3]:
    a = r.select_one('th.table--primaryLink a')
    if a:
        print(' ', a.text.strip(), '→', a.get('href'))
"
```

Expected: prints a small number of rows (likely 10-20) with assignment names and `/courses/1222348/assignments/.../submissions/...` hrefs.

- [ ] **Step 2: Write the failing test** at `tests/test_gs_client_parsing.py`

```python
"""Tests for the dashboard HTML parser using the real saved 18-100 page."""
from __future__ import annotations

from gradescope_bot.gs_client import AssignmentRow, parse_course_dashboard


def test_parse_returns_at_least_one_graded_assignment(dashboard_html: str) -> None:
    rows = parse_course_dashboard(dashboard_html)
    graded = [r for r in rows if r.status == "graded"]
    assert len(graded) >= 1, "Expected at least one graded assignment in the fixture"


def test_parse_extracts_assignment_and_submission_ids_for_graded_rows(dashboard_html: str) -> None:
    rows = parse_course_dashboard(dashboard_html)
    graded = [r for r in rows if r.status == "graded"]
    for row in graded:
        assert row.assignment_id.isdigit(), f"assignment_id must be digits: {row.assignment_id}"
        assert row.submission_id is not None
        assert row.submission_id.isdigit()


def test_parse_extracts_score_and_max_score_for_graded_rows(dashboard_html: str) -> None:
    rows = parse_course_dashboard(dashboard_html)
    graded = [r for r in rows if r.status == "graded"]
    for row in graded:
        assert row.score is not None
        assert row.max_score is not None
        assert 0 <= row.score <= row.max_score


def test_parse_extracts_assignment_name(dashboard_html: str) -> None:
    rows = parse_course_dashboard(dashboard_html)
    graded = [r for r in rows if r.status == "graded"]
    names = [r.name for r in graded]
    # At least one assignment should have "homework", "lab", "exam", "hw" etc. in it
    keywords = ("homework", "lab", "exam", "hw", "quiz", "project")
    assert any(
        any(k in n.lower() for k in keywords) for n in names
    ), f"None of {names} match expected keywords"


def test_parse_returns_empty_for_empty_html() -> None:
    assert parse_course_dashboard("<html></html>") == []


def test_parse_ignores_header_row(dashboard_html: str) -> None:
    rows = parse_course_dashboard(dashboard_html)
    # None should have header-like text as the name
    names = {r.name for r in rows}
    assert "Name" not in names
```

- [ ] **Step 3: Run to verify fail**

```bash
pytest tests/test_gs_client_parsing.py -v
```

Expected: FAIL with `ImportError: cannot import name 'parse_course_dashboard'`.

- [ ] **Step 4: Add `parse_course_dashboard` and `fetch_course_dashboard` to `gs_client.py`**

Add the following functions/methods to `gradescope_bot/gs_client.py` (append at module level below `GSClient`):

```python
import re
from datetime import datetime

from bs4 import BeautifulSoup

_HREF_RE = re.compile(
    r"/courses/(?P<cid>\d+)/assignments/(?P<aid>\d+)(?:/submissions/(?P<sid>\d+))?"
)
_SCORE_RE = re.compile(r"([-\d.]+)\s*/\s*([\d.]+)")


def parse_course_dashboard(html: str) -> list[AssignmentRow]:
    """Parse the HTML of /courses/{cid} into a list of AssignmentRow.

    Detects graded rows by: has .submissionStatus--score AND no .submissionStatus--text.
    """
    soup = BeautifulSoup(html, "html.parser")
    rows: list[AssignmentRow] = []
    for tr in soup.select("tr[role=row]"):
        link = tr.select_one("th.table--primaryLink a")
        if link is None:
            continue  # header row or non-assignment row

        href = link.get("href", "")
        m = _HREF_RE.search(href)
        if m is None:
            continue
        name = link.get_text(strip=True)
        if not name or name.lower() == "name":
            continue

        status_cell = tr.select_one("td.submissionStatus")
        score_div = status_cell.select_one(".submissionStatus--score") if status_cell else None
        text_div = status_cell.select_one(".submissionStatus--text") if status_cell else None

        score: float | None = None
        max_score: float | None = None
        if score_div is not None:
            m2 = _SCORE_RE.search(score_div.get_text())
            if m2:
                score = float(m2.group(1))
                max_score = float(m2.group(2))

        if score_div is not None and text_div is None:
            status = "graded"
        elif text_div is not None:
            text = text_div.get_text(strip=True).lower()
            if "no submission" in text:
                status = "no_submission"
            elif "late" in text:
                status = "late"
            elif "submitted" in text:
                status = "submitted"
            else:
                status = "unknown"
        else:
            status = "unknown"

        due_date: datetime | None = None
        due_el = tr.select_one("time.submissionTimeChart--dueDate")
        if due_el is not None and due_el.get("datetime"):
            try:
                due_date = datetime.fromisoformat(due_el["datetime"].replace(" ", "T", 1))
            except ValueError:
                due_date = None

        rows.append(
            AssignmentRow(
                assignment_id=m.group("aid"),
                submission_id=m.group("sid"),
                name=name,
                score=score,
                max_score=max_score,
                due_date=due_date,
                status=status,
            )
        )
    return rows
```

Also add a method to `GSClient`:

```python
    def fetch_course_dashboard(self, course_id: str) -> list[AssignmentRow]:
        url = f"{config.GS_BASE_URL}/courses/{course_id}"
        resp = self.session.get(url)
        resp.raise_for_status()
        return parse_course_dashboard(resp.text)
```

- [ ] **Step 5: Run tests**

```bash
pytest tests/test_gs_client_parsing.py -v
```

Expected: all 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add gradescope_bot/gs_client.py tests/test_gs_client_parsing.py
git commit -m "Add dashboard HTML parser and fetch_course_dashboard method"
```

---

## Task 7: PDF download method

**Files:**
- Modify: `gradescope_bot/gs_client.py` (add `download_submission_pdf`)
- Test: `tests/test_gs_client_pdf.py`

- [ ] **Step 1: Write the failing test** at `tests/test_gs_client_pdf.py`

```python
"""Tests for the PDF download path. Uses a mock session to avoid real network."""
from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from gradescope_bot import config
from gradescope_bot.gs_client import GSClient


def _mock_client(pdf_bytes: bytes, status_code: int = 200) -> GSClient:
    client = GSClient()
    # Bypass real login
    fake_conn = MagicMock()
    fake_session = MagicMock()
    fake_response = MagicMock(content=pdf_bytes, status_code=status_code)
    fake_response.raise_for_status = MagicMock()
    fake_session.get.return_value = fake_response
    fake_conn.session = fake_session
    client._conn = fake_conn
    return client


def test_download_submission_pdf_returns_bytes() -> None:
    pdf = b"%PDF-1.4\n%fake content\n"
    client = _mock_client(pdf)

    result = client.download_submission_pdf("1222348", "7841492", "400080463")

    assert result == pdf
    client._conn.session.get.assert_called_once_with(
        "https://www.gradescope.com/courses/1222348/assignments/7841492/submissions/400080463.pdf"
    )


def test_download_submission_pdf_raises_when_response_not_pdf() -> None:
    client = _mock_client(b"<html>login page</html>")
    with pytest.raises(ValueError, match="not a PDF"):
        client.download_submission_pdf("1", "2", "3")
```

- [ ] **Step 2: Run to verify fail**

```bash
pytest tests/test_gs_client_pdf.py -v
```

Expected: FAIL with `AttributeError: 'GSClient' object has no attribute 'download_submission_pdf'`.

- [ ] **Step 3: Add the method to `GSClient` in `gs_client.py`**

```python
    def download_submission_pdf(
        self, course_id: str, assignment_id: str, submission_id: str
    ) -> bytes:
        """Download a graded submission PDF. Raises if response isn't a PDF."""
        url = (
            f"{config.GS_BASE_URL}/courses/{course_id}/assignments/"
            f"{assignment_id}/submissions/{submission_id}.pdf"
        )
        resp = self.session.get(url)
        resp.raise_for_status()
        content = resp.content
        if not content.startswith(b"%PDF"):
            raise ValueError(
                f"Response from {url} is not a PDF (first 16 bytes: {content[:16]!r})"
            )
        return content
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_gs_client_pdf.py -v
```

Expected: both tests PASS.

- [ ] **Step 5: Commit**

```bash
git add gradescope_bot/gs_client.py tests/test_gs_client_pdf.py
git commit -m "Add download_submission_pdf with content-type validation"
```

---

## Task 8: Fetcher pipeline

**Files:**
- Create: `gradescope_bot/fetcher.py`
- Test: `tests/test_fetcher.py`

- [ ] **Step 1: Write the failing test** at `tests/test_fetcher.py`

```python
"""Tests for the fetcher pipeline using a fake GSClient."""
from __future__ import annotations

import hashlib
from datetime import datetime
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from gradescope_bot import fetcher, storage
from gradescope_bot.gs_client import AssignmentRow


class FakeCourse:
    def __init__(self, course_id: str, name: str, year: int, semester: str) -> None:
        self.course_id = course_id
        self.name = name
        self.year = year
        self.semester = semester


def _fake_client(
    courses: dict, dashboards: dict[str, list[AssignmentRow]], pdfs: dict[tuple, bytes]
) -> MagicMock:
    client = MagicMock()
    client.get_courses.return_value = {"student": courses, "instructor": {}}
    client.fetch_course_dashboard.side_effect = lambda cid: dashboards[cid]
    client.download_submission_pdf.side_effect = lambda cid, aid, sid: pdfs[(cid, aid, sid)]
    return client


def test_fetcher_creates_queue_folder_for_graded_assignment(tmp_data_dir: Path) -> None:
    courses = {"1222348": FakeCourse("1222348", "18-100: ECE", 2026, "Spring")}
    dashboards = {
        "1222348": [
            AssignmentRow(
                assignment_id="7453474",
                submission_id="381362479",
                name="Homework 1",
                score=10.0,
                max_score=10.0,
                due_date=datetime(2026, 1, 19, 22, 0, 0),
                status="graded",
            )
        ]
    }
    pdf_bytes = b"%PDF-1.4\n test\n"
    pdfs = {("1222348", "7453474", "381362479"): pdf_bytes}
    client = _fake_client(courses, dashboards, pdfs)

    fetcher.run_fetch_phase(client, now_local=lambda: datetime(2026, 4, 13, 2, 0, 0))

    item_id = "1222348_7453474"
    state = storage.read_state(item_id)
    assert state is not None
    assert state["status"] == "pending_analysis"
    assert state["title"] == "Homework 1"
    assert state["score"] == 10.0
    assert state["submission_id"] == "381362479"
    assert state["pdf_sha256"] == hashlib.sha256(pdf_bytes).hexdigest()

    pdf_path = storage.item_dir(item_id) / "submission.pdf"
    assert pdf_path.read_bytes() == pdf_bytes


def test_fetcher_skips_ungraded_rows(tmp_data_dir: Path) -> None:
    courses = {"1222348": FakeCourse("1222348", "18-100: ECE", 2026, "Spring")}
    dashboards = {
        "1222348": [
            AssignmentRow(
                assignment_id="X",
                submission_id=None,
                name="HW Future",
                score=None,
                max_score=None,
                due_date=None,
                status="submitted",
            )
        ]
    }
    client = _fake_client(courses, dashboards, {})

    fetcher.run_fetch_phase(client, now_local=lambda: datetime(2026, 4, 13, 2, 0, 0))

    assert storage.list_items() == []


def test_fetcher_is_idempotent_for_already_downloaded_item(tmp_data_dir: Path) -> None:
    courses = {"1222348": FakeCourse("1222348", "18-100: ECE", 2026, "Spring")}
    row = AssignmentRow(
        assignment_id="7453474", submission_id="381362479", name="Homework 1",
        score=10.0, max_score=10.0, due_date=None, status="graded",
    )
    dashboards = {"1222348": [row]}
    pdf_bytes = b"%PDF-1.4\nsame\n"
    pdfs = {("1222348", "7453474", "381362479"): pdf_bytes}
    client = _fake_client(courses, dashboards, pdfs)

    fetcher.run_fetch_phase(client, now_local=lambda: datetime(2026, 4, 13, 2, 0, 0))
    # Second run: download_submission_pdf should NOT be called again
    client.download_submission_pdf.reset_mock()
    fetcher.run_fetch_phase(client, now_local=lambda: datetime(2026, 4, 14, 2, 0, 0))

    client.download_submission_pdf.assert_not_called()
```

- [ ] **Step 2: Run to verify fail**

```bash
pytest tests/test_fetcher.py -v
```

Expected: FAIL with `ModuleNotFoundError: gradescope_bot.fetcher`.

- [ ] **Step 3: Implement `gradescope_bot/fetcher.py`**

```python
"""Fetcher pipeline: login → courses → dashboards → download new graded PDFs."""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime
from typing import Callable

from gradescope_bot import storage
from gradescope_bot.gs_client import AssignmentRow, GSClient
from gradescope_bot.rate_limit import DailyCapExhausted, RatePerRunExhausted

log = logging.getLogger(__name__)


_CURRENT_SEMESTER_MONTHS = {
    "Spring": range(1, 6),   # Jan-May
    "Summer": range(6, 9),   # Jun-Aug
    "Fall":   range(9, 13),  # Sep-Dec
}


def _semester_matches_today(semester: str, year: int, now: datetime) -> bool:
    months = _CURRENT_SEMESTER_MONTHS.get(semester)
    if months is None:
        return False
    return year == now.year and now.month in months


def _infer_type(name: str) -> str:
    n = name.lower()
    if "hw" in n or "homework" in n:
        return "homework"
    if "lab" in n:
        return "lab"
    if "exam" in n or "midterm" in n or "final" in n:
        return "exam"
    if "quiz" in n:
        return "quiz"
    if "project" in n:
        return "project"
    return "other"


def _make_item_id(course_id: str, assignment_id: str) -> str:
    return f"{course_id}_{assignment_id}"


def run_fetch_phase(
    client: GSClient,
    now_local: Callable[[], datetime] = lambda: datetime.now().astimezone(),
) -> dict:
    """Run the fetch phase of a heartbeat cycle. Returns a counters dict.

    The caller is responsible for calling client.login() before invoking this.
    """
    counters = {"new_items": 0, "skipped_existing": 0, "errors": 0}

    try:
        courses = client.get_courses()
    except Exception as e:
        log.error("get_courses failed: %s", e)
        raise

    student_courses = courses.get("student", {})
    now = now_local()

    for course_id, course in student_courses.items():
        semester = getattr(course, "semester", None)
        year = getattr(course, "year", None)
        if semester is None or year is None or not _semester_matches_today(semester, year, now):
            log.info("Skipping inactive course %s (%s %s)", course_id, semester, year)
            continue

        try:
            rows: list[AssignmentRow] = client.fetch_course_dashboard(course_id)
        except (RatePerRunExhausted, DailyCapExhausted):
            log.warning("Rate cap hit while listing %s; aborting fetch phase", course_id)
            raise
        except Exception as e:
            log.warning("Dashboard fetch failed for %s: %s", course_id, e)
            counters["errors"] += 1
            continue

        for row in rows:
            if row.status != "graded" or row.submission_id is None:
                continue
            item_id = _make_item_id(course_id, row.assignment_id)
            existing = storage.read_state(item_id)
            if existing is not None and existing.get("pdf_sha256") is not None:
                counters["skipped_existing"] += 1
                continue

            state = {
                "id": item_id,
                "title": row.name,
                "course_id": course_id,
                "assignment_id": row.assignment_id,
                "submission_id": row.submission_id,
                "tags": [
                    f"course_name:{getattr(course, 'name', '')}",
                    f"term:{semester}{year}",
                    f"type:{_infer_type(row.name)}",
                ],
                "score": row.score,
                "max_score": row.max_score,
                "due_date": row.due_date.isoformat() if row.due_date else None,
                "first_seen_local": now.isoformat(),
                "downloaded_at": None,
                "analyzed_at": None,
                "reviewed_at": None,
                "pdf_sha256": None,
                "status": "pending_download",
                "summary": "",
                "issue_count": 0,
                "error": None,
            }
            storage.write_state(item_id, state)

            try:
                pdf_bytes = client.download_submission_pdf(
                    course_id, row.assignment_id, row.submission_id
                )
            except (RatePerRunExhausted, DailyCapExhausted):
                raise
            except Exception as e:
                log.warning("PDF download failed for %s: %s", item_id, e)
                storage.update_state(item_id, error=str(e))
                counters["errors"] += 1
                continue

            pdf_path = storage.item_dir(item_id) / "submission.pdf"
            pdf_path.write_bytes(pdf_bytes)
            sha = hashlib.sha256(pdf_bytes).hexdigest()
            storage.update_state(
                item_id,
                pdf_sha256=sha,
                downloaded_at=now.isoformat(),
                status="pending_analysis",
            )
            counters["new_items"] += 1
            log.info("Downloaded %s (%s)", item_id, row.name)

    return counters
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_fetcher.py -v
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add gradescope_bot/fetcher.py tests/test_fetcher.py
git commit -m "Add fetcher pipeline with active-course filter and idempotent downloads"
```

---

## Task 9: Prompt template

**Files:**
- Create: `prompts/regrade_check.md`

- [ ] **Step 1: Write the prompt template (verbatim from smoke-tested version)**

```markdown
You are analyzing a GRADED Gradescope homework submission PDF for possible regrade requests.

The PDF is at: {pdf_path}

It contains the student's work PLUS Gradescope's grader annotations overlaid on each page:
rubric items, points awarded/deducted, grader comments, and the per-question score breakdown.

## Your job

1. Read the entire PDF using the Read tool. The file is {pdf_pages} pages. If it exceeds
   10 pages, read it in page ranges (1-10, 11-20, 21-...) so you cover every page. Do not skip pages.
2. For every question in the assignment, examine:
   - What the student wrote/submitted
   - Which rubric items the grader applied
   - Points awarded vs. available
   - Any grader comments
3. Look for regrade-worthy issues in these five categories:
   - arithmetic_mismatch — points deducted don't add up to the total shown
   - rubric_misapplication — the cited rubric item doesn't match what the student wrote
   - missed_correct_work — the student got something right but lost points (alternate valid
     method, correct answer marked wrong, etc.)
   - unclear_deduction — points taken with no explanation or a vague comment that prevents
     the student from understanding why
   - partial_credit_too_low — substantial correct work received disproportionately few points
4. Apply a strict "reasonable person" filter. Only flag issues a TA/professor would plausibly
   agree with upon re-review. Err strongly on the side of NOT flagging. False positives waste
   everyone's time. If you're unsure, don't flag it. Previously-denied regrade requests
   visible in the PDF should not be re-flagged.
5. Write the structured verdict to `{output_path}` using the Write tool, conforming to the JSON
   schema provided. Set item_id to "{item_id}".
6. If and only if the verdict contains at least one kept issue, also write `{draft_path}` with
   one section per kept issue in this format:

   # Regrade Requests — <assignment title> (<course if visible>)

   ## Question <N> — <short description>

   **Requesting regrade for:** <X points deducted under "rubric item">

   **Reason for request:**
   <1-2 paragraphs, respectful tone, citing specific page numbers and what the student wrote>

   ---

## Output requirements

- Your FINAL response must be the SAME JSON object you wrote to analysis.json.
- Do not skip pages. Do not guess at content. If a page is ambiguous, re-read it.
- Use your maximum reasoning effort. This is a high-stakes evaluation.
```

- [ ] **Step 2: Commit**

```bash
git add prompts/regrade_check.md
git commit -m "Add regrade-check prompt template (smoke-tested verbatim)"
```

---

## Task 10: Analyzer subprocess wrapper

**Files:**
- Create: `gradescope_bot/analyzer.py`
- Create: `tests/fixtures/fake_claude/fake_claude_ok.sh`
- Create: `tests/fixtures/fake_claude/fake_claude_fail.sh`
- Create: `tests/fixtures/fake_claude/fake_claude_slow.sh`
- Create: `tests/fixtures/fake_claude/fake_claude_malformed.sh`
- Test: `tests/test_analyzer_subprocess.py`

- [ ] **Step 1: Write `fake_claude_ok.sh`**

```bash
#!/usr/bin/env bash
# Mimics a successful claude -p run by writing a canned analysis.json
# to whatever --add-dir path was given.
set -euo pipefail
ADD_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --add-dir) ADD_DIR="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [[ -z "$ADD_DIR" ]]; then
  echo "fake_claude_ok: missing --add-dir" >&2
  exit 2
fi
cat > "${ADD_DIR}/analysis.json" <<'JSON'
{
  "item_id": "1222348_7453474",
  "model": "claude-opus-4-6",
  "overall_verdict": "needs_review",
  "summary": "Synthetic verdict from fake_claude_ok.sh",
  "issues": [
    {
      "question": "Q1",
      "category": "missed_correct_work",
      "severity": "medium",
      "rubric_item_cited": "Incorrect",
      "points_disputed": 1.0,
      "reasoning": "Synthetic reasoning.",
      "keep": true
    }
  ],
  "kept_issue_count": 1
}
JSON
# Emit the same JSON on stdout as the claude -p --output-format json wrapper would
printf '{"type":"result","is_error":false,"structured_output":%s}\n' "$(cat "${ADD_DIR}/analysis.json")"
```

- [ ] **Step 2: Write `fake_claude_fail.sh`**

```bash
#!/usr/bin/env bash
echo "fake_claude_fail: simulated failure" >&2
exit 1
```

- [ ] **Step 3: Write `fake_claude_slow.sh`**

```bash
#!/usr/bin/env bash
sleep 30
echo "this should have timed out already"
```

- [ ] **Step 4: Write `fake_claude_malformed.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
ADD_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --add-dir) ADD_DIR="$2"; shift 2 ;;
    *) shift ;;
  esac
done
echo "{ this is not valid json" > "${ADD_DIR}/analysis.json"
printf '{"type":"result","is_error":false}\n'
```

- [ ] **Step 5: Make the fake scripts executable**

```bash
chmod +x tests/fixtures/fake_claude/fake_claude_*.sh
```

- [ ] **Step 6: Write the failing test** at `tests/test_analyzer_subprocess.py`

```python
"""Tests for the analyzer subprocess wrapper using real shell-script doubles."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from gradescope_bot import analyzer, config, storage


FAKE_DIR = Path(__file__).parent / "fixtures" / "fake_claude"


def _seed_item(tmp_data_dir: Path, item_id: str) -> Path:
    state = {
        "id": item_id,
        "title": "HW 1",
        "course_id": "1222348",
        "assignment_id": "7453474",
        "submission_id": "381362479",
        "tags": [],
        "score": 8.0,
        "max_score": 10.0,
        "due_date": None,
        "first_seen_local": "2026-04-13T02:00:00-04:00",
        "downloaded_at": "2026-04-13T02:00:05-04:00",
        "analyzed_at": None,
        "reviewed_at": None,
        "pdf_sha256": "abc",
        "status": "pending_analysis",
        "summary": "",
        "issue_count": 0,
        "error": None,
    }
    storage.write_state(item_id, state)
    # Real PDF must exist so --add-dir has something
    d = storage.item_dir(item_id)
    (d / "submission.pdf").write_bytes(b"%PDF-1.4\ndummy\n")
    return d


def test_analyze_success_sets_needs_review(
    tmp_data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(config, "CLAUDE_BINARY", str(FAKE_DIR / "fake_claude_ok.sh"))
    _seed_item(tmp_data_dir, "1222348_7453474")

    analyzer.analyze("1222348_7453474")

    state = storage.read_state("1222348_7453474")
    assert state["status"] == "needs_review"
    assert state["issue_count"] == 1
    assert "Synthetic" in state["summary"]
    assert state["analyzed_at"] is not None


def test_analyze_failure_sets_analysis_failed(
    tmp_data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(config, "CLAUDE_BINARY", str(FAKE_DIR / "fake_claude_fail.sh"))
    _seed_item(tmp_data_dir, "1222348_7453474")

    analyzer.analyze("1222348_7453474")

    state = storage.read_state("1222348_7453474")
    assert state["status"] == "analysis_failed"
    assert state["error"] is not None


def test_analyze_timeout_sets_analysis_failed(
    tmp_data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(config, "CLAUDE_BINARY", str(FAKE_DIR / "fake_claude_slow.sh"))
    monkeypatch.setattr(config, "CLAUDE_TIMEOUT_SEC", 2)  # force fast timeout
    _seed_item(tmp_data_dir, "1222348_7453474")

    analyzer.analyze("1222348_7453474")

    state = storage.read_state("1222348_7453474")
    assert state["status"] == "analysis_failed"
    assert "timed out" in state["error"].lower()


def test_analyze_malformed_json_sets_analysis_failed(
    tmp_data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(config, "CLAUDE_BINARY", str(FAKE_DIR / "fake_claude_malformed.sh"))
    _seed_item(tmp_data_dir, "1222348_7453474")

    analyzer.analyze("1222348_7453474")

    state = storage.read_state("1222348_7453474")
    assert state["status"] == "analysis_failed"
    assert "json" in state["error"].lower()
```

- [ ] **Step 7: Run to verify fail**

```bash
pytest tests/test_analyzer_subprocess.py -v
```

Expected: FAIL with `ModuleNotFoundError: gradescope_bot.analyzer`.

- [ ] **Step 8: Implement `gradescope_bot/analyzer.py`**

```python
"""Analyzer: invoke `claude -p` on a queue item and parse the resulting verdict."""
from __future__ import annotations

import json
import logging
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from gradescope_bot import config, storage

log = logging.getLogger(__name__)


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
                    "question", "category", "severity", "rubric_item_cited",
                    "points_disputed", "reasoning", "keep",
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


def _render_prompt(item_id: str, item_dir: Path, pdf_pages: int) -> str:
    template = config.REGRADE_PROMPT.read_text(encoding="utf-8")
    return template.format(
        pdf_path=str(item_dir / "submission.pdf"),
        pdf_pages=pdf_pages,
        output_path=str(item_dir / "analysis.json"),
        draft_path=str(item_dir / "regrade_draft.md"),
        item_id=item_id,
    )


def _count_pdf_pages(pdf_path: Path) -> int:
    """Best-effort page count. Uses pdfinfo if available, else returns 10."""
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


def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def analyze(item_id: str) -> None:
    """Run `claude -p` on one queue item and update its state.json."""
    item_dir = storage.item_dir(item_id)
    pdf_path = item_dir / "submission.pdf"
    if not pdf_path.exists():
        storage.update_state(item_id, status="analysis_failed", error="submission.pdf missing")
        return

    pages = _count_pdf_pages(pdf_path)
    prompt = _render_prompt(item_id, item_dir, pages)

    cmd = [
        config.CLAUDE_BINARY, "-p", prompt,
        "--model", config.CLAUDE_MODEL,
        "--effort", config.CLAUDE_EFFORT,
        "--output-format", "json",
        "--json-schema", json.dumps(VERDICT_SCHEMA),
        "--permission-mode", "acceptEdits",
        "--add-dir", str(item_dir),
        "--max-turns", str(config.CLAUDE_MAX_TURNS),
        "--max-budget-usd", str(config.CLAUDE_MAX_BUDGET_USD),
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=config.CLAUDE_TIMEOUT_SEC,
        )
    except subprocess.TimeoutExpired:
        storage.update_state(
            item_id,
            status="analysis_failed",
            error=f"claude -p timed out after {config.CLAUDE_TIMEOUT_SEC}s",
        )
        return

    if result.returncode != 0:
        storage.update_state(
            item_id,
            status="analysis_failed",
            error=f"claude -p exit {result.returncode}: {result.stderr[:1000]}",
        )
        return

    analysis_path = item_dir / "analysis.json"
    if not analysis_path.exists():
        storage.update_state(
            item_id,
            status="analysis_failed",
            error="analysis.json not written",
        )
        return

    try:
        verdict = json.loads(analysis_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        storage.update_state(
            item_id,
            status="analysis_failed",
            error=f"analysis.json invalid JSON: {e}",
        )
        return

    kept = int(verdict.get("kept_issue_count", 0))
    storage.update_state(
        item_id,
        status="needs_review" if kept > 0 else "no_issues_found",
        summary=verdict.get("summary", ""),
        issue_count=kept,
        analyzed_at=_now_utc_iso(),
        error=None,
    )


def run_analyze_phase() -> dict[str, int]:
    """Analyze all items with status=pending_analysis. Returns counters."""
    counters = {"analyzed_ok": 0, "needs_review": 0, "no_issues_found": 0, "failed": 0}
    items = storage.list_items(status="pending_analysis")
    for item in items:
        analyze(item["id"])
        state = storage.read_state(item["id"])
        if state is None:
            continue
        if state["status"] == "needs_review":
            counters["needs_review"] += 1
            counters["analyzed_ok"] += 1
        elif state["status"] == "no_issues_found":
            counters["no_issues_found"] += 1
            counters["analyzed_ok"] += 1
        else:
            counters["failed"] += 1
    return counters
```

- [ ] **Step 9: Run tests**

```bash
pytest tests/test_analyzer_subprocess.py -v
```

Expected: all 4 tests PASS.

- [ ] **Step 10: Commit**

```bash
git add gradescope_bot/analyzer.py tests/test_analyzer_subprocess.py tests/fixtures/fake_claude/
git commit -m "Add analyzer subprocess wrapper with real shell-script fakes"
```

---

## Task 11: Scheduler (2 AM catch-up logic)

**Files:**
- Create: `gradescope_bot/scheduler.py`
- Test: `tests/test_scheduler.py`

- [ ] **Step 1: Write the failing test** at `tests/test_scheduler.py`

```python
"""Tests for the 2 AM catch-up scheduler logic (pure functions, no threading)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from gradescope_bot.scheduler import Decision, decide_next_action

TZ = timezone(timedelta(hours=-4))  # arbitrary fixed offset for tests


def dt(y, mo, d, h, mi=0) -> datetime:
    return datetime(y, mo, d, h, mi, tzinfo=TZ)


def test_catch_up_when_last_run_before_today_2am_and_now_after() -> None:
    decision = decide_next_action(
        now=dt(2026, 4, 13, 9, 0),
        last_run=dt(2026, 4, 12, 2, 0),
        hour=2, minute=0,
    )
    assert decision.run_now is True
    assert decision.next_wake == dt(2026, 4, 14, 2, 0)


def test_sleep_until_tomorrow_if_already_ran_today() -> None:
    decision = decide_next_action(
        now=dt(2026, 4, 13, 9, 0),
        last_run=dt(2026, 4, 13, 2, 5),
        hour=2, minute=0,
    )
    assert decision.run_now is False
    assert decision.next_wake == dt(2026, 4, 14, 2, 0)


def test_sleep_until_today_if_early_morning_and_last_run_yesterday_early() -> None:
    decision = decide_next_action(
        now=dt(2026, 4, 13, 0, 30),
        last_run=dt(2026, 4, 12, 2, 0),
        hour=2, minute=0,
    )
    assert decision.run_now is False
    assert decision.next_wake == dt(2026, 4, 13, 2, 0)


def test_first_run_ever_with_no_last_run_runs_immediately_if_past_2am() -> None:
    decision = decide_next_action(
        now=dt(2026, 4, 13, 9, 0),
        last_run=None,
        hour=2, minute=0,
    )
    assert decision.run_now is True


def test_first_run_ever_before_2am_waits_until_2am() -> None:
    decision = decide_next_action(
        now=dt(2026, 4, 13, 0, 30),
        last_run=None,
        hour=2, minute=0,
    )
    assert decision.run_now is False
    assert decision.next_wake == dt(2026, 4, 13, 2, 0)
```

- [ ] **Step 2: Run to verify fail**

```bash
pytest tests/test_scheduler.py -v
```

Expected: FAIL with `ModuleNotFoundError: gradescope_bot.scheduler`.

- [ ] **Step 3: Implement `gradescope_bot/scheduler.py`**

```python
"""Pure-function scheduler logic for the 2 AM catch-up policy."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass
class Decision:
    run_now: bool
    next_wake: datetime


def decide_next_action(
    now: datetime,
    last_run: datetime | None,
    hour: int,
    minute: int,
) -> Decision:
    """Given current time and last successful run time, decide the next action.

    Policy:
      * If we missed today's HH:MM slot (now >= today@HH:MM and last_run < today@HH:MM),
        run immediately and schedule next wake for tomorrow@HH:MM.
      * Otherwise, if last_run >= today@HH:MM (we already ran today), sleep until
        tomorrow@HH:MM.
      * Otherwise (early morning, before today@HH:MM, haven't run yet today),
        sleep until today@HH:MM.
    """
    today_slot = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    tomorrow_slot = today_slot + timedelta(days=1)

    if last_run is None:
        if now >= today_slot:
            return Decision(run_now=True, next_wake=tomorrow_slot)
        return Decision(run_now=False, next_wake=today_slot)

    if last_run < today_slot <= now:
        return Decision(run_now=True, next_wake=tomorrow_slot)

    if last_run >= today_slot:
        return Decision(run_now=False, next_wake=tomorrow_slot)

    return Decision(run_now=False, next_wake=today_slot)
```

- [ ] **Step 4: Run tests**

```bash
pytest tests/test_scheduler.py -v
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add gradescope_bot/scheduler.py tests/test_scheduler.py
git commit -m "Add pure-function 2 AM catch-up scheduler"
```

---

## Task 12: Heartbeat daemon

**Files:**
- Create: `gradescope_bot/heartbeat.py`

- [ ] **Step 1: Write `gradescope_bot/heartbeat.py`**

```python
"""Long-running heartbeat daemon entry point.

Usage:
  python -m gradescope_bot.heartbeat           # sleep-until-next-2am loop
  python -m gradescope_bot.heartbeat --run-now # one cycle and exit
"""
from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import json
import logging
import logging.handlers
import signal
import sys
import threading
from datetime import datetime
from pathlib import Path

from gradescope_bot import analyzer, config, fetcher
from gradescope_bot.gs_client import GSClient
from gradescope_bot.rate_limit import DailyCapExhausted, RatePerRunExhausted
from gradescope_bot.scheduler import decide_next_action

log = logging.getLogger("gradescope_bot.heartbeat")

_stop = threading.Event()


def _setup_logging() -> None:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    handler = logging.handlers.RotatingFileHandler(
        config.HEARTBEAT_LOG, maxBytes=10 * 1024 * 1024, backupCount=5,
    )
    handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s")
    )
    stream = logging.StreamHandler(sys.stdout)
    stream.setFormatter(handler.formatter)
    logging.basicConfig(level=logging.INFO, handlers=[handler, stream])


def _acquire_pid_lock() -> int:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    fd = config.HEARTBEAT_PID.open("w")
    try:
        fcntl.flock(fd.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log.error("Another heartbeat process holds the lock; exiting")
        sys.exit(1)
    fd.write(str(sys.argv))
    fd.flush()
    # Return the raw fd so it stays alive for the process lifetime
    return fd.fileno()


def _read_state() -> dict:
    if config.HEARTBEAT_STATE.exists():
        return json.loads(config.HEARTBEAT_STATE.read_text(encoding="utf-8"))
    return {}


def _write_state(state: dict) -> None:
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = config.HEARTBEAT_STATE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, indent=2), encoding="utf-8")
    tmp.replace(config.HEARTBEAT_STATE)


def _now_local() -> datetime:
    return datetime.now().astimezone()


def run_cycle() -> dict:
    """Run one fetch+analyze cycle and return counters. Updates heartbeat_state.json."""
    started = _now_local()
    log.info("Cycle start")
    state = _read_state()
    state["last_status"] = "running"
    state["daemon_started_local"] = state.get("daemon_started_local") or started.isoformat()
    _write_state(state)

    fetch_counters = {"new_items": 0, "skipped_existing": 0, "errors": 0}
    analyze_counters = {"analyzed_ok": 0, "needs_review": 0, "no_issues_found": 0, "failed": 0}
    last_status = "ok"

    try:
        client = GSClient()
        client.login()
        fetch_counters = fetcher.run_fetch_phase(client, now_local=_now_local)
        analyze_counters = analyzer.run_analyze_phase()
    except DailyCapExhausted as e:
        log.warning("Daily cap hit: %s", e)
        last_status = "daily_cap_hit"
    except RatePerRunExhausted as e:
        log.warning("Per-run cap hit: %s", e)
        last_status = "per_run_cap_hit"
    except Exception as e:
        log.exception("Cycle failed: %s", e)
        last_status = f"error: {type(e).__name__}"

    finished = _now_local()
    counters = {**fetch_counters, **analyze_counters}
    log.info("Cycle end: %s (%s)", counters, last_status)

    if last_status == "ok":
        state["last_run_local"] = finished.isoformat()
    state["last_status"] = last_status
    state["last_cycle_counters"] = counters
    _write_state(state)
    return counters


def _install_signal_handlers() -> None:
    def handler(signum, _frame):
        log.info("Received signal %s; exiting", signum)
        _stop.set()

    signal.signal(signal.SIGTERM, handler)
    signal.signal(signal.SIGINT, handler)


def run_scheduler_loop() -> None:
    while not _stop.is_set():
        now = _now_local()
        state = _read_state()
        last_run_str = state.get("last_run_local")
        last_run = datetime.fromisoformat(last_run_str) if last_run_str else None

        decision = decide_next_action(
            now=now,
            last_run=last_run,
            hour=config.HEARTBEAT_HOUR_LOCAL,
            minute=config.HEARTBEAT_MINUTE_LOCAL,
        )

        if decision.run_now:
            run_cycle()
            # Refresh state — last_run_local may have moved
            state = _read_state()

        state["next_scheduled_local"] = decision.next_wake.isoformat()
        _write_state(state)

        wait_seconds = max(0.0, (decision.next_wake - _now_local()).total_seconds())
        log.info("Sleeping %s seconds until %s", int(wait_seconds), decision.next_wake.isoformat())
        _stop.wait(timeout=wait_seconds)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-now", action="store_true", help="Run one cycle and exit")
    args = parser.parse_args()

    _setup_logging()
    _acquire_pid_lock()
    _install_signal_handlers()

    if args.run_now:
        run_cycle()
        return

    run_scheduler_loop()


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Smoke-test the import**

```bash
python -c "from gradescope_bot import heartbeat; print('ok')"
```

Expected: prints `ok`.

- [ ] **Step 3: Sanity-check --help**

```bash
python -m gradescope_bot.heartbeat --help
```

Expected: argparse output showing `--run-now`.

- [ ] **Step 4: Commit**

```bash
git add gradescope_bot/heartbeat.py
git commit -m "Add heartbeat daemon with 2 AM scheduler loop and --run-now mode"
```

---

## Task 13: FastAPI app skeleton + dashboard route

**Files:**
- Create: `gradescope_bot/serve.py`
- Create: `gradescope_bot/templates/base.html`
- Create: `gradescope_bot/templates/dashboard.html`
- Create: `gradescope_bot/static/style.css`

- [ ] **Step 1: Write `gradescope_bot/templates/base.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{% block title %}Gradescope Bot{% endblock %}</title>
<link rel="stylesheet" href="/static/style.css">
</head>
<body>
<header class="topbar">
  <h1><a href="/">Gradescope Bot</a></h1>
  <div class="status">
    {% if heartbeat %}
      Last run: {{ heartbeat.last_run_local or "never" }}
      · {{ heartbeat.last_status }}
      · Next: {{ heartbeat.next_scheduled_local or "—" }}
    {% else %}
      No heartbeat yet.
    {% endif %}
  </div>
</header>
<main>{% block content %}{% endblock %}</main>
</body>
</html>
```

- [ ] **Step 2: Write `gradescope_bot/templates/dashboard.html`**

```html
{% extends "base.html" %}
{% block content %}
<section>
  <h2>Filters</h2>
  <div class="chips">
    {% for chip in chips %}
      <a class="chip {% if chip.active %}active{% endif %}" href="{{ chip.href }}">{{ chip.label }}</a>
    {% endfor %}
  </div>
</section>

{% for group in groups %}
<section class="group">
  <h2>{{ group.title }} ({{ group.items|length }})</h2>
  {% if group.items %}
    <ul class="items">
      {% for item in group.items %}
        <li>
          <a href="/item/{{ item.id }}">
            <span class="title">{{ item.title }}</span>
            <span class="summary">{{ item.summary or "" }}</span>
            <span class="score">{{ item.score }}/{{ item.max_score }}</span>
          </a>
        </li>
      {% endfor %}
    </ul>
  {% else %}
    <p class="empty">None.</p>
  {% endif %}
</section>
{% endfor %}
{% endblock %}
```

- [ ] **Step 3: Write `gradescope_bot/static/style.css`**

```css
* { box-sizing: border-box; }
body { font: 14px/1.4 system-ui, sans-serif; margin: 0; color: #222; background: #fafafa; }
header.topbar { display: flex; justify-content: space-between; align-items: baseline;
  padding: 12px 20px; background: #222; color: #eee; }
header.topbar h1 a { color: #fff; text-decoration: none; font-size: 18px; }
header.topbar .status { font-family: ui-monospace, monospace; font-size: 12px; color: #bbb; }
main { max-width: 1000px; margin: 20px auto; padding: 0 20px; }
section.group { margin-bottom: 30px; border: 1px solid #ddd; border-radius: 6px;
  background: #fff; padding: 16px 20px; }
section.group h2 { margin-top: 0; font-size: 16px; }
ul.items { list-style: none; padding: 0; margin: 0; }
ul.items li { border-bottom: 1px solid #eee; }
ul.items li:last-child { border-bottom: none; }
ul.items li a { display: grid; grid-template-columns: 2fr 3fr 60px;
  gap: 12px; padding: 10px 0; text-decoration: none; color: #222; }
ul.items li a:hover { background: #f4f4f4; }
.title { font-weight: 600; }
.summary { color: #555; font-size: 13px; }
.score { text-align: right; font-family: ui-monospace, monospace; color: #666; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.chip { display: inline-block; padding: 4px 10px; border: 1px solid #ccc;
  border-radius: 14px; background: #fff; color: #333; text-decoration: none; font-size: 12px; }
.chip.active { background: #333; color: #fff; border-color: #333; }
.pdf-frame { width: 100%; height: 80vh; border: 1px solid #ddd; border-radius: 6px; }
.draft { background: #fffbea; padding: 16px; border-radius: 6px; border: 1px solid #f1e6a0; }
pre.analysis { background: #f6f6f6; padding: 12px; overflow: auto; font-size: 12px; }
form.inline { display: inline; }
button { font: inherit; padding: 6px 12px; cursor: pointer; }
.empty { color: #888; font-style: italic; }
```

- [ ] **Step 4: Write `gradescope_bot/serve.py`**

```python
"""FastAPI read-mostly dashboard. Localhost only, no auth."""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from markdown_it import MarkdownIt

from gradescope_bot import config, storage

app = FastAPI()
TEMPLATE_DIR = Path(__file__).parent / "templates"
STATIC_DIR = Path(__file__).parent / "static"
templates = Jinja2Templates(directory=str(TEMPLATE_DIR))
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
_md = MarkdownIt()


GROUP_ORDER = [
    ("needs_review", "Needs review"),
    ("pending_download", "Pending download"),
    ("pending_analysis", "Pending analysis"),
    ("analysis_failed", "Analysis failed"),
    ("no_issues_found", "No issues found"),
    ("reviewed", "Reviewed"),
]


def _read_heartbeat() -> dict | None:
    if config.HEARTBEAT_STATE.exists():
        return json.loads(config.HEARTBEAT_STATE.read_text(encoding="utf-8"))
    return None


def _build_chips(items: list[dict], active_filters: dict[str, str]) -> list[dict]:
    """Collect distinct tag values from the queue and flag active ones."""
    tags: set[str] = set()
    for item in items:
        for tag in item.get("tags", []):
            tags.add(tag)
    chips = []
    for tag in sorted(tags):
        key, _, value = tag.partition(":")
        active = active_filters.get(key) == value
        href = f"/?{key}={value}" if not active else "/"
        chips.append({"label": tag, "active": active, "href": href})
    return chips


def _filter_items(items: list[dict], filters: dict[str, str]) -> list[dict]:
    if not filters:
        return items
    out = []
    for item in items:
        tags = set(item.get("tags", []))
        if all(f"{k}:{v}" in tags for k, v in filters.items()):
            out.append(item)
    return out


@app.get("/", response_class=HTMLResponse)
def dashboard(request: Request):
    all_items = storage.list_items()
    filters = {
        k: v for k, v in request.query_params.items()
        if k in {"course", "course_name", "type", "term"}
    }
    items = _filter_items(all_items, filters)

    groups = []
    for status, title in GROUP_ORDER:
        bucket = [i for i in items if i.get("status") == status]
        groups.append({"title": title, "items": bucket})

    return templates.TemplateResponse(
        request,
        "dashboard.html",
        {
            "groups": groups,
            "chips": _build_chips(all_items, filters),
            "heartbeat": _read_heartbeat(),
        },
    )


@app.get("/api/status")
def api_status():
    return JSONResponse(_read_heartbeat() or {})


@app.get("/queue/{item_id}/submission.pdf")
def serve_pdf(item_id: str):
    path = config.QUEUE_DIR / item_id / "submission.pdf"
    if not path.exists():
        return JSONResponse({"error": "not found"}, status_code=404)
    return FileResponse(str(path), media_type="application/pdf")
```

- [ ] **Step 5: Smoke-test the import**

```bash
python -c "from gradescope_bot import serve; print('ok')"
```

Expected: prints `ok`.

- [ ] **Step 6: Start the server briefly and probe /**

```bash
(uvicorn gradescope_bot.serve:app --host 127.0.0.1 --port 8765 &) && sleep 2 && curl -s http://127.0.0.1:8765/ -o /tmp/dashboard.html && wc -c /tmp/dashboard.html && pkill -f "uvicorn gradescope_bot.serve"
```

Expected: `/tmp/dashboard.html` is non-empty HTML containing "Gradescope Bot".

- [ ] **Step 7: Commit**

```bash
git add gradescope_bot/serve.py gradescope_bot/templates/ gradescope_bot/static/
git commit -m "Add FastAPI dashboard with grouped queue view and tag filters"
```

---

## Task 14: Item detail route + review/reanalyze actions

**Files:**
- Create: `gradescope_bot/templates/item.html`
- Modify: `gradescope_bot/serve.py`

- [ ] **Step 1: Write `gradescope_bot/templates/item.html`**

```html
{% extends "base.html" %}
{% block title %}{{ state.title }} — Gradescope Bot{% endblock %}
{% block content %}
<p><a href="/">← back to dashboard</a></p>
<h2>{{ state.title }}</h2>
<p class="meta">
  {{ state.score }}/{{ state.max_score }} ·
  status: <strong>{{ state.status }}</strong> ·
  tags: {{ state.tags|join(", ") }}
</p>

{% if state.summary %}<p><strong>Summary:</strong> {{ state.summary }}</p>{% endif %}

<div class="actions">
  {% if state.status != "reviewed" %}
    <form class="inline" method="post" action="/item/{{ state.id }}/review">
      <button type="submit">Mark as reviewed</button>
    </form>
  {% endif %}
  <form class="inline" method="post" action="/item/{{ state.id }}/reanalyze">
    <button type="submit">Re-analyze (regenerates draft)</button>
  </form>
</div>

<h3>Submission PDF</h3>
<iframe class="pdf-frame" src="/queue/{{ state.id }}/submission.pdf"></iframe>

{% if draft_html %}
<h3>Regrade draft</h3>
<div class="draft">{{ draft_html|safe }}</div>
{% endif %}

{% if analysis_json %}
<h3>Raw analysis.json</h3>
<pre class="analysis">{{ analysis_json }}</pre>
{% endif %}
{% endblock %}
```

- [ ] **Step 2: Add routes to `gradescope_bot/serve.py`**

Append the following to `gradescope_bot/serve.py`:

```python
from datetime import datetime, timezone
import shutil


@app.get("/item/{item_id}", response_class=HTMLResponse)
def item_detail(request: Request, item_id: str):
    state = storage.read_state(item_id)
    if state is None:
        return JSONResponse({"error": "not found"}, status_code=404)
    item_dir = config.QUEUE_DIR / item_id
    draft_path = item_dir / "regrade_draft.md"
    analysis_path = item_dir / "analysis.json"
    draft_html = _md.render(draft_path.read_text(encoding="utf-8")) if draft_path.exists() else None
    analysis_json = (
        analysis_path.read_text(encoding="utf-8") if analysis_path.exists() else None
    )
    return templates.TemplateResponse(
        request,
        "item.html",
        {
            "state": state,
            "draft_html": draft_html,
            "analysis_json": analysis_json,
            "heartbeat": _read_heartbeat(),
        },
    )


@app.post("/item/{item_id}/review")
def mark_reviewed(item_id: str):
    storage.update_state(
        item_id,
        status="reviewed",
        reviewed_at=datetime.now(timezone.utc).isoformat(),
    )
    return RedirectResponse(url="/", status_code=303)


@app.post("/item/{item_id}/reanalyze")
def reanalyze(item_id: str):
    item_dir = config.QUEUE_DIR / item_id
    # Back up existing draft to avoid clobbering manual edits
    draft = item_dir / "regrade_draft.md"
    if draft.exists():
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        shutil.move(str(draft), str(item_dir / f"regrade_draft.md.bak-{ts}"))
    storage.update_state(item_id, status="pending_analysis", error=None)
    return RedirectResponse(url=f"/item/{item_id}", status_code=303)
```

- [ ] **Step 3: Smoke test**

```bash
python -c "from gradescope_bot import serve; print('ok')"
```

Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add gradescope_bot/serve.py gradescope_bot/templates/item.html
git commit -m "Add item detail view with PDF embed, draft render, and review/reanalyze actions"
```

---

## Task 15: Live login and analyzer smoke tests (opt-in)

**Files:**
- Create: `tests/test_live_login.py`
- Create: `tests/test_live_pdf_download.py`
- Create: `tests/test_analyzer_smoke.py`

- [ ] **Step 1: Write `tests/test_live_login.py`**

```python
"""Live login test against real Gradescope. Opt-in via GS_LIVE=1."""
from __future__ import annotations

import os

import pytest

from gradescope_bot.gs_client import GSClient

pytestmark = pytest.mark.skipif(
    os.environ.get("GS_LIVE") != "1",
    reason="Set GS_LIVE=1 to run live Gradescope tests",
)


def test_live_login_and_list_courses() -> None:
    client = GSClient()
    client.login()
    courses = client.get_courses()
    assert "student" in courses
    assert isinstance(courses["student"], dict)
```

- [ ] **Step 2: Write `tests/test_live_pdf_download.py`**

```python
"""Live PDF download test. Opt-in via GS_LIVE=1 and GS_TEST_SUBMISSION env vars."""
from __future__ import annotations

import os

import pytest

from gradescope_bot.gs_client import GSClient

pytestmark = pytest.mark.skipif(
    os.environ.get("GS_LIVE") != "1",
    reason="Set GS_LIVE=1 to run live Gradescope tests",
)


def test_live_pdf_download_starts_with_pdf_magic() -> None:
    course_id = os.environ["GS_TEST_COURSE_ID"]
    assignment_id = os.environ["GS_TEST_ASSIGNMENT_ID"]
    submission_id = os.environ["GS_TEST_SUBMISSION_ID"]

    client = GSClient()
    client.login()
    content = client.download_submission_pdf(course_id, assignment_id, submission_id)

    assert content[:4] == b"%PDF"
    assert len(content) > 1000
```

- [ ] **Step 3: Write `tests/test_analyzer_smoke.py`**

```python
"""Real `claude -p` smoke test against the bundled sample PDF. Opt-in via CLAUDE_LIVE=1."""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

import pytest

from gradescope_bot import analyzer, storage

pytestmark = pytest.mark.skipif(
    os.environ.get("CLAUDE_LIVE") != "1",
    reason="Set CLAUDE_LIVE=1 to run real claude -p (~$1 per run)",
)


def test_analyze_real_sample_pdf(tmp_data_dir: Path, sample_pdf_path: Path) -> None:
    item_id = "test_sample"
    state = {
        "id": item_id,
        "title": "Sample (smoke test)",
        "course_id": "1222348",
        "assignment_id": "7841492",
        "submission_id": "398420660",
        "tags": ["course:18-100", "type:homework"],
        "score": None,
        "max_score": None,
        "due_date": None,
        "first_seen_local": None,
        "downloaded_at": None,
        "analyzed_at": None,
        "reviewed_at": None,
        "pdf_sha256": "abc",
        "status": "pending_analysis",
        "summary": "",
        "issue_count": 0,
        "error": None,
    }
    storage.write_state(item_id, state)
    shutil.copy(sample_pdf_path, storage.item_dir(item_id) / "submission.pdf")

    analyzer.analyze(item_id)

    final = storage.read_state(item_id)
    assert final["status"] in {"needs_review", "no_issues_found"}
    analysis = json.loads((storage.item_dir(item_id) / "analysis.json").read_text())
    assert analysis["overall_verdict"] in {"needs_review", "no_issues_found"}
    assert "issues" in analysis
```

- [ ] **Step 4: Verify opt-in tests are skipped by default**

```bash
pytest tests/test_live_login.py tests/test_live_pdf_download.py tests/test_analyzer_smoke.py -v
```

Expected: all tests SKIPPED with reason messages.

- [ ] **Step 5: Commit**

```bash
git add tests/test_live_login.py tests/test_live_pdf_download.py tests/test_analyzer_smoke.py
git commit -m "Add opt-in live integration tests gated on GS_LIVE and CLAUDE_LIVE"
```

---

## Task 16: README + manual QA checklist

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# Gradescope Regrade Bot

Personal bot that pulls graded assignments from Gradescope daily at 2 AM local time, analyzes them with Claude Code (`--effort max` on Opus) for reasonable regrade candidates, and serves a localhost dashboard for review.

**The bot never auto-submits regrade requests.** It only drafts them for you.

## Setup

1. Install dependencies:
   ```bash
   pip install -e ".[dev]"
   ```
2. Make sure `claude` (Claude Code CLI) is on your PATH:
   ```bash
   which claude && claude --version
   ```
3. Copy `.env.example` to `.env` and fill in your Gradescope credentials:
   ```bash
   cp .env.example .env
   $EDITOR .env
   ```
4. (Optional) Run unit tests:
   ```bash
   pytest
   ```

## Running

The bot has two processes. They share the `data/` directory on disk.

### Heartbeat daemon (always running)

Runs in the foreground, sleeps until 2 AM local time each day, fetches new graded submissions, and analyzes them with Claude Code.

```bash
python -m gradescope_bot.heartbeat
```

Or start a one-shot cycle (used for the initial 7-day backfill and manual runs):

```bash
python -m gradescope_bot.heartbeat --run-now
```

### Web dashboard (ad-hoc)

Start it when you want to look at the queue. Kill it when you're done.

```bash
uvicorn gradescope_bot.serve:app --host 127.0.0.1 --port 8765
```

Then visit [http://127.0.0.1:8765/](http://127.0.0.1:8765/).

## Manual QA checklist

Run through this after initial setup to verify the full pipeline:

1. `cp .env.example .env` and fill in credentials.
2. `python -m gradescope_bot.heartbeat --run-now`
3. Check `data/heartbeat.log` for a clean cycle.
4. Verify at least one folder exists under `data/queue/`.
5. `xdg-open data/queue/<first-item-id>/submission.pdf` — confirm PDF opens.
6. Check that `analysis.json` exists in the queue folder.
7. Start the server: `uvicorn gradescope_bot.serve:app --host 127.0.0.1 --port 8765`.
8. Visit `http://127.0.0.1:8765/`, verify items render, grouped by status.
9. Click into an item, verify the PDF iframe loads and the draft (if any) renders.
10. Click "Mark as reviewed" and verify the item moves to the Reviewed section.
11. Stop the server (Ctrl-C). Start the daemon: `python -m gradescope_bot.heartbeat`. Check the log shows the next wake time.

## Cost expectations

Based on smoke tests on 3 real graded PDFs (10, 12, 24 pages):

- Per-item analyzer cost: $0.93 – $1.73 (average ~$1.20)
- Daily steady-state (1-3 new items): $1-5/day
- Initial 7-day backfill (~20 items): one-time ~$25-30

## How it works

See the full design spec at `docs/superpowers/specs/2026-04-13-gradescope-regrade-bot-design.md`.
```

- [ ] **Step 2: Run the full test suite one last time**

```bash
pytest -v
```

Expected: all unit + subprocess tests PASS; live tests SKIPPED.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Add README with setup, run, and manual QA checklist"
```

---

## Task 17: End-to-end sanity check (live)

- [ ] **Step 1: Run the live login test**

```bash
GS_LIVE=1 pytest tests/test_live_login.py -v
```

Expected: PASS. If it fails with auth/CAPTCHA, stop and investigate — do not move on.

- [ ] **Step 2: Run one heartbeat cycle**

```bash
python -m gradescope_bot.heartbeat --run-now
```

Expected: `data/heartbeat.log` shows `Cycle start` → fetch counts → analyze counts → `Cycle end`. At least one queue folder is created under `data/queue/`.

- [ ] **Step 3: Verify the dashboard renders**

```bash
uvicorn gradescope_bot.serve:app --host 127.0.0.1 --port 8765 &
sleep 2
curl -s http://127.0.0.1:8765/ | grep -c "Gradescope Bot"
pkill -f "uvicorn gradescope_bot.serve"
```

Expected: grep count ≥ 1.

- [ ] **Step 4: Start the daemon and observe first sleep cycle**

```bash
timeout 10 python -m gradescope_bot.heartbeat || true
```

Expected: daemon logs "Sleeping N seconds until 2026-MM-DDT02:00:00..." and then exits via the timeout. `data/heartbeat_state.json` has a `next_scheduled_local` field pointing at the next 2 AM.

- [ ] **Step 5: Final commit (if needed)**

```bash
git status
# If any stray log/state files appeared, make sure .gitignore covers them; commit any fixes.
```

---

## Summary of task ordering

| # | Task | Depends on |
|---|---|---|
| 1 | Project scaffolding | — |
| 2 | Config module | 1 |
| 3 | Storage module | 2 |
| 4 | Rate limiter | 2 |
| 5 | GSClient login + session rate limiting | 2, 4 |
| 6 | Dashboard HTML parser | 5 |
| 7 | PDF download method | 5 |
| 8 | Fetcher pipeline | 3, 6, 7 |
| 9 | Prompt template | 2 |
| 10 | Analyzer subprocess wrapper | 3, 9 |
| 11 | Scheduler logic | 2 |
| 12 | Heartbeat daemon | 8, 10, 11 |
| 13 | FastAPI app + dashboard route | 3 |
| 14 | Item detail + actions | 13 |
| 15 | Live/smoke test scaffolding | 10, 14 |
| 16 | README + manual QA | all |
| 17 | End-to-end live sanity check | all |

Tasks 3/4, 6/7, 13/14 can run in parallel given their dependencies.

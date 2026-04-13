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

# Prescreen — cheap sonnet pass that decides whether the item has regradable
# content at all (skips auto-graded quizzes, submission-less items, etc.)
# Saves ~$1-2 per non-regradable item by avoiding the opus-max workflow.
CLAUDE_PRESCREEN_BINARY = os.environ.get("CLAUDE_PRESCREEN_BINARY", CLAUDE_BINARY)
CLAUDE_PRESCREEN_MODEL = "sonnet"
CLAUDE_PRESCREEN_EFFORT = "medium"
CLAUDE_PRESCREEN_MAX_TURNS = 6
CLAUDE_PRESCREEN_MAX_BUDGET_USD = 0.50
CLAUDE_PRESCREEN_TIMEOUT_SEC = 300
PRESCREEN_PROMPT = PROMPTS_DIR / "regrade_prescreen.md"

# ── Web UI ───────────────────────────────────────────────────────────────────
SERVER_HOST = "127.0.0.1"
SERVER_PORT = 8765

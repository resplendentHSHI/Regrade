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
DEV_MODE = os.environ.get("POKO_DEV_MODE", "0") == "1"
DEV_EMAIL = os.environ.get("POKO_DEV_EMAIL", "dev@poko.local")

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
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
NOTIFICATION_FROM_EMAIL = os.environ.get("NOTIFICATION_FROM_EMAIL", "Poko <onboarding@resend.dev>")

# ── Rate limits ────────────────────────────────────────────────────────
MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024  # 50 MB
JOBS_PER_USER_PER_DAY = 50
REQUESTS_PER_USER_PER_HOUR = 100
JOB_RESULT_RETENTION_DAYS = 7

# ── Server ─────────────────────────────────────────────────────────────
SERVER_HOST = os.environ.get("SERVER_HOST", "0.0.0.0")
SERVER_PORT = int(os.environ.get("SERVER_PORT", "8080"))

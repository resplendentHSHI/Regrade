"""Sidecar-specific config."""
from __future__ import annotations
from pathlib import Path

GS_BASE_URL = "https://www.gradescope.com"
GS_EMAIL = ""
GS_PASSWORD = ""

MIN_REQUEST_SPACING_SEC = 2.0
REQUEST_SPACING_JITTER_SEC = 0.5
PER_RUN_CAP = 50
DAILY_CAP = 150
BACKOFF_INITIAL_SEC = 30
BACKOFF_MAX_SEC = 480
BACKOFF_MAX_RETRIES = 5
HTTP_TIMEOUT_SEC = (60, 60)
BACKFILL_DAYS = 7
RATE_LIMIT_STATE = Path("/tmp/poko_rate_limit.json")

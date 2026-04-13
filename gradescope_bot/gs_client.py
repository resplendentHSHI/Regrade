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
        # GSConnection.login() populates self.account = Account(self.session, base_url)
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

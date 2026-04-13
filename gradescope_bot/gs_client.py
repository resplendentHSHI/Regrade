"""Thin wrapper over gradescopeapi's authenticated session with our rate limiter installed."""
from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

import requests
from bs4 import BeautifulSoup
from gradescopeapi.classes.connection import GSConnection

from gradescope_bot import config
from gradescope_bot.rate_limit import (
    DailyCapExhausted,
    RateLimiter,
    RatePerRunExhausted,
)

log = logging.getLogger(__name__)

_HREF_RE = re.compile(
    r"/courses/(?P<cid>\d+)/assignments/(?P<aid>\d+)(?:/submissions/(?P<sid>\d+))?"
)
_SCORE_RE = re.compile(r"([-\d.]+)\s*/\s*([\d.]+)")


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

    def fetch_course_dashboard(self, course_id: str) -> list[AssignmentRow]:
        url = f"{config.GS_BASE_URL}/courses/{course_id}"
        resp = self.session.get(url)
        resp.raise_for_status()
        return parse_course_dashboard(resp.text)

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

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

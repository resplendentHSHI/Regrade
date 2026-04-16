"""Fetch pipeline adapted for sidecar use — returns dicts, no storage dependency."""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Callable

import config
from gs_client import AssignmentRow, GSClient
from rate_limit import DailyCapExhausted, RatePerRunExhausted

log = logging.getLogger(__name__)


_CURRENT_SEMESTER_MONTHS = {
    "Spring": range(1, 6),   # Jan-May
    "Summer": range(6, 9),   # Jun-Aug
    "Fall":   range(9, 13),  # Sep-Dec
}


def _semester_matches_today(semester: str, year: int | str, now: datetime) -> bool:
    months = _CURRENT_SEMESTER_MONTHS.get(semester)
    if months is None:
        return False
    try:
        year_int = int(year)
    except (TypeError, ValueError):
        return False
    return year_int == now.year and now.month in months


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


def fetch_courses(
    client: GSClient,
    now_local: Callable[[], datetime] = lambda: datetime.now().astimezone(),
) -> list[dict]:
    """Return active-semester student courses as a list of dicts."""
    courses = client.get_courses()
    student_courses = courses.get("student", {})
    now = now_local()
    result = []
    for course_id, course in student_courses.items():
        semester = getattr(course, "semester", None)
        year = getattr(course, "year", None)
        if semester is None or year is None or not _semester_matches_today(semester, year, now):
            log.info("Skipping inactive course %s (%s %s)", course_id, semester, year)
            continue
        result.append({
            "id": str(course_id),
            "name": getattr(course, "name", ""),
            "semester": semester,
            "year": str(year),
        })
    return result


def fetch_upcoming(
    client: GSClient,
    course_ids: list[str],
    now_local: Callable[[], datetime] = lambda: datetime.now().astimezone(),
) -> list[dict]:
    """Return future ungraded assignments across the given courses."""
    now = now_local()
    result = []
    for course_id in course_ids:
        try:
            rows: list[AssignmentRow] = client.fetch_course_dashboard(course_id)
        except (RatePerRunExhausted, DailyCapExhausted):
            raise
        except Exception as e:
            log.warning("Dashboard fetch failed for %s: %s", course_id, e)
            continue

        for row in rows:
            if row.status == "graded":
                continue
            if row.due_date is not None and row.due_date <= now:
                continue
            result.append({
                "course_id": str(course_id),
                "assignment_id": row.assignment_id,
                "name": row.name,
                "status": row.status,
                "due_date": row.due_date.isoformat() if row.due_date else None,
            })
    return result


def list_graded(
    client: GSClient,
    course_ids: list[str],
) -> list[dict]:
    """List ALL graded assignments across courses (for manual selection UI).

    Does NOT download PDFs. Returns metadata only.
    """
    result = []
    for course_id in course_ids:
        try:
            rows: list[AssignmentRow] = client.fetch_course_dashboard(course_id)
        except (RatePerRunExhausted, DailyCapExhausted):
            raise
        except Exception as e:
            log.warning("Dashboard fetch failed for %s: %s", course_id, e)
            continue

        for row in rows:
            if row.status != "graded" or row.submission_id is None:
                continue
            result.append({
                "course_id": str(course_id),
                "assignment_id": row.assignment_id,
                "submission_id": row.submission_id,
                "name": row.name,
                "score": row.score,
                "max_score": row.max_score,
                "due_date": row.due_date.isoformat() if row.due_date else None,
                "type": _infer_type(row.name),
            })
    return result


def fetch_graded(
    client: GSClient,
    course_ids: list[str],
    data_dir: str | Path,
    already_processed_ids: list[str] | None = None,
    backfill_days: int | None = None,
    now_local: Callable[[], datetime] = lambda: datetime.now().astimezone(),
) -> dict:
    """Download graded PDFs that haven't been processed yet.

    Behavior:
      - Always skips assignments in already_processed_ids.
      - If backfill_days is set (e.g., 30 for initial backfill), also filters
        to assignments with due_date in the last N days OR due_date=None
        (exams, etc.). This prevents downloading an entire semester of old HWs.
      - If backfill_days is None (normal heartbeat), downloads ALL graded
        assignments not yet processed — catches newly graded items regardless
        of when they were due.

    Returns:
        {"items": [...], "scores": [...]}
    """
    processed_set = set(already_processed_ids or [])
    data_dir = Path(data_dir)
    now = now_local()
    cutoff = (now - timedelta(days=backfill_days)) if backfill_days else None
    items = []
    scores = []

    for course_id in course_ids:
        try:
            rows: list[AssignmentRow] = client.fetch_course_dashboard(course_id)
        except (RatePerRunExhausted, DailyCapExhausted):
            raise
        except Exception as e:
            log.warning("Dashboard fetch failed for %s: %s", course_id, e)
            continue

        for row in rows:
            # Record score for ALL graded assignments (for change detection)
            if row.status == "graded" and row.score is not None:
                scores.append({
                    "course_id": str(course_id),
                    "assignment_id": row.assignment_id,
                    "score": row.score,
                    "max_score": row.max_score,
                })

            if row.status != "graded" or row.submission_id is None:
                continue

            item_id = _make_item_id(course_id, row.assignment_id)

            # Skip already-processed assignments
            if item_id in processed_set:
                log.debug("Skipping already-processed %s (%s)", item_id, row.name)
                continue

            # For backfill: only include items with recent due dates or no due date
            if cutoff is not None and row.due_date is not None and row.due_date < cutoff:
                log.debug("Skipping %s (%s): due %s before backfill cutoff",
                          item_id, row.name, row.due_date.isoformat())
                continue

            # Download the PDF
            try:
                pdf_bytes = client.download_submission_pdf(
                    course_id, row.assignment_id, row.submission_id
                )
            except (RatePerRunExhausted, DailyCapExhausted):
                raise
            except Exception as e:
                log.warning("PDF download failed for %s: %s", item_id, e)
                continue

            item_dir = data_dir / item_id
            item_dir.mkdir(parents=True, exist_ok=True)
            pdf_path = item_dir / "submission.pdf"
            pdf_path.write_bytes(pdf_bytes)

            sha = hashlib.sha256(pdf_bytes).hexdigest()
            items.append({
                "course_id": str(course_id),
                "assignment_id": row.assignment_id,
                "submission_id": row.submission_id,
                "name": row.name,
                "score": row.score,
                "max_score": row.max_score,
                "due_date": row.due_date.isoformat() if row.due_date else None,
                "type": _infer_type(row.name),
                "pdf_hash": sha,
                "pdf_path": str(pdf_path),
            })
            log.info("Downloaded %s (%s)", item_id, row.name)

    return {"items": items, "scores": scores}


def fetch_specific(
    client: GSClient,
    assignments: list[dict],
    data_dir: str | Path,
) -> dict:
    """Download specific assignments by ID (for manual selection).

    Args:
        assignments: List of {"course_id": str, "assignment_id": str, "submission_id": str, ...}
        data_dir: Directory to write PDFs.

    Returns:
        {"items": [...]}
    """
    data_dir = Path(data_dir)
    items = []

    for a in assignments:
        course_id = a["course_id"]
        assignment_id = a["assignment_id"]
        submission_id = a["submission_id"]
        item_id = _make_item_id(course_id, assignment_id)

        try:
            pdf_bytes = client.download_submission_pdf(course_id, assignment_id, submission_id)
        except (RatePerRunExhausted, DailyCapExhausted):
            raise
        except Exception as e:
            log.warning("PDF download failed for %s: %s", item_id, e)
            continue

        item_dir = data_dir / item_id
        item_dir.mkdir(parents=True, exist_ok=True)
        pdf_path = item_dir / "submission.pdf"
        pdf_path.write_bytes(pdf_bytes)

        sha = hashlib.sha256(pdf_bytes).hexdigest()
        items.append({
            **a,
            "pdf_hash": sha,
            "pdf_path": str(pdf_path),
        })

    return {"items": items}

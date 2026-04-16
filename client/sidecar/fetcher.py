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
            # Only include non-graded assignments with a future due date
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


def fetch_graded(
    client: GSClient,
    course_ids: list[str],
    data_dir: str | Path,
    existing_hashes: list[str] | None = None,
    now_local: Callable[[], datetime] = lambda: datetime.now().astimezone(),
) -> dict:
    """Download new graded PDFs. Returns {"items": [...], "scores": [...]}.

    Args:
        client: Logged-in GSClient.
        course_ids: List of course ID strings to process.
        data_dir: Directory to write PDFs into (organized by item_id).
        existing_hashes: Map of item_id -> pdf_sha256 for already-downloaded items.
            Items present here are skipped.

    Returns:
        {
            "items": [
                {
                    "course_id": str,
                    "assignment_id": str,
                    "submission_id": str,
                    "name": str,
                    "score": float | null,
                    "max_score": float | null,
                    "due_date": str | null,
                    "type": str,
                    "pdf_hash": str,
                    "pdf_path": str,
                }
            ],
            "scores": [
                {
                    "course_id": str,
                    "assignment_id": str,
                    "score": float | null,
                    "max_score": float | null,
                }
            ],
        }
    """
    existing_hashes_set = set(existing_hashes or [])

    data_dir = Path(data_dir)
    now = now_local()
    cutoff = now - timedelta(days=config.BACKFILL_DAYS)
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
            if row.status != "graded" or row.submission_id is None:
                continue
            if row.due_date is not None and row.due_date < cutoff:
                log.debug(
                    "Skipping %s (%s): due %s before cutoff %s",
                    row.assignment_id, row.name, row.due_date.isoformat(), cutoff.isoformat(),
                )
                continue

            item_id = _make_item_id(course_id, row.assignment_id)

            # Record the score regardless of whether we download the PDF
            scores.append({
                "course_id": str(course_id),
                "assignment_id": row.assignment_id,
                "score": row.score,
                "max_score": row.max_score,
            })

            item: dict = {
                "course_id": str(course_id),
                "assignment_id": row.assignment_id,
                "submission_id": row.submission_id,
                "name": row.name,
                "score": row.score,
                "max_score": row.max_score,
                "due_date": row.due_date.isoformat() if row.due_date else None,
                "type": _infer_type(row.name),
                "pdf_hash": None,
                "pdf_path": None,
            }

            try:
                pdf_bytes = client.download_submission_pdf(
                    course_id, row.assignment_id, row.submission_id
                )
            except (RatePerRunExhausted, DailyCapExhausted):
                raise
            except Exception as e:
                log.warning("PDF download failed for %s: %s", item_id, e)
                log.warning("Skipping %s due to download error", item_id)
                continue

            item_dir = data_dir / item_id
            item_dir.mkdir(parents=True, exist_ok=True)
            pdf_path = item_dir / "submission.pdf"
            pdf_path.write_bytes(pdf_bytes)

            sha = hashlib.sha256(pdf_bytes).hexdigest()
            if sha in existing_hashes_set:
                log.debug("Skipping already-known hash %s for %s", sha[:8], item_id)
                pdf_path.unlink(missing_ok=True)
                continue
            item["pdf_path"] = str(pdf_path)
            item["pdf_hash"] = sha
            items.append(item)
            log.info("Downloaded %s (%s)", item_id, row.name)

    return {"items": items, "scores": scores}

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


def test_fetcher_accepts_string_year_from_gradescopeapi_library(tmp_data_dir: Path) -> None:
    """gradescopeapi's Course dataclass types year as str; the filter must coerce."""
    courses = {"1222348": FakeCourse("1222348", "18-100: ECE", "2026", "Spring")}  # year is str
    row = AssignmentRow(
        assignment_id="7453474", submission_id="381362479", name="Homework 1",
        score=10.0, max_score=10.0, due_date=None, status="graded",
    )
    dashboards = {"1222348": [row]}
    pdfs = {("1222348", "7453474", "381362479"): b"%PDF-1.4\nx\n"}
    client = _fake_client(courses, dashboards, pdfs)

    fetcher.run_fetch_phase(client, now_local=lambda: datetime(2026, 4, 13, 2, 0, 0))

    assert storage.read_state("1222348_7453474") is not None, (
        "String year should coerce to int and be treated as active"
    )


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

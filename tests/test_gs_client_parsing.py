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
        # score can exceed max_score when extra credit is awarded
        assert row.score >= 0
        assert row.max_score >= 0


def test_parse_extracts_assignment_name(dashboard_html: str) -> None:
    rows = parse_course_dashboard(dashboard_html)
    graded = [r for r in rows if r.status == "graded"]
    names = [r.name for r in graded]
    # At least one assignment should have a recognizable keyword in its name
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

"""Tests for state.json round-trip and queue scanning."""
from __future__ import annotations

from pathlib import Path

import pytest

from gradescope_bot import storage


def _make_state(item_id: str, status: str = "pending_analysis", issue_count: int = 0) -> dict:
    return {
        "id": item_id,
        "title": "Homework 1",
        "course_id": "1222348",
        "assignment_id": "7453474",
        "submission_id": "381362479",
        "tags": ["course:18-100", "type:homework"],
        "score": 8.0,
        "max_score": 10.0,
        "due_date": None,
        "first_seen_local": "2026-04-13T02:00:00-04:00",
        "downloaded_at": None,
        "analyzed_at": None,
        "reviewed_at": None,
        "pdf_sha256": None,
        "status": status,
        "summary": "",
        "issue_count": issue_count,
        "error": None,
    }


def test_write_and_read_state_roundtrip(tmp_data_dir: Path) -> None:
    state = _make_state("1222348_7453474")
    storage.write_state("1222348_7453474", state)

    loaded = storage.read_state("1222348_7453474")

    assert loaded == state


def test_list_items_returns_all_queue_folders(tmp_data_dir: Path) -> None:
    storage.write_state("1222348_1", _make_state("1222348_1", status="needs_review", issue_count=2))
    storage.write_state("1222348_2", _make_state("1222348_2", status="no_issues_found"))
    storage.write_state("1222348_3", _make_state("1222348_3", status="pending_analysis"))

    items = storage.list_items()

    assert {i["id"] for i in items} == {"1222348_1", "1222348_2", "1222348_3"}


def test_list_items_filters_by_status(tmp_data_dir: Path) -> None:
    storage.write_state("1222348_1", _make_state("1222348_1", status="needs_review", issue_count=1))
    storage.write_state("1222348_2", _make_state("1222348_2", status="no_issues_found"))

    needs_review = storage.list_items(status="needs_review")

    assert len(needs_review) == 1
    assert needs_review[0]["id"] == "1222348_1"


def test_update_state_merges_fields(tmp_data_dir: Path) -> None:
    storage.write_state("1222348_1", _make_state("1222348_1"))

    storage.update_state("1222348_1", status="needs_review", issue_count=3, summary="test")

    loaded = storage.read_state("1222348_1")
    assert loaded["status"] == "needs_review"
    assert loaded["issue_count"] == 3
    assert loaded["summary"] == "test"
    assert loaded["title"] == "Homework 1"  # untouched


def test_item_dir_creates_folder(tmp_data_dir: Path) -> None:
    d = storage.item_dir("1222348_7453474")
    assert d.exists()
    assert d.is_dir()
    assert d.name == "1222348_7453474"


def test_read_state_returns_none_for_missing(tmp_data_dir: Path) -> None:
    assert storage.read_state("does_not_exist") is None


def test_list_items_skips_corrupt_folders(tmp_data_dir: Path, caplog: pytest.LogCaptureFixture) -> None:
    storage.write_state("good_1", _make_state("good_1"))
    # Create a queue subfolder with no state.json
    (tmp_data_dir / "queue" / "bad_1").mkdir()

    items = storage.list_items()

    assert len(items) == 1
    assert items[0]["id"] == "good_1"

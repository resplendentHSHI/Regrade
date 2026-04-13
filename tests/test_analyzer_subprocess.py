"""Tests for the analyzer subprocess wrapper using real shell-script doubles."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from gradescope_bot import analyzer, config, storage


FAKE_DIR = Path(__file__).parent / "fixtures" / "fake_claude"


def _seed_item(tmp_data_dir: Path, item_id: str) -> Path:
    state = {
        "id": item_id,
        "title": "HW 1",
        "course_id": "1222348",
        "assignment_id": "7453474",
        "submission_id": "381362479",
        "tags": [],
        "score": 8.0,
        "max_score": 10.0,
        "due_date": None,
        "first_seen_local": "2026-04-13T02:00:00-04:00",
        "downloaded_at": "2026-04-13T02:00:05-04:00",
        "analyzed_at": None,
        "reviewed_at": None,
        "pdf_sha256": "abc",
        "status": "pending_analysis",
        "summary": "",
        "issue_count": 0,
        "error": None,
    }
    storage.write_state(item_id, state)
    # Real PDF must exist so --add-dir has something
    d = storage.item_dir(item_id)
    (d / "submission.pdf").write_bytes(b"%PDF-1.4\ndummy\n")
    return d


def test_analyze_success_sets_needs_review(
    tmp_data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(config, "CLAUDE_BINARY", str(FAKE_DIR / "fake_claude_ok.sh"))
    _seed_item(tmp_data_dir, "1222348_7453474")

    analyzer.analyze("1222348_7453474")

    state = storage.read_state("1222348_7453474")
    assert state["status"] == "needs_review"
    assert state["issue_count"] == 1
    assert "Synthetic" in state["summary"]
    assert state["analyzed_at"] is not None


def test_analyze_failure_sets_analysis_failed(
    tmp_data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(config, "CLAUDE_BINARY", str(FAKE_DIR / "fake_claude_fail.sh"))
    _seed_item(tmp_data_dir, "1222348_7453474")

    analyzer.analyze("1222348_7453474")

    state = storage.read_state("1222348_7453474")
    assert state["status"] == "analysis_failed"
    assert state["error"] is not None


def test_analyze_timeout_sets_analysis_failed(
    tmp_data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(config, "CLAUDE_BINARY", str(FAKE_DIR / "fake_claude_slow.sh"))
    monkeypatch.setattr(config, "CLAUDE_TIMEOUT_SEC", 2)  # force fast timeout
    _seed_item(tmp_data_dir, "1222348_7453474")

    analyzer.analyze("1222348_7453474")

    state = storage.read_state("1222348_7453474")
    assert state["status"] == "analysis_failed"
    assert "timed out" in state["error"].lower()


def test_analyze_malformed_json_sets_analysis_failed(
    tmp_data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(config, "CLAUDE_BINARY", str(FAKE_DIR / "fake_claude_malformed.sh"))
    _seed_item(tmp_data_dir, "1222348_7453474")

    analyzer.analyze("1222348_7453474")

    state = storage.read_state("1222348_7453474")
    assert state["status"] == "analysis_failed"
    assert "json" in state["error"].lower()

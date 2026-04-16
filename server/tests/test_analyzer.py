"""Tests for the server-side analyzer (subprocess-based, using shell script fakes)."""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from poko_server import config

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture()
def job_dir(tmp_data_dir: Path) -> Path:
    d = config.UPLOAD_DIR / "test-job"
    d.mkdir(parents=True, exist_ok=True)
    pdf_bytes = (FIXTURES / "sample.pdf").read_bytes()
    (d / "submission.pdf").write_bytes(pdf_bytes)
    return d


def test_analyze_with_prescreen_yes_and_full_pass(job_dir):
    from poko_server.analyzer import analyze_job
    with patch.object(config, "CLAUDE_PRESCREEN_BINARY", str(FIXTURES / "fake_prescreen_yes.sh")), \
         patch.object(config, "CLAUDE_BINARY", str(FIXTURES / "fake_claude_ok.sh")):
        result = analyze_job("test-job", job_dir)
    assert result["status"] == "complete"
    assert result["kept_issue_count"] == 1
    assert result["draft_md"] is not None
    assert "Clairaut" in result["draft_md"]
    parsed = json.loads(result["result_json"])
    assert parsed["issues"][0]["confidence_tier"] == "critical"


def test_analyze_with_prescreen_no(job_dir):
    from poko_server.analyzer import analyze_job
    with patch.object(config, "CLAUDE_PRESCREEN_BINARY", str(FIXTURES / "fake_prescreen_no.sh")):
        result = analyze_job("test-job", job_dir)
    assert result["status"] == "complete"
    assert result["kept_issue_count"] == 0
    assert result["result_json"] is not None
    parsed = json.loads(result["result_json"])
    assert parsed["overall_verdict"] == "no_issues_found"


def test_analyze_with_failed_subprocess(job_dir):
    from poko_server.analyzer import analyze_job
    with patch.object(config, "CLAUDE_PRESCREEN_BINARY", str(FIXTURES / "fake_prescreen_yes.sh")), \
         patch.object(config, "CLAUDE_BINARY", str(FIXTURES / "fake_claude_fail.sh")):
        result = analyze_job("test-job", job_dir)
    assert result["status"] == "failed"
    assert result["error"] is not None


def test_analyze_missing_pdf(tmp_data_dir):
    from poko_server.analyzer import analyze_job
    empty_dir = config.UPLOAD_DIR / "no-pdf-job"
    empty_dir.mkdir(parents=True, exist_ok=True)
    result = analyze_job("no-pdf-job", empty_dir)
    assert result["status"] == "failed"
    assert "missing" in result["error"].lower()

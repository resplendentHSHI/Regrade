"""Real `claude -p` smoke test against the bundled sample PDF. Opt-in via CLAUDE_LIVE=1."""
from __future__ import annotations

import json
import os
import shutil
from pathlib import Path

import pytest

from gradescope_bot import analyzer, storage

pytestmark = pytest.mark.skipif(
    os.environ.get("CLAUDE_LIVE") != "1",
    reason="Set CLAUDE_LIVE=1 to run real claude -p (~$1 per run)",
)


def test_analyze_real_sample_pdf(tmp_data_dir: Path, sample_pdf_path: Path) -> None:
    item_id = "test_sample"
    state = {
        "id": item_id,
        "title": "Sample (smoke test)",
        "course_id": "1222348",
        "assignment_id": "7841492",
        "submission_id": "398420660",
        "tags": ["course:18-100", "type:homework"],
        "score": None,
        "max_score": None,
        "due_date": None,
        "first_seen_local": None,
        "downloaded_at": None,
        "analyzed_at": None,
        "reviewed_at": None,
        "pdf_sha256": "abc",
        "status": "pending_analysis",
        "summary": "",
        "issue_count": 0,
        "error": None,
    }
    storage.write_state(item_id, state)
    shutil.copy(sample_pdf_path, storage.item_dir(item_id) / "submission.pdf")

    analyzer.analyze(item_id)

    final = storage.read_state(item_id)
    assert final["status"] in {"needs_review", "no_issues_found"}
    analysis = json.loads((storage.item_dir(item_id) / "analysis.json").read_text())
    assert analysis["overall_verdict"] in {"needs_review", "no_issues_found"}
    assert "issues" in analysis

"""Analyzer: invoke `claude -p` on a queue item and parse the resulting verdict."""
from __future__ import annotations

import json
import logging
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from gradescope_bot import config, storage

log = logging.getLogger(__name__)


PRESCREEN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["has_regradable_content", "reason"],
    "additionalProperties": False,
    "properties": {
        "has_regradable_content": {"type": "boolean"},
        "reason": {"type": "string"},
    },
}


VERDICT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": [
        "item_id", "model", "overall_verdict", "summary", "issues", "kept_issue_count",
    ],
    "additionalProperties": False,
    "properties": {
        "item_id": {"type": "string"},
        "model": {"type": "string"},
        "overall_verdict": {"type": "string", "enum": ["needs_review", "no_issues_found"]},
        "summary": {"type": "string"},
        "issues": {
            "type": "array",
            "items": {
                "type": "object",
                "required": [
                    "question", "category", "severity", "rubric_item_cited",
                    "points_disputed", "reasoning", "keep",
                ],
                "additionalProperties": False,
                "properties": {
                    "question": {"type": "string"},
                    "category": {
                        "type": "string",
                        "enum": [
                            "arithmetic_mismatch", "rubric_misapplication",
                            "missed_correct_work", "unclear_deduction",
                            "partial_credit_too_low",
                        ],
                    },
                    "severity": {"type": "string", "enum": ["low", "medium", "high"]},
                    "rubric_item_cited": {"type": "string"},
                    "points_disputed": {"type": "number"},
                    "reasoning": {"type": "string"},
                    "keep": {"type": "boolean"},
                },
            },
        },
        "kept_issue_count": {"type": "integer", "minimum": 0},
    },
}


def _render_prompt(item_id: str, item_dir: Path, pdf_pages: int) -> str:
    template = config.REGRADE_PROMPT.read_text(encoding="utf-8")
    return template.format(
        pdf_path=str(item_dir / "submission.pdf"),
        pdf_pages=pdf_pages,
        output_path=str(item_dir / "analysis.json"),
        draft_path=str(item_dir / "regrade_draft.md"),
        item_id=item_id,
    )


def _render_prescreen_prompt(item_dir: Path, pdf_pages: int) -> str:
    template = config.PRESCREEN_PROMPT.read_text(encoding="utf-8")
    return template.format(
        pdf_path=str(item_dir / "submission.pdf"),
        pdf_pages=pdf_pages,
        output_path=str(item_dir / "prescreen.json"),
    )


def _prescreen(item_id: str, item_dir: Path, pdf_pages: int) -> tuple[bool, str]:
    """Run a cheap sonnet pass to decide if the item has regradable content.

    Returns (has_regradable_content, reason). On any error, returns (True, reason)
    so the main analyzer still runs — we'd rather over-check than skip.
    """
    prompt = _render_prescreen_prompt(item_dir, pdf_pages)
    cmd = [
        config.CLAUDE_PRESCREEN_BINARY, "-p", prompt,
        "--model", config.CLAUDE_PRESCREEN_MODEL,
        "--effort", config.CLAUDE_PRESCREEN_EFFORT,
        "--output-format", "json",
        "--json-schema", json.dumps(PRESCREEN_SCHEMA),
        "--permission-mode", "acceptEdits",
        "--add-dir", str(item_dir),
        "--max-turns", str(config.CLAUDE_PRESCREEN_MAX_TURNS),
        "--max-budget-usd", str(config.CLAUDE_PRESCREEN_MAX_BUDGET_USD),
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=config.CLAUDE_PRESCREEN_TIMEOUT_SEC,
        )
    except subprocess.TimeoutExpired:
        log.warning("Prescreen timed out for %s; proceeding to full analyzer", item_id)
        return True, "prescreen timed out, running full analysis"

    if result.returncode != 0:
        log.warning("Prescreen failed for %s (exit %s); proceeding to full analyzer",
                    item_id, result.returncode)
        return True, f"prescreen exit {result.returncode}, running full analysis"

    prescreen_path = item_dir / "prescreen.json"
    if not prescreen_path.exists():
        log.warning("Prescreen wrote no file for %s; proceeding to full analyzer", item_id)
        return True, "prescreen output missing, running full analysis"

    try:
        verdict = json.loads(prescreen_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        log.warning("Prescreen JSON invalid for %s: %s; proceeding to full analyzer",
                    item_id, e)
        return True, f"prescreen invalid JSON, running full analysis"

    has = bool(verdict.get("has_regradable_content", True))
    reason = str(verdict.get("reason", ""))
    return has, reason


def _count_pdf_pages(pdf_path: Path) -> int:
    """Best-effort page count. Uses pdfinfo if available, else returns 10."""
    try:
        result = subprocess.run(
            ["pdfinfo", str(pdf_path)], capture_output=True, text=True, timeout=10
        )
        for line in result.stdout.splitlines():
            if line.startswith("Pages:"):
                return int(line.split()[1])
    except (FileNotFoundError, subprocess.TimeoutExpired, ValueError):
        pass
    return 10


def _now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def analyze(item_id: str) -> None:
    """Run `claude -p` on one queue item and update its state.json.

    Two-stage flow:
      1. Cheap sonnet prescreen: does this PDF have regradable content at all?
         If no, short-circuit to no_issues_found without invoking opus.
      2. Full opus --effort max workflow (reads PDF, writes analysis.json + draft).
    """
    item_dir = storage.item_dir(item_id)
    pdf_path = item_dir / "submission.pdf"
    if not pdf_path.exists():
        storage.update_state(item_id, status="analysis_failed", error="submission.pdf missing")
        return

    pages = _count_pdf_pages(pdf_path)

    # Stage 1: prescreen
    has_content, prescreen_reason = _prescreen(item_id, item_dir, pages)
    if not has_content:
        log.info("Prescreen short-circuit for %s: %s", item_id, prescreen_reason)
        storage.update_state(
            item_id,
            status="no_issues_found",
            summary=f"Prescreen skipped deep analysis: {prescreen_reason}",
            issue_count=0,
            analyzed_at=_now_utc_iso(),
            error=None,
        )
        return

    # Stage 2: full analyzer
    prompt = _render_prompt(item_id, item_dir, pages)

    cmd = [
        config.CLAUDE_BINARY, "-p", prompt,
        "--model", config.CLAUDE_MODEL,
        "--effort", config.CLAUDE_EFFORT,
        "--output-format", "json",
        "--json-schema", json.dumps(VERDICT_SCHEMA),
        "--permission-mode", "acceptEdits",
        "--add-dir", str(item_dir),
        "--max-turns", str(config.CLAUDE_MAX_TURNS),
        "--max-budget-usd", str(config.CLAUDE_MAX_BUDGET_USD),
    ]

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=config.CLAUDE_TIMEOUT_SEC,
        )
    except subprocess.TimeoutExpired:
        storage.update_state(
            item_id,
            status="analysis_failed",
            error=f"claude -p timed out after {config.CLAUDE_TIMEOUT_SEC}s",
        )
        return

    if result.returncode != 0:
        storage.update_state(
            item_id,
            status="analysis_failed",
            error=f"claude -p exit {result.returncode}: {result.stderr[:1000]}",
        )
        return

    analysis_path = item_dir / "analysis.json"
    if not analysis_path.exists():
        storage.update_state(
            item_id,
            status="analysis_failed",
            error="analysis.json not written",
        )
        return

    try:
        verdict = json.loads(analysis_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        storage.update_state(
            item_id,
            status="analysis_failed",
            error=f"analysis.json invalid JSON: {e}",
        )
        return

    kept = int(verdict.get("kept_issue_count", 0))
    storage.update_state(
        item_id,
        status="needs_review" if kept > 0 else "no_issues_found",
        summary=verdict.get("summary", ""),
        issue_count=kept,
        analyzed_at=_now_utc_iso(),
        error=None,
    )


def run_analyze_phase() -> dict[str, int]:
    """Analyze all items with status=pending_analysis. Returns counters."""
    counters = {"analyzed_ok": 0, "needs_review": 0, "no_issues_found": 0, "failed": 0}
    items = storage.list_items(status="pending_analysis")
    for item in items:
        analyze(item["id"])
        state = storage.read_state(item["id"])
        if state is None:
            continue
        if state["status"] == "needs_review":
            counters["needs_review"] += 1
            counters["analyzed_ok"] += 1
        elif state["status"] == "no_issues_found":
            counters["no_issues_found"] += 1
            counters["analyzed_ok"] += 1
        else:
            counters["failed"] += 1
    return counters

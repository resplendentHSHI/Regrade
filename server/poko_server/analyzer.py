"""Analyzer: invoke claude subprocess on a job directory and return a result dict.

Two-stage flow:
  1. Cheap sonnet prescreen: does this PDF have regradable content at all?
     If no, short-circuit to no_issues_found without invoking opus.
  2. Full opus --effort max workflow (reads PDF, writes analysis.json + draft).

Key differences from gradescope_bot/analyzer.py:
- No dependency on gradescope_bot.storage — takes job_dir: Path directly.
- Adds confidence_tier field to VERDICT_SCHEMA issues.
- Returns a result dict instead of updating storage.
"""
from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path
from typing import Any

from poko_server import config

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
                    "question", "category", "severity", "confidence_tier",
                    "rubric_item_cited", "points_disputed", "reasoning", "keep",
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
                    "confidence_tier": {
                        "type": "string",
                        "enum": ["critical", "strong", "marginal"],
                    },
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


def _render_prompt(template_path: Path, **kwargs: Any) -> str:
    """Read template and substitute keyword arguments."""
    template = template_path.read_text(encoding="utf-8")
    return template.format(**kwargs)


def _run_prescreen(job_dir: Path, pdf_pages: int) -> tuple[bool, str]:
    """Run a cheap sonnet pass to decide if the item has regradable content.

    Returns (has_regradable_content, reason). On any error, returns (True, reason)
    so the main analyzer still runs — we'd rather over-check than skip.
    """
    prompt = _render_prompt(
        config.PRESCREEN_PROMPT,
        pdf_path=str(job_dir / "submission.pdf"),
        pdf_pages=pdf_pages,
        output_path=str(job_dir / "prescreen.json"),
    )
    cmd = [
        config.CLAUDE_PRESCREEN_BINARY, "-p", prompt,
        "--model", config.CLAUDE_PRESCREEN_MODEL,
        "--effort", config.CLAUDE_PRESCREEN_EFFORT,
        "--output-format", "json",
        "--json-schema", json.dumps(PRESCREEN_SCHEMA),
        "--permission-mode", "acceptEdits",
        "--add-dir", str(job_dir),
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
        log.warning("Prescreen timed out; proceeding to full analyzer")
        return True, "prescreen timed out, running full analysis"

    if result.returncode != 0:
        log.warning("Prescreen failed (exit %s); proceeding to full analyzer", result.returncode)
        return True, f"prescreen exit {result.returncode}, running full analysis"

    prescreen_path = job_dir / "prescreen.json"
    if not prescreen_path.exists():
        log.warning("Prescreen wrote no file; proceeding to full analyzer")
        return True, "prescreen output missing, running full analysis"

    try:
        verdict = json.loads(prescreen_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        log.warning("Prescreen JSON invalid: %s; proceeding to full analyzer", e)
        return True, "prescreen invalid JSON, running full analysis"

    has = bool(verdict.get("has_regradable_content", True))
    reason = str(verdict.get("reason", ""))
    return has, reason


def analyze_job(job_id: str, job_dir: Path) -> dict[str, Any]:
    """Run the two-stage analyzer on a job directory.

    Returns a dict with keys:
      status: "complete" | "failed"
      result_json: JSON string of the verdict (or None on failure)
      draft_md: string content of regrade_draft.md (or None)
      kept_issue_count: int
      error: error message string (or None)
    """
    pdf_path = job_dir / "submission.pdf"
    if not pdf_path.exists():
        return {
            "status": "failed",
            "result_json": None,
            "draft_md": None,
            "kept_issue_count": 0,
            "error": "submission.pdf missing",
        }

    pages = _count_pdf_pages(pdf_path)

    # Stage 1: prescreen
    has_content, prescreen_reason = _run_prescreen(job_dir, pages)
    if not has_content:
        log.info("Prescreen short-circuit for %s: %s", job_id, prescreen_reason)
        no_issues_verdict = {
            "item_id": job_id,
            "model": "prescreen",
            "overall_verdict": "no_issues_found",
            "summary": f"Prescreen skipped deep analysis: {prescreen_reason}",
            "issues": [],
            "kept_issue_count": 0,
        }
        return {
            "status": "complete",
            "result_json": json.dumps(no_issues_verdict),
            "draft_md": None,
            "kept_issue_count": 0,
            "error": None,
        }

    # Stage 2: full analyzer
    prompt = _render_prompt(
        config.REGRADE_PROMPT,
        pdf_path=str(pdf_path),
        pdf_pages=pages,
        output_path=str(job_dir / "analysis.json"),
        draft_path=str(job_dir / "regrade_draft.md"),
        item_id=job_id,
    )

    cmd = [
        config.CLAUDE_BINARY, "-p", prompt,
        "--model", config.CLAUDE_MODEL,
        "--effort", config.CLAUDE_EFFORT,
        "--output-format", "json",
        "--json-schema", json.dumps(VERDICT_SCHEMA),
        "--permission-mode", "acceptEdits",
        "--add-dir", str(job_dir),
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
        return {
            "status": "failed",
            "result_json": None,
            "draft_md": None,
            "kept_issue_count": 0,
            "error": f"claude -p timed out after {config.CLAUDE_TIMEOUT_SEC}s",
        }

    if result.returncode != 0:
        return {
            "status": "failed",
            "result_json": None,
            "draft_md": None,
            "kept_issue_count": 0,
            "error": f"claude -p exit {result.returncode}: {result.stderr[:1000]}",
        }

    analysis_path = job_dir / "analysis.json"
    if not analysis_path.exists():
        return {
            "status": "failed",
            "result_json": None,
            "draft_md": None,
            "kept_issue_count": 0,
            "error": "analysis.json not written",
        }

    try:
        verdict = json.loads(analysis_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        return {
            "status": "failed",
            "result_json": None,
            "draft_md": None,
            "kept_issue_count": 0,
            "error": f"analysis.json invalid JSON: {e}",
        }

    kept = int(verdict.get("kept_issue_count", 0))

    draft_md: str | None = None
    draft_path = job_dir / "regrade_draft.md"
    if draft_path.exists():
        draft_md = draft_path.read_text(encoding="utf-8")

    return {
        "status": "complete",
        "result_json": analysis_path.read_text(encoding="utf-8"),
        "draft_md": draft_md,
        "kept_issue_count": kept,
        "error": None,
    }

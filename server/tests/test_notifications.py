"""Tests for email notifications."""
from __future__ import annotations

import json
from unittest.mock import patch, MagicMock

import pytest

from poko_server.notifications import should_notify, build_email_body, send_notification


def _make_result_json(issues):
    return json.dumps({
        "item_id": "test", "model": "opus", "overall_verdict": "needs_review",
        "summary": "Found issues.",
        "issues": issues,
        "kept_issue_count": len([i for i in issues if i.get("keep")]),
    })


def test_should_notify_critical_issues():
    result = _make_result_json([
        {"question": "Q3", "category": "rubric_misapplication", "severity": "high",
         "confidence_tier": "critical", "rubric_item_cited": "X",
         "points_disputed": 4, "reasoning": "Wrong.", "keep": True}
    ])
    assert should_notify(result) is True


def test_should_not_notify_strong_only():
    result = _make_result_json([
        {"question": "Q3", "category": "rubric_misapplication", "severity": "medium",
         "confidence_tier": "strong", "rubric_item_cited": "X",
         "points_disputed": 2, "reasoning": "Maybe.", "keep": True}
    ])
    assert should_notify(result) is False


def test_should_not_notify_no_issues():
    result = json.dumps({
        "item_id": "test", "model": "prescreen",
        "overall_verdict": "no_issues_found", "summary": "Clean.",
        "issues": [], "kept_issue_count": 0,
    })
    assert should_notify(result) is False


def test_build_email_body():
    result = _make_result_json([
        {"question": "Q3", "category": "rubric_misapplication", "severity": "high",
         "confidence_tier": "critical", "rubric_item_cited": "Clairaut's theorem",
         "points_disputed": 4, "reasoning": "Conditions stated correctly.", "keep": True}
    ])
    body = build_email_body("alice@gmail.com", "HW7", "MATH 268", result)
    assert "Poko" in body
    assert "Q3" in body
    assert "+4" in body
    assert "MATH 268" in body


def test_send_notification_calls_resend():
    with patch("poko_server.notifications.resend.Emails.send") as mock_send, \
         patch("poko_server.notifications.config.RESEND_API_KEY", "re_test_key"), \
         patch("poko_server.notifications.config.NOTIFICATION_FROM_EMAIL", "Poko <test@resend.dev>"):
        send_notification("alice@gmail.com", "Test Subject", "Test body")

    mock_send.assert_called_once()
    call_args = mock_send.call_args[0][0]
    assert call_args["to"] == ["alice@gmail.com"]
    assert call_args["subject"] == "Test Subject"
    assert call_args["text"] == "Test body"


def test_send_notification_skips_when_no_key():
    with patch("poko_server.notifications.config.RESEND_API_KEY", ""):
        result = send_notification("alice@gmail.com", "Test", "Body")
    assert result is False

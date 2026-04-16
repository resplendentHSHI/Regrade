"""Email notifications for critical regrade findings via Resend."""
from __future__ import annotations

import json
import logging

import resend

from poko_server import config

log = logging.getLogger(__name__)


def should_notify(result_json: str) -> bool:
    """Return True if the result contains at least one critical-tier kept issue."""
    try:
        data = json.loads(result_json)
    except (json.JSONDecodeError, TypeError):
        return False
    for issue in data.get("issues", []):
        if issue.get("keep") and issue.get("confidence_tier") == "critical":
            return True
    return False


def build_email_body(user_email, assignment_name, course_name, result_json):
    """Build the notification email body from analysis results."""
    data = json.loads(result_json)
    critical_issues = [
        i for i in data.get("issues", [])
        if i.get("keep") and i.get("confidence_tier") == "critical"
    ]
    lines = [
        "Hi,", "",
        "Poko reviewed your graded assignments and found something that looks like a clear mistake:", "",
    ]
    for issue in critical_issues:
        q = issue.get("question", "?")
        cat = issue.get("category", "").replace("_", " ")
        pts = issue.get("points_disputed", 0)
        reasoning = issue.get("reasoning", "")
        lines.append(f"  {q} — {cat.title()} (+{pts} pts possible)")
        lines.append(f"  {reasoning}")
        lines.append("")
    lines.append(f"Course: {course_name}")
    lines.append("")
    lines.append("Open the app to review the full draft and decide whether to submit a regrade.")
    lines.append("")
    lines.append("— Poko")
    return "\n".join(lines)


def send_notification(to_email, subject, body):
    """Send an email via Resend. Returns True on success."""
    if not config.RESEND_API_KEY:
        log.warning("RESEND_API_KEY not configured; skipping send")
        return False

    resend.api_key = config.RESEND_API_KEY
    try:
        resend.Emails.send({
            "from": config.NOTIFICATION_FROM_EMAIL,
            "to": [to_email],
            "subject": subject,
            "text": body,
        })
        log.info("Notification sent to %s: %s", to_email, subject)
        return True
    except Exception:
        log.exception("Failed to send notification to %s", to_email)
        return False

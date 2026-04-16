"""Email notifications for critical regrade findings."""
from __future__ import annotations

import json
import logging
import smtplib
from email.message import EmailMessage

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
    """Send an email via SMTP. Returns True on success."""
    if not config.NOTIFICATION_EMAIL or not config.NOTIFICATION_EMAIL_PASSWORD:
        log.warning("Notification email not configured; skipping send")
        return False
    msg = EmailMessage()
    msg["From"] = config.NOTIFICATION_EMAIL
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body)
    try:
        with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT) as smtp:
            smtp.starttls()
            smtp.login(config.NOTIFICATION_EMAIL, config.NOTIFICATION_EMAIL_PASSWORD)
            smtp.sendmail(config.NOTIFICATION_EMAIL, to_email, msg.as_string())
        log.info("Notification sent to %s: %s", to_email, subject)
        return True
    except Exception:
        log.exception("Failed to send notification to %s", to_email)
        return False

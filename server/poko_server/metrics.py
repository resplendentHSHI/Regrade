"""Score change detection and metrics aggregation."""
from __future__ import annotations

import logging
from typing import Any

from poko_server import db

log = logging.getLogger(__name__)


def process_score_sync(user_id: str, scores: list[dict[str, Any]]) -> dict[str, Any]:
    """Compare incoming scores against stored snapshots, detect increases."""
    changes = []
    total_delta = 0.0

    for entry in scores:
        course_id = entry["course_id"]
        assignment_id = entry["assignment_id"]
        new_score = float(entry["score"])
        max_score = float(entry["max_score"])

        prev = db.get_previous_score(user_id, course_id, assignment_id)

        if prev is not None and new_score > prev["score"]:
            # Only credit if Poko analyzed this assignment
            job = db.get_connection().execute(
                """SELECT id FROM jobs WHERE user_id = ? AND course_id = ?
                   AND assignment_id = ? AND status = 'complete'""",
                (user_id, course_id, assignment_id),
            ).fetchone()
            if job is not None:
                delta = new_score - prev["score"]
                total_delta += delta
                changes.append({
                    "course_id": course_id, "assignment_id": assignment_id,
                    "old_score": prev["score"], "new_score": new_score, "delta": delta,
                })

        db.upsert_score_snapshot(user_id, course_id, assignment_id, new_score, max_score)

    if total_delta > 0:
        db.update_user_metrics(user_id, points_recovered_delta=total_delta)

    return {"changes_detected": len(changes), "total_points_delta": total_delta, "details": changes}

"""Job lifecycle: process pending uploads, cleanup old results."""
from __future__ import annotations

import logging
import shutil
import threading
import time
from datetime import datetime, timedelta, timezone

from poko_server import config, db
from poko_server.analyzer import analyze_job
from poko_server.notifications import should_notify, send_notification, build_email_body

log = logging.getLogger(__name__)


def process_pending_jobs() -> dict[str, int]:
    """Find all uploaded jobs, analyze them, update DB. Returns counters."""
    counters = {"processed": 0, "complete": 0, "failed": 0}
    pending = db.list_jobs_by_status("uploaded")

    for job in pending:
        job_id = job["id"]
        job_dir = config.UPLOAD_DIR / job_id
        log.info("Processing job %s", job_id)

        db.update_job_status(job_id, "analyzing")
        result = analyze_job(job_id, job_dir)

        db.update_job_status(
            job_id,
            status=result["status"],
            result_json=result.get("result_json"),
            draft_md=result.get("draft_md"),
        )

        # Delete PDF immediately after analysis
        pdf_path = job_dir / "submission.pdf"
        if pdf_path.exists():
            pdf_path.unlink()

        counters["processed"] += 1
        if result["status"] == "complete":
            counters["complete"] += 1
            # Send notification for critical findings
            if result.get("result_json") and should_notify(result["result_json"]):
                user = db.get_user_by_id(job["user_id"])
                if user:
                    body = build_email_body(
                        user["email"], job["assignment_name"],
                        job["course_name"], result["result_json"],
                    )
                    send_notification(
                        user["email"],
                        f"Poko found an obvious grading error in {job['assignment_name']}",
                        body,
                    )
        else:
            counters["failed"] += 1

    return counters


def cleanup_old_jobs(retention_days: int = config.JOB_RESULT_RETENTION_DAYS) -> int:
    """Delete completed/failed jobs older than retention_days."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    cutoff_iso = cutoff.isoformat()
    conn = db.get_connection()
    rows = conn.execute(
        """SELECT id FROM jobs
           WHERE status IN ('complete', 'failed')
             AND completed_at IS NOT NULL
             AND completed_at < ?""",
        (cutoff_iso,),
    ).fetchall()

    deleted = 0
    for row in rows:
        job_id = row["id"]
        job_dir = config.UPLOAD_DIR / job_id
        if job_dir.exists():
            shutil.rmtree(job_dir)
        db.delete_job(job_id)
        deleted += 1
    return deleted


def recover_interrupted_jobs() -> int:
    """On server restart, re-queue any jobs stuck in 'analyzing' state."""
    stuck = db.list_jobs_by_status("analyzing")
    for job in stuck:
        log.warning("Recovering stuck job %s → uploaded", job["id"])
        db.update_job_status(job["id"], "uploaded")
    return len(stuck)


def _worker_loop(poll_interval: float = 10.0) -> None:
    """Background thread that polls for pending jobs and processes them."""
    while True:
        try:
            counts = process_pending_jobs()
            if counts["processed"] > 0:
                log.info("Worker processed %d jobs: %d complete, %d failed",
                         counts["processed"], counts["complete"], counts["failed"])
        except Exception:
            log.exception("Worker error during job processing")
        time.sleep(poll_interval)


def start_worker(poll_interval: float = 10.0) -> threading.Thread:
    """Start the background job worker thread."""
    t = threading.Thread(target=_worker_loop, args=(poll_interval,), daemon=True)
    t.start()
    log.info("Background job worker started (poll every %.0fs)", poll_interval)
    return t

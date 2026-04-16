"""FastAPI application and route handlers."""
from __future__ import annotations

import hashlib
import hmac
import shutil
import time
import logging
from collections import defaultdict

from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field

from poko_server import config, db
from poko_server.auth import get_current_user_email
from poko_server.jobs import recover_interrupted_jobs, cleanup_old_jobs, start_worker
from poko_server.metrics import process_score_sync

log = logging.getLogger(__name__)

app = FastAPI(title="Poko Server", version="0.1.0")
_start_time = time.monotonic()

# ── In-memory rate limiting ────────────────────────────────────────────
# Tracks request counts per user. Reset on server restart (good enough for MVP).
_rate_buckets: dict[str, list[float]] = defaultdict(list)


def _check_rate_limit(user_email: str) -> None:
    """Enforce per-user rate limits. Raises 429 if exceeded."""
    now = time.time()
    bucket = _rate_buckets[user_email]
    # Prune entries older than 1 hour
    cutoff = now - 3600
    _rate_buckets[user_email] = [t for t in bucket if t > cutoff]
    bucket = _rate_buckets[user_email]

    if len(bucket) >= config.REQUESTS_PER_USER_PER_HOUR:
        raise HTTPException(status_code=429, detail="Rate limit exceeded (100 requests/hour)")
    bucket.append(now)


def _check_daily_job_limit(user_id: str) -> None:
    """Enforce per-user daily job upload limit."""
    conn = db.get_connection()
    today_count = conn.execute(
        "SELECT COUNT(*) FROM jobs WHERE user_id = ? AND created_at >= date('now')",
        (user_id,),
    ).fetchone()[0]
    if today_count >= config.JOBS_PER_USER_PER_DAY:
        raise HTTPException(status_code=429, detail="Daily job limit exceeded (50/day)")


# ── Input validation helpers ───────────────────────────────────────────
MAX_FIELD_LEN = 200


def _validate_field(value: str, name: str) -> str:
    """Validate string fields: max length, no null bytes."""
    if len(value) > MAX_FIELD_LEN:
        raise HTTPException(status_code=400, detail=f"{name} too long (max {MAX_FIELD_LEN} chars)")
    if "\x00" in value:
        raise HTTPException(status_code=400, detail=f"Invalid characters in {name}")
    return value


# ── Lifecycle ──────────────────────────────────────────────────────────

@app.on_event("startup")
def startup():
    db.create_tables()
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    if config.DEV_MODE:
        log.warning("⚠ SERVER RUNNING IN DEV MODE — dev-token-placeholder accepted")
    recovered = recover_interrupted_jobs()
    if recovered:
        log.info("Recovered %d interrupted jobs", recovered)
    cleaned = cleanup_old_jobs()
    if cleaned:
        log.info("Cleaned up %d old jobs", cleaned)
    start_worker()


@app.on_event("shutdown")
def shutdown():
    db.close_connection()


# ── Middleware ─────────────────────────────────────────────────────────

@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log every API request for analytics."""
    response = await call_next(request)
    if request.url.path not in ("/health", "/admin/stats"):
        try:
            db.log_event("api_request", detail=f"{request.method} {request.url.path}")
        except Exception:
            pass
    return response


# ── Endpoints ─────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {
        "status": "ok",
        "uptime_seconds": round(time.monotonic() - _start_time, 1),
    }


@app.get("/admin/stats")
def admin_stats(request: Request):
    """Server-wide analytics. Protected by admin secret."""
    admin_secret = config.ADMIN_SECRET
    provided = request.query_params.get("secret", "")
    if not admin_secret or not hmac.compare_digest(provided, admin_secret):
        log.warning("Unauthorized admin stats attempt from %s", request.client.host if request.client else "unknown")
        raise HTTPException(status_code=403, detail="Forbidden")
    stats = db.get_server_stats()
    stats["uptime_seconds"] = round(time.monotonic() - _start_time, 1)
    return stats


@app.post("/auth/verify")
def auth_verify(email: str = Depends(get_current_user_email)):
    _check_rate_limit(email)
    user = db.get_user_by_email(email)
    return {"email": email, "user_id": user["id"]}


@app.get("/users/me/stats")
def user_stats(email: str = Depends(get_current_user_email)):
    _check_rate_limit(email)
    user = db.get_user_by_email(email)
    metrics = db.get_user_metrics(user["id"])
    return {
        "email": email,
        "points_recovered": metrics["points_recovered"],
        "pages_reviewed": metrics["pages_reviewed"],
        "assignments_analyzed": metrics["assignments_analyzed"],
    }


@app.post("/jobs", status_code=201)
def upload_job(
    file: UploadFile = File(...),
    course_id: str = Form(...),
    assignment_id: str = Form(...),
    assignment_name: str = Form(""),
    course_name: str = Form(""),
    email: str = Depends(get_current_user_email),
):
    _check_rate_limit(email)

    # Validate string inputs
    course_id = _validate_field(course_id, "course_id")
    assignment_id = _validate_field(assignment_id, "assignment_id")
    assignment_name = _validate_field(assignment_name, "assignment_name")
    course_name = _validate_field(course_name, "course_name")

    # Validate PDF
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF uploads accepted")
    content = file.file.read()
    if len(content) > config.MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 50 MB)")
    if not content.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="Invalid PDF file (bad magic bytes)")

    user = db.get_user_by_email(email)
    _check_daily_job_limit(user["id"])

    pdf_hash = hashlib.sha256(content).hexdigest()
    job = db.create_job(user_id=user["id"], pdf_hash=pdf_hash, course_id=course_id,
                        assignment_id=assignment_id, assignment_name=assignment_name,
                        course_name=course_name)
    if job["status"] == "uploaded" and job["completed_at"] is None:
        job_dir = config.UPLOAD_DIR / job["id"]
        job_dir.mkdir(parents=True, exist_ok=True)
        (job_dir / "submission.pdf").write_bytes(content)

    db.log_event("job_upload", user_id=user["id"], detail=f"{course_id}/{assignment_id}")
    return {"job_id": job["id"], "status": job["status"]}


@app.get("/jobs/{job_id}/status")
def job_status(job_id: str, email: str = Depends(get_current_user_email)):
    _check_rate_limit(email)
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    user = db.get_user_by_email(email)
    if job["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job_id": job_id, "status": job["status"]}


@app.get("/jobs/{job_id}/result")
def job_result(job_id: str, email: str = Depends(get_current_user_email)):
    _check_rate_limit(email)
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    user = db.get_user_by_email(email)
    if job["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] not in ("complete", "failed"):
        raise HTTPException(status_code=409, detail=f"Job is still {job['status']}")
    return {"job_id": job_id, "status": job["status"],
            "result_json": job["result_json"], "draft_md": job["draft_md"]}


class ScoreEntry(BaseModel):
    course_id: str = Field(max_length=200)
    assignment_id: str = Field(max_length=200)
    score: float
    max_score: float


class ScoreSyncRequest(BaseModel):
    scores: list[ScoreEntry] = Field(max_length=200)


@app.post("/scores/sync")
def score_sync(body: ScoreSyncRequest, email: str = Depends(get_current_user_email)):
    _check_rate_limit(email)
    user = db.get_user_by_email(email)
    result = process_score_sync(user["id"], [s.model_dump() for s in body.scores])
    return result


@app.delete("/jobs/{job_id}")
def delete_job(job_id: str, email: str = Depends(get_current_user_email)):
    _check_rate_limit(email)
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    user = db.get_user_by_email(email)
    if job["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Job not found")
    job_dir = config.UPLOAD_DIR / job_id
    if job_dir.exists():
        shutil.rmtree(job_dir)
    db.delete_job(job_id)
    return {"deleted": True}

"""FastAPI application and route handlers."""
from __future__ import annotations

import hashlib
import shutil
import time
import logging

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from poko_server import config, db
from poko_server.auth import get_current_user_email
from poko_server.jobs import recover_interrupted_jobs, cleanup_old_jobs, start_worker
from poko_server.metrics import process_score_sync

log = logging.getLogger(__name__)

app = FastAPI(title="Poko Server", version="0.1.0")
_start_time = time.monotonic()


@app.on_event("startup")
def startup():
    db.create_tables()
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
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


@app.get("/health")
def health():
    return {
        "status": "ok",
        "uptime_seconds": round(time.monotonic() - _start_time, 1),
    }


@app.post("/auth/verify")
def auth_verify(email: str = Depends(get_current_user_email)):
    user = db.get_user_by_email(email)
    return {"email": email, "user_id": user["id"]}


@app.get("/users/me/stats")
def user_stats(email: str = Depends(get_current_user_email)):
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
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Only PDF uploads accepted")
    content = file.file.read()
    if len(content) > config.MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(status_code=400, detail="File too large (max 50 MB)")
    pdf_hash = hashlib.sha256(content).hexdigest()
    user = db.get_user_by_email(email)
    job = db.create_job(user_id=user["id"], pdf_hash=pdf_hash, course_id=course_id,
                        assignment_id=assignment_id, assignment_name=assignment_name,
                        course_name=course_name)
    if job["status"] == "uploaded" and job["completed_at"] is None:
        job_dir = config.UPLOAD_DIR / job["id"]
        job_dir.mkdir(parents=True, exist_ok=True)
        (job_dir / "submission.pdf").write_bytes(content)
    return {"job_id": job["id"], "status": job["status"]}


@app.get("/jobs/{job_id}/status")
def job_status(job_id: str, email: str = Depends(get_current_user_email)):
    job = db.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    user = db.get_user_by_email(email)
    if job["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job_id": job_id, "status": job["status"]}


@app.get("/jobs/{job_id}/result")
def job_result(job_id: str, email: str = Depends(get_current_user_email)):
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
    course_id: str
    assignment_id: str
    score: float
    max_score: float


class ScoreSyncRequest(BaseModel):
    scores: list[ScoreEntry]


@app.post("/scores/sync")
def score_sync(body: ScoreSyncRequest, email: str = Depends(get_current_user_email)):
    user = db.get_user_by_email(email)
    result = process_score_sync(user["id"], [s.model_dump() for s in body.scores])
    return result


@app.delete("/jobs/{job_id}")
def delete_job(job_id: str, email: str = Depends(get_current_user_email)):
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

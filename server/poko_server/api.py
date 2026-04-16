"""FastAPI application and route handlers."""
from __future__ import annotations

import time
import logging

from fastapi import Depends, FastAPI

from poko_server import db
from poko_server.auth import get_current_user_email

log = logging.getLogger(__name__)

app = FastAPI(title="Poko Server", version="0.1.0")
_start_time = time.monotonic()


@app.on_event("startup")
def startup():
    db.create_tables()


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

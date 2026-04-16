"""Google OAuth token verification."""
from __future__ import annotations

import logging

import httpx
from fastapi import Header, HTTPException

from poko_server import config, db

log = logging.getLogger(__name__)


def verify_google_token(access_token: str) -> str | None:
    """Verify a Google OAuth access token. Returns the email or None."""
    try:
        resp = httpx.get(
            config.GOOGLE_TOKENINFO_URL,
            params={"access_token": access_token},
            timeout=10.0,
        )
    except Exception:
        log.warning("Google token verification failed: network error")
        return None

    if resp.status_code != 200:
        return None

    data = resp.json()
    if data.get("email_verified") != "true":
        return None

    return data.get("email")


def get_current_user_email(authorization: str = Header(...)) -> str:
    """FastAPI dependency: extract and verify the Bearer token.
    Returns the user's email. Creates a user record if first login.
    Raises 401 on invalid token.
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    token = authorization[len("Bearer "):]
    email = verify_google_token(token)
    if email is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user = db.get_user_by_email(email)
    if user is None:
        db.create_user(email)

    return email

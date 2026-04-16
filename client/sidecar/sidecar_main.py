"""Sidecar CLI entry point. Communicates with Tauri via JSON on stdout.

All logging goes to stderr. Only JSON output goes to stdout.

Commands:
  login <email> <password>
  courses <email> <password>
  fetch <email> <password> <course_ids_json> <data_dir> [existing_hashes_json]
  upcoming <email> <password> <course_ids_json>
"""
from __future__ import annotations

import json
import logging
import sys

# Configure logging to stderr before any imports that might log
logging.basicConfig(
    stream=sys.stderr,
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

import config  # noqa: E402 — after logging setup
from fetcher import fetch_courses, fetch_graded, fetch_upcoming  # noqa: E402
from gs_client import GSClient  # noqa: E402

log = logging.getLogger(__name__)


def _out(data: dict) -> None:
    """Write a single JSON line to stdout."""
    print(json.dumps(data), flush=True)


def _login_client(email: str, password: str) -> GSClient:
    config.GS_EMAIL = email
    config.GS_PASSWORD = password
    client = GSClient()
    client.login()
    return client


def cmd_login(args: list[str]) -> None:
    if len(args) < 2:
        _out({"ok": False, "error": "Usage: login <email> <password>"})
        return
    email, password = args[0], args[1]
    try:
        _login_client(email, password)
        _out({"ok": True})
    except Exception as e:
        log.error("Login failed: %s", e)
        _out({"ok": False, "error": str(e)})


def cmd_courses(args: list[str]) -> None:
    if len(args) < 2:
        _out({"ok": False, "error": "Usage: courses <email> <password>"})
        return
    email, password = args[0], args[1]
    try:
        client = _login_client(email, password)
        courses = fetch_courses(client)
        _out({"ok": True, "courses": courses})
    except Exception as e:
        log.error("courses failed: %s", e)
        _out({"ok": False, "error": str(e)})


def cmd_upcoming(args: list[str]) -> None:
    if len(args) < 3:
        _out({"ok": False, "error": "Usage: upcoming <email> <password> <course_ids_json>"})
        return
    email, password, course_ids_json = args[0], args[1], args[2]
    try:
        course_ids = json.loads(course_ids_json)
        client = _login_client(email, password)
        assignments = fetch_upcoming(client, course_ids)
        _out({"ok": True, "assignments": assignments})
    except Exception as e:
        log.error("upcoming failed: %s", e)
        _out({"ok": False, "error": str(e)})


def cmd_fetch(args: list[str]) -> None:
    if len(args) < 4:
        _out({"ok": False, "error": "Usage: fetch <email> <password> <course_ids_json> <data_dir> [existing_hashes_json]"})
        return
    email, password, course_ids_json, data_dir = args[0], args[1], args[2], args[3]
    existing_hashes_json = args[4] if len(args) > 4 else None
    try:
        course_ids = json.loads(course_ids_json)
        existing_hashes = json.loads(existing_hashes_json) if existing_hashes_json else {}
        client = _login_client(email, password)
        result = fetch_graded(client, course_ids, data_dir, existing_hashes)
        _out({"ok": True, "items": result["items"], "scores": result["scores"]})
    except Exception as e:
        log.error("fetch failed: %s", e)
        _out({"ok": False, "error": str(e)})


_COMMANDS = {
    "login": cmd_login,
    "courses": cmd_courses,
    "upcoming": cmd_upcoming,
    "fetch": cmd_fetch,
}


def main() -> None:
    if len(sys.argv) < 2:
        _out({"ok": False, "error": "Usage: sidecar_main.py <command> [args...]"})
        sys.exit(1)

    command = sys.argv[1]
    args = sys.argv[2:]

    handler = _COMMANDS.get(command)
    if handler is None:
        _out({"ok": False, "error": f"Unknown command: {command!r}. Available: {', '.join(_COMMANDS)}"})
        sys.exit(1)

    handler(args)


if __name__ == "__main__":
    main()

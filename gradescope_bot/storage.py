"""Filesystem-backed queue: one folder per item, state.json is the source of truth."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from gradescope_bot import config

log = logging.getLogger(__name__)


def item_dir(item_id: str) -> Path:
    """Return the queue folder for an item, creating it if missing."""
    d = config.QUEUE_DIR / item_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _state_path(item_id: str) -> Path:
    return item_dir(item_id) / "state.json"


def read_state(item_id: str) -> dict[str, Any] | None:
    """Load state.json for an item. Returns None if missing."""
    path = config.QUEUE_DIR / item_id / "state.json"
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def write_state(item_id: str, state: dict[str, Any]) -> None:
    """Atomically write state.json for an item."""
    path = _state_path(item_id)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, indent=2), encoding="utf-8")
    tmp.replace(path)


def update_state(item_id: str, **fields: Any) -> dict[str, Any]:
    """Merge the given fields into an existing state.json and persist."""
    state = read_state(item_id)
    if state is None:
        raise FileNotFoundError(f"No state.json for {item_id}")
    state.update(fields)
    write_state(item_id, state)
    return state


def list_items(status: str | None = None) -> list[dict[str, Any]]:
    """Scan QUEUE_DIR and return all state.json contents, optionally filtered by status."""
    if not config.QUEUE_DIR.exists():
        return []
    out: list[dict[str, Any]] = []
    for sub in sorted(config.QUEUE_DIR.iterdir()):
        if not sub.is_dir():
            continue
        state_file = sub / "state.json"
        if not state_file.exists():
            log.warning("Queue folder %s missing state.json; skipping", sub.name)
            continue
        try:
            state = json.loads(state_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            log.warning("Corrupt state.json in %s: %s", sub.name, e)
            continue
        if status is not None and state.get("status") != status:
            continue
        out.append(state)
    return out

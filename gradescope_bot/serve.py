"""FastAPI read-mostly dashboard. Localhost only, no auth."""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from markdown_it import MarkdownIt

from gradescope_bot import config, storage

app = FastAPI()
TEMPLATE_DIR = Path(__file__).parent / "templates"
STATIC_DIR = Path(__file__).parent / "static"
templates = Jinja2Templates(directory=str(TEMPLATE_DIR))
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
_md = MarkdownIt()


GROUP_ORDER = [
    ("needs_review", "Needs review"),
    ("pending_download", "Pending download"),
    ("pending_analysis", "Pending analysis"),
    ("analysis_failed", "Analysis failed"),
    ("no_issues_found", "No issues found"),
    ("reviewed", "Reviewed"),
]


def _read_heartbeat() -> dict | None:
    if config.HEARTBEAT_STATE.exists():
        return json.loads(config.HEARTBEAT_STATE.read_text(encoding="utf-8"))
    return None


def _build_chips(items: list[dict], active_filters: dict[str, str]) -> list[dict]:
    """Collect distinct tag values from the queue and flag active ones."""
    tags: set[str] = set()
    for item in items:
        for tag in item.get("tags", []):
            tags.add(tag)
    chips = []
    for tag in sorted(tags):
        key, _, value = tag.partition(":")
        active = active_filters.get(key) == value
        href = f"/?{key}={value}" if not active else "/"
        chips.append({"label": tag, "active": active, "href": href})
    return chips


def _filter_items(items: list[dict], filters: dict[str, str]) -> list[dict]:
    if not filters:
        return items
    out = []
    for item in items:
        tags = set(item.get("tags", []))
        if all(f"{k}:{v}" in tags for k, v in filters.items()):
            out.append(item)
    return out


@app.get("/", response_class=HTMLResponse)
def dashboard(request: Request):
    all_items = storage.list_items()
    filters = {
        k: v for k, v in request.query_params.items()
        if k in {"course", "course_name", "type", "term"}
    }
    items = _filter_items(all_items, filters)

    groups = []
    for status, title in GROUP_ORDER:
        bucket = [i for i in items if i.get("status") == status]
        groups.append({"title": title, "entries": bucket})

    return templates.TemplateResponse(
        request,
        "dashboard.html",
        {
            "groups": groups,
            "chips": _build_chips(all_items, filters),
            "heartbeat": _read_heartbeat(),
        },
    )


@app.get("/api/status")
def api_status():
    return JSONResponse(_read_heartbeat() or {})


@app.get("/queue/{item_id}/submission.pdf")
def serve_pdf(item_id: str):
    path = config.QUEUE_DIR / item_id / "submission.pdf"
    if not path.exists():
        return JSONResponse({"error": "not found"}, status_code=404)
    return FileResponse(str(path), media_type="application/pdf")

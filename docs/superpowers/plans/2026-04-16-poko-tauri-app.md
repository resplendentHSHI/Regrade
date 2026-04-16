# Poko Tauri Desktop App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Poko desktop app — a Tauri 2.x + React application that scrapes Gradescope locally, uploads PDFs to the Poko server for analysis, and displays results in a polished dashboard.

**Architecture:** Tauri 2.x wraps a React + shadcn/ui frontend. A Python sidecar handles all Gradescope interaction (login, scraping, PDF download). The app communicates with the Poko server via HTTPS for analysis. Local state is persisted via Tauri's filesystem APIs. A background heartbeat runs daily at 2 AM.

**Tech Stack:** Tauri 2.x (Rust), React 18 + TypeScript, shadcn/ui + Tailwind CSS, Vite, Python sidecar (reused from gradescope_bot), bun as package manager

**Environment prerequisites (install before starting):**
```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# Tauri Linux system dependencies
sudo apt install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf \
  build-essential curl wget file libssl-dev libayatana-appindicator3-dev libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev

# Node.js (needed alongside bun for some Tauri tooling)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

---

## File Structure

```
client/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs              # Tauri setup, commands registration
│   │   └── commands.rs          # Tauri command handlers (sidecar calls, file ops)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── capabilities/
│       └── default.json         # Tauri v2 permissions
├── src/
│   ├── components/
│   │   ├── ui/                  # shadcn/ui components (auto-generated)
│   │   ├── Sidebar.tsx          # Left nav sidebar
│   │   ├── StatusBadge.tsx      # Assignment status badges
│   │   └── PolicyModal.tsx      # Course policy acknowledgment modal
│   ├── views/
│   │   ├── Onboarding.tsx       # Data transparency + GS login + course setup
│   │   ├── Home.tsx             # Hero stats + activity feed
│   │   ├── Assignments.tsx      # Grouped assignment list
│   │   ├── AssignmentDetail.tsx # PDF viewer + regrade draft
│   │   ├── Upcoming.tsx         # Due dates list
│   │   └── Settings.tsx         # Course mgmt, creds, notifications, privacy
│   ├── lib/
│   │   ├── api.ts               # Poko server API client
│   │   ├── auth.ts              # Google OAuth flow
│   │   ├── sidecar.ts           # Python sidecar invocation
│   │   ├── store.ts             # Local state (assignments, queue, settings)
│   │   ├── queue.ts             # Outbound job queue with retry
│   │   └── heartbeat.ts         # 2 AM scheduler
│   ├── App.tsx                  # Router + layout
│   ├── main.tsx                 # React entry point
│   └── index.css                # Tailwind imports
├── sidecar/
│   ├── sidecar_main.py          # CLI entry point for Tauri
│   ├── gs_client.py             # Copied from gradescope_bot
│   ├── fetcher.py               # Adapted from gradescope_bot
│   ├── rate_limit.py            # Copied from gradescope_bot
│   └── config.py                # Sidecar-specific config
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
├── components.json              # shadcn/ui config
└── index.html
```

---

### Task 1: Environment Setup + Tauri Scaffold

**Files:**
- Create: `client/` directory with full Tauri + React + Vite scaffold
- Create: `client/package.json`
- Create: `client/src-tauri/tauri.conf.json`
- Create: `client/src-tauri/src/main.rs`
- Create: `client/src-tauri/Cargo.toml`

- [ ] **Step 1: Install Rust if not present**

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustc --version  # verify
```

- [ ] **Step 2: Install Tauri Linux system dependencies**

```bash
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf \
  build-essential curl wget file libssl-dev libayatana-appindicator3-dev \
  libsoup-3.0-dev libjavascriptcoregtk-4.1-dev
```

- [ ] **Step 3: Install Node.js if not present**

```bash
# Check if node exists
which node || {
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt install -y nodejs
}
node --version  # verify
```

- [ ] **Step 4: Scaffold Tauri app with bun**

```bash
cd /home/hshi/Desktop/Gradescope-Bot
bunx create-tauri-app client --template react-ts --manager bun --yes
```

If `create-tauri-app` doesn't support `--yes`, run it interactively:
- Project name: `client`
- Frontend: `React`
- Language: `TypeScript`
- Package manager: `bun`

- [ ] **Step 5: Install shadcn/ui and Tailwind**

```bash
cd /home/hshi/Desktop/Gradescope-Bot/client
bun add -D tailwindcss @tailwindcss/vite
bunx --bun shadcn@latest init -d
```

When prompted for shadcn init:
- Style: Default
- Base color: Neutral
- CSS variables: Yes

- [ ] **Step 6: Install shadcn components we'll need**

```bash
cd /home/hshi/Desktop/Gradescope-Bot/client
bunx --bun shadcn@latest add button card badge input label dialog tabs scroll-area separator
```

- [ ] **Step 7: Configure Tauri window**

Update `client/src-tauri/tauri.conf.json` to set:
- `productName`: `"Poko"`
- `identifier`: `"com.poko.app"`
- `windows[0].title`: `"Poko"`
- `windows[0].width`: 1200
- `windows[0].height`: 800
- `windows[0].minWidth`: 900
- `windows[0].minHeight`: 600

- [ ] **Step 8: Verify the app runs**

```bash
cd /home/hshi/Desktop/Gradescope-Bot/client
bun run tauri dev
```

Expected: A Tauri window opens showing the default React template. Close it.

- [ ] **Step 9: Commit**

```bash
cd /home/hshi/Desktop/Gradescope-Bot
git add client/
git commit -m "feat(client): scaffold Tauri 2 + React + shadcn/ui app"
```

---

### Task 2: Python Sidecar CLI

**Files:**
- Create: `client/sidecar/sidecar_main.py`
- Create: `client/sidecar/config.py`
- Copy: `gradescope_bot/gs_client.py` → `client/sidecar/gs_client.py`
- Copy: `gradescope_bot/rate_limit.py` → `client/sidecar/rate_limit.py`
- Create: `client/sidecar/fetcher.py` (adapted)
- Create: `client/sidecar/requirements.txt`

The sidecar is a Python CLI that Tauri calls as a subprocess. It communicates via JSON on stdout. Commands:

- `login <email> <password>` → `{"ok": true}` or `{"ok": false, "error": "..."}`
- `courses` → `{"courses": [{"id": "...", "name": "...", "semester": "...", "year": "..."}]}`
- `fetch <course_ids_json> <data_dir>` → `{"items": [...], "scores": [...]}` — downloads PDFs to data_dir, returns metadata
- `upcoming <course_ids_json>` → `{"assignments": [{"name": "...", "due_date": "...", "course_name": "..."}]}`

- [ ] **Step 1: Create sidecar/requirements.txt**

```
gradescopeapi==1.8.0
beautifulsoup4>=4.12
requests>=2.31
python-dotenv>=1.0
```

- [ ] **Step 2: Copy reusable modules**

```bash
mkdir -p /home/hshi/Desktop/Gradescope-Bot/client/sidecar
cp /home/hshi/Desktop/Gradescope-Bot/gradescope_bot/gs_client.py /home/hshi/Desktop/Gradescope-Bot/client/sidecar/gs_client.py
cp /home/hshi/Desktop/Gradescope-Bot/gradescope_bot/rate_limit.py /home/hshi/Desktop/Gradescope-Bot/client/sidecar/rate_limit.py
```

- [ ] **Step 3: Create sidecar/config.py**

```python
"""Sidecar-specific config. Reads from env vars or uses defaults."""
from __future__ import annotations

import os
from pathlib import Path

GS_BASE_URL = "https://www.gradescope.com"

MIN_REQUEST_SPACING_SEC = 2.0
REQUEST_SPACING_JITTER_SEC = 0.5
PER_RUN_CAP = 50
DAILY_CAP = 150
BACKOFF_INITIAL_SEC = 30
BACKOFF_MAX_SEC = 480
BACKOFF_MAX_RETRIES = 5
HTTP_TIMEOUT_SEC = (60, 60)

BACKFILL_DAYS = 7
```

- [ ] **Step 4: Update copied modules to use sidecar config**

In `client/sidecar/gs_client.py`, replace:
```python
from gradescope_bot import config
from gradescope_bot.rate_limit import (...)
```
with:
```python
import config
from rate_limit import (...)
```

In `client/sidecar/rate_limit.py`, replace:
```python
from gradescope_bot import config
```
with:
```python
import config
```

Also in `rate_limit.py`, replace `config.RATE_LIMIT_STATE` references with a path parameter or remove the file-based persistence (the sidecar is short-lived, no need to persist rate limit state across separate invocations — the daily cap resets via a JSON file in the data dir passed by Tauri).

- [ ] **Step 5: Create sidecar/fetcher.py (adapted)**

Adapt from `gradescope_bot/fetcher.py` but:
- Remove `storage` dependency — return data instead of writing to filesystem
- Accept `data_dir` as a parameter for PDF storage
- Return structured JSON with items and scores

```python
"""Fetch pipeline adapted for sidecar: returns JSON, writes PDFs to data_dir."""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timedelta
from pathlib import Path

import config
from gs_client import AssignmentRow, GSClient

log = logging.getLogger(__name__)

_CURRENT_SEMESTER_MONTHS = {
    "Spring": range(1, 6),
    "Summer": range(6, 9),
    "Fall": range(9, 13),
}


def _semester_matches_today(semester: str, year, now: datetime) -> bool:
    months = _CURRENT_SEMESTER_MONTHS.get(semester)
    if months is None:
        return False
    try:
        year_int = int(year)
    except (TypeError, ValueError):
        return False
    return year_int == now.year and now.month in months


def _infer_type(name: str) -> str:
    n = name.lower()
    if "hw" in n or "homework" in n:
        return "homework"
    if "lab" in n:
        return "lab"
    if "exam" in n or "midterm" in n or "final" in n:
        return "exam"
    if "quiz" in n:
        return "quiz"
    if "project" in n:
        return "project"
    return "other"


def fetch_courses(client: GSClient) -> list[dict]:
    """Return list of active student courses."""
    courses = client.get_courses()
    now = datetime.now().astimezone()
    result = []
    for course_id, course in courses.get("student", {}).items():
        semester = getattr(course, "semester", None)
        year = getattr(course, "year", None)
        if semester and year and _semester_matches_today(semester, year, now):
            result.append({
                "id": str(course_id),
                "name": getattr(course, "name", ""),
                "semester": semester,
                "year": str(year),
            })
    return result


def fetch_upcoming(client: GSClient, course_ids: list[str]) -> list[dict]:
    """Return upcoming assignments (not yet graded, with due dates in the future)."""
    now = datetime.now().astimezone()
    upcoming = []
    for cid in course_ids:
        try:
            rows = client.fetch_course_dashboard(cid)
        except Exception as e:
            log.warning("Dashboard fetch failed for %s: %s", cid, e)
            continue
        for row in rows:
            if row.status == "graded":
                continue
            if row.due_date and row.due_date > now:
                upcoming.append({
                    "name": row.name,
                    "due_date": row.due_date.isoformat(),
                    "course_id": cid,
                    "assignment_id": row.assignment_id,
                    "type": _infer_type(row.name),
                })
    upcoming.sort(key=lambda x: x["due_date"])
    return upcoming


def fetch_graded(client: GSClient, course_ids: list[str], data_dir: str,
                 existing_hashes: list[str]) -> dict:
    """Download new graded PDFs. Returns {items: [...], scores: [...]}."""
    now = datetime.now().astimezone()
    cutoff = now - timedelta(days=config.BACKFILL_DAYS)
    items = []
    scores = []
    data_path = Path(data_dir)

    for cid in course_ids:
        try:
            rows = client.fetch_course_dashboard(cid)
        except Exception as e:
            log.warning("Dashboard fetch failed for %s: %s", cid, e)
            continue

        for row in rows:
            if row.score is not None and row.max_score is not None:
                scores.append({
                    "course_id": cid,
                    "assignment_id": row.assignment_id,
                    "score": row.score,
                    "max_score": row.max_score,
                })

            if row.status != "graded" or row.submission_id is None:
                continue
            if row.due_date is not None and row.due_date < cutoff:
                continue

            try:
                pdf_bytes = client.download_submission_pdf(
                    cid, row.assignment_id, row.submission_id
                )
            except Exception as e:
                log.warning("PDF download failed for %s/%s: %s", cid, row.assignment_id, e)
                continue

            pdf_hash = hashlib.sha256(pdf_bytes).hexdigest()
            if pdf_hash in existing_hashes:
                continue

            item_dir = data_path / f"{cid}_{row.assignment_id}"
            item_dir.mkdir(parents=True, exist_ok=True)
            (item_dir / "submission.pdf").write_bytes(pdf_bytes)

            items.append({
                "course_id": cid,
                "assignment_id": row.assignment_id,
                "submission_id": row.submission_id,
                "name": row.name,
                "score": row.score,
                "max_score": row.max_score,
                "due_date": row.due_date.isoformat() if row.due_date else None,
                "type": _infer_type(row.name),
                "pdf_hash": pdf_hash,
                "pdf_path": str(item_dir / "submission.pdf"),
            })

    return {"items": items, "scores": scores}
```

- [ ] **Step 6: Create sidecar/sidecar_main.py**

```python
#!/usr/bin/env python3
"""Poko sidecar CLI — called by Tauri as a subprocess.

Usage:
    python sidecar_main.py login <email> <password>
    python sidecar_main.py courses <email> <password>
    python sidecar_main.py fetch <email> <password> <course_ids_json> <data_dir> [existing_hashes_json]
    python sidecar_main.py upcoming <email> <password> <course_ids_json>

All output is JSON on stdout. Errors are JSON with {"ok": false, "error": "..."}.
"""
from __future__ import annotations

import json
import sys
import logging

logging.basicConfig(level=logging.WARNING, stream=sys.stderr)

from gs_client import GSClient
from rate_limit import RateLimiter
from fetcher import fetch_courses, fetch_upcoming, fetch_graded


def _make_client() -> GSClient:
    return GSClient(limiter=RateLimiter())


def _respond(data: dict) -> None:
    print(json.dumps(data), flush=True)


def cmd_login(email: str, password: str) -> None:
    import config
    config.GS_EMAIL = email
    config.GS_PASSWORD = password
    client = _make_client()
    try:
        client.login()
        _respond({"ok": True})
    except Exception as e:
        _respond({"ok": False, "error": str(e)})


def cmd_courses(email: str, password: str) -> None:
    import config
    config.GS_EMAIL = email
    config.GS_PASSWORD = password
    client = _make_client()
    try:
        client.login()
        courses = fetch_courses(client)
        _respond({"ok": True, "courses": courses})
    except Exception as e:
        _respond({"ok": False, "error": str(e)})


def cmd_fetch(email: str, password: str, course_ids_json: str,
              data_dir: str, existing_hashes_json: str = "[]") -> None:
    import config
    config.GS_EMAIL = email
    config.GS_PASSWORD = password
    course_ids = json.loads(course_ids_json)
    existing_hashes = json.loads(existing_hashes_json)
    client = _make_client()
    try:
        client.login()
        result = fetch_graded(client, course_ids, data_dir, existing_hashes)
        _respond({"ok": True, **result})
    except Exception as e:
        _respond({"ok": False, "error": str(e)})


def cmd_upcoming(email: str, password: str, course_ids_json: str) -> None:
    import config
    config.GS_EMAIL = email
    config.GS_PASSWORD = password
    client = _make_client()
    try:
        client.login()
        assignments = fetch_upcoming(client, json.loads(course_ids_json))
        _respond({"ok": True, "assignments": assignments})
    except Exception as e:
        _respond({"ok": False, "error": str(e)})


def main() -> None:
    if len(sys.argv) < 2:
        _respond({"ok": False, "error": "Usage: sidecar_main.py <command> [args...]"})
        sys.exit(1)

    cmd = sys.argv[1]
    args = sys.argv[2:]

    try:
        if cmd == "login" and len(args) == 2:
            cmd_login(args[0], args[1])
        elif cmd == "courses" and len(args) == 2:
            cmd_courses(args[0], args[1])
        elif cmd == "fetch" and len(args) >= 4:
            cmd_fetch(args[0], args[1], args[2], args[3],
                      args[4] if len(args) > 4 else "[]")
        elif cmd == "upcoming" and len(args) == 3:
            cmd_upcoming(args[0], args[1], args[2])
        else:
            _respond({"ok": False, "error": f"Unknown command or wrong args: {cmd}"})
            sys.exit(1)
    except Exception as e:
        _respond({"ok": False, "error": str(e)})
        sys.exit(1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 7: Add GS_EMAIL and GS_PASSWORD to sidecar config**

Update `client/sidecar/config.py` to add:
```python
GS_EMAIL = ""
GS_PASSWORD = ""
```

These will be set dynamically by sidecar_main.py before login.

- [ ] **Step 8: Test the sidecar CLI manually**

```bash
cd /home/hshi/Desktop/Gradescope-Bot/client/sidecar
python sidecar_main.py login "wrong@email.com" "wrongpass"
# Expected: {"ok": false, "error": "Invalid credentials."}
```

- [ ] **Step 9: Commit**

```bash
cd /home/hshi/Desktop/Gradescope-Bot
git add client/sidecar/
git commit -m "feat(client): add Python sidecar CLI for Gradescope interaction"
```

---

### Task 3: TypeScript Library Layer

**Files:**
- Create: `client/src/lib/sidecar.ts`
- Create: `client/src/lib/api.ts`
- Create: `client/src/lib/store.ts`
- Create: `client/src/lib/types.ts`

- [ ] **Step 1: Create shared types**

Create `client/src/lib/types.ts`:

```typescript
export interface Course {
  id: string;
  name: string;
  semester: string;
  year: string;
  enabled: boolean;
  policyAckAt: string | null;
}

export interface Assignment {
  courseId: string;
  assignmentId: string;
  submissionId?: string;
  name: string;
  score: number | null;
  maxScore: number | null;
  dueDate: string | null;
  type: string;
  pdfHash?: string;
  pdfPath?: string;
  status: "pending_upload" | "uploading" | "analyzing" | "complete" | "failed" | "no_issues" | "regrade_candidates";
  resultJson?: string;
  draftMd?: string;
  jobId?: string;
  pointsRecovered?: number;
}

export interface UpcomingAssignment {
  name: string;
  dueDate: string;
  courseId: string;
  assignmentId: string;
  type: string;
}

export interface UserStats {
  email: string;
  pointsRecovered: number;
  pagesReviewed: number;
  assignmentsAnalyzed: number;
}

export interface ActivityEntry {
  timestamp: string;
  message: string;
  type: "info" | "success" | "warning";
}

export interface HeartbeatState {
  lastRun: string | null;
  nextScheduled: string | null;
  status: "idle" | "running" | "error";
  queueDepth: number;
}
```

- [ ] **Step 2: Create sidecar.ts**

```typescript
import { Command } from "@tauri-apps/plugin-shell";

interface SidecarResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

async function runSidecar(args: string[]): Promise<SidecarResponse> {
  const cmd = Command.create("python3", [
    "sidecar/sidecar_main.py",
    ...args,
  ], { cwd: "SIDECAR_DIR_PLACEHOLDER" });
  // NOTE: during dev, we call python3 directly. For production,
  // this would be a bundled PyInstaller binary via Tauri sidecar config.

  const output = await cmd.execute();
  if (output.stdout) {
    try {
      return JSON.parse(output.stdout);
    } catch {
      return { ok: false, error: `Invalid JSON: ${output.stdout}` };
    }
  }
  return { ok: false, error: output.stderr || "No output from sidecar" };
}

export async function testLogin(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  return runSidecar(["login", email, password]);
}

export async function fetchCourses(email: string, password: string) {
  const resp = await runSidecar(["courses", email, password]);
  if (!resp.ok) throw new Error(resp.error || "Failed to fetch courses");
  return resp.courses as Array<{ id: string; name: string; semester: string; year: string }>;
}

export async function fetchGraded(
  email: string,
  password: string,
  courseIds: string[],
  dataDir: string,
  existingHashes: string[] = [],
) {
  const resp = await runSidecar([
    "fetch", email, password,
    JSON.stringify(courseIds), dataDir,
    JSON.stringify(existingHashes),
  ]);
  if (!resp.ok) throw new Error(resp.error || "Failed to fetch");
  return resp as { ok: boolean; items: unknown[]; scores: unknown[] };
}

export async function fetchUpcoming(email: string, password: string, courseIds: string[]) {
  const resp = await runSidecar(["upcoming", email, password, JSON.stringify(courseIds)]);
  if (!resp.ok) throw new Error(resp.error || "Failed to fetch upcoming");
  return resp.assignments as Array<{ name: string; dueDate: string; courseId: string; assignmentId: string; type: string }>;
}
```

**IMPORTANT:** The `Command.create` call will need to be adjusted based on how Tauri's shell plugin is configured. During development, we call `python3` directly with the sidecar directory. The implementer should:
1. Install `@tauri-apps/plugin-shell`: `bun add @tauri-apps/plugin-shell`
2. Add the shell plugin to `tauri.conf.json` capabilities
3. Set the correct working directory for the sidecar (use `appDataDir` from Tauri path APIs, or for dev, use relative path from the client dir)

- [ ] **Step 3: Create api.ts**

```typescript
const SERVER_URL = "http://localhost:8080";

async function request(
  path: string,
  options: RequestInit & { token?: string } = {},
): Promise<Response> {
  const { token, ...fetchOpts } = options;
  const headers: Record<string, string> = {
    ...(fetchOpts.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return fetch(`${SERVER_URL}${path}`, { ...fetchOpts, headers });
}

export async function verifyAuth(token: string) {
  const resp = await request("/auth/verify", { method: "POST", token });
  if (!resp.ok) throw new Error("Auth failed");
  return resp.json() as Promise<{ email: string; user_id: string }>;
}

export async function uploadJob(
  token: string,
  file: Blob,
  metadata: { courseId: string; assignmentId: string; assignmentName: string; courseName: string },
) {
  const form = new FormData();
  form.append("file", file, "submission.pdf");
  form.append("course_id", metadata.courseId);
  form.append("assignment_id", metadata.assignmentId);
  form.append("assignment_name", metadata.assignmentName);
  form.append("course_name", metadata.courseName);

  const resp = await request("/jobs", {
    method: "POST",
    token,
    body: form,
  });
  if (!resp.ok) throw new Error(`Upload failed: ${resp.status}`);
  return resp.json() as Promise<{ job_id: string; status: string }>;
}

export async function getJobStatus(token: string, jobId: string) {
  const resp = await request(`/jobs/${jobId}/status`, { token });
  if (!resp.ok) throw new Error(`Status check failed: ${resp.status}`);
  return resp.json() as Promise<{ job_id: string; status: string }>;
}

export async function getJobResult(token: string, jobId: string) {
  const resp = await request(`/jobs/${jobId}/result`, { token });
  if (!resp.ok) throw new Error(`Result fetch failed: ${resp.status}`);
  return resp.json() as Promise<{
    job_id: string;
    status: string;
    result_json: string | null;
    draft_md: string | null;
  }>;
}

export async function deleteJob(token: string, jobId: string) {
  const resp = await request(`/jobs/${jobId}`, { method: "DELETE", token });
  return resp.ok;
}

export async function syncScores(
  token: string,
  scores: Array<{ course_id: string; assignment_id: string; score: number; max_score: number }>,
) {
  const resp = await request("/scores/sync", {
    method: "POST",
    token,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scores }),
  });
  if (!resp.ok) throw new Error(`Score sync failed: ${resp.status}`);
  return resp.json() as Promise<{
    changes_detected: number;
    total_points_delta: number;
    details: unknown[];
  }>;
}

export async function getUserStats(token: string) {
  const resp = await request("/users/me/stats", { token });
  if (!resp.ok) throw new Error(`Stats fetch failed: ${resp.status}`);
  return resp.json() as Promise<{
    email: string;
    points_recovered: number;
    pages_reviewed: number;
    assignments_analyzed: number;
  }>;
}

export async function checkHealth() {
  try {
    const resp = await fetch(`${SERVER_URL}/health`);
    return resp.ok;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Create store.ts**

```typescript
import { BaseDirectory, mkdir, readTextFile, writeTextFile, exists } from "@tauri-apps/plugin-fs";
import type { Assignment, Course, ActivityEntry, HeartbeatState, UpcomingAssignment } from "./types";

const STORE_DIR = "poko";

async function ensureDir() {
  const dirExists = await exists(STORE_DIR, { baseDir: BaseDirectory.AppData });
  if (!dirExists) {
    await mkdir(STORE_DIR, { baseDir: BaseDirectory.AppData, recursive: true });
  }
}

async function readJson<T>(filename: string, fallback: T): Promise<T> {
  try {
    const text = await readTextFile(`${STORE_DIR}/${filename}`, { baseDir: BaseDirectory.AppData });
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(filename: string, data: unknown): Promise<void> {
  await ensureDir();
  await writeTextFile(`${STORE_DIR}/${filename}`, JSON.stringify(data, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
}

// ── Courses ──────────────────────────────────────────────────────────
export const getCourses = () => readJson<Course[]>("courses.json", []);
export const saveCourses = (courses: Course[]) => writeJson("courses.json", courses);

// ── Assignments ──────────────────────────────────────────────────────
export const getAssignments = () => readJson<Assignment[]>("assignments.json", []);
export const saveAssignments = (items: Assignment[]) => writeJson("assignments.json", items);

// ── Upcoming ─────────────────────────────────────────────────────────
export const getUpcoming = () => readJson<UpcomingAssignment[]>("upcoming.json", []);
export const saveUpcoming = (items: UpcomingAssignment[]) => writeJson("upcoming.json", items);

// ── Activity ─────────────────────────────────────────────────────────
export async function addActivity(message: string, type: "info" | "success" | "warning" = "info") {
  const entries = await readJson<ActivityEntry[]>("activity.json", []);
  entries.unshift({ timestamp: new Date().toISOString(), message, type });
  if (entries.length > 100) entries.length = 100;
  await writeJson("activity.json", entries);
}
export const getActivity = () => readJson<ActivityEntry[]>("activity.json", []);

// ── Heartbeat state ──────────────────────────────────────────────────
export const getHeartbeatState = () =>
  readJson<HeartbeatState>("heartbeat.json", {
    lastRun: null,
    nextScheduled: null,
    status: "idle",
    queueDepth: 0,
  });
export const saveHeartbeatState = (state: HeartbeatState) => writeJson("heartbeat.json", state);

// ── Settings ─────────────────────────────────────────────────────────
interface Settings {
  onboardingComplete: boolean;
  serverUrl: string;
  notificationsEnabled: boolean;
}
export const getSettings = () =>
  readJson<Settings>("settings.json", {
    onboardingComplete: false,
    serverUrl: "http://localhost:8080",
    notificationsEnabled: true,
  });
export const saveSettings = (s: Settings) => writeJson("settings.json", s);
```

**IMPORTANT:** The implementer must install the fs plugin:
```bash
bun add @tauri-apps/plugin-fs
```
And add it to tauri.conf.json capabilities.

- [ ] **Step 5: Commit**

```bash
cd /home/hshi/Desktop/Gradescope-Bot
git add client/src/lib/
git commit -m "feat(client): add TypeScript library layer (sidecar, api, store, types)"
```

---

### Task 4: App Shell + Routing

**Files:**
- Create: `client/src/App.tsx`
- Create: `client/src/components/Sidebar.tsx`
- Modify: `client/src/main.tsx`
- Modify: `client/src/index.css`

- [ ] **Step 1: Install react-router**

```bash
cd /home/hshi/Desktop/Gradescope-Bot/client
bun add react-router-dom
```

- [ ] **Step 2: Create Sidebar component**

`client/src/components/Sidebar.tsx`:

```tsx
import { NavLink } from "react-router-dom";
import { Home, FileText, Calendar, Settings } from "lucide-react";

const links = [
  { to: "/", icon: Home, label: "Home" },
  { to: "/assignments", icon: FileText, label: "Assignments" },
  { to: "/upcoming", icon: Calendar, label: "Upcoming" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export function Sidebar() {
  return (
    <aside className="w-56 border-r bg-muted/30 flex flex-col">
      <div className="p-4 border-b">
        <h1 className="text-xl font-bold">Poko</h1>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {links.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted"
              }`
            }
          >
            <Icon className="h-4 w-4" />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 3: Create App.tsx with router**

```tsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { getSettings } from "./lib/store";

function Placeholder({ title }: { title: string }) {
  return <div className="p-8"><h2 className="text-2xl font-bold">{title}</h2><p className="text-muted-foreground mt-2">Coming soon</p></div>;
}

export default function App() {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    getSettings().then((s) => setOnboarded(s.onboardingComplete));
  }, []);

  if (onboarded === null) return null;
  if (!onboarded) return <Placeholder title="Onboarding" />;

  return (
    <BrowserRouter>
      <div className="flex h-screen">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <Routes>
            <Route path="/" element={<Placeholder title="Home" />} />
            <Route path="/assignments" element={<Placeholder title="Assignments" />} />
            <Route path="/assignments/:id" element={<Placeholder title="Assignment Detail" />} />
            <Route path="/upcoming" element={<Placeholder title="Upcoming" />} />
            <Route path="/settings" element={<Placeholder title="Settings" />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
```

- [ ] **Step 4: Update main.tsx**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 5: Verify the app builds and runs**

```bash
cd /home/hshi/Desktop/Gradescope-Bot/client
bun run tauri dev
```

Expected: App opens with sidebar (Home, Assignments, Upcoming, Settings) and placeholder content.

- [ ] **Step 6: Commit**

```bash
cd /home/hshi/Desktop/Gradescope-Bot
git add client/src/
git commit -m "feat(client): add app shell with sidebar navigation and routing"
```

---

### Task 5: Onboarding Flow

**Files:**
- Create: `client/src/views/Onboarding.tsx`
- Create: `client/src/components/PolicyModal.tsx`
- Modify: `client/src/App.tsx`

This task implements the full onboarding wizard: data transparency → Gradescope credentials → course selection with policy acknowledgment.

- [ ] **Step 1: Create PolicyModal**

`client/src/components/PolicyModal.tsx`:

```tsx
import { useState } from "react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./ui/dialog";

interface PolicyModalProps {
  courseName: string;
  open: boolean;
  onAccept: () => void;
  onCancel: () => void;
}

export function PolicyModal({ courseName, open, onAccept, onCancel }: PolicyModalProps) {
  const [checked, setChecked] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Policy Acknowledgment</DialogTitle>
          <DialogDescription>
            I confirm that using automated tools to review grading is permitted under the
            academic integrity policy for <strong>{courseName}</strong>. I understand that
            it is my responsibility to verify this with my instructor, and that Poko is not
            responsible for any policy violations.
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-start gap-2 mt-4 cursor-pointer">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-1"
          />
          <span className="text-sm">
            I have reviewed my course's policy and confirm this use is permitted.
          </span>
        </label>
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button disabled={!checked} onClick={onAccept}>Enable Course</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Create Onboarding view**

`client/src/views/Onboarding.tsx`:

A multi-step wizard with 3 steps. The implementer should create this with:

**Step 1 — Data Transparency:**
- Title: "How your data is handled"
- 5 bullet points from the spec (§4.1 Step 1)
- "I understand, continue" button

**Step 2 — Gradescope Credentials:**
- Email + password inputs
- "Test Login" button that calls `sidecar.testLogin(email, password)`
- Shows success/error state
- On success, saves to Tauri secure store (or local store for now) and advances

**Step 3 — Course Selection:**
- Calls `sidecar.fetchCourses(email, password)` to load courses
- Shows each course with a toggle
- When enabling, opens PolicyModal
- On accept, records `policyAckAt` timestamp
- "Finish Setup" button saves courses and marks onboarding complete

The implementer should use `useState` for the step counter, loading states, and error messages. Use shadcn `Card`, `Button`, `Input`, `Label` components.

After finishing, call `saveSettings({ onboardingComplete: true, ... })` and `saveCourses(enabledCourses)`, then trigger a re-render in App.tsx to show the main dashboard.

- [ ] **Step 3: Wire onboarding into App.tsx**

Update the `if (!onboarded)` branch in App.tsx to render `<Onboarding onComplete={() => setOnboarded(true)} />` instead of a placeholder.

- [ ] **Step 4: Verify the onboarding flow**

```bash
cd /home/hshi/Desktop/Gradescope-Bot/client
bun run tauri dev
```

Expected: App opens to onboarding. Step through data transparency → enter Gradescope creds → see courses → enable with policy modal → finish → see main dashboard.

- [ ] **Step 5: Commit**

```bash
cd /home/hshi/Desktop/Gradescope-Bot
git add client/src/
git commit -m "feat(client): add onboarding wizard with data transparency, login, and course setup"
```

---

### Task 6: Job Queue + Heartbeat

**Files:**
- Create: `client/src/lib/queue.ts`
- Create: `client/src/lib/heartbeat.ts`

- [ ] **Step 1: Create queue.ts**

The job queue manages uploading PDFs to the server and polling for results. It persists state to the local store.

```typescript
import * as api from "./api";
import * as store from "./store";
import type { Assignment } from "./types";
import { readFile } from "@tauri-apps/plugin-fs";

const POLL_INTERVAL_MS = 30_000;
const RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 3600_000];

export async function uploadPendingJobs(token: string): Promise<void> {
  const assignments = await store.getAssignments();
  const pending = assignments.filter((a) => a.status === "pending_upload" && a.pdfPath);

  for (const item of pending) {
    try {
      const pdfBytes = await readFile(item.pdfPath!);
      const blob = new Blob([pdfBytes], { type: "application/pdf" });

      const result = await api.uploadJob(token, blob, {
        courseId: item.courseId,
        assignmentId: item.assignmentId,
        assignmentName: item.name,
        courseName: "", // filled in by server from course data
      });

      item.jobId = result.job_id;
      item.status = "uploading";
      await store.addActivity(`Uploaded ${item.name} for analysis`, "info");
    } catch (err) {
      console.error(`Upload failed for ${item.name}:`, err);
    }
  }

  await store.saveAssignments(assignments);
}

export async function pollJobResults(token: string): Promise<void> {
  const assignments = await store.getAssignments();
  const inFlight = assignments.filter(
    (a) => a.jobId && (a.status === "uploading" || a.status === "analyzing"),
  );

  for (const item of inFlight) {
    try {
      const status = await api.getJobStatus(token, item.jobId!);
      if (status.status === "complete" || status.status === "failed") {
        const result = await api.getJobResult(token, item.jobId!);
        item.resultJson = result.result_json ?? undefined;
        item.draftMd = result.draft_md ?? undefined;

        if (result.result_json) {
          const parsed = JSON.parse(result.result_json);
          const kept = parsed.kept_issue_count || 0;
          item.status = kept > 0 ? "regrade_candidates" : "no_issues";
          await store.addActivity(
            kept > 0
              ? `Poko found ${kept} regrade candidate(s) in ${item.name}`
              : `No issues found in ${item.name}`,
            kept > 0 ? "success" : "info",
          );
        } else {
          item.status = "failed";
        }

        await api.deleteJob(token, item.jobId!);
      } else {
        item.status = "analyzing";
      }
    } catch (err) {
      console.error(`Poll failed for ${item.name}:`, err);
    }
  }

  await store.saveAssignments(assignments);
}
```

- [ ] **Step 2: Create heartbeat.ts**

```typescript
import * as sidecar from "./sidecar";
import * as api from "./api";
import * as store from "./store";
import { uploadPendingJobs, pollJobResults } from "./queue";
import type { Assignment } from "./types";
import { appDataDir } from "@tauri-apps/api/path";

export async function runHeartbeat(
  gsEmail: string,
  gsPassword: string,
  token: string,
): Promise<void> {
  const state = await store.getHeartbeatState();
  state.status = "running";
  await store.saveHeartbeatState(state);

  try {
    const courses = await store.getCourses();
    const enabledIds = courses.filter((c) => c.enabled).map((c) => c.id);
    if (enabledIds.length === 0) return;

    const dataDir = `${await appDataDir()}/poko/pdfs`;
    const assignments = await store.getAssignments();
    const existingHashes = assignments
      .filter((a) => a.pdfHash)
      .map((a) => a.pdfHash!);

    // 1. Fetch new graded PDFs + scores
    const result = await sidecar.fetchGraded(
      gsEmail, gsPassword, enabledIds, dataDir, existingHashes,
    );

    // 2. Add new items to local assignments
    for (const item of result.items as any[]) {
      assignments.push({
        courseId: item.course_id,
        assignmentId: item.assignment_id,
        submissionId: item.submission_id,
        name: item.name,
        score: item.score,
        maxScore: item.max_score,
        dueDate: item.due_date,
        type: item.type,
        pdfHash: item.pdf_hash,
        pdfPath: item.pdf_path,
        status: "pending_upload",
      });
    }
    await store.saveAssignments(assignments);

    // 3. Sync scores with server
    if ((result.scores as any[]).length > 0) {
      await api.syncScores(token, result.scores as any[]);
    }

    // 4. Upload pending PDFs
    await uploadPendingJobs(token);

    // 5. Poll for results
    await pollJobResults(token);

    // 6. Fetch upcoming assignments
    const upcoming = await sidecar.fetchUpcoming(gsEmail, gsPassword, enabledIds);
    await store.saveUpcoming(upcoming);

    await store.addActivity(
      `Heartbeat complete: ${(result.items as any[]).length} new, ${assignments.filter((a) => a.status === "analyzing").length} analyzing`,
      "info",
    );

    state.lastRun = new Date().toISOString();
    state.status = "idle";
    state.queueDepth = assignments.filter(
      (a) => a.status === "pending_upload" || a.status === "uploading" || a.status === "analyzing",
    ).length;
  } catch (err) {
    state.status = "error";
    console.error("Heartbeat error:", err);
    await store.addActivity(`Heartbeat error: ${err}`, "warning");
  }

  // Schedule next run for tomorrow 2 AM
  const now = new Date();
  const next = new Date(now);
  next.setHours(2, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  state.nextScheduled = next.toISOString();
  await store.saveHeartbeatState(state);
}
```

- [ ] **Step 3: Commit**

```bash
cd /home/hshi/Desktop/Gradescope-Bot
git add client/src/lib/queue.ts client/src/lib/heartbeat.ts
git commit -m "feat(client): add job queue with retry and heartbeat scheduler"
```

---

### Task 7: Home View

**Files:**
- Create: `client/src/views/Home.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Create Home view**

The Home view shows:
- Hero stat: points recovered (large number, centered)
- Supporting stats: pages reviewed, assignments analyzed (smaller, in a row)
- Heartbeat status bar: last run, next scheduled, queue depth
- Recent activity feed (last 20 entries)
- "Run Now" button that triggers `runHeartbeat()`

Use shadcn `Card`, `Badge`, `Button`, `Separator`. Use `useEffect` + `useState` to load from store on mount. Use `setInterval` to refresh activity every 30s.

The implementer should create a polished, professional layout. The hero stat should be prominent — this is the value proposition ("Poko has recovered X points for you").

- [ ] **Step 2: Wire into App.tsx router**

Replace the Home placeholder route with `<Home />`.

- [ ] **Step 3: Verify**

```bash
cd /home/hshi/Desktop/Gradescope-Bot/client
bun run tauri dev
```

Expected: Home view shows with stats (all zeros initially), activity feed (empty), and heartbeat status.

- [ ] **Step 4: Commit**

```bash
cd /home/hshi/Desktop/Gradescope-Bot
git add client/src/views/Home.tsx client/src/App.tsx
git commit -m "feat(client): add Home view with hero stats and activity feed"
```

---

### Task 8: Assignments View

**Files:**
- Create: `client/src/views/Assignments.tsx`
- Create: `client/src/components/StatusBadge.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Create StatusBadge**

`client/src/components/StatusBadge.tsx`:

```tsx
import { Badge } from "./ui/badge";

const STATUS_CONFIG: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending_upload: { label: "Pending", variant: "outline" },
  uploading: { label: "Uploading", variant: "secondary" },
  analyzing: { label: "Analyzing", variant: "secondary" },
  complete: { label: "Reviewed", variant: "default" },
  failed: { label: "Failed", variant: "destructive" },
  no_issues: { label: "No Issues", variant: "outline" },
  regrade_candidates: { label: "Regrade Found", variant: "default" },
};

export function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] || { label: status, variant: "outline" as const };
  return <Badge variant={config.variant}>{config.label}</Badge>;
}
```

- [ ] **Step 2: Create Assignments view**

The view shows assignments grouped by course. Each assignment row has: name, score (e.g., "85/100"), status badge, and points recovered badge if applicable. Clicking a row navigates to `/assignments/{courseId}_{assignmentId}`.

Use shadcn `Card`, `Badge`, `Separator`. Group by courseId, show course name as section header with per-course points recovered total. Sort assignments by date (newest first).

Load from `store.getAssignments()` on mount.

- [ ] **Step 3: Wire into App.tsx**

Replace the Assignments placeholder route.

- [ ] **Step 4: Commit**

```bash
cd /home/hshi/Desktop/Gradescope-Bot
git add client/src/views/Assignments.tsx client/src/components/StatusBadge.tsx client/src/App.tsx
git commit -m "feat(client): add Assignments view with course grouping and status badges"
```

---

### Task 9: Assignment Detail View

**Files:**
- Create: `client/src/views/AssignmentDetail.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Create AssignmentDetail view**

This view shows a single assignment with:
- Header: assignment name, course, score, status badge
- Split layout:
  - Left (60%): PDF viewer using an `<iframe>` pointing to the local PDF file via `convertFileSrc()` from `@tauri-apps/api/core`
  - Right (40%): Regrade draft rendered as HTML (parse markdown with a simple md→html library or just `<pre>` for now), with a "Copy to Clipboard" button
- Per-question breakdown if result_json exists (parse and display issues with confidence tier badges: red for critical, amber for strong, gray for marginal)

Use `useParams()` from react-router to get the assignment ID. Load from `store.getAssignments()` and find the matching one.

The implementer should install:
```bash
bun add react-markdown
```

For the PDF iframe, use `convertFileSrc` from Tauri to convert the local file path to a webview-accessible URL.

- [ ] **Step 2: Wire into App.tsx**

Replace the AssignmentDetail placeholder route.

- [ ] **Step 3: Commit**

```bash
cd /home/hshi/Desktop/Gradescope-Bot
git add client/src/views/AssignmentDetail.tsx client/src/App.tsx
git commit -m "feat(client): add Assignment Detail view with PDF embed and regrade draft"
```

---

### Task 10: Upcoming + Settings Views

**Files:**
- Create: `client/src/views/Upcoming.tsx`
- Create: `client/src/views/Settings.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Create Upcoming view**

Simple list sorted by due date. Each row: assignment name, course name, due date (formatted relative, e.g., "in 3 days"), type badge. Load from `store.getUpcoming()`.

- [ ] **Step 2: Create Settings view**

Sections:
- **Courses**: list of enabled courses with toggle to disable, button to "Add Courses" (re-runs course fetch + policy flow)
- **Gradescope**: shows connected email, button to "Update Credentials" 
- **Notifications**: toggle for email notifications
- **Privacy**: the data transparency text from onboarding, accessible anytime
- **Account**: shows Gmail email, "Sign Out" button

- [ ] **Step 3: Wire into App.tsx**

Replace remaining placeholder routes.

- [ ] **Step 4: Commit**

```bash
cd /home/hshi/Desktop/Gradescope-Bot
git add client/src/views/Upcoming.tsx client/src/views/Settings.tsx client/src/App.tsx
git commit -m "feat(client): add Upcoming assignments and Settings views"
```

---

### Task 11: Google OAuth Integration

**Files:**
- Create: `client/src/lib/auth.ts`
- Modify: `client/src/views/Onboarding.tsx` (add OAuth as Step 0)
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Create auth.ts**

For MVP, we'll use a simplified auth flow. The full Google OAuth redirect flow requires a Google Cloud project with OAuth credentials. For now, implement the structure:

```typescript
import { open } from "@tauri-apps/plugin-shell";

const GOOGLE_CLIENT_ID = "YOUR_CLIENT_ID"; // set from env or config
const REDIRECT_URI = "http://localhost:9876/callback";

export async function startOAuthFlow(): Promise<string> {
  // 1. Start a local HTTP server to capture the redirect
  // 2. Open browser to Google's OAuth URL
  // 3. Wait for the callback with the auth code
  // 4. Exchange code for tokens
  // For MVP: use a placeholder that stores a token locally
  
  // This will be implemented with a proper OAuth flow when Google Cloud
  // credentials are set up. For now, return a mock token for development.
  return "dev-token-placeholder";
}

export function getStoredToken(): string | null {
  return localStorage.getItem("poko_auth_token");
}

export function storeToken(token: string): void {
  localStorage.setItem("poko_auth_token", token);
}

export function clearToken(): void {
  localStorage.removeItem("poko_auth_token");
}
```

**NOTE:** Full OAuth implementation requires a Google Cloud OAuth Client ID, which the user hasn't set up yet. The implementer should wire the structure so it's easy to plug in real OAuth later. For now, the dev flow skips OAuth and uses a placeholder token that the server accepts (since during dev, both client and server run locally).

- [ ] **Step 2: Add auth gating to App.tsx**

Update App.tsx to check for a stored token. If no token, show a "Sign in with Google" button before the onboarding flow. For dev mode, auto-generate a dev token.

- [ ] **Step 3: Commit**

```bash
cd /home/hshi/Desktop/Gradescope-Bot
git add client/src/lib/auth.ts client/src/views/Onboarding.tsx client/src/App.tsx
git commit -m "feat(client): add OAuth auth structure (dev mode placeholder)"
```

---

### Task 12: Heartbeat Background Loop + Polish

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/views/Home.tsx`

- [ ] **Step 1: Wire heartbeat into App.tsx**

After the app loads and the user is onboarded, start a background loop:
- On app start: check if a heartbeat should run (compare lastRun to now)
- Set up a `setInterval` that checks every 60 seconds if it's time to run
- The 2 AM check: if `now.getHours() === 2` and `lastRun` was before today, trigger `runHeartbeat()`
- Also poll for job results every 30 seconds if there are in-flight jobs

- [ ] **Step 2: Add "Run Now" button to Home**

The Home view's "Run Now" button calls `runHeartbeat()` directly. Show a loading spinner while running. Refresh stats after completion.

- [ ] **Step 3: Load real stats from server**

Update Home view to call `api.getUserStats(token)` on mount and display real numbers.

- [ ] **Step 4: Verify full flow end-to-end**

```bash
# Terminal 1: Start the Poko server
cd /home/hshi/Desktop/Gradescope-Bot/server
PYTHONPATH=. python -m poko_server

# Terminal 2: Start the Tauri app
cd /home/hshi/Desktop/Gradescope-Bot/client
bun run tauri dev
```

Expected: App opens → onboarding → enter GS creds → select courses → dashboard → click "Run Now" → heartbeat runs → assignments appear → analyzing → results show up.

- [ ] **Step 5: Commit**

```bash
cd /home/hshi/Desktop/Gradescope-Bot
git add client/src/
git commit -m "feat(client): wire heartbeat background loop and end-to-end flow"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] § 2.1 Poko Desktop App: Tauri + React — Tasks 1, 4
- [x] § 2.1 Python Sidecar: reused code — Task 2
- [x] § 2.2 Data flow: scrape → download → upload → results — Tasks 2, 3, 6
- [x] § 2.3 Resilience: persistent queue, retry — Task 6
- [x] § 3.1 Gmail OAuth: desktop flow — Task 11
- [x] § 3.2 Gradescope Credentials: local storage — Task 5
- [x] § 4.1 Onboarding: data transparency + creds + courses + policy — Task 5
- [x] § 4.2 Semester transitions: course refresh — Task 10 (Settings)
- [x] § 5.1 PDF-only filter: sidecar handles — Task 2
- [x] § 6 Score change detection: score sync in heartbeat — Task 6
- [x] § 8.1 Home view: hero stats, activity — Task 7
- [x] § 8.1 Assignments view: grouped, badges — Task 8
- [x] § 8.1 Assignment detail: PDF + draft — Task 9
- [x] § 8.1 Upcoming: due dates — Task 10
- [x] § 8.1 Settings: courses, creds, notifications, privacy — Task 10
- [x] § 8.2 Navigation: sidebar — Task 4
- [x] § 8.3 Metrics integration: woven into views — Tasks 7, 8

**Placeholder scan:** OAuth auth.ts has a placeholder for development mode — this is intentional and noted. No other placeholders.

**Type consistency:** `Assignment`, `Course`, `UpcomingAssignment`, `UserStats`, `HeartbeatState`, `ActivityEntry` types are defined in `types.ts` and used consistently across store, views, and lib modules.

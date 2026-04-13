# Gradescope Regrade Bot — Design Spec

**Date:** 2026-04-13
**Status:** Approved for planning (pending user review of this document)
**Smoke-tested:** Yes — 3 real graded PDFs, $3.60 total, 0 failures

## 1. Purpose

A personal bot that:

1. Automatically pulls graded homework submissions from Gradescope once per day at 02:00 local time.
2. Uses Claude Code (`claude -p` with `--effort max` on Opus) to analyze each graded PDF for regrade-worthy issues.
3. Writes per-assignment regrade request drafts in paste-ready Gradescope format when reasonable issues are found.
4. Presents a local web dashboard where the user can see the queue, review drafts, and cross-reference the downloaded PDFs.

The bot **never** auto-submits regrade requests. The user is always the final decision maker.

## 2. Non-goals

- Multi-user support. Personal tool for one Gradescope account.
- Instructor-side grading workflows. Student role only.
- Grading itself. The bot only audits existing grades.
- In-browser draft editing. Drafts live as files on disk; edit in any editor.
- Persistent long-running web server. The UI is started ad-hoc when needed.
- Mobile / remote access. Localhost only, no auth.
- Pushing to Gradescope. Zero write-path to Gradescope's servers.

## 3. High-level architecture

Two Python processes that share `data/` on the filesystem:

```
┌─────────────────────────────┐              ┌────────────────────────────┐
│  heartbeat daemon           │              │  web server (ad-hoc)       │
│  gradescope_bot.heartbeat   │              │  gradescope_bot.serve       │
│                             │              │                            │
│  • always running           │              │  • started when user looks │
│  • wakes at 02:00 local     │              │  • read-mostly             │
│  • fetches + analyzes       │              │  • FastAPI + Jinja         │
│  • writes state.json files  │              │  • 127.0.0.1:8765          │
└────────────┬────────────────┘              └──────────────┬─────────────┘
             │                                              │
             ▼                                              ▼
        ┌──────────────────────────────────────────────────────┐
        │  data/  (filesystem — the one source of truth)       │
        │  ├── heartbeat_state.json                            │
        │  ├── heartbeat.log                                   │
        │  ├── heartbeat.pid                                   │
        │  ├── rate_limit_state.json                           │
        │  └── queue/<item_id>/{state.json, submission.pdf,    │
        │                       analysis.json, regrade_draft.md}│
        └──────────────────────────────────────────────────────┘
```

No database. No IPC. Both processes can be independently started/killed/reloaded.

## 4. Repository layout

```
Gradescope-Bot/
├── gradescope_bot/
│   ├── __init__.py
│   ├── config.py          # constants, paths, env loading
│   ├── gs_client.py       # gradescopeapi wrapper + custom scrapers + rate limiter
│   ├── fetcher.py         # discover courses → assignments → download PDFs
│   ├── storage.py         # state.json helpers, queue folder layout
│   ├── analyzer.py        # invokes `claude -p`, parses verdict
│   ├── heartbeat.py       # long-running daemon (2am scheduler)
│   ├── serve.py           # FastAPI app
│   ├── templates/         # Jinja2 templates
│   │   ├── dashboard.html
│   │   └── item.html
│   └── static/
│       └── style.css
├── prompts/
│   └── regrade_check.md   # prompt template for claude -p
├── tests/
│   ├── fixtures/
│   │   ├── dashboard_sample.html   # the saved 18100 course page
│   │   ├── sample_graded.pdf       # one of the smoke-tested PDFs
│   │   └── fake_claude/            # real shell scripts for subprocess tests
│   │       ├── fake_claude_ok.sh
│   │       ├── fake_claude_fail.sh
│   │       ├── fake_claude_slow.sh
│   │       └── fake_claude_malformed.sh
│   ├── test_gs_client_parsing.py
│   ├── test_rate_limiter.py
│   ├── test_storage.py
│   ├── test_scheduler.py
│   ├── test_analyzer_parsing.py
│   ├── test_analyzer_subprocess.py   # uses fake_claude scripts
│   ├── test_live_login.py            # GS_LIVE=1 gated
│   ├── test_live_pdf_download.py     # GS_LIVE=1 gated
│   └── test_analyzer_smoke.py        # CLAUDE_LIVE=1 gated, ~$1
├── data/                  # gitignored
├── docs/
│   └── superpowers/specs/2026-04-13-gradescope-regrade-bot-design.md
├── .env                   # gitignored — GS_EMAIL, GS_PASSWORD
├── .gitignore
├── pyproject.toml
└── README.md
```

## 5. Data layout (the filesystem IS the database)

### 5.1 Queue folder per assignment

```
data/queue/<item_id>/
├── state.json           # status, tags, summary, timestamps
├── submission.pdf       # graded PDF with rubric overlays (source of truth)
├── analysis.json        # raw LLM verdict
└── regrade_draft.md     # only if status == needs_review
```

**`item_id` format:** `{course_id}_{assignment_id}` — e.g., `1222348_7841492`. Deterministic, idempotent (same assignment never double-queued), no slug collisions, no sanitization edge cases.

### 5.2 `state.json` schema

```json
{
  "id": "1222348_7841492",
  "title": "Homework 8",
  "course_id": "1222348",
  "assignment_id": "7841492",
  "submission_id": "398420660",
  "tags": [
    "course:18-100",
    "course_name:Introduction to Electrical and Computer Engineering",
    "term:Spring2026",
    "type:homework"
  ],
  "score": 18.5,
  "max_score": 20.0,
  "due_date": "2026-04-08T22:00:00-04:00",
  "first_seen_local": "2026-04-13T02:00:14-04:00",
  "downloaded_at": "2026-04-13T02:00:18-04:00",
  "analyzed_at": "2026-04-13T02:05:03-04:00",
  "reviewed_at": null,
  "pdf_sha256": "ab12...",
  "status": "needs_review",
  "summary": "1 potential regrade: Q2.2 internal consistency with Q6.2",
  "issue_count": 1,
  "error": null
}
```

**Status lifecycle:**

```
pending_download
      │
      ▼ (fetcher writes PDF)
pending_analysis
      │
      ▼ (analyzer writes analysis.json)
needs_review ───────┐
      │             │
no_issues_found ────┤
      │             │
analysis_failed ────┘   (manual re-analyze available via UI)
      │
      ▼ (user clicks "Mark reviewed" in UI)
reviewed   (terminal)
```

### 5.3 Tags

Tags are free-form `key:value` strings used for UI filter chips. Standard keys:

- `course:<short-code>` — parsed from course name (e.g., "18-100")
- `course_name:<full-name>` — for display
- `term:<TermYYYY>` — e.g., `Spring2026`
- `type:<kind>` — `homework | lab | exam | quiz | project | other`, inferred from assignment name via keyword map

Inference is best-effort. The user can manually edit `state.json` to fix tags.

### 5.4 `heartbeat_state.json`

```json
{
  "last_run_local": "2026-04-13T02:00:14-04:00",
  "last_status": "ok",
  "last_cycle_counters": {
    "new_items": 2,
    "analyzed_ok": 2,
    "needs_review": 1,
    "no_issues_found": 1,
    "failed": 0
  },
  "next_scheduled_local": "2026-04-14T02:00:00-04:00",
  "daemon_started_local": "2026-04-10T18:45:00-04:00"
}
```

### 5.5 `rate_limit_state.json`

```json
{
  "day_local": "2026-04-13",
  "requests_used": 47,
  "daily_cap": 150
}
```

Counter is reset when `day_local` differs from today. Incremented (and fsync'd) per request. Daily cap is a hard circuit breaker across all Gradescope requests regardless of trigger source.

## 6. Gradescope integration

### 6.1 Library in use

`gradescopeapi` 1.8.0 (`nyuoss/gradescope-api`). Used for:

- `GSConnection.login(email, password)` — returns an authenticated `requests.Session`
- `Account.get_courses()` — returns `{"student": {...}, "instructor": {...}}` with term/year metadata
- Direct access to `connection.session` for all custom scraping

### 6.2 Custom scraping (built on `connection.session`)

The library does **not** implement PDF download or rubric parsing. Two custom methods in `gs_client.py`:

#### `fetch_course_dashboard(course_id: str) -> list[AssignmentRow]`

Hits `https://www.gradescope.com/courses/{course_id}` and parses the assignment table with BeautifulSoup. Per the saved dashboard HTML audit:

- Row selector: `tr[role="row"]` (skip header)
- Assignment name: `th.table--primaryLink > a` text content
- Assignment + submission IDs: parsed from `th.table--primaryLink > a[href]` pattern `/courses/{cid}/assignments/{aid}/submissions/{sid}`
- Score: `td.submissionStatus div.submissionStatus--score` text, e.g., "8.5 / 10.0"
- Status text (ungraded only): `td.submissionStatus div.submissionStatus--text`
- Due date: `time.submissionTimeChart--dueDate[datetime]` ISO string

Returns:

```python
@dataclass
class AssignmentRow:
    assignment_id: str
    submission_id: str | None     # None if not yet submitted
    name: str
    score: float | None
    max_score: float | None
    due_date: datetime | None
    status: Literal["graded", "submitted", "no_submission", "late", "unknown"]
```

**"Graded" detection:** `.submissionStatus--score` div present **and** `.submissionStatus--text` div absent. The bot only downloads rows where `status == "graded"`.

#### `download_submission_pdf(course_id, assignment_id, submission_id) -> bytes`

Hits `https://www.gradescope.com/courses/{course_id}/assignments/{assignment_id}/submissions/{submission_id}.pdf` (the `.pdf` suffix is the official download URL — confirmed from user-supplied example). Returns raw bytes. No HTML parsing. One request.

Validation:

- Response MUST start with `%PDF` — otherwise treat as an auth-redirect failure, re-login once, retry once, then abort the item with `pdf_download_failed`.
- SHA-256 the bytes and store in `state.json.pdf_sha256`. Subsequent runs skip re-download if the file exists with the same hash.

### 6.3 Rate limiter (`gs_client.py`)

Wraps `connection.session.request` with a monkey-patched method enforcing:

| Parameter | Value | Rationale |
|---|---|---|
| Minimum spacing | 2.0 s ± 0.5 s jitter | Well below any polite-scraping threshold |
| Per-run cap | 50 requests | Revised down from 200 after smoke tests showed typical runs use < 30 |
| Daily cap | 150 requests | Circuit breaker across all triggers |
| Parallelism | 1 (strictly serial) | No request overlap |
| 429/503 backoff | Exponential: 30 s → 60 s → 120 s → 240 s → 480 s → give up | Max 5 retries per request |
| Timeout per request | 60 s connect + 60 s read | |

On exceeding per-run or daily cap, raises `RatePerRunExhausted` / `DailyCapExhausted`. Fetcher catches both and aborts the cycle cleanly, leaving remaining items in `pending_download`. Next cycle resumes.

### 6.4 Per-cycle request budget

Observed budget after the first run:

- Login: 1
- `Account.get_courses()`: 1
- `fetch_course_dashboard(cid)`: 1 × N_active_courses
- `download_submission_pdf(...)`: 1 × N_new_graded_assignments

**Typical daily run after backfill:** 2 + N_active_courses + N_new_graded ≈ **5–15 requests**.

**Initial 7-day backfill:** ~2 + 5 + 20 ≈ **~30 requests**.

Both well under the 50/run and 150/day caps.

### 6.5 "Active course" filter

An enrolled student course is considered active if `Account.get_courses()` returns it under the `"student"` key with a current `term` + `year` matching "this semester" (month-based heuristic: Jan-May → Spring, Jun-Aug → Summer, Sep-Dec → Fall, using the host's local clock). Non-matching enrolled courses are silently skipped.

## 7. Scheduler (`heartbeat.py`)

### 7.1 Target schedule

**Daily at 02:00 in the host's local timezone.** Uses the OS's current IANA timezone (`datetime.now().astimezone()`), so DST transitions are honored automatically — no hardcoded offset.

### 7.2 Startup

1. Acquire `data/heartbeat.pid` via `fcntl.flock(LOCK_EX | LOCK_NB)`. Fail-fast on collision ("another heartbeat is running; exiting"). Release on clean shutdown.
2. Set up rotating logger → `data/heartbeat.log` (10 MB × 5 files).
3. Install SIGTERM and SIGINT handlers that set a `threading.Event` so sleeps wake immediately.
4. Enter scheduler loop.

### 7.3 Scheduler loop (pseudocode)

```python
stop = threading.Event()
while not stop.is_set():
    now = datetime.now().astimezone()
    today_2am = now.replace(hour=2, minute=0, second=0, microsecond=0)
    tomorrow_2am = today_2am + timedelta(days=1)
    last_run = read_state().last_run_local

    # Catch-up rule: if we missed today's 02:00 slot, run immediately.
    if last_run < today_2am <= now:
        run_cycle()

    # Compute next wake
    state = read_state()
    if state.last_run_local >= today_2am:
        next_run = tomorrow_2am
    else:
        next_run = today_2am

    wait_seconds = max(0, (next_run - datetime.now().astimezone()).total_seconds())
    stop.wait(timeout=wait_seconds)
```

**Resume semantics.** `last_run_local` is updated only after a successful cycle. A crash or kill mid-cycle leaves `last_run_local` stale, so the next startup's catch-up check fires and re-runs. The PDF cache plus `pdf_sha256` check makes this safe — already-downloaded items are skipped on retry.

**Laptop-sleep resilience.** If the machine suspends past 02:00 and wakes later that day, the catch-up rule fires on the first clock tick after wake.

**Manual run.** `python -m gradescope_bot.heartbeat --run-now` runs one cycle and exits. Does not touch the scheduler loop. Also used for the initial 7-day backfill.

### 7.4 A single cycle

```
cycle_start
  ↓
Fetcher.run_fetch_phase()
  • login
  • enumerate active student courses
  • for each: fetch_course_dashboard, find new graded rows
  • for each new row: create queue folder, state.json(status=pending_download), download PDF, set pdf_sha256, flip status=pending_analysis
  • on RatePerRunExhausted / DailyCapExhausted: abort cleanly
  ↓
Analyzer.run_analyze_phase()
  • scan data/queue/*/state.json for status == "pending_analysis"
    (analysis_failed is NEVER auto-retried; the only way to retry a failed
     item is the UI "Re-analyze" button, which resets its status back to
     pending_analysis so the next cycle picks it up)
  • invoke claude -p serially, one item at a time
  • update state.json on each completion
  ↓
cycle_end
  • write heartbeat_state.json with counters
  • update last_run_local on success
```

### 7.5 Failure matrix

| Failure | Response |
|---|---|
| Login fails (auth, CAPTCHA, 2FA) | Abort cycle, `heartbeat_state.last_status="auth_failed"`, UI shows banner, retry tomorrow |
| Rate 429/503 after max backoff | Abort cycle cleanly, remaining items stay `pending_download`, resume next day |
| `DailyCapExhausted` | Same — clean abort, surface in UI |
| PDF download returns non-PDF bytes | Re-login once, retry once, then abort item with `pdf_download_failed`, next cycle retries |
| PDF download truncated (< expected size, incomplete) | Don't write file; leave `pending_download`; next cycle retries |
| `claude -p` timeout (>20 min) | Mark item `analysis_failed`, store error, move on |
| `claude -p` non-zero exit | Mark `analysis_failed`, capture stderr into `state.json.error` |
| `claude -p` malformed/missing analysis.json | Mark `analysis_failed`, capture stdout into error |
| Queue folder corrupt (missing state.json or PDF) | Log, skip, don't crash the cycle |
| Disk full | Abort cycle, log, surface in UI |

## 8. Analyzer (`analyzer.py`)

### 8.1 Invocation

```python
def analyze(item_dir: Path) -> Verdict:
    subprocess.run(
        [
            "claude", "-p", prompt_text,
            "--model", "opus",
            "--effort", "max",
            "--output-format", "json",
            "--json-schema", json.dumps(VERDICT_SCHEMA),
            "--permission-mode", "acceptEdits",
            "--add-dir", str(item_dir),
            "--max-turns", "20",
            "--max-budget-usd", "5.00",
        ],
        capture_output=True,
        timeout=1200,   # 20 minutes
        text=True,
    )
```

**Rationale:** these flags are battle-tested. All 3 smoke tests passed with this exact configuration.

- `--model opus --effort max` — strongest model + highest reasoning budget. Non-negotiable for high-stakes regrades.
- `--json-schema` — native structured-output validation. Guarantees schema-conforming JSON on stdout.
- `--permission-mode acceptEdits` — lets the subprocess Write `analysis.json` and `regrade_draft.md` without prompting.
- `--add-dir <item_dir>` — grants tool access to the single queue item directory.
- `--max-turns 20` — max observed in smoke tests was 9, so 20 is comfortable headroom.
- `--max-budget-usd 5.00` — hard dollar ceiling per invocation. Smoke tests ranged $0.93–$1.73; $5.00 is generous safety.
- Timeout 20 min — max observed was 9.7 min.

### 8.2 Prompt template (`prompts/regrade_check.md`)

The exact wording that passed all 3 smoke tests, parameterized with `{pdf_path}`, `{output_path}`, `{draft_path}`, `{pdf_pages}`:

```
You are analyzing a GRADED Gradescope homework submission PDF for possible regrade requests.

The PDF is at: {pdf_path}

It contains the student's work PLUS Gradescope's grader annotations overlaid on each page:
rubric items, points awarded/deducted, grader comments, and the per-question score breakdown.

## Your job

1. Read the entire PDF using the Read tool. The file is {pdf_pages} pages. If it exceeds
   10 pages, read it in page ranges (1-10, 11-20, 21-...) so you cover every page. Do not skip pages.
2. For every question in the assignment, examine:
   - What the student wrote/submitted
   - Which rubric items the grader applied
   - Points awarded vs. available
   - Any grader comments
3. Look for regrade-worthy issues in these five categories:
   - arithmetic_mismatch — points deducted don't add up to the total shown
   - rubric_misapplication — the cited rubric item doesn't match what the student wrote
   - missed_correct_work — the student got something right but lost points (alternate valid
     method, correct answer marked wrong, etc.)
   - unclear_deduction — points taken with no explanation or a vague comment that prevents
     the student from understanding why
   - partial_credit_too_low — substantial correct work received disproportionately few points
4. Apply a strict "reasonable person" filter. Only flag issues a TA/professor would plausibly
   agree with upon re-review. Err strongly on the side of NOT flagging. False positives waste
   everyone's time. If you're unsure, don't flag it. Previously-denied regrade requests
   visible in the PDF should not be re-flagged.
5. Write the structured verdict to `{output_path}` using the Write tool, conforming to the JSON
   schema provided. Set item_id to "{item_id}".
6. If and only if the verdict contains at least one kept issue, also write `{draft_path}` with
   one section per kept issue in this format:

   # Regrade Requests — <assignment title> (<course if visible>)

   ## Question <N> — <short description>

   **Requesting regrade for:** <X points deducted under "rubric item">

   **Reason for request:**
   <1-2 paragraphs, respectful tone, citing specific page numbers and what the student wrote>

   ---

## Output requirements

- Your FINAL response must be the SAME JSON object you wrote to analysis.json.
- Do not skip pages. Do not guess at content. If a page is ambiguous, re-read it.
- Use your maximum reasoning effort. This is a high-stakes evaluation.
```

### 8.3 Verdict schema (passed to `--json-schema`)

```json
{
  "type": "object",
  "required": ["item_id", "model", "overall_verdict", "summary", "issues", "kept_issue_count"],
  "additionalProperties": false,
  "properties": {
    "item_id": { "type": "string" },
    "model": { "type": "string" },
    "overall_verdict": {
      "type": "string",
      "enum": ["needs_review", "no_issues_found"]
    },
    "summary": { "type": "string" },
    "issues": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["question", "category", "severity", "rubric_item_cited",
                     "points_disputed", "reasoning", "keep"],
        "additionalProperties": false,
        "properties": {
          "question": { "type": "string" },
          "category": {
            "type": "string",
            "enum": ["arithmetic_mismatch", "rubric_misapplication",
                     "missed_correct_work", "unclear_deduction",
                     "partial_credit_too_low"]
          },
          "severity": { "type": "string", "enum": ["low", "medium", "high"] },
          "rubric_item_cited": { "type": "string" },
          "points_disputed": { "type": "number" },
          "reasoning": { "type": "string" },
          "keep": { "type": "boolean" }
        }
      }
    },
    "kept_issue_count": { "type": "integer", "minimum": 0 }
  }
}
```

`keep: false` entries are allowed in `issues` — they let the model reason openly about borderline candidates and self-retract. Only `keep: true` issues are counted in `kept_issue_count` and shown in the UI "needs review" panel.

### 8.4 Post-call bookkeeping

1. Parse `analysis.json` from disk (preferred over stdout which has a `{"type":"result"}` wrapper).
2. Update `state.json`:
   - `analyzed_at = now_local()`
   - `issue_count = analysis.kept_issue_count`
   - `summary = analysis.summary`
   - `status = "needs_review" if kept_issue_count > 0 else "no_issues_found"`
3. On any error (timeout, non-zero exit, missing/unparseable file), set `status = "analysis_failed"` and store the error details in `state.json.error`. Do not auto-retry. The UI exposes a manual "Re-analyze" button.
4. The analyzer **never** touches Gradescope. Pure local operation. No rate-limit budget consumed.

### 8.5 Expected cost and duration

From smoke tests on 3 real PDFs (10 / 12 / 24 pages):

- **Per-item cost:** $0.93 – $1.73 (avg ~$1.20)
- **Per-item wall clock:** 4.5 – 9.7 min
- **Daily steady-state (1–3 new items):** $1–5/day, 5–30 min
- **One-time 7-day backfill (~20 items):** ~$25–30, ~2–3 hours (serial)

These costs are the user's accepted baseline. The `--max-budget-usd 5.00` ceiling provides per-item blast-radius protection.

## 9. Web UI (`serve.py`)

### 9.1 Scope

- Dashboard listing all queue items with tag filter chips
- Per-item detail page with embedded PDF viewer + rendered regrade_draft.md + raw analysis.json (collapsible)
- Status summary banner (read from `heartbeat_state.json`)
- "Mark as reviewed" and "Re-analyze" buttons per item

**Out of scope (explicitly):** in-browser draft editing, credential forms, PDF annotation, any write-path to Gradescope.

### 9.2 Stack

- FastAPI, single `serve.py`
- Jinja2 server-rendered HTML, no build step, no npm
- Vanilla JS for filter-chip toggles
- `markdown-it-py` for rendering `regrade_draft.md`
- Native `<iframe src=".../submission.pdf">` for PDF display
- Localhost only: `127.0.0.1:8765`, no auth

### 9.3 Routes

```
GET  /                                    dashboard
GET  /item/{item_id}                      detail view
GET  /queue/{item_id}/submission.pdf      FileResponse
GET  /queue/{item_id}/regrade_draft.md    FileResponse (raw)
POST /item/{item_id}/review               mark reviewed
POST /item/{item_id}/reanalyze            reset status → pending_analysis
GET  /api/status                          heartbeat_state.json as JSON
```

### 9.4 Dashboard organization

Three collapsible sections:

1. **Needs review** — `status=needs_review`. Sorted by highest-severity kept issue. On top, always expanded.
2. **In progress / failed** — `status ∈ {pending_download, pending_analysis, analysis_failed}`. Expanded.
3. **No issues found** — `status=no_issues_found`. Collapsed by default — the user wanted to see "Claude checked this, nothing worth requesting" without having to open anything.
4. **Reviewed** — `status=reviewed`. Collapsed by default, kept for history.

Filter chips above: all distinct `course:*`, `type:*`, `term:*` values from current items' tag sets. Filter state lives in the URL query string (`?course=18-100&type=homework`) so bookmarks and refreshes preserve it.

### 9.5 Data freshness

Every request rescans `data/queue/` from disk. No caching. This is fast (<10 ms for hundreds of items) and eliminates invalidation bugs. The heartbeat daemon can update `state.json` files while the UI is open; a page refresh immediately reflects the new state.

### 9.6 Lifecycle

`python -m gradescope_bot.serve` runs in the foreground until Ctrl-C. No daemonization. The user starts it when they want to look and kills it when they're done. The heartbeat daemon runs independently.

## 10. Configuration (`config.py`)

All constants live here. No scattered magic numbers.

```python
# Paths
DATA_DIR = Path("./data")
QUEUE_DIR = DATA_DIR / "queue"
HEARTBEAT_STATE = DATA_DIR / "heartbeat_state.json"
RATE_LIMIT_STATE = DATA_DIR / "rate_limit_state.json"
HEARTBEAT_LOG = DATA_DIR / "heartbeat.log"
HEARTBEAT_PID = DATA_DIR / "heartbeat.pid"
PROMPTS_DIR = Path("./prompts")

# Gradescope
GS_BASE_URL = "https://www.gradescope.com"
GS_EMAIL = os.environ["GS_EMAIL"]
GS_PASSWORD = os.environ["GS_PASSWORD"]

# Rate limiting
MIN_REQUEST_SPACING_SEC = 2.0
REQUEST_SPACING_JITTER_SEC = 0.5
PER_RUN_CAP = 50
DAILY_CAP = 150
BACKOFF_INITIAL_SEC = 30
BACKOFF_MAX_SEC = 480
BACKOFF_MAX_RETRIES = 5

# Scheduler
HEARTBEAT_HOUR_LOCAL = 2
HEARTBEAT_MINUTE_LOCAL = 0
BACKFILL_DAYS = 7

# Analyzer
CLAUDE_MODEL = "opus"
CLAUDE_EFFORT = "max"
CLAUDE_MAX_TURNS = 20
CLAUDE_MAX_BUDGET_USD = 5.00
CLAUDE_TIMEOUT_SEC = 1200

# Web UI
SERVER_HOST = "127.0.0.1"
SERVER_PORT = 8765
```

## 11. Testing strategy

### 11.1 Unit tests (fast, no network, no tokens)

- `test_gs_client_parsing.py` — feed the saved dashboard HTML fixture to `fetch_course_dashboard` and assert the full `AssignmentRow` list. Most critical test because HTML parsers are brittle.
- `test_rate_limiter.py` — token bucket spacing, per-run cap enforcement, daily cap rollover at midnight, `DailyCapExhausted` raised at the right count. Uses an injected fake clock.
- `test_storage.py` — `state.json` round-trip, status transitions, tag filter predicates.
- `test_scheduler.py` — catch-up logic (inject "now" and "last_run" and assert next scheduled); DST spring-forward and fall-back edge cases; laptop-sleep-past-02:00 case.
- `test_analyzer_parsing.py` — feed synthetic `analysis.json` fixtures (valid, malformed, missing fields, empty issues) to the parser and assert correct state transitions.

### 11.2 Subprocess tests (no network, no tokens)

`test_analyzer_subprocess.py` uses **real** shell scripts in `tests/fixtures/fake_claude/` to exercise the analyzer wrapper against real subprocess primitives. This catches bugs that `unittest.mock.patch('subprocess.run')` would miss (e.g., `text=True` vs bytes, timeout-kill semantics, path mismatches, env stripping).

Scripts:

- `fake_claude_ok.sh` — writes a canned `analysis.json` to the `--add-dir` path, exits 0
- `fake_claude_fail.sh` — prints error to stderr, exits 1
- `fake_claude_slow.sh` — `sleep 30` then exits (tests timeout)
- `fake_claude_malformed.sh` — writes invalid JSON, exits 0

Tests override the `claude` binary path in `config.py` (or inject via PATH manipulation) to point at these scripts.

### 11.3 Live integration tests (gated)

Opt-in only, skipped by default:

- `test_live_login.py` — `GS_LIVE=1`. Real login with `.env` credentials; verifies session is usable.
- `test_live_pdf_download.py` — `GS_LIVE=1`. Downloads one known PDF to `/tmp`, asserts first 4 bytes are `%PDF`.
- `test_analyzer_smoke.py` — `CLAUDE_LIVE=1`. Runs `claude -p` on `tests/fixtures/sample_graded.pdf` (one of the three smoke-tested PDFs), asserts schema-valid output. Costs ~$1.

### 11.4 Manual QA checklist

Documented in the README:

1. Set `.env` with `GS_EMAIL` and `GS_PASSWORD`.
2. Run `python -m gradescope_bot.heartbeat --run-now`.
3. Verify a queue folder appears under `data/queue/`.
4. Verify PDF opens (`xdg-open data/queue/<id>/submission.pdf`).
5. Start the server: `python -m gradescope_bot.serve`.
6. Visit `http://127.0.0.1:8765/`.
7. Verify dashboard renders all items, grouped by status.
8. Click an item, verify PDF viewer works, verify draft renders (if any).
9. Click "Mark reviewed" and verify the item moves to the Reviewed section.
10. Kill the server (Ctrl-C). Run `python -m gradescope_bot.heartbeat` to start the daemon in the foreground. Leave it for a day. Verify 02:00 trigger fires (check `heartbeat.log`).

## 12. Open questions and risks

### 12.1 Submission ID is not exposed by the library

**Resolved:** the course dashboard HTML contains `/submissions/{sid}` in each row's `href`, so `fetch_course_dashboard` extracts `submission_id` directly. No extra request needed.

### 12.2 PDF URL pattern

**Resolved:** user confirmed `/courses/{cid}/assignments/{aid}/submissions/{sid}.pdf` is the direct download URL.

### 12.3 Rubric data

**Resolved:** rubric items, points, and grader comments are visually overlaid on the graded PDF. Claude Code's multimodal Read tool sees them directly. No separate JSON scrape needed.

### 12.4 Active course detection

**Heuristic:** match Gradescope's term/year metadata against month-based "current semester" rule on the host clock. If the user takes classes that don't fit the standard academic calendar, they can add an allowlist override in `config.py` (`COURSE_ALLOWLIST: set[str] | None`). Not implemented until needed.

### 12.5 Gradescope anti-bot measures

**Risk:** Gradescope could introduce CAPTCHA, 2FA-on-login, or rate limiting that breaks the bot. **Mitigation:** every failure mode surfaces cleanly in `heartbeat_state.last_status`, the UI shows a banner, and the bot gives up rather than trying to evade. No stored session cookies beyond the in-memory per-run session. If persistent CAPTCHA appears, the bot goes dark until the user intervenes manually. This is considered acceptable for a personal tool.

### 12.6 Drafts overwriting user edits

**Risk:** if the user edits `regrade_draft.md` manually and then clicks "Re-analyze", the new analyzer run would overwrite their edits. **Mitigation:** "Re-analyze" moves the existing `regrade_draft.md` to `regrade_draft.md.bak-{timestamp}` before running. The UI banner also warns "Re-analyzing will regenerate the draft."

### 12.7 Cost drift

**Risk:** per-item cost could grow if Gradescope PDFs get longer or if the model becomes more verbose. **Mitigation:** `--max-budget-usd 5.00` per item + the daily analyzer summary counters in `heartbeat_state.json` make cost drift visible. If the user sees runs approaching the cap, they can adjust the limit.

### 12.8 Personal info in logs

**Risk:** `heartbeat.log` may contain assignment names, question text, and grader comments. **Mitigation:** the log is local-only, under `data/`, and the `.gitignore` excludes `data/`. No remote logging.

## 13. Smoke test evidence

Three real graded PDFs from the user's account were tested end-to-end with the exact analyzer invocation specified in § 8.1 on 2026-04-13:

| PDF | Pages | Verdict | Kept issues | Cost | Duration |
|---|---|---|---|---|---|
| submission_398420660.pdf (HW08 ADCs) | 10 | needs_review | 1 (Q2.2, internal consistency with Q6.2) | $0.94 | 4.5 min |
| submission_397845064.pdf (Lab 5 Op-Amp) | 24 | no_issues_found | 0 | $0.93 | 4.7 min |
| submission_396787625.pdf (HW07 Capacitors) | 12 | needs_review | 1 (Q3.F, Rth=1kΩ required by accepted τ=1ms) | $1.73 | 9.7 min |

All three exited 0, produced schema-valid JSON, and wrote files to expected paths. Two flagged issues were high-quality cross-question consistency arguments. The model also correctly recognized previously-denied regrade requests in the 24-page submission and avoided re-flagging them — emergent behavior from `--effort max` that confirms the design premise.

**The smoke-tested PDFs and their artifacts are preserved under `/tmp/gs_smoke/` for reference during implementation.** One of them will be copied into `tests/fixtures/sample_graded.pdf` for the opt-in `test_analyzer_smoke.py` integration test.

## 14. Summary of what this spec commits to

1. Two-process architecture: long-running heartbeat daemon + ad-hoc web server, sharing `data/`.
2. Pure filesystem state, flat queue with tag filtering, one folder per assignment.
3. `gradescopeapi` for login and course listing + two custom scrapers (`fetch_course_dashboard`, `download_submission_pdf`) built on its authenticated session.
4. Conservative rate limiting: 2 s ± 0.5 s jitter, 50/run, 150/day, exponential 429 backoff.
5. 02:00 local-time daily scheduler with catch-up and suspend-resume resilience, no cron.
6. `claude -p --model opus --effort max --json-schema --output-format json` for every analysis. Non-negotiable.
7. Battle-tested prompt and schema, both lifted from successful smoke runs.
8. Narrow-scope FastAPI dashboard, localhost only, no auth, no editing.
9. Unit + subprocess + gated-live test pyramid.
10. No auto-submission to Gradescope, ever.

# Poko — Commercial Product Design Spec

## 1. Overview

Poko is a macOS desktop companion app that automatically reviews graded Gradescope assignments for regrade opportunities. It scrapes Gradescope locally on the user's machine, uploads PDFs to a private server for AI analysis, and presents results in a polished dashboard. The app tracks score changes over time and notifies users only when obvious grading errors are found.

**Core value proposition:** Students stop manually re-reading every graded assignment. Poko does the first pass and only surfaces real, defensible regrade candidates.

**Business model:** $5/month, charged only in months where points were actually recovered. Payment infrastructure (Stripe) is deferred to a later sub-project.

**Privacy-first design:** Gradescope credentials never leave the user's device. Uploaded PDFs are deleted from the server immediately after analysis. The local app is open source so users can verify these claims.

## 2. System Architecture

### 2.1 Components

Three components communicate over HTTPS:

1. **Poko Desktop App** (`client/`) — open source, Tauri 2.x + React
   - Handles all Gradescope interaction (login, scraping, PDF download)
   - Stores credentials in the OS keychain
   - Manages a persistent outbound job queue
   - Displays the dashboard UI
   - Runs a background heartbeat (daily at 2 AM local time)

2. **Poko Server** (`server/`) — closed source, Python FastAPI
   - Receives PDFs from authenticated clients
   - Runs the two-stage Claude analysis pipeline
   - Returns structured results
   - Deletes PDFs immediately after analysis
   - Sends email notifications for critical findings
   - Tracks aggregate metrics and score changes

3. **Python Sidecar** — bundled with the Tauri app
   - Reuses existing tested Python code: `gs_client.py`, `fetcher.py`, `rate_limit.py`
   - Called by Tauri as a subprocess via Tauri's sidecar support
   - Handles Gradescope login, course scraping, dashboard parsing, PDF download
   - Isolated from the server — communicates with Tauri via stdout/stderr JSON
   - Bundled with a standalone Python runtime (e.g., PyInstaller or PyOxidizer binary) so end users don't need Python installed

### 2.2 Data Flow

```
User installs Poko → Gmail OAuth login (email scope only) →
enters Gradescope creds (stored in OS keychain) →
course setup wizard (scrape, enable, acknowledge policy per course) →

Daily heartbeat (2 AM local):
  1. Sidecar scrapes Gradescope dashboard for each enabled course
  2. Filters to PDF-only graded assignments
  3. Downloads new PDFs locally
  4. Sends current score snapshot to server (server detects successful regrades)
  5. Queues new PDFs for server upload

Outbound queue (runs whenever server is reachable):
  1. POST PDF + metadata to server
  2. Server down → exponential backoff retry (1m → 5m → 15m → 1h cap)
  3. Server accepts → poll for results
  4. Results received → store locally, mark complete

Server pipeline:
  1. Validate PDF, create job record in SQLite
  2. Sonnet prescreen: is this worth analyzing?
  3. If yes → Opus max analysis with regrade_check.md prompt
  4. Store results, delete PDF immediately
  5. If critical-tier findings → send email notification
  6. Hold results for client pickup (max 7 days, then purge)
```

### 2.3 Resilience

The local app maintains a persistent outbound queue on disk. If the server is down, jobs accumulate locally and retry with exponential backoff. If the client goes offline, the server holds results for up to 7 days.

The Gradescope heartbeat runs once daily at 2 AM — this is rate-limited and conservative. Server uploads are independent of the heartbeat and retry aggressively since it's our own infrastructure.

Job deduplication: SHA-256 hash of PDF content prevents duplicate analysis if the same PDF is re-uploaded.

Server crash recovery: on restart, any jobs in `received` state are re-run automatically.

## 3. Authentication & Identity

### 3.1 Gmail OAuth 2.0

- User clicks "Sign in with Google" in the Tauri app
- Tauri opens system browser to Google's OAuth consent screen
- Single scope: `email` (identity only)
- OAuth redirect to `localhost:<port>`, Tauri captures the auth code
- App exchanges code for access + refresh tokens, stored in OS keychain
- Every API call to the server includes the access token
- Server verifies the token with Google, extracts the email as the user's identity
- Server never stores OAuth tokens — validates per-request, discards

### 3.2 Gradescope Credentials

- Entered in the app's setup wizard
- Stored in the macOS Keychain (Windows Credential Manager in future)
- Never sent to the server — all Gradescope interaction happens on the client via the Python sidecar
- Used to create a `gradescopeapi` session locally
- Known limitation: SSO-linked accounts (e.g., `@andrew.cmu.edu` via Shibboleth) do not work with `gradescopeapi`'s direct login. Users must link a non-SSO email with a direct Gradescope password.

### 3.3 Server-Side User Record

Minimal data stored per user:
- Gmail address (primary key)
- List of enabled courses (course ID + name + policy-acknowledged timestamp)
- Aggregate metrics (total pages reviewed, total points recovered)
- Notification preferences
- Score snapshots (numeric scores only, for change detection)

No credentials, no tokens, no personal data beyond email.

## 4. Course Setup Wizard & Policy Gate

### 4.1 First-Time Onboarding Flow

**Step 1: Data Transparency Screen**

Before any credentials are entered, the user sees:

> **How your data is handled**
>
> - **Your Gradescope credentials** are stored on your device only, in your operating system's secure keychain. They are never sent to our servers.
> - **Your graded assignments** are uploaded to our server for analysis, then **permanently deleted immediately** after processing. We never store your coursework.
> - **What we keep on our server:** your email address, which courses you've enabled, and aggregate stats (pages reviewed, points recovered). That's it.
> - **Email notifications:** We'll email you when we find an obvious grading error. You can turn this off anytime.
> - **You're always in control:** Every regrade suggestion is a draft for you to review. We never submit anything to Gradescope on your behalf.

This screen is also accessible anytime from Settings > Privacy.

**Step 2: Gradescope Credentials**

- User enters Gradescope email and password
- App validates by attempting a login via the sidecar
- On success, credentials are saved to the OS keychain
- On failure, clear error message (with a note about SSO accounts not being supported)

**Step 3: Course Selection**

- App scrapes all enrolled courses via the sidecar
- Filters to active semester courses (using `_semester_matches_today` logic)
- Presents a list showing: course name, semester, role

**Step 4: Per-Course Policy Acknowledgment**

When enabling a course, a modal appears:

> **Policy Acknowledgment**
>
> "I confirm that using automated tools to review grading is permitted under the academic integrity policy for **[Course Name]**. I understand that it is my responsibility to verify this with my instructor, and that Poko is not responsible for any policy violations."
>
> [ ] I have reviewed my course's policy and confirm this use is permitted.
>
> [Enable Course]

The acknowledgment timestamp is stored locally and synced to the server.

### 4.2 Semester Transitions

When a new semester starts, the app detects new courses and prompts the wizard for those courses only. Previously enabled courses from past semesters are archived automatically.

## 5. Analysis Pipeline

### 5.1 PDF-Only Filter

Assignments are filtered to PDF submissions only before downloading. Non-PDF submissions (online quizzes, code uploads) are skipped entirely. This eliminates the need for user feedback about unregradable items.

### 5.2 Two-Stage Claude Pipeline

Reused from the existing bot with minimal changes:

**Stage 1: Sonnet Prescreen**
- Model: Claude Sonnet, effort medium
- Purpose: quick check — does this PDF contain student work with rubric annotations that could be regradable?
- Cost: ~$0.10 per item
- Timeout: 300 seconds
- Fail-safe: on any error, pass through to Stage 2

**Stage 2: Opus Max Analysis**
- Model: Claude Opus, effort max
- Purpose: full regrade analysis across 5 categories:
  1. Arithmetic mismatch (grader added points wrong)
  2. Rubric misapplication (rubric item doesn't match the deduction)
  3. Missed correct work (student's answer is actually right)
  4. Unclear deduction (no rubric item explains the point loss)
  5. Partial credit too low (work is substantially correct)
- Cost: ~$1-2 per item
- Timeout: 1200 seconds
- Max budget per item: $5.00
- Output: structured `analysis.json` + `regrade_draft.md` with paste-ready per-question regrade text

### 5.3 Confidence Tiers

Each finding is classified into one of three tiers:

| Tier | Description | Dashboard | Email |
|------|-------------|-----------|-------|
| **Critical** | Clear-cut errors: arithmetic wrong, rubric contradicts itself | Red badge | Yes |
| **Strong** | Likely regradable but requires judgment | Amber badge | No |
| **Marginal** | Possible but uncertain | Gray indicator | No |

Only critical-tier findings trigger email notifications.

### 5.4 Prompts

The existing prompts are reused verbatim:
- `prompts/regrade_check.md` — main analyzer prompt (smoke-tested on 3 real PDFs)
- `prompts/regrade_prescreen.md` — sonnet prescreen prompt

The confidence tier classification is added to the opus prompt's output schema.

## 6. Score Change Detection

The client sends a score snapshot to the server during each heartbeat via `POST /scores/sync`:

```json
{
  "scores": [
    {"course_id": "1222348", "assignment_id": "7841492", "score": 85, "max_score": 100}
  ]
}
```

The server compares against the previous snapshot. If a score increased on an assignment where Poko previously generated a regrade draft, the delta is attributed to Poko and added to the user's `points_recovered` metric.

This runs as part of the normal heartbeat — no separate process needed.

## 7. Email Notifications

### 7.1 When to Send

- Only when opus analysis finds at least one **critical-tier** finding
- Maximum 1 email per day per user (batch multiple assignments)
- Users can disable notifications in Settings

### 7.2 Email Content

```
Subject: Poko found an obvious grading error in HW7

Hi Chris,

Poko reviewed your graded assignments and found something that looks like a clear mistake:

  HW7 Q3 — Rubric misapplication (+4 pts possible)
  Clairaut's theorem conditions were stated correctly but marked wrong.

Open the app to review the full draft and decide whether to submit a regrade.

— Poko
```

### 7.3 Implementation

- MVP: SMTP via a configured email account (`NOTIFICATION_EMAIL` and `NOTIFICATION_EMAIL_PASSWORD` in `.env`)
- Production: migrate to a transactional email service (SendGrid, Resend, or AWS SES)

## 8. Local App Dashboard

### 8.1 Views

**Home / Overview**
- Hero stat: "X points recovered" front and center
- Supporting numbers: pages reviewed, assignments analyzed
- Recent activity feed: "Poko found 2 regrade candidates in HW7", "Score change detected on HW5: +3 points"
- Heartbeat status: last scan, next scheduled, queue depth

**Assignments**
- Grouped by course, sortable by date
- Each assignment shows: name, score, status badge
- Status states: `pending_upload` → `uploading` → `analyzing` → `reviewed`
- After review: `no_issues` / `regrade_candidates` (with tier badges) / `points_recovered`
- Click into an assignment for:
  - Embedded PDF viewer (from local storage)
  - Rendered regrade draft (markdown)
  - Per-question breakdown with confidence tier
  - "Copy to clipboard" button for regrade text
  - Score change history if applicable
- Each course header shows "Y points recovered in [Course Name]"
- Each assignment with a successful regrade shows a green "+N pts" badge inline

**Upcoming Assignments**
- Pulled from Gradescope dashboard scrape during heartbeat
- Shows due dates, course name, assignment name
- List view sorted by due date

**Settings**
- Course management (enable/disable, re-acknowledge policy)
- Gradescope credentials (update)
- Notification preferences (on/off)
- Privacy info (data transparency screen)
- Account (Gmail address, sign out)

### 8.2 Navigation

Left sidebar with: Poko logo/mascot, Home, Assignments, Upcoming, Settings.

### 8.3 Metrics Integration

Metrics are woven into existing views, not a separate page:
- Home: hero stat + supporting numbers
- Assignment view: per-item "+N pts" badges
- Course headers: per-course totals
- Email notifications: running total in footer

## 9. Server API

### 9.1 Endpoints

```
POST   /auth/verify           — validate Gmail OAuth token, create user if new
POST   /jobs                  — upload PDF + metadata, returns job_id
GET    /jobs/{job_id}/status   — poll for results (processing/complete/failed)
GET    /jobs/{job_id}/result   — fetch analysis.json + regrade_draft.md
DELETE /jobs/{job_id}          — client confirms receipt, server deletes everything
POST   /scores/sync           — client sends current score snapshot for change detection
GET    /users/me/stats        — aggregate metrics for this user
GET    /health                — server health check
```

### 9.2 Job Lifecycle

```
uploaded → preprocessing → analyzing → complete | failed
```

- Jobs in `uploaded` or `preprocessing` state on server restart are re-run
- Completed jobs are held for 7 days, then purged
- Client calls `DELETE /jobs/{id}` after fetching results to trigger immediate cleanup

### 9.3 Database

SQLite with tables:
- `users` — gmail, created_at, notification_prefs
- `courses` — user_id, course_id, course_name, enabled, policy_ack_at
- `jobs` — id, user_id, course_id, assignment_id, status, pdf_hash, created_at, completed_at, result_json, draft_md
- `score_snapshots` — user_id, course_id, assignment_id, score, max_score, recorded_at
- `metrics` — user_id, points_recovered, pages_reviewed, assignments_analyzed

## 10. Privacy & Data Handling

### 10.1 Server-Side Data Lifecycle

| Data | Stored? | Duration |
|------|---------|----------|
| PDF uploads | Temp disk only | Deleted immediately after analysis |
| Analysis results | SQLite | Until client fetches, max 7 days |
| Regrade drafts | SQLite | Until client fetches, max 7 days |
| Score snapshots | SQLite | Kept for change detection (numbers only) |
| User email | SQLite | Until account deleted |
| Enabled courses | SQLite | Until account deleted |
| Aggregate metrics | SQLite | Until account deleted |
| OAuth tokens | Never stored | Validated per-request, discarded |
| Gradescope creds | Never touches server | Client-side OS keychain only |

### 10.2 Client-Side Storage

- Gradescope credentials → OS keychain (encrypted by OS)
- OAuth refresh token → OS keychain
- Downloaded PDFs → local app data directory
- Analysis results + regrade drafts → local app data directory
- Job queue state → local app data directory

### 10.3 Privacy Guarantees

1. "We never store your assignments."
2. "Your Gradescope password never leaves your device."
3. "We only keep your email and course stats on our server."
4. "All results are delivered to your device then purged from our server."
5. "Delete your account and all server-side data is gone immediately."

## 11. Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri 2.x (Rust) — macOS only for initial release |
| Frontend | React 18 + TypeScript + shadcn/ui + Tailwind CSS |
| Build | Vite |
| Server | Python 3.13 + FastAPI + SQLite |
| Analysis | Claude Code CLI (sonnet prescreen + opus max) |
| Email (MVP) | SMTP from configured email account |
| Auth | Google OAuth 2.0 (email scope only) |
| Credential storage | Tauri secure store plugin (OS keychain) |
| Gradescope client | Python sidecar (bundled with Tauri app) |

## 12. Project Structure

```
poko/
├── client/                      # Tauri app (open source)
│   ├── src-tauri/               # Rust backend
│   │   ├── src/
│   │   │   └── main.rs          # Tauri commands, sidecar management
│   │   ├── sidecar/             # Bundled Python scripts
│   │   │   ├── gs_client.py     # Gradescope client (reused)
│   │   │   ├── fetcher.py       # Fetch pipeline (reused)
│   │   │   ├── rate_limit.py    # Rate limiter (reused)
│   │   │   └── sidecar_main.py  # CLI entry point for Tauri to call
│   │   ├── Cargo.toml
│   │   └── tauri.conf.json
│   ├── src/                     # React frontend
│   │   ├── components/          # shadcn/ui components
│   │   ├── views/
│   │   │   ├── Home.tsx
│   │   │   ├── Assignments.tsx
│   │   │   ├── AssignmentDetail.tsx
│   │   │   ├── Upcoming.tsx
│   │   │   └── Settings.tsx
│   │   ├── lib/
│   │   │   ├── api.ts           # Server API client
│   │   │   ├── auth.ts          # Gmail OAuth flow
│   │   │   ├── queue.ts         # Outbound job queue
│   │   │   └── store.ts         # Local state management
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   └── tsconfig.json
├── server/                      # FastAPI server (closed source)
│   ├── server/
│   │   ├── api.py               # Route handlers
│   │   ├── auth.py              # OAuth verification
│   │   ├── jobs.py              # Job queue + lifecycle
│   │   ├── analyzer.py          # Two-stage Claude pipeline (reused)
│   │   ├── notifications.py     # Email sending (SMTP)
│   │   ├── metrics.py           # Score tracking + aggregation
│   │   ├── models.py            # SQLite models
│   │   └── config.py            # Server config
│   ├── prompts/                 # Regrade + prescreen prompts (reused)
│   │   ├── regrade_check.md
│   │   └── regrade_prescreen.md
│   ├── tests/
│   └── pyproject.toml
├── docs/
└── README.md
```

## 13. Code Reuse from Existing Bot

The following modules from the current `gradescope_bot/` are reused:

| Existing Module | Destination | Changes |
|----------------|-------------|---------|
| `gs_client.py` | `client/src-tauri/sidecar/` | None — used as-is via sidecar |
| `fetcher.py` | `client/src-tauri/sidecar/` | Remove heartbeat coupling, expose as CLI |
| `rate_limit.py` | `client/src-tauri/sidecar/` | None |
| `analyzer.py` | `server/server/` | Add confidence tiers to output schema |
| `config.py` | Split between client sidecar + server | Separate configs for each |
| `prompts/regrade_check.md` | `server/prompts/` | Add confidence tier classification |
| `prompts/regrade_prescreen.md` | `server/prompts/` | None |

Modules NOT reused (replaced by new infrastructure):
- `heartbeat.py` — replaced by Tauri background process
- `scheduler.py` — rewritten for Tauri's event system
- `storage.py` — replaced by SQLite on server, local state on client
- `serve.py` + templates — replaced by React dashboard

## 14. Sub-Project Decomposition

This spec covers the full product vision. Implementation is split into sub-projects built in order:

### Sub-Project 1: Server API + Auth
- FastAPI server with SQLite
- Gmail OAuth verification
- Job upload/poll/result endpoints
- Analysis pipeline (reused)
- Email notifications
- Score sync + metrics
- Server health + crash recovery

### Sub-Project 2: Tauri Desktop App
- Tauri + React + shadcn/ui scaffold
- Gmail OAuth flow in desktop context
- Gradescope credential entry + keychain storage
- Python sidecar integration
- Course setup wizard + policy gate
- Outbound job queue with retry
- Dashboard views (Home, Assignments, Upcoming, Settings)
- PDF viewer + regrade draft display
- Background heartbeat

### Sub-Project 3: Payment (Stripe) — deferred
- Stripe integration with metered billing
- $5/month charged only when points recovered
- Card management UI in Settings
- Grace period + dunning logic

### Sub-Project 4: Gacha Pet — deferred
- Pet spawns on first install
- Visual companion in the app
- Design and art TBD

## 15. Platform Support

- **Mac (primary):** macOS 12+ (Monterey and later). Tauri 2.x supports this natively.
- **Windows (future):** Tauri is cross-platform. Windows support is a build/test effort, not a redesign. The Python sidecar and server are already platform-agnostic.

## 16. Rate Limiting

### 16.1 Gradescope (Client-Side)

Reused from existing bot:
- Minimum 2.0 seconds between requests + 0.5s random jitter
- Per-run cap: 50 requests
- Daily cap: 150 requests
- 429/503 exponential backoff (handled in session monkey-patch)

### 16.2 Server API

- Per-user rate limit: 100 requests/hour (prevents abuse)
- Job submission limit: 50 PDFs/day per user (matches Gradescope daily cap)
- File size limit: 50 MB per PDF upload

# Poko Full-Scale E2E Testing Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the entire Poko system works end-to-end across two machines: Linux laptop as server, Mac mini as client, with real Gradescope data.

**Architecture:** Linux (100.101.173.53) runs the Poko server on port 8080 in dev mode. Mac mini (100.115.196.42, user xiaoxia) runs the Tauri desktop app which talks to the server over Tailnet. The Mac's Python sidecar uses pyenv Python 3.12.

**Environment:**
- Linux: `POKO_DEV_MODE=1 POKO_DEV_EMAIL=chrisshi.lab@gmail.com` server at `http://100.101.173.53:8080`
- Mac: SSH as `ssh xiaoxia@100.115.196.42`, Python at `/Users/xiaoxia/.pyenv/versions/3.12.8/bin/python3`, repo at `~/Desktop/poko`
- Gradescope creds: sourced from `/home/hshi/Desktop/Gradescope-Bot/.env` on Linux (`GS_EMAIL`, `GS_PASSWORD`)

**SSH shorthand for all Mac commands:**
```bash
ssh xiaoxia@100.115.196.42 '<command>'
```

**Mac PATH prefix for all commands on Mac:**
```bash
export PATH="$HOME/.pyenv/versions/3.12.8/bin:$HOME/.bun/bin:$HOME/.cargo/bin:$PATH" && export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
```

---

### Task 1: Server Startup + Health Verification

**Purpose:** Ensure the Linux server is running and reachable from Mac over Tailnet.

- [ ] **Step 1: Start the server on Linux**

```bash
cd /home/hshi/Desktop/Gradescope-Bot/server
pkill -f poko_server 2>/dev/null; sleep 1
POKO_DEV_MODE=1 POKO_DEV_EMAIL=chrisshi.lab@gmail.com PYTHONPATH=. python -m poko_server &
sleep 3
curl -s http://localhost:8080/health
```

Expected: `{"status":"ok","uptime_seconds":...}`

- [ ] **Step 2: Verify Mac can reach server**

```bash
ssh xiaoxia@100.115.196.42 'curl -s http://100.101.173.53:8080/health'
```

Expected: `{"status":"ok","uptime_seconds":...}`

- [ ] **Step 3: Verify dev auth from Mac**

```bash
ssh xiaoxia@100.115.196.42 'curl -s -X POST http://100.101.173.53:8080/auth/verify -H "Authorization: Bearer dev-token-placeholder"'
```

Expected: `{"email":"chrisshi.lab@gmail.com","user_id":"..."}`

---

### Task 2: Mac Sidecar Verification

**Purpose:** Verify the Python sidecar works on macOS with pyenv Python 3.12.

- [ ] **Step 1: Test sidecar login**

```bash
source /home/hshi/Desktop/Gradescope-Bot/.env
ssh xiaoxia@100.115.196.42 "export PATH=\"\$HOME/.pyenv/versions/3.12.8/bin:\$PATH\" && cd ~/Desktop/poko/client/sidecar && python3 sidecar_main.py login '$GS_EMAIL' '$GS_PASSWORD'"
```

Expected: `{"ok": true}`

- [ ] **Step 2: Test sidecar course fetch**

```bash
source /home/hshi/Desktop/Gradescope-Bot/.env
ssh xiaoxia@100.115.196.42 "export PATH=\"\$HOME/.pyenv/versions/3.12.8/bin:\$PATH\" && cd ~/Desktop/poko/client/sidecar && python3 sidecar_main.py courses '$GS_EMAIL' '$GS_PASSWORD'" | python3 -m json.tool
```

Expected: `{"ok": true, "courses": [...]}` with 6 courses

- [ ] **Step 3: Test sidecar fetch graded**

```bash
source /home/hshi/Desktop/Gradescope-Bot/.env
ssh xiaoxia@100.115.196.42 "export PATH=\"\$HOME/.pyenv/versions/3.12.8/bin:\$PATH\" && cd ~/Desktop/poko/client/sidecar && mkdir -p /tmp/poko_test && python3 sidecar_main.py fetch '$GS_EMAIL' '$GS_PASSWORD' '[\"1222348\"]' /tmp/poko_test '[]'" | python3 -c "
import sys, json
d = json.load(sys.stdin)
assert d['ok']
for item in d['items']:
    for k in ['course_id','assignment_id','name','score','max_score','type','pdf_hash','pdf_path']:
        assert k in item, f'Missing {k}'
print(f'PASS: {len(d[\"items\"])} items, {len(d[\"scores\"])} scores')
"
```

Expected: `PASS: 2 items, 2 scores`

- [ ] **Step 4: Verify output shapes match TypeScript contracts**

Check that every field the TS `heartbeat.ts` reads is present:
- items: `course_id, assignment_id, submission_id, name, score, max_score, due_date, type, pdf_hash, pdf_path`
- scores: `course_id, assignment_id, score, max_score`

---

### Task 3: Cross-Machine Upload + Analysis

**Purpose:** Upload a PDF from the Mac to the Linux server, verify analysis runs and returns results.

- [ ] **Step 1: Upload PDF from Mac**

```bash
ssh xiaoxia@100.115.196.42 "curl -s -X POST http://100.101.173.53:8080/jobs \
  -H 'Authorization: Bearer dev-token-placeholder' \
  -F 'file=@/tmp/poko_test/1222348_7696546/submission.pdf;type=application/pdf' \
  -F 'course_id=1222348' \
  -F 'assignment_id=7696546' \
  -F 'assignment_name=Exam 1' \
  -F 'course_name=18100'"
```

Expected: `{"job_id":"...","status":"uploaded"}`

- [ ] **Step 2: Poll until complete (from Mac)**

```bash
JOB_ID=<job_id from step 1>
ssh xiaoxia@100.115.196.42 "curl -s http://100.101.173.53:8080/jobs/$JOB_ID/status -H 'Authorization: Bearer dev-token-placeholder'"
```

Repeat every 30s until status is `complete` or `failed`. Expected: ~5-10 min for opus max.

- [ ] **Step 3: Fetch result from Mac**

```bash
ssh xiaoxia@100.115.196.42 "curl -s http://100.101.173.53:8080/jobs/$JOB_ID/result -H 'Authorization: Bearer dev-token-placeholder'" | python3 -c "
import sys, json
d = json.load(sys.stdin)
r = json.loads(d['result_json'])
print(f'Status: {d[\"status\"]}')
print(f'Verdict: {r[\"overall_verdict\"]}')
print(f'Issues: {r[\"kept_issue_count\"]}')
print(f'Draft: {\"yes\" if d[\"draft_md\"] else \"no\"}')
"
```

Expected: `Status: complete`, valid verdict

- [ ] **Step 4: Delete job from Mac**

```bash
ssh xiaoxia@100.115.196.42 "curl -s -X DELETE http://100.101.173.53:8080/jobs/$JOB_ID -H 'Authorization: Bearer dev-token-placeholder'"
```

Expected: `{"deleted":true}`

- [ ] **Step 5: Verify stats updated**

```bash
ssh xiaoxia@100.115.196.42 "curl -s http://100.101.173.53:8080/users/me/stats -H 'Authorization: Bearer dev-token-placeholder'" | python3 -m json.tool
```

Expected: `pages_reviewed > 0`, `assignments_analyzed > 0`

---

### Task 4: Score Sync from Mac

**Purpose:** Verify score change detection works cross-machine.

- [ ] **Step 1: Send baseline scores**

```bash
ssh xiaoxia@100.115.196.42 "curl -s -X POST http://100.101.173.53:8080/scores/sync \
  -H 'Authorization: Bearer dev-token-placeholder' \
  -H 'Content-Type: application/json' \
  -d '{\"scores\": [{\"course_id\": \"1222348\", \"assignment_id\": \"9999\", \"score\": 80.0, \"max_score\": 100.0}]}'"
```

Expected: `changes_detected: 0`

- [ ] **Step 2: Send increased score**

```bash
ssh xiaoxia@100.115.196.42 "curl -s -X POST http://100.101.173.53:8080/scores/sync \
  -H 'Authorization: Bearer dev-token-placeholder' \
  -H 'Content-Type: application/json' \
  -d '{\"scores\": [{\"course_id\": \"1222348\", \"assignment_id\": \"9999\", \"score\": 85.0, \"max_score\": 100.0}]}'"
```

Expected: `changes_detected: 1, total_points_delta: 5.0` (only if a job exists for that assignment — otherwise `changes_detected: 0` is correct per the attribution logic)

---

### Task 5: Tauri App GUI Test on Mac

**Purpose:** Open the Poko.app on the Mac and walk through the full onboarding + dashboard.

- [ ] **Step 1: Launch the app**

```bash
ssh xiaoxia@100.115.196.42 'open ~/Desktop/poko/client/src-tauri/target/release/bundle/macos/Poko.app'
```

Or for dev mode with hot reload:
```bash
ssh xiaoxia@100.115.196.42 'export PATH="$HOME/.bun/bin:$HOME/.cargo/bin:$PATH" && export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && cd ~/Desktop/poko/client && bun run tauri dev'
```

NOTE: This requires a display. If SSH, the user must be physically at the Mac or use screen sharing.

- [ ] **Step 2: Walk through onboarding**

1. Step 0: "How your data is handled" → verify privacy text is accurate → click "I understand, continue"
2. Step 1: Enter Gradescope email + password → click "Test Login" → verify green checkmark → click "Continue"
3. Step 2: Verify 6 courses appear → toggle one on → verify PolicyModal appears → check checkbox → click "Enable Course" → click "Finish Setup"

- [ ] **Step 3: Verify dashboard**

1. Home view: hero stat (0 points), supporting stats, heartbeat status, empty activity feed
2. Click "Run Now" → verify spinner → wait for heartbeat to complete → verify activity entries appear
3. Navigate to Assignments → verify assignments are listed with status badges
4. Click an assignment → verify PDF embed loads (if available) and regrade draft renders
5. Navigate to Upcoming → verify empty or populated list
6. Navigate to Settings → verify courses listed, privacy text, sign out button

- [ ] **Step 4: Verify server interaction**

During the "Run Now" heartbeat:
- Check server logs on Linux for incoming job uploads
- Verify jobs appear in status `uploaded` → `analyzing` → `complete`
- Verify stats update on both server (`/users/me/stats`) and Home view

---

### Task 6: Error Handling Verification

**Purpose:** Verify the app handles failure cases gracefully.

- [ ] **Step 1: Server offline — test from Mac**

Stop the server on Linux:
```bash
pkill -f poko_server
```

On the Mac Tauri app, click "Run Now". Verify:
- Heartbeat reports error (not crash)
- Dashboard shows "Server offline" or error message
- App remains usable (doesn't freeze or crash)

Restart server after test.

- [ ] **Step 2: Bad Gradescope credentials**

In onboarding (or reset via Settings > Sign Out), enter wrong credentials. Verify:
- "Test Login" shows clear error message
- "Continue" button stays disabled
- No crash or hang

- [ ] **Step 3: Non-PDF assignment**

Verify the sidecar's PDF-only filter works — non-PDF submissions should be skipped, not uploaded.

---

### Task 7: Server Test Suite on Linux

**Purpose:** Confirm all automated tests still pass after all the integration work.

- [ ] **Step 1: Run server tests**

```bash
cd /home/hshi/Desktop/Gradescope-Bot
PYTHONPATH=server python -m pytest server/tests/ -v
```

Expected: 40/40 passed

- [ ] **Step 2: Run client build**

```bash
cd /home/hshi/Desktop/Gradescope-Bot/client
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$HOME/.cargo/bin:$HOME/.bun/bin:$PATH"
bun run build
```

Expected: Clean build, no errors

---

## Execution Notes

- Tasks 1-4 can be run entirely via SSH from the Linux machine (no display needed)
- Task 5 requires physical access to the Mac or screen sharing (GUI test)
- Task 6 requires both machines
- Task 7 is Linux-only
- The Claude analysis in Task 3 takes ~5-10 minutes per exam — budget accordingly
- Each analysis costs ~$1-2 in Claude API tokens

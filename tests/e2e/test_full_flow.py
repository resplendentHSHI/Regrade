"""Full end-to-end flow test simulating exactly what the Tauri app does.

Requires:
  - Server running at SERVER_URL with POKO_DEV_MODE=1
  - GS_EMAIL and GS_PASSWORD in environment
  - Run with: python tests/e2e/test_full_flow.py

This walks through every step the app takes, validating data shapes at each point.
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.error

SERVER_URL = os.environ.get("POKO_SERVER_URL", "http://localhost:8080")
TOKEN = "dev-token-placeholder"
GS_EMAIL = os.environ.get("GS_EMAIL", "")
GS_PASSWORD = os.environ.get("GS_PASSWORD", "")
SIDECAR_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "client", "sidecar")
SIDECAR_MAIN = os.path.join(SIDECAR_DIR, "sidecar_main.py")
PYTHON = sys.executable

passed = 0
failed = 0
errors = []


def check(name: str, condition: bool, detail: str = ""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  PASS: {name}")
    else:
        failed += 1
        msg = f"  FAIL: {name}" + (f" — {detail}" if detail else "")
        print(msg)
        errors.append(msg)


def api_request(method: str, path: str, data=None, headers=None, files=None):
    """Make an HTTP request to the server."""
    url = f"{SERVER_URL}{path}"
    if headers is None:
        headers = {}
    headers["Authorization"] = f"Bearer {TOKEN}"

    if files:
        # Use curl for multipart
        cmd = ["curl", "-s", "-X", method, url]
        for k, v in headers.items():
            cmd += ["-H", f"{k}: {v}"]
        for key, (filename, filepath, content_type) in files.items():
            cmd += ["-F", f"{key}=@{filepath};type={content_type}"]
        if data:
            for k, v in data.items():
                cmd += ["-F", f"{k}={v}"]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        return json.loads(result.stdout) if result.stdout else None
    elif data:
        body = json.dumps(data).encode()
        headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
    else:
        req = urllib.request.Request(url, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {"_status": e.code, "_body": e.read().decode()}


def run_sidecar(args: list[str], cwd: str = "/tmp") -> dict:
    result = subprocess.run(
        [PYTHON, SIDECAR_MAIN, *args],
        capture_output=True, text=True, timeout=120,
        cwd=cwd,
    )
    if result.stdout.strip():
        return json.loads(result.stdout.strip())
    return {"ok": False, "error": result.stderr}


def main():
    global passed, failed

    if not GS_EMAIL or not GS_PASSWORD:
        print("ERROR: Set GS_EMAIL and GS_PASSWORD in environment")
        sys.exit(1)

    print("\n=== Phase 1: Server Health ===")
    try:
        health = api_request("GET", "/health")
        check("server_health", health and health.get("status") == "ok",
              f"got: {health}")
    except Exception as e:
        check("server_health", False, f"server unreachable: {e}")
        print("\nServer must be running. Aborting.")
        sys.exit(1)

    print("\n=== Phase 2: Auth ===")
    auth = api_request("POST", "/auth/verify")
    check("auth_verify_returns_email", auth and "email" in auth, f"got: {auth}")
    check("auth_verify_returns_user_id", auth and "user_id" in auth, f"got: {auth}")

    print("\n=== Phase 3: Sidecar Login ===")
    login = run_sidecar(["login", GS_EMAIL, GS_PASSWORD])
    check("sidecar_login_ok", login.get("ok") is True, f"got: {login}")

    print("\n=== Phase 4: Sidecar Courses ===")
    courses = run_sidecar(["courses", GS_EMAIL, GS_PASSWORD])
    check("sidecar_courses_ok", courses.get("ok") is True, f"got: {courses}")
    check("sidecar_courses_has_list", isinstance(courses.get("courses"), list),
          f"type: {type(courses.get('courses'))}")
    if courses.get("courses"):
        c = courses["courses"][0]
        for key in ["id", "name", "semester", "year"]:
            check(f"course_has_{key}", key in c, f"keys: {list(c.keys())}")
    course_ids = [c["id"] for c in courses.get("courses", [])]
    check("at_least_one_course", len(course_ids) > 0, f"found {len(course_ids)}")

    print("\n=== Phase 5: Sidecar Fetch Graded ===")
    test_dir = tempfile.mkdtemp(prefix="poko_e2e_")
    # Use first course only to keep it fast
    test_course = course_ids[0] if course_ids else "1222348"
    fetch = run_sidecar(["fetch", GS_EMAIL, GS_PASSWORD,
                         json.dumps([test_course]), test_dir, "[]"])
    check("sidecar_fetch_ok", fetch.get("ok") is True, f"got: {fetch}")
    items = fetch.get("items", [])
    scores = fetch.get("scores", [])
    check("fetch_has_items_list", isinstance(items, list), f"type: {type(items)}")
    check("fetch_has_scores_list", isinstance(scores, list), f"type: {type(scores)}")

    # Validate item shape matches TypeScript heartbeat.ts expectations
    if items:
        item = items[0]
        REQUIRED_ITEM_KEYS = ["course_id", "assignment_id", "submission_id", "name",
                              "score", "max_score", "due_date", "type", "pdf_hash", "pdf_path"]
        for key in REQUIRED_ITEM_KEYS:
            check(f"item_has_{key}", key in item, f"keys: {list(item.keys())}")
        check("item_pdf_exists", os.path.isfile(item.get("pdf_path", "")),
              f"path: {item.get('pdf_path')}")
        check("item_pdf_hash_is_64_hex", len(item.get("pdf_hash", "")) == 64,
              f"hash: {item.get('pdf_hash', '')[:20]}")

    # Validate score shape matches TypeScript api.syncScores expectations
    if scores:
        s = scores[0]
        REQUIRED_SCORE_KEYS = ["course_id", "assignment_id", "score", "max_score"]
        for key in REQUIRED_SCORE_KEYS:
            check(f"score_has_{key}", key in s, f"keys: {list(s.keys())}")

    print("\n=== Phase 6: Score Sync ===")
    if scores:
        sync_result = api_request("POST", "/scores/sync", data={"scores": scores})
        check("score_sync_ok", sync_result and "changes_detected" in sync_result,
              f"got: {sync_result}")
    else:
        print("  SKIP: no scores to sync")

    print("\n=== Phase 7: PDF Upload to Server ===")
    if items:
        item = items[0]
        upload = api_request("POST", "/jobs",
                             data={"course_id": item["course_id"],
                                   "assignment_id": item["assignment_id"],
                                   "assignment_name": item["name"],
                                   "course_name": ""},
                             files={"file": ("submission.pdf", item["pdf_path"],
                                             "application/pdf")})
        check("upload_returns_job_id", upload and "job_id" in upload, f"got: {upload}")
        check("upload_status_uploaded", upload and upload.get("status") == "uploaded",
              f"status: {upload.get('status')}")
        job_id = upload.get("job_id", "")

        print("\n=== Phase 8: Job Status Polling ===")
        status = api_request("GET", f"/jobs/{job_id}/status")
        check("status_returns_job_id", status and status.get("job_id") == job_id,
              f"got: {status}")
        initial_status = status.get("status", "")
        check("status_is_valid", initial_status in ("uploaded", "analyzing", "complete", "failed"),
              f"status: {initial_status}")

        print("\n=== Phase 9: Wait for Analysis (polling) ===")
        print("  Waiting for Claude analysis (this takes 5-10 minutes)...")
        max_wait = 720  # 12 minutes
        poll_interval = 30
        elapsed = 0
        final_status = initial_status
        while elapsed < max_wait and final_status not in ("complete", "failed"):
            time.sleep(poll_interval)
            elapsed += poll_interval
            s = api_request("GET", f"/jobs/{job_id}/status")
            final_status = s.get("status", "") if s else "error"
            print(f"  [{elapsed}s] status={final_status}")

        check("analysis_completed", final_status in ("complete", "failed"),
              f"status after {elapsed}s: {final_status}")

        print("\n=== Phase 10: Fetch Result ===")
        if final_status == "complete":
            result = api_request("GET", f"/jobs/{job_id}/result")
            check("result_has_result_json", result and result.get("result_json") is not None,
                  f"got: {result}")
            check("result_has_draft_md_field", result and "draft_md" in result,
                  f"keys: {list(result.keys()) if result else 'none'}")

            if result and result.get("result_json"):
                parsed = json.loads(result["result_json"])
                check("result_has_overall_verdict",
                      parsed.get("overall_verdict") in ("needs_review", "no_issues_found"),
                      f"verdict: {parsed.get('overall_verdict')}")
                check("result_has_issues_array", isinstance(parsed.get("issues"), list),
                      f"type: {type(parsed.get('issues'))}")
                check("result_has_kept_issue_count",
                      isinstance(parsed.get("kept_issue_count"), int),
                      f"type: {type(parsed.get('kept_issue_count'))}")

                # Validate confidence_tier on each issue
                for issue in parsed.get("issues", []):
                    check(f"issue_{issue.get('question','?')}_has_confidence_tier",
                          issue.get("confidence_tier") in ("critical", "strong", "marginal"),
                          f"tier: {issue.get('confidence_tier')}")

        print("\n=== Phase 11: Delete Job ===")
        delete = api_request("DELETE", f"/jobs/{job_id}")
        check("delete_ok", delete and delete.get("deleted") is True, f"got: {delete}")

        verify = api_request("GET", f"/jobs/{job_id}/status")
        check("deleted_returns_404", verify and verify.get("_status") == 404,
              f"got: {verify}")
    else:
        print("  SKIP: no items to upload")

    print("\n=== Phase 12: User Stats ===")
    stats = api_request("GET", "/users/me/stats")
    check("stats_has_email", stats and "email" in stats, f"got: {stats}")
    check("stats_has_points_recovered", stats and "points_recovered" in stats, f"got: {stats}")
    check("stats_has_pages_reviewed", stats and "pages_reviewed" in stats, f"got: {stats}")
    check("stats_has_assignments_analyzed", stats and "assignments_analyzed" in stats, f"got: {stats}")
    if stats:
        check("pages_reviewed_positive", stats.get("pages_reviewed", 0) > 0,
              f"pages: {stats.get('pages_reviewed')}")

    print("\n=== Phase 13: Sidecar Upcoming ===")
    upcoming = run_sidecar(["upcoming", GS_EMAIL, GS_PASSWORD,
                            json.dumps(course_ids)])
    check("upcoming_ok", upcoming.get("ok") is True, f"got: {upcoming}")
    check("upcoming_has_assignments", isinstance(upcoming.get("assignments"), list),
          f"type: {type(upcoming.get('assignments'))}")

    print("\n=== Phase 14: Duplicate Upload Dedup ===")
    if items:
        item = items[0]
        dup1 = api_request("POST", "/jobs",
                           data={"course_id": item["course_id"],
                                 "assignment_id": item["assignment_id"],
                                 "assignment_name": item["name"],
                                 "course_name": ""},
                           files={"file": ("submission.pdf", item["pdf_path"],
                                           "application/pdf")})
        dup2 = api_request("POST", "/jobs",
                           data={"course_id": item["course_id"],
                                 "assignment_id": item["assignment_id"],
                                 "assignment_name": item["name"],
                                 "course_name": ""},
                           files={"file": ("submission.pdf", item["pdf_path"],
                                           "application/pdf")})
        check("dedup_same_job_id",
              dup1 and dup2 and dup1.get("job_id") == dup2.get("job_id"),
              f"ids: {dup1.get('job_id')} vs {dup2.get('job_id')}")
        # Clean up
        if dup1 and dup1.get("job_id"):
            api_request("DELETE", f"/jobs/{dup1['job_id']}")

    print("\n=== Phase 15: Error Handling ===")
    # Bad token
    old_token = TOKEN
    bad_req = urllib.request.Request(
        f"{SERVER_URL}/users/me/stats",
        headers={"Authorization": "Bearer bad-token-xyz"},
    )
    try:
        urllib.request.urlopen(bad_req)
        check("bad_token_rejected", False, "should have returned 401")
    except urllib.error.HTTPError as e:
        check("bad_token_rejected", e.code == 401, f"status: {e.code}")

    # Non-PDF upload
    with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as f:
        f.write(b"not a pdf")
        f.flush()
        non_pdf = api_request("POST", "/jobs",
                              data={"course_id": "1", "assignment_id": "1",
                                    "assignment_name": "test", "course_name": "test"},
                              files={"file": ("test.txt", f.name, "text/plain")})
        # Should be rejected
        check("non_pdf_rejected",
              non_pdf and (non_pdf.get("detail") or non_pdf.get("_status") == 400),
              f"got: {non_pdf}")
        os.unlink(f.name)

    # Nonexistent job
    not_found = api_request("GET", "/jobs/nonexistent-id-12345/status")
    check("nonexistent_job_404",
          not_found and not_found.get("_status") == 404,
          f"got: {not_found}")

    # ── Summary ───────────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    print(f"RESULTS: {passed} passed, {failed} failed out of {passed + failed} checks")
    if errors:
        print("\nFailures:")
        for e in errors:
            print(f"  {e}")
    print(f"{'='*60}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()

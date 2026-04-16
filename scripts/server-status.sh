#!/usr/bin/env bash
# Pretty-print Poko server status.
# Usage: POKO_ADMIN_SECRET=xxx ./scripts/server-status.sh [server_url]
set -euo pipefail

URL="${1:-https://tp64.tailf28040.ts.net}"
SECRET="${POKO_ADMIN_SECRET:-admin123}"

exec python3 - "$URL" "$SECRET" <<'PYEOF'
import sys, json, urllib.request, urllib.error

url = sys.argv[1].rstrip("/")
secret = sys.argv[2]

def fetch(path):
    try:
        with urllib.request.urlopen(f"{url}{path}", timeout=10) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"_status": e.code, "_body": e.read().decode()}
    except Exception as e:
        return {"_error": str(e)}

print(f"── Poko server @ {url}\n")

h = fetch("/health")
if h.get("status") == "ok":
    hours = h.get("uptime_seconds", 0) / 3600
    print(f"  status:           ok (up {hours:.1f}h)")
else:
    print(f"  status:           DOWN ({h})")
    sys.exit(1)
print()

s = fetch(f"/admin/stats?secret={secret}")
if "_status" in s or "_error" in s or "detail" in s:
    print(f"  stats unavailable: {s}")
else:
    total = s.get("total_jobs", 0)
    done = s.get("jobs_complete", 0)
    failed = s.get("jobs_failed", 0)
    in_flight = total - done - failed
    print(f"  users:            {s.get('total_users', '?')}")
    print(f"  jobs:             {total} total  |  {done} done  |  {failed} failed  |  {in_flight} in flight")
    print(f"  pages reviewed:   {s.get('total_pages_reviewed', 0)}")
    print(f"  points recovered: {s.get('total_points_recovered', 0)}")
    print(f"  api requests:     {s.get('api_requests_today', 0)} today / {s.get('api_requests_total', 0)} total")
print()

u = fetch(f"/admin/users?secret={secret}")
users = u.get("users", [])
if not users:
    print("  (no users yet)")
else:
    print(f"  Per-user ({len(users)}):")
    for row in users:
        email = row.get("email", "?")
        a = row.get("assignments_analyzed", 0)
        p = row.get("points_recovered", 0.0)
        c = (row.get("created_at") or "")[:10]
        print(f"    {email:35} {a:4} analyzed  +{p:5.1f} pts  joined {c}")
PYEOF

#!/usr/bin/env bash
# Mimics a successful claude -p run by writing a canned analysis.json
# to whatever --add-dir path was given.
set -euo pipefail
ADD_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --add-dir) ADD_DIR="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [[ -z "$ADD_DIR" ]]; then
  echo "fake_claude_ok: missing --add-dir" >&2
  exit 2
fi
cat > "${ADD_DIR}/analysis.json" <<'JSON'
{
  "item_id": "1222348_7453474",
  "model": "claude-opus-4-6",
  "overall_verdict": "needs_review",
  "summary": "Synthetic verdict from fake_claude_ok.sh",
  "issues": [
    {
      "question": "Q1",
      "category": "missed_correct_work",
      "severity": "medium",
      "rubric_item_cited": "Incorrect",
      "points_disputed": 1.0,
      "reasoning": "Synthetic reasoning.",
      "keep": true
    }
  ],
  "kept_issue_count": 1
}
JSON
# Emit the same JSON on stdout as the claude -p --output-format json wrapper would
printf '{"type":"result","is_error":false,"structured_output":%s}\n' "$(cat "${ADD_DIR}/analysis.json")"

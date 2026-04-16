#!/usr/bin/env bash
ADD_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --add-dir) ADD_DIR="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [[ -z "$ADD_DIR" ]]; then echo "ERROR: --add-dir not provided" >&2; exit 1; fi

cat > "$ADD_DIR/analysis.json" <<'ENDJSON'
{
  "item_id": "test-item",
  "model": "opus",
  "overall_verdict": "needs_review",
  "summary": "Found one issue with Q3.",
  "issues": [
    {
      "question": "Q3",
      "category": "rubric_misapplication",
      "severity": "high",
      "confidence_tier": "critical",
      "rubric_item_cited": "Clairaut's theorem",
      "points_disputed": 4,
      "reasoning": "Conditions were stated correctly.",
      "keep": true
    }
  ],
  "kept_issue_count": 1
}
ENDJSON

cat > "$ADD_DIR/regrade_draft.md" <<'ENDDRAFT'
# Regrade Requests — HW7

## Question 3 — Clairaut's theorem

**Requesting regrade for:** 4 points deducted under "Clairaut's theorem"

**Reason for request:**
The conditions for Clairaut's theorem were stated correctly.
ENDDRAFT

cat "$ADD_DIR/analysis.json"

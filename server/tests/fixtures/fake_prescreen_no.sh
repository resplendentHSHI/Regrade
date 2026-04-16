#!/usr/bin/env bash
ADD_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --add-dir) ADD_DIR="$2"; shift 2 ;;
    *) shift ;;
  esac
done
cat > "$ADD_DIR/prescreen.json" <<'EOF'
{"has_regradable_content": false, "reason": "Auto-graded quiz, no rubric"}
EOF
cat "$ADD_DIR/prescreen.json"

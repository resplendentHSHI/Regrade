#!/usr/bin/env bash
# Prescreen fake: returns has_regradable_content=true
set -euo pipefail
ADD_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --add-dir) ADD_DIR="$2"; shift 2 ;;
    *) shift ;;
  esac
done
cat > "${ADD_DIR}/prescreen.json" <<'JSON'
{"has_regradable_content": true, "reason": "handwritten work with rubric overlays"}
JSON
printf '{"type":"result","is_error":false,"structured_output":%s}\n' "$(cat "${ADD_DIR}/prescreen.json")"

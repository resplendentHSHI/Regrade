#!/usr/bin/env bash
set -euo pipefail
ADD_DIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --add-dir) ADD_DIR="$2"; shift 2 ;;
    *) shift ;;
  esac
done
echo "{ this is not valid json" > "${ADD_DIR}/analysis.json"
printf '{"type":"result","is_error":false}\n'

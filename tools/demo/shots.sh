#!/usr/bin/env bash
# Screenshot the demo machine (tools/demo/up.sh) at 2x: desktop and phone, dark and light.
#   shots.sh [out-dir]       default ./shots; needs agent-browser on this machine
set -euo pipefail
URL=${DEMO_URL:-http://localhost:8180}
OUT=${1:-shots}; mkdir -p "$OUT"
B="agent-browser --session springroll-demo"
thread() { curl -fsS "$URL/api/agent/threads" | jq -r --arg o "$1" '[.[] | select(.origin == $o)][0].id'; }
chat=$(thread chat); report=$(thread job:price-watch)
pages=( "timeline #/" "report #/r/$report" "chat #/t/$chat" "app #/v/reading" "jobs #/jobs" "todos #/v/todos" )
theme() { curl -fsS -X POST "$URL/api/settings" -H 'content-type: application/json' -d "{\"theme\":\"$1\"}" >/dev/null; }

$B open "$URL/" >/dev/null
for mode in dark light; do
  [ "$mode" = dark ] && theme springroll-dark-glass || theme springroll-light
  for size in "desktop 1440 900" "phone 390 844"; do
    set -- $size
    $B set viewport "$2" "$3" 2 >/dev/null
    for p in "${pages[@]}"; do
      name=${p%% *}; hash=${p#* }
      $B open "$URL/$hash" >/dev/null; sleep 2.5
      $B screenshot "$OUT/$name-$1-$mode.png" >/dev/null
    done
  done
done
theme springroll-dark-glass
$B close >/dev/null 2>&1 || true
ls "$OUT"

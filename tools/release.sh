#!/usr/bin/env bash
# Ship to a machine: push main to GitHub, then run that machine's "Update
# Springroll" job (it pulls, merges with judgment, checks, and reports).
#   tools/release.sh [ssh-host]      default host: agent@springroll
set -euo pipefail
host=${1:-agent@springroll}
cd "$(dirname "$0")/.."
[ -z "$(git status --porcelain)" ] || { echo "Commit first." >&2; exit 1; }
git push -q origin main
echo "Pushed $(git log -1 --format='%h %s')"
ssh "$host" 'curl -fsS -X POST localhost:8090/jobs/springroll-update/run 2>/dev/null || curl -fsS -X POST localhost:8090/jobs/agentos-update/run' | python3 -c 'import json,sys; t=json.load(sys.stdin).get("threadId"); print("Update started:", f"#/t/{t}" if t else "(already running)")'

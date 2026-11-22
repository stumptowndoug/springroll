#!/bin/bash
# Run both even when one fails; agentd retries and surfaces failures on the Timeline.
set -uo pipefail
cd "$(dirname "$0")/../.."
failed=0
bin/updates apply || failed=1
python3 jobs/updates/cli.py --apply || failed=1
exit "$failed"

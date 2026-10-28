#!/usr/bin/env bash
# Restarts agentd once no chat turn or job run is going (agentd's memory grows while it's up).
# Run it detached so it outlives the caller's own turn:
#   systemd-run --user --unit=agentd-restart-when-idle ~/home/jobs/housekeeping/restart-agentd.sh
# --if-over <MB>: only restart when agentd's RSS is above that. Gives up after 4 hours.
set -uo pipefail
export PATH="$HOME/home/bin:$PATH"
min=0; [ "${1:-}" = "--if-over" ] && min=$2
rss() { echo $(( $(ps -o rss= -p "$(systemctl --user show -p MainPID --value agentd)") / 1024 )); }
before=$(rss)
[ "$before" -le "$min" ] && { echo "agentd at ${before} MB, under ${min} MB: no restart"; exit 0; }
for i in $(seq 1 480); do
  sleep 30
  busy=$(curl -sf localhost:8090/threads | jq '[.[] | select(.running or .status=="running" or .status=="queued")] | length')
  runs=$(sqlite3 ~/data/agentd/agentd.db "select count(*) from runs where status in ('running','queued')")
  if [ "$busy" = "0" ] && [ "$runs" = "0" ]; then
    systemctl --user restart agentd && sleep 10
    if curl -sf -o /dev/null localhost:8090/threads; then
      echo "agentd restarted: ${before} MB → $(rss) MB"
    else
      signal --needs --source Housekeeping --key agentd:restart "agentd didn't come back after a restart" "journalctl --user -u agentd"
      exit 1
    fi
    exit 0
  fi
done
signal --source Housekeeping --key agentd:restart "agentd restart still waiting" "Something kept running for 4 hours; agentd is at ${before} MB."

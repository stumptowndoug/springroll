#!/usr/bin/env bash
# TCP buffer memory vs the kernel's pressure line, and who holds it. Over the line the kernel shrinks
# every socket's window, so every download on the box crawls (2026-10-29: the desk proxy leaked 245
# agentd event streams, ~860 MB, downloads at 2-4 MB/s). --fix: restart desk when desk is holding
# stuck connections to agentd (open tabs reconnect on their own).
set -uo pipefail
export PATH="$HOME/home/bin:$PATH"
mem=$(awk '/^TCP:/{for(i=1;i<NF;i++) if($i=="mem") print $(i+1)}' /proc/net/sockstat)
read -r _ pressure _ < <(sysctl -n net.ipv4.tcp_mem)
pct=$(( mem * 100 / pressure ))
echo "TCP memory: $mem pages ($(( mem * 4 / 1024 )) MB), ${pct}% of the pressure line ($pressure)"
echo "Biggest queues by process (MB, connections):"
ss -tnp | awk 'NR>1 && ($1+$2)>65536 {p="?"; if (match($0,/pid=[0-9]+/)) p=substr($0,RSTART+4,RLENGTH-4); q[p]+=$1+$2; n[p]++}
  END{for(p in q) printf "%.1f %d %s\n", q[p]/1e6, n[p], p}' | sort -nr | head -5 |
  while read -r mb n pid; do cmd=$(ps -o args= -p "$pid" 2>/dev/null | cut -c1-70); printf "  %7s MB %4s  %s\n" "$mb" "$n" "${cmd:-(no process)}"; done
desk=$(systemctl --user show -p MainPID --value desk)
stuck=$(ss -tnp state established '( dport = :8090 )' | awk -v p="pid=$desk," 'index($0,p) && $1>65536' | wc -l)
echo "desk → agentd connections with unread data: $stuck"
if [ "${1:-}" = "--fix" ] && { [ "$stuck" -ge 20 ] || { [ "$pct" -ge 50 ] && [ "$stuck" -ge 5 ]; }; }; then
  systemctl --user restart desk && sleep 3
  echo "restarted desk: TCP memory now $(awk '/^TCP:/{for(i=1;i<NF;i++) if($i=="mem") print $(i+1)}' /proc/net/sockstat) pages"
fi
[ "$pct" -ge 50 ] && signal --source Housekeeping --key housekeeping:tcp "TCP buffers at ${pct}% of the kernel's pressure line" "See the housekeeping report: something is holding unread sockets." >/dev/null
exit 0

#!/usr/bin/env bash
# A throwaway Springroll for screenshots and demos: a systemd container on this machine, installed
# from this checkout the way a new machine is, filled with a made-up week (seed.sh), on
# 127.0.0.1:8180. Needs Docker.
#   up.sh                  build it (CLAUDE_TOKEN_FILE=<file> signs Claude in, for real chats)
#   up.sh down             throw it away
# Then: shots.sh to screenshot it; `preview 8180` on a Springroll machine to open it.
set -euo pipefail
NAME=${DEMO_NAME:-springroll-demo}; PORT=${DEMO_PORT:-8180}
REPO=$(cd "$(dirname "$0")/../.." && pwd)
IMAGE=${DEMO_IMAGE:-jrei/systemd-ubuntu:24.04}
[ "${1:-}" = down ] && { docker rm -f "$NAME" >/dev/null && echo "Removed $NAME."; exit 0; }
box() { docker exec "$NAME" bash -c "$1"; }
as_agent() { docker exec "$NAME" sudo -u agent -H bash -lc "PATH=\$HOME/home/bin:\$PATH; $1"; }

docker run -d --name "$NAME" --hostname "$NAME" --privileged --cgroupns=host \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw --tmpfs /run --tmpfs /run/lock \
  -p "127.0.0.1:$PORT:8000" "$IMAGE" /sbin/init >/dev/null
for _ in $(seq 30); do box 'test -d /run/systemd/system' 2>/dev/null && break; sleep 1; done
box 'apt-get update -qq && apt-get install -y -qq curl ca-certificates git sudo socat openssl >/dev/null 2>&1'
docker cp "$REPO" "$NAME:/opt/springroll"
box 'chown -R root:root /opt/springroll && /opt/springroll/seed/install.sh --no-tailscale' | sed 's/^/  | /'

# Springroll listens on 127.0.0.1 only; forward the container's address to it, as on exe.dev.
box 'cat > /etc/systemd/system/demo-proxy.service <<"UNIT"
[Unit]
Description=Let the host reach Springroll in this container
After=network-online.target
[Service]
ExecStart=/bin/sh -c "exec socat TCP-LISTEN:8000,bind=$$(hostname -I | cut -d\" \" -f1),fork,reuseaddr TCP:127.0.0.1:8000"
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload && systemctl enable --now demo-proxy >/dev/null 2>&1'

if [ -n "${CLAUDE_TOKEN_FILE:-}" ]; then
  docker cp "$CLAUDE_TOKEN_FILE" "$NAME:/home/agent/.config/springroll/claude-token"
  box 'chown agent:agent /home/agent/.config/springroll/claude-token && chmod 600 /home/agent/.config/springroll/claude-token'
  as_agent 'systemctl --user restart agentd'
fi

docker cp "$REPO/tools/demo" "$NAME:/opt/demo" && box 'chown -R agent:agent /opt/demo'
sleep 3; as_agent '/opt/demo/seed.sh'

if [ -n "${CLAUDE_TOKEN_FILE:-}" ]; then # one real chat: an agent builds an app while the Timeline fills
  as_agent 'curl -fsS -X POST localhost:8090/threads -H "content-type: application/json" -d "{\"agent\":\"claude\",\"text\":\"Build me a reading list app: books I want to read, am reading, and have finished, with a rating when I finish one. Start it with five well-known novels so it is not empty.\"}" >/dev/null'
  echo "A chat is building the Reading list app (3-5 minutes); shots.sh after it's done."
fi
echo "Demo Springroll on http://127.0.0.1:$PORT"

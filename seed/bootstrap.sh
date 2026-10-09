#!/usr/bin/env bash
# Install AgentOS on a remote box from this Mac: seed/bootstrap.sh <host> [claude-token-file]
# Copies the seed to the box and runs install.sh there as root.
set -euo pipefail
HOST=${1:?usage: bootstrap.sh <host> [claude-token-file]}
TOKEN=${2:-$HOME/.springroll/claude-token}
SEED=$(cd "$(dirname "$0")" && pwd)

rsync -a --delete "$SEED/" "root@$HOST:/opt/agentos-seed/"
if [ -f "$TOKEN" ]; then
  ssh "root@$HOST" 'id agent >/dev/null 2>&1 || useradd -m -s /bin/bash agent; install -d -o agent -g agent -m 700 /home/agent/.config /home/agent/.config/agentos'
  scp -q "$TOKEN" "root@$HOST:/home/agent/.config/agentos/claude-token"
  ssh "root@$HOST" 'chown agent:agent /home/agent/.config/agentos/claude-token && chmod 600 /home/agent/.config/agentos/claude-token'
fi
ssh "root@$HOST" 'bash /opt/agentos-seed/install.sh'

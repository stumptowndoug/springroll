#!/usr/bin/env bash
# Install Springroll on a remote box from this Mac:
#   seed/bootstrap.sh <host> [install.sh options, e.g. --profile personal]
# Copies the seed to /opt/springroll-seed on the box (plus a Claude token, if
# $CLAUDE_TOKEN_FILE or ~/.springroll/claude-token exists) and runs install.sh there.
set -euo pipefail
HOST=${1:?usage: bootstrap.sh <host> [install options]}; shift
TOKEN=${CLAUDE_TOKEN_FILE:-$HOME/.springroll/claude-token}
SEED=$(cd "$(dirname "$0")" && pwd)

rsync -a --delete --exclude __pycache__ "$SEED/" "root@$HOST:/opt/springroll-seed/"
if [ -f "$TOKEN" ]; then
  ssh "root@$HOST" 'id agent >/dev/null 2>&1 || useradd -m -s /bin/bash agent; install -d -o agent -g agent -m 700 /home/agent/.config /home/agent/.config/springroll'
  scp -q "$TOKEN" "root@$HOST:/home/agent/.config/springroll/claude-token"
  ssh "root@$HOST" 'chown agent:agent /home/agent/.config/springroll/claude-token && chmod 600 /home/agent/.config/springroll/claude-token'
fi
ssh "root@$HOST" bash /opt/springroll-seed/install.sh "$@"

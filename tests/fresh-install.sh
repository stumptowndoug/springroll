#!/usr/bin/env bash
# Fresh-install test: run the installer in a throwaway container that boots
# systemd, then check the Desk and Views come up. Needs Docker (run as root).
#   tests/fresh-install.sh <image> [install options]
#   tests/fresh-install.sh jrei/systemd-ubuntu:24.04 --profile personal
# Images: jrei/systemd-ubuntu:24.04, jrei/systemd-debian:12, archlinux (any
# image with systemd works; it's started as PID 1).
set -uo pipefail
IMAGE=${1:?usage: fresh-install.sh <image> [install options]}; shift
SEED=${SEED:-/opt/agentos-seed}
NAME=aos-test-$$
INIT=/sbin/init
[[ "$IMAGE" == archlinux* ]] && INIT=/usr/lib/systemd/systemd
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1; }
trap cleanup EXIT

docker run -d --name "$NAME" --privileged --cgroupns=host -v /sys/fs/cgroup:/sys/fs/cgroup:rw \
  --tmpfs /run --tmpfs /run/lock "$IMAGE" "$INIT" >/dev/null || exit 1
for i in $(seq 1 30); do docker exec "$NAME" test -d /run/systemd/system 2>/dev/null && break; sleep 1; done
# Minimal images may lack curl/sudo; install just enough to run the installer.
docker exec "$NAME" bash -c 'command -v curl >/dev/null || { command -v apt-get >/dev/null && apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null; command -v pacman >/dev/null && pacman -Sy --noconfirm curl >/dev/null; command -v dnf >/dev/null && dnf install -y -q curl >/dev/null; }' 2>/dev/null
docker cp "$SEED" "$NAME:/opt/agentos-seed"
# BACKUP=<file> [PASSPHRASE=…]: also restore that backup and check it came back.
if [ -n "${BACKUP:-}" ]; then docker cp "$BACKUP" "$NAME:/opt/backup.tar.gz"; set -- "$@" --restore /opt/backup.tar.gz; fi

start=$(date +%s)
docker exec -e AGENTOS_BACKUP_PASSPHRASE="${PASSPHRASE:-}" "$NAME" bash /opt/agentos-seed/install.sh --no-tailscale "$@" 2>&1 | sed 's/^/  | /'
echo "install took $(( $(date +%s) - start ))s"

pass=0 fail=0
check() { if docker exec "$NAME" bash -c "$2" >/dev/null 2>&1; then echo "  ✓ $1"; pass=$((pass+1)); else echo "  ✗ $1"; fail=$((fail+1)); fi; }
U="sudo -u agent XDG_RUNTIME_DIR=/run/user/$(docker exec "$NAME" id -u agent)"
sleep 5
check "desk service" "$U systemctl --user is-active desk"
check "terminal service" "$U systemctl --user is-active desk-term"
check "Desk answers" "curl -fsS localhost:8000/ | grep -q '<title>Desk'"
check "views API" "curl -fsS localhost:8000/api/views | grep -q settings"
check "files API" "curl -fsS 'localhost:8000/api/files/list?path=~/home' | grep -q AGENTS.md"
check "code viewer served" "curl -fsS localhost:8000/ui/vendor/code.js | grep -q langFor && curl -fsS localhost:8000/ui/vendor/pce/prism/index.js >/dev/null"
check "terminal proxied" "curl -fsS localhost:8000/term/ | grep -qi ttyd"
check "claude installed" "sudo -u agent bash -lc '. ~/.config/agentos/env; claude --version'"
check "codex installed" "sudo -u agent bash -lc '. ~/.config/agentos/env; codex --version'"
check "add-view works" "sudo -u agent bash -lc '. ~/.config/agentos/env; add-view --list' | grep -q system"
for v in $(docker exec "$NAME" bash -c 'ls /home/agent/home/views | grep -vx desk'); do
  check "view $v serves" "curl -fsS localhost:8000/v/$v/ -o /dev/null"
done
check "agent session starts" "curl -fsS -X POST localhost:8000/api/sessions -H content-type:application/json -d '{\"agent\":\"shell\"}' | grep -q session"
check "agentd answers" "curl -fsS localhost:8000/api/agent/health | grep -q ok"
check "jobs API" "curl -fsS localhost:8000/api/agent/jobs | grep -q nightly-backup"
check "connections API" "curl -fsS localhost:8000/api/connections | grep -q github"
if [ -n "${BACKUP:-}" ]; then
  check "restored: chats" "[ \$(curl -fsS localhost:8000/api/agent/threads | jq length) -gt 0 ]"
  check "restored: jobs" "curl -fsS localhost:8000/api/agent/jobs | grep -q disk-check"
  check "restored: Mail View" "curl -fsS localhost:8000/api/views | grep -q '\"mail\"'"
  check "restored: mail data" "test -s /home/agent/data/mail/mail.db"
  check "restored: secrets" "test -s /home/agent/.config/agentos/gmail"
else
  check "re-run is clean" "bash /opt/agentos-seed/install.sh --no-tailscale $* >/dev/null 2>&1"
fi
echo "$IMAGE: $pass passed, $fail failed"
[ "$fail" = 0 ]

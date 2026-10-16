#!/usr/bin/env bash
# Fresh-install test: run the installer in a throwaway container that boots
# systemd, then check Springroll and Views come up. Needs Docker (run as root).
#   tests/fresh-install.sh <image> [install options]
#   tests/fresh-install.sh jrei/systemd-ubuntu:24.04 --profile personal
# Images: jrei/systemd-ubuntu:24.04, jrei/systemd-debian:12, archlinux (any
# image with systemd works; it's started as PID 1).
set -uo pipefail
IMAGE=${1:?usage: fresh-install.sh <image> [install options]}; shift
SEED=${SEED:-/opt/springroll-seed}
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
docker cp "$SEED" "$NAME:/opt/springroll-seed"
# BACKUP=<file> [PASSPHRASE=…]: also restore that backup and check it came back.
if [ -n "${BACKUP:-}" ]; then docker cp "$BACKUP" "$NAME:/opt/backup.tar.gz"; set -- "$@" --restore /opt/backup.tar.gz; fi

start=$(date +%s)
docker exec -e SPRINGROLL_BACKUP_PASSPHRASE="${PASSPHRASE:-}" "$NAME" bash /opt/springroll-seed/install.sh --no-tailscale "$@" 2>&1 | sed 's/^/  | /'
echo "install took $(( $(date +%s) - start ))s"

pass=0 fail=0
check() { if docker exec "$NAME" bash -c "$2" >/dev/null 2>&1; then echo "  ✓ $1"; pass=$((pass+1)); else echo "  ✗ $1"; fail=$((fail+1)); fi; }
U="sudo -u agent XDG_RUNTIME_DIR=/run/user/$(docker exec "$NAME" id -u agent)"
sleep 5
check "desk service" "$U systemctl --user is-active desk"
check "terminal service" "$U systemctl --user is-active desk-term"
check "Springroll answers" "curl -fsS localhost:8000/ | grep -q '<title>Springroll'"
check "views API" "curl -fsS localhost:8000/api/views | grep -q settings"
check "files API" "curl -fsS 'localhost:8000/api/files/list?path=~/home' | grep -q AGENTS.md"
check "code viewer served" "curl -fsS localhost:8000/ui/vendor/code.js | grep -q langFor && curl -fsS localhost:8000/ui/vendor/pce/prism/index.js >/dev/null"
check "terminal proxied" "curl -fsS localhost:8000/term/ | grep -qi ttyd"
check "claude installed" "sudo -u agent bash -lc '. ~/.config/springroll/env; claude --version'"
check "codex installed" "sudo -u agent bash -lc '. ~/.config/springroll/env; codex --version'"
check "add-view works" "sudo -u agent bash -lc '. ~/.config/springroll/env; add-view --list' | grep -q system"
# The Browser app's first start installs agent-browser in the background: give it a couple of minutes.
check "browser app up" "for i in \$(seq 1 60); do curl -fsS localhost:8000/v/browser/api/backends >/dev/null && exit 0; sleep 3; done; exit 1"
check "browser tools installed" "curl -fsS localhost:8000/v/browser/api/setup | jq -e '.[] | select(.id==\"local\") | .state==\"ready\"'"
check "browser opens a page" "sudo -u agent bash -lc '. ~/.config/springroll/env; browser start t --via local --url https://example.com >/dev/null && agent-browser --session t get title | grep -q Example; r=\$?; browser stop t >/dev/null; exit \$r'"
check "home internet off until set up" "! $U systemctl --user is-active tailscale-browser"
for v in $(docker exec "$NAME" bash -c 'ls /home/agent/home/views | grep -vx desk'); do
  check "view $v serves" "curl -fsS localhost:8000/v/$v/ -o /dev/null"
done
check "agent session starts" "curl -fsS -X POST localhost:8000/api/sessions -H content-type:application/json -d '{\"agent\":\"shell\"}' | grep -q session"
check "agentd answers" "curl -fsS localhost:8000/api/agent/health | grep -q ok"
check "jobs API" "curl -fsS localhost:8000/api/agent/jobs | grep -q nightly-backup"
check "connections API" "curl -fsS localhost:8000/api/connections | grep -q github"
check "timeline and keys pages served" "curl -fsS localhost:8000/app/timeline.js -o /dev/null && curl -fsS localhost:8000/app/keys.js -o /dev/null"
check "upcoming API" "curl -fsS localhost:8000/api/upcoming | jq -e 'type==\"array\"'"
check "needs-you config" "curl -fsS localhost:8000/api/needs/config | jq -e 'type==\"object\"'"
check "personas: presets ship, none by default" "curl -fsS localhost:8000/api/personas | jq -e 'length>=4' && curl -fsS localhost:8000/api/settings | jq -e '.persona.default==null'"
check "to-dos app answers" "for i in \$(seq 1 30); do curl -fsS localhost:8000/v/todos/api/boards | jq -e '.[0].id==\"personal\"' && exit 0; sleep 2; done; exit 1"
check "email asks first by default" "curl -fsS localhost:8000/api/google | jq -e '.policy.send==\"ask\"'"
check "housekeeping job" "curl -fsS localhost:8000/api/agent/jobs | grep -q housekeeping"
check "memory seeded, Claude's own off" "test -s /home/agent/home/notes/memory.md && jq -e '.autoMemoryEnabled==false' /home/agent/.claude/settings.json"
check "skills linked for every agent" "test -e /home/agent/.claude/skills/timeline/SKILL.md && test -e /home/agent/.codex/skills/jobs/SKILL.md && test -e /home/agent/.pi/agent/skills/machine/SKILL.md"
if [ -n "${BACKUP:-}" ]; then
  check "restored: chats" "[ \$(curl -fsS localhost:8000/api/agent/threads | jq length) -gt 0 ]"
  check "restored: jobs" "curl -fsS localhost:8000/api/agent/jobs | grep -q disk-check"
  check "restored: Mail View" "curl -fsS localhost:8000/api/views | grep -q '\"mail\"'"
  check "restored: mail data" "test -s /home/agent/data/mail/mail.db"
  check "restored: secrets" "test -s /home/agent/.config/springroll/gmail"
else
  check "re-run is clean" "bash /opt/springroll-seed/install.sh --no-tailscale $* >/dev/null 2>&1"
check "browser still opens after the re-run" "sudo -u agent bash -lc '. ~/.config/springroll/env; browser start t --via local --url https://example.com >/dev/null && agent-browser --session t get title | grep -q Example; r=\$?; browser stop t >/dev/null; exit \$r'"
fi
echo "$IMAGE: $pass passed, $fail failed"
[ "$fail" = 0 ]

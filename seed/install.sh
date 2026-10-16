#!/usr/bin/env bash
# Install Springroll on this machine. Run as root on a Linux box with systemd,
# from a checkout of the springroll repo:
#
#   sudo seed/install.sh [--profile default|minimal|personal] [--with mail,system]
#                        [--restore backup.tar.gz] [--no-tailscale] [--no-swap] [--check] [--force]
#
#   --profile       which Views to start with (seed/profiles/*.txt); default: default
#   --with          extra templates, comma-separated (seed/templates/*)
#   --restore       restore a backup (from `backup` / Settings → Backups) after installing
#   --no-tailscale  don't install Tailscale; reach Springroll over an SSH tunnel
#   --no-swap       don't add a swap file on small machines
#   --check         print the preflight report and stop
#   --force         install even if the preflight finds a blocker
#
# Safe to re-run: it never overwrites an existing /home/agent/home, and only
# adds templates that aren't installed yet.
set -euo pipefail
SEED=$(cd "$(dirname "$0")" && pwd)
U=agent
H=/home/$U
PROFILE=default WITH="" TAILSCALE=1 SWAP=1 CHECK=0 FORCE=0 RESTORE=
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE=$2; shift ;;
    --with) WITH=$2; shift ;;
    --restore) RESTORE=$(realpath "$2"); shift ;;
    --no-tailscale) TAILSCALE=0 ;;
    --no-swap) SWAP=0 ;;
    --check) CHECK=1 ;;
    --force) FORCE=1 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "unknown option $1" >&2; exit 1 ;;
  esac
  shift
done

say() { printf '%s\n' "$*"; }
ok() { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*"; WARNINGS=$((WARNINGS + 1)); }
block() { printf '  ✗ %s\n' "$*"; BLOCKERS=$((BLOCKERS + 1)); }
WARNINGS=0 BLOCKERS=0

# ---------- Preflight ----------
say "== preflight"
[ "$(id -u)" = 0 ] && ok "running as root" || block "run as root (sudo)"
[ -d /run/systemd/system ] && ok "systemd" || block "systemd isn't running (containers and Alpine aren't supported; use a VM)"
. /etc/os-release 2>/dev/null || true
DISTRO="${PRETTY_NAME:-unknown}"
if command -v apt-get >/dev/null; then PM=apt
elif command -v dnf >/dev/null; then PM=dnf
elif command -v pacman >/dev/null; then PM=pacman
else PM=""; fi
[ -n "$PM" ] && ok "$DISTRO ($PM)" || block "$DISTRO: no apt, dnf or pacman"
ARCH=$(uname -m)
case "$ARCH" in x86_64|aarch64) ok "CPU: $ARCH, $(nproc) cores" ;; *) warn "CPU: $ARCH is untested (x86_64 and aarch64 are)" ;; esac
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
SWAP_MB=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$MEM_MB" -lt 900 ]; then block "memory: ${MEM_MB} MB (need 1 GB; 2 GB+ recommended)"
elif [ "$MEM_MB" -lt 1800 ]; then warn "memory: ${MEM_MB} MB: enough for one agent session at a time (4 GB recommended)"
elif [ "$MEM_MB" -lt 3500 ]; then ok "memory: ${MEM_MB} MB: two or three agent sessions (4 GB recommended)"
else ok "memory: ${MEM_MB} MB"; fi
DISK_GB=$(df -BG --output=avail /home 2>/dev/null | tail -1 | tr -dc 0-9)
if [ "${DISK_GB:-0}" -lt 5 ]; then block "disk: ${DISK_GB:-?} GB free (need 5 GB; 20 GB+ recommended)"
elif [ "$DISK_GB" -lt 15 ]; then warn "disk: ${DISK_GB} GB free (tools take ~3 GB; 20 GB+ recommended)"
else ok "disk: ${DISK_GB} GB free"; fi
curl -fsS -o /dev/null -m 10 https://registry.npmjs.org/ 2>/dev/null && ok "internet" || block "can't reach the internet"
[ "$TAILSCALE" = 1 ] && ok "access: Tailscale (private HTTPS)" || ok "access: SSH tunnel (no Tailscale)"
[ -f "$SEED/profiles/$PROFILE.txt" ] && ok "profile: $PROFILE${WITH:+ + $WITH}" || block "no profile '$PROFILE' (have: $(ls "$SEED/profiles" | sed 's/\.txt//' | tr '\n' ' '))"
for t in $(echo "$WITH" | tr ',' ' '); do [ -d "$SEED/templates/$t" ] || block "no template '$t' (have: $(ls "$SEED/templates" | tr '\n' ' '))"; done
[ -z "$RESTORE" ] || { [ -f "$RESTORE" ] && ok "restore: $(basename "$RESTORE")" || block "no backup file $RESTORE"; }
if [ "$BLOCKERS" -gt 0 ] && [ "$FORCE" = 0 ]; then say "Stopping: fix the ✗ items above, or re-run with --force."; exit 1; fi
[ "$CHECK" = 1 ] && exit 0

as_agent() { sudo -u $U -H bash -c ". $H/.config/springroll/env 2>/dev/null; export XDG_RUNTIME_DIR=/run/user/\$(id -u); $1"; }

# ---------- System ----------
say "== system packages"
case "$PM" in
  apt)
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq
    apt-get install -y -qq sudo tmux git curl jq sqlite3 python3 python3-venv ripgrep build-essential ca-certificates rsync iproute2 bubblewrap >/dev/null
    apt-get install -y -qq ttyd >/dev/null 2>&1 || true   # not packaged on Debian 12
    if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
      curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null && apt-get install -y -qq nodejs >/dev/null
    fi ;;
  dnf)
    dnf install -y -q sudo tmux git curl jq sqlite python3 ripgrep gcc gcc-c++ make ca-certificates rsync iproute nodejs npm bubblewrap >/dev/null
    dnf install -y -q ttyd >/dev/null 2>&1 || true ;;
  pacman)
    pacman -Sy --noconfirm --needed sudo tmux ttyd git curl jq sqlite python ripgrep base-devel ca-certificates rsync iproute2 nodejs npm bubblewrap >/dev/null ;;
esac
# Distros without a ttyd package get the official static build.
if ! command -v ttyd >/dev/null; then
  curl -fsSL -o /usr/local/bin/ttyd "https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.$ARCH" && chmod +x /usr/local/bin/ttyd
fi
systemctl disable --now ttyd >/dev/null 2>&1 || true  # some packages start their own on :7681
ok "node $(node -v), ttyd $(ttyd --version 2>&1 | awk '{print $3}'), tmux $(tmux -V | awk '{print $2}')"

if [ "$SWAP" = 1 ] && [ "$MEM_MB" -lt 6000 ] && [ "$SWAP_MB" -lt 512 ] && [ ! -e /swapfile ]; then
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "added a 2 GB swap file"
fi

# loginctl and user services need the system D-Bus (minimal images may lack it).
if ! busctl status >/dev/null 2>&1; then
  case "$PM" in apt) apt-get install -y -qq dbus >/dev/null ;; dnf) dnf install -y -q dbus-broker >/dev/null ;; pacman) pacman -S --noconfirm --needed dbus >/dev/null ;; esac
  systemctl start dbus.socket dbus.service dbus-broker.service >/dev/null 2>&1 || true
  systemctl restart systemd-logind >/dev/null 2>&1 || true
fi

id $U >/dev/null 2>&1 || useradd -m -s /bin/bash $U
echo "$U ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$U && chmod 440 /etc/sudoers.d/$U
getent group docker >/dev/null && usermod -aG docker $U
if [ -f /root/.ssh/authorized_keys ]; then
  install -d -o $U -g $U -m 700 $H/.ssh
  install -o $U -g $U -m 600 /root/.ssh/authorized_keys $H/.ssh/authorized_keys
fi
loginctl enable-linger $U
# The user's service manager starts asynchronously; wait for it before using it.
for i in $(seq 1 30); do sudo -u $U XDG_RUNTIME_DIR=/run/user/$(id -u $U) systemctl --user show-environment >/dev/null 2>&1 && break; sleep 1; done

if [ "$TAILSCALE" = 1 ] && ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh >/dev/null
fi

# ---------- Agents ----------
say "== agents"
install -d -o $U -g $U $H/.config $H/.config/systemd $H/.config/systemd/user $H/data $H/projects $H/.claude
install -d -o $U -g $U -m 700 $H/.config/springroll
cat > $H/.config/springroll/env <<'EOF'
export PATH=$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/home/bin:$PATH
# Every shell (jobs, sudo -u, ssh) reaches the agent's systemd and per-user sockets the same way.
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
[ -f $HOME/.config/springroll/claude-token ] && export CLAUDE_CODE_OAUTH_TOKEN=$(cat $HOME/.config/springroll/claude-token)
EOF
echo "$SEED" > $H/.config/springroll/seed
chown $U:$U $H/.config/springroll/env $H/.config/springroll/seed
grep -q springroll/env $H/.bashrc 2>/dev/null || sed -i "1i . \$HOME/.config/springroll/env" $H/.bashrc 2>/dev/null || echo '. $HOME/.config/springroll/env' >> $H/.bashrc
as_agent 'command -v claude >/dev/null || curl -fsSL https://claude.ai/install.sh | bash >/dev/null 2>&1'
as_agent 'npm config set prefix ~/.npm-global; command -v codex >/dev/null || npm i -g @openai/codex playwright >/dev/null 2>&1'
# Chat adapters (Agent Client Protocol) for Springroll's chat; OpenCode has it built in.
# Replaces the old @zed-industries packages (deprecated, frozen model lists); re-running updates them.
as_agent 'npm rm -g @zed-industries/claude-code-acp @zed-industries/codex-acp >/dev/null 2>&1; npm i -g @agentclientprotocol/claude-agent-acp@latest @agentclientprotocol/codex-acp@latest >/dev/null 2>&1'
as_agent 'playwright install chromium >/dev/null 2>&1' || true
if [ "$PM" = apt ]; then $H/.npm-global/bin/playwright install-deps chromium >/dev/null 2>&1 || true
else warn "Playwright's browser libraries are only auto-installed on Debian/Ubuntu; the agent can add them if screenshots fail"; fi
as_agent '[ -f ~/.claude.json ] || echo "{\"hasCompletedOnboarding\":true,\"theme\":\"dark\",\"projects\":{\"$HOME/home\":{\"hasTrustDialogAccepted\":true}}}" > ~/.claude.json'
as_agent '[ -f ~/.claude/settings.json ] || echo "{\"model\":\"opus\",\"permissions\":{\"defaultMode\":\"bypassPermissions\"},\"skipDangerousModePermissionPrompt\":true,\"autoMemoryEnabled\":false}" > ~/.claude/settings.json'
# Memory lives in ~/home/notes/memory.md for every agent (and in backups), not in Claude's own store.
as_agent 'f=~/.claude/settings.json; jq -e "has(\"autoMemoryEnabled\")" $f >/dev/null 2>&1 || { jq ".autoMemoryEnabled=false" $f > $f.tmp && mv $f.tmp $f; }'
as_agent '[ -f ~/.config/springroll/ntfy-topic ] || echo "springroll-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d " \n")" > ~/.config/springroll/ntfy-topic'
# Secrets are files (600); folders in there (browser profiles, ssh keys, tailscale-browser) need 700
# or nothing can open them. An older installer chmod-ed folders to 600 on a re-run: repaired here.
as_agent 'find ~/.config/springroll -mindepth 1 -maxdepth 1 -type f -exec chmod 600 {} + ; find ~/.config/springroll -mindepth 1 -type d -exec chmod 700 {} + ; git config --global user.name agent; git config --global user.email agent@$(hostname)'

# ---------- Home ----------
say "== home"
if [ -d $H/home ]; then
  ok "$H/home exists; leaving it alone (the agent owns it)"
else
  rsync -a "$SEED/home/" $H/home/ && chown -R $U:$U $H/home
  as_agent 'cd ~/home && git init -q -b main && git add -A && git commit -qm "Seed the machine"'
  ok "seeded $H/home"
fi

say "== skills"
as_agent 'for d in ~/.claude/skills ~/.codex/skills ~/.pi/agent/skills; do mkdir -p $d; for s in ~/home/skills/*/; do ln -sfn "$s" "$d/$(basename "$s")"; done; done'

say "== services"
as_agent 'mkdir -p ~/.config/systemd/user; for u in ~/home/views/desk/desk.service ~/home/views/desk/desk-term.service ~/home/agentd/agentd.service; do systemctl --user link $u >/dev/null; n=$(basename $u); systemctl --user enable $n >/dev/null 2>&1; systemctl --user restart $n; done'
# Apps that ship with Springroll and run a server (Browser): link and start them, in the background
# (Browser's first start installs agent-browser). Units that aren't for every machine say so with a
# Condition (tailscale-browser only runs once home internet is set up).
as_agent 'for u in ~/home/views/*/*.service; do case $u in */views/desk/*) continue ;; esac; systemctl --user link "$u" >/dev/null 2>&1; grep -q "^\[Install\]" "$u" && systemctl --user enable "$(basename "$u")" >/dev/null 2>&1 && systemctl --user start --no-block "$(basename "$u")" >/dev/null 2>&1; done; true'

say "== views"
TEMPLATES=$( (grep -v '^#' "$SEED/profiles/$PROFILE.txt"; echo "$WITH" | tr ',' '\n') | sed '/^[[:space:]]*$/d' | sort -u)
for t in $TEMPLATES; do
  if [ -d $H/home/views/$t ]; then ok "$t (already installed)"
  else as_agent "add-view $t" | sed 's/^/  ✓ /'; fi
done

if [ -n "$RESTORE" ]; then
  say "== restore"
  install -o $U -g $U -m 600 "$RESTORE" /tmp/springroll-restore.tar.gz
  # Secrets need the backup's passphrase: SPRINGROLL_BACKUP_PASSPHRASE=… install.sh --restore …
  sudo -u $U -H SPRINGROLL_BACKUP_PASSPHRASE="${SPRINGROLL_BACKUP_PASSPHRASE:-}" bash -c ". $H/.config/springroll/env; export XDG_RUNTIME_DIR=/run/user/\$(id -u); restore /tmp/springroll-restore.tar.gz" | sed 's/^/  /'
  rm -f /tmp/springroll-restore.tar.gz
fi

say "== network"
if [ "$TAILSCALE" = 1 ] && tailscale status >/dev/null 2>&1; then
  tailscale serve --bg 8000 >/dev/null
  say "Springroll: https://$(tailscale status --json | jq -r .Self.DNSName | sed 's/\.$//')"
elif [ "$TAILSCALE" = 1 ]; then
  say "Tailscale isn't connected yet. Run: sudo tailscale up && sudo tailscale serve --bg 8000"
else
  say "Springroll is on 127.0.0.1:8000. From your computer: ssh -N -L 8000:127.0.0.1:8000 $U@<this-host>, then open http://localhost:8000"
fi
[ -f $H/.config/springroll/claude-token ] || say "No Claude token: open Springroll and sign in from Settings → Coding agents (or /login in the terminal)."
say "More Views: Springroll → Settings → Views, or: sudo -u $U add-view --list"
say "Phone notifications: subscribe to ntfy topic $(cat $H/.config/springroll/ntfy-topic)"
[ "$WARNINGS" -gt 0 ] && say "($WARNINGS warning(s) above.)"
exit 0

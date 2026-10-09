#!/usr/bin/env bash
# Install AgentOS on this machine. Run as root on a fresh Ubuntu/Debian box,
# from a checkout of the agentos repo:  sudo seed/install.sh
# Safe to re-run: it never overwrites an existing /home/agent/home.
#
# Optional: put a Claude setup token (from `claude setup-token`) at
# /home/agent/.config/agentos/claude-token before running, or log in later
# from the Desk's terminal pane.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root" >&2; exit 1; }
SEED=$(cd "$(dirname "$0")" && pwd)
U=agent
H=/home/$U
as_agent() { sudo -u $U -H bash -c ". $H/.config/agentos/env 2>/dev/null; export XDG_RUNTIME_DIR=/run/user/\$(id -u); $1"; }

echo "== system"
id $U >/dev/null 2>&1 || useradd -m -s /bin/bash $U
echo "$U ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$U && chmod 440 /etc/sudoers.d/$U
getent group docker >/dev/null && usermod -aG docker $U
if [ -f /root/.ssh/authorized_keys ]; then
  install -d -o $U -g $U -m 700 $H/.ssh
  install -o $U -g $U -m 600 /root/.ssh/authorized_keys $H/.ssh/authorized_keys
fi
loginctl enable-linger $U
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq tmux ttyd git curl jq sqlite3 python3-venv ripgrep build-essential ca-certificates rsync >/dev/null
systemctl disable --now ttyd >/dev/null 2>&1 || true  # the package starts its own on :7681
command -v node >/dev/null || { curl -fsSL https://deb.nodesource.com/setup_24.x | bash - >/dev/null && apt-get install -y -qq nodejs >/dev/null; }
command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh >/dev/null

echo "== agents"
install -d -o $U -g $U -m 700 $H/.config/agentos
install -d -o $U -g $U $H/data $H/projects $H/.claude
cat > $H/.config/agentos/env <<'EOF'
export PATH=$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/home/bin:$PATH
[ -f $HOME/.config/agentos/claude-token ] && export CLAUDE_CODE_OAUTH_TOKEN=$(cat $HOME/.config/agentos/claude-token)
EOF
chown $U:$U $H/.config/agentos/env
grep -q agentos/env $H/.bashrc || sed -i "1i . \$HOME/.config/agentos/env" $H/.bashrc
as_agent 'command -v claude >/dev/null || curl -fsSL https://claude.ai/install.sh | bash >/dev/null 2>&1'
as_agent 'npm config set prefix ~/.npm-global; command -v codex >/dev/null || npm i -g @openai/codex playwright >/dev/null 2>&1'
as_agent 'playwright install chromium >/dev/null 2>&1' || true
$H/.npm-global/bin/playwright install-deps chromium >/dev/null 2>&1 || true
as_agent '[ -f ~/.claude.json ] || echo "{\"hasCompletedOnboarding\":true,\"theme\":\"dark\",\"projects\":{\"$HOME/home\":{\"hasTrustDialogAccepted\":true}}}" > ~/.claude.json'
as_agent '[ -f ~/.claude/settings.json ] || echo "{\"model\":\"opus\",\"permissions\":{\"defaultMode\":\"bypassPermissions\"},\"skipDangerousModePermissionPrompt\":true}" > ~/.claude/settings.json'
as_agent '[ -f ~/.config/agentos/ntfy-topic ] || echo "agentos-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d " \n")" > ~/.config/agentos/ntfy-topic'
as_agent 'chmod 600 ~/.config/agentos/* ; git config --global user.name agent; git config --global user.email agent@$(hostname)'

echo "== home"
if [ -d $H/home ]; then
  echo "$H/home exists; leaving it alone (the agent owns it)"
else
  rsync -a "$SEED/home/" $H/home/ && chown -R $U:$U $H/home
  as_agent 'cd ~/home && git init -q -b main && git add -A && git commit -qm "Seed the machine"'
fi

echo "== skills"
as_agent 'for d in ~/.claude/skills ~/.codex/skills ~/.pi/agent/skills; do mkdir -p $d; for s in ~/home/skills/*/; do ln -sfn "$s" "$d/$(basename "$s")"; done; done'

echo "== services"
as_agent 'for u in desk desk-term; do systemctl --user link ~/home/views/desk/$u.service >/dev/null; systemctl --user enable $u >/dev/null 2>&1; systemctl --user restart $u; done'

echo "== network"
if tailscale status >/dev/null 2>&1; then
  tailscale serve --bg 8000 >/dev/null
  echo "Desk: https://$(tailscale status --json | jq -r .Self.DNSName | sed 's/\.$//')"
else
  echo "Tailscale isn't connected. Run: sudo tailscale up && sudo tailscale serve --bg 8000"
fi
[ -f $H/.config/agentos/claude-token ] || echo "No Claude token: open the Desk and log in from the terminal pane (/login)."
echo "More agents (Codex, OpenCode, Pi): Desk → Settings → Coding agents, or the + menu in the agent pane."
echo "Phone notifications: subscribe to ntfy topic $(cat $H/.config/agentos/ntfy-topic)"

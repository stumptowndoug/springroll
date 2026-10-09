# Packaging: installing AgentOS on any box

## What gets installed

AgentOS is two things with different owners:

- **The seed** (`seed/` in this repo, ours): `install.sh` plus the starting
  `home/`: `AGENTS.md`, the Desk, and the `show` / `notify` / `focus` commands.
- **The machine's home** (`/home/agent/home` on the box, the agent's): a
  git repo that starts as a copy of the seed and then diverges as the agent
  builds Views and changes the Desk.

The installer only ever creates the home; it never overwrites one. So
re-running it is safe, and a box keeps its personality across upgrades.

## Today

- On the box, from a checkout: `sudo seed/install.sh`
- From a Mac: `seed/bootstrap.sh <host> [claude-token-file]` (rsyncs the seed to
  `/opt/agentos-seed` and runs the installer there)

Requirements: Ubuntu or Debian with systemd, root, internet. The installer
adds the `agent` user (passwordless sudo), packages, Node, Tailscale, Claude
Code, Codex, Playwright, the Desk services, and `tailscale serve`.

After install, two human steps that can't be automated: `tailscale up` (if not
already) and signing the agents in (a Claude setup token, or `/login` in the
Desk's terminal; `codex login --device-auth` for Codex).

## Next

1. **Public repo + one line**: `curl -fsSL https://<host>/install | sudo bash`,
   where the script clones the repo to `/opt/agentos-seed` and runs
   `install.sh`. This is the whole package; no .deb, no image.
2. **First run in the Desk**: if no agent is signed in, the terminal pane is
   where you sign in, with a short note on screen. No separate setup wizard.
3. **Upgrades are merges the agent does.** A new seed version arrives as a
   git remote in `~/home` (`upstream`). Upgrading is asking the agent to
   "pull in the latest AgentOS seed and merge it with what we've changed",
   instead of a package manager overwriting files it doesn't understand.
4. **Other places to run it**: a cloud VM is the default. On a Mac or
   Windows laptop, run it in a Linux VM (OrbStack, Lima, UTM) so the agent
   has a whole machine of its own. Not a container: the agent needs systemd,
   sudo, and Docker itself.

## Deliberately not

A Docker image as the main distribution, our own package format, a config
file of options, or a GUI installer. The installer stays a readable shell
script a person (or agent) can audit in two minutes.

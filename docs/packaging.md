# Packaging: installing AgentOS on any box

## What gets installed

- **The seed** (`seed/` in this repo, ours):
  - `install.sh`, `bootstrap.sh`
  - `home/`: the core every machine gets: the Desk, Settings, Gallery, the
    design kit, `AGENTS.md`, `DESIGN.md`, `bin/` (show, notify, focus, desk,
    preview, add-view, in-scope, check-themes), the agent registry, skills.
  - `templates/<name>/`: optional Views (today: `system`, `mail`). A
    template is a working View folder, plus a `SETUP.md` if it needs accounts
    or keys; an agent session walks the owner through it.
  - `profiles/*.txt`: lists of templates to start with (`minimal`,
    `default` = system, `personal` = system + mail).
- **The machine's home** (`/home/agent/home`, the agent's): a git repo that
  starts as a copy of `seed/home` plus the chosen templates, then diverges.
  The installer never overwrites it.

Adding Views later: Desk → Settings → Views, or `add-view <name>` /
`add-view --list` on the box. The installer records where its seed is
(`~/.config/agentos/seed`) so the catalog keeps working.

## Installing

On the box, from a checkout, as root:

    seed/install.sh [--profile default|minimal|personal] [--with mail,system]
                    [--restore backup.tar.gz] [--no-tailscale] [--no-swap] [--check] [--force]

From a Mac: `seed/bootstrap.sh <host> [same options]` (copies the seed to
`/opt/agentos-seed`, plus a Claude token if one is at
`$CLAUDE_TOKEN_FILE` or `~/.springroll/claude-token`).

`--check` prints the preflight report (distro, CPU, memory, disk, systemd,
internet) and stops. The installer adds a 2 GB swap file on machines under
6 GB with no swap, unless `--no-swap`.

After install, the human steps: `tailscale up` (unless `--no-tailscale`, in
which case the Desk is reached over `ssh -L 8000:127.0.0.1:8000`), and
signing agents in (Settings → Coding agents).

## Moving to a new machine

On the old one: Settings → Backups → Download (or `backup` on the box). On the
new one: `AGENTOS_BACKUP_PASSPHRASE=… sudo seed/install.sh --restore <file>`.
Tested end to end: the live box's backup restored onto a fresh Ubuntu 24.04
brought back chats, jobs, Views with their data, and secrets.

## Where it runs

Tested from a blank machine with `tests/fresh-install.sh` (a throwaway
container booting systemd, then 14 checks: services, Desk, terminal, agents
installed, every View serving, sessions, idempotent re-run):

| Distro | Package manager | Result |
|---|---|---|
| Ubuntu 26.04 (the live box) | apt | ✓ (installed and re-run in place) |
| Ubuntu 24.04 | apt | ✓ |
| Debian 12 | apt (ttyd from the static build) | ✓ |
| Fedora 44 | dnf | ✓ |
| Arch Linux | pacman | ✓ |

Requirements: systemd (so not Alpine or plain Docker containers; WSL2 with
systemd works), x86_64 or aarch64, root. On a Mac or Windows laptop, run it
in a Linux VM (OrbStack, Lima, UTM, WSL2).

Not yet tested: ARM hardware (Raspberry Pi 5, ARM cloud), RHEL/Rocky (no
ttyd package; the static build should cover it). Playwright's browser
libraries are only auto-installed on Debian/Ubuntu.

## Sizing

Measured on the live box: the Desk, terminal server, System View and
Tailscale together use under 100 MB. Each agent session uses 250–350 MB (a
Codex session with its helpers ~700 MB). Tools take about 3 GB of disk
(npm packages 1 GB, Playwright's Chromium 700 MB).

| | RAM | CPU | Disk | Good for |
|---|---|---|---|---|
| Minimum | 2 GB + swap | 1 vCPU | 15 GB | 1–2 agent sessions |
| Recommended | 4 GB | 2–3 vCPU | 30 GB | ~5 sessions plus screenshot checks |
| Comfortable | 8 GB+ | 4 vCPU | 50 GB | many parallel agents |

## Next

1. **Public repo + one line**: `curl -fsSL <url>/install | sudo bash`, where
   the script clones the repo to `/opt/agentos-seed` and runs `install.sh`.
2. **Upgrades are merges the agent does**: a new seed version arrives as a
   git remote in `~/home`; the agent merges it with what the owner changed.
   Template updates the same way.
3. **CI for the test matrix**: run `tests/fresh-install.sh` per distro on
   every change to `seed/`.

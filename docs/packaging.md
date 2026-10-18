# Packaging: installing Springroll on any box

## What gets installed

- **The seed** (`seed/` in this repo, ours):
  - `install.sh`, `bootstrap.sh`
  - `home/`: the core every machine gets: Springroll and agentd, the apps
    (Files, Browser, Dev, To-dos, Settings, Gallery; Calendar as a
    placeholder), the design kit, `AGENTS.md`, `DESIGN.md`, `bin/` (show,
    notify, signal, secret, gmail, dev, browser, backup, …), the agent
    registry, the connections catalog, skills, personas and the starter jobs.
  - `templates/<name>/`: optional apps (today: `system`, `mail`). A
    template is a working View folder, plus a `SETUP.md` if it needs accounts
    or keys; an agent session walks the owner through it.
  - `profiles/*.txt`: lists of templates to start with (`minimal`,
    `default` = system, `personal` = system + mail).
- **The machine's home** (`/home/agent/home`, the agent's): a git repo that
  starts as a copy of `seed/home` plus the chosen templates, then diverges.
  The installer never overwrites it.

Adding apps later: Springroll → Apps → Ready to add, or `add-view <name>` /
`add-view --list` on the box. The installer records where its seed is
(`~/.config/springroll/seed`) so the catalog keeps working.

## Installing

On the box, from a checkout, as root:

    seed/install.sh [--profile default|minimal|personal] [--with mail,system]
                    [--restore backup.tar.gz] [--no-tailscale] [--no-swap] [--check] [--force]

From a Mac: `seed/bootstrap.sh <host> [same options]` (copies the seed to
`/opt/springroll-seed`, plus a Claude token if one is at
`$CLAUDE_TOKEN_FILE` or `~/.springroll/claude-token`).

`--check` prints the preflight report (distro, CPU, memory, disk, systemd,
internet) and stops. The installer adds a 2 GB swap file on machines under
6 GB with no swap, unless `--no-swap`.

After install, the human steps: `tailscale up` (unless `--no-tailscale`, in
which case Springroll is reached over `ssh -L 8000:127.0.0.1:8000`), and
signing agents in (Connections → Coding agents).

## Moving to a new machine

On the old one: Settings → Backups → Download (or `backup` on the box). On the
new one: `SPRINGROLL_BACKUP_PASSPHRASE=… sudo seed/install.sh --restore <file>`.
Tested end to end: the live box's backup restored onto a fresh Ubuntu 24.04
brought back chats, jobs, Views with their data, and secrets.

## Where it runs

Tested from a blank machine with `tests/fresh-install.sh` (a throwaway
container booting systemd, then 19 checks: services, Springroll, agentd, Files, terminal,
agents installed, jobs and connections APIs, every View serving, sessions,
idempotent re-run; with `BACKUP=` it also restores a backup and checks it):

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

Measured on the live box: Springroll, terminal server, System View and
Tailscale together use under 100 MB. Each agent session uses 250–350 MB (a
Codex session with its helpers ~700 MB). Tools take about 3 GB of disk
(npm packages 1 GB, Playwright's Chromium 700 MB).

| | RAM | CPU | Disk | Good for |
|---|---|---|---|---|
| Minimum | 2 GB + swap | 1 vCPU | 15 GB | 1–2 agent sessions |
| Recommended | 4 GB | 2–3 vCPU | 30 GB | ~5 sessions plus screenshot checks |
| Comfortable | 8 GB+ | 4 vCPU | 50 GB | many parallel agents |

## Next

1. **One line**: the repo is public; next is `curl -fsSL <url>/install | sudo bash`,
   where the script clones it to `/opt/springroll` and runs `install.sh`.
2. **Updates are merges the agent does** (built): each machine is the owner's
   fork. `springroll-upstream` snapshots the seed (and installed templates) onto
   an `upstream` branch in `~/home`; the weekly **Update Springroll** job follows
   `skills/update/SKILL.md`: backup, merge on a branch, keep the owner's
   choices (`LOCAL.md`, `DESIGN.md`), run changelog migrations, check Springroll
   and Views, then report Took / Adapted / Skipped / Needs you. Upstream writes
   `CHANGELOG.md` for that agent: what, why, and "if you changed this".
   When the seed is a git checkout (the default install), `springroll-upstream`
   pulls it first.
3. **CI for the test matrix**: run `tests/fresh-install.sh` per distro on
   every change to `seed/`.

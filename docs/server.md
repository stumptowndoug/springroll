# The Springroll box

Hetzner Cloud, Hillsboro (US). Created 2026-10-08 for Springroll, cleaned and
renamed for Springroll the same day.

| | |
|---|---|
| Type | CPX21: 3 vCPU (x86), 4 GB RAM, 80 GB disk, plus 2 GB swap |
| OS | Ubuntu 26.04.1 LTS |
| Public IP | 5.78.211.34 (SSH only) |
| Tailscale | `springroll` · `springroll.tail07853f.ts.net` · 100.77.215.117 |
| SSH | `ssh root@springroll` (over Tailscale) or `ssh root@5.78.211.34`; key from the owner's Mac |
| Backups | Hetzner daily backups enabled (+20%) |

## Installed

- Docker 29 (Ubuntu package), empty: no containers, images or volumes
- Tailscale 1.104, HTTPS ("serve") enabled on the tailnet; nothing served yet
- ufw firewall: inbound SSH, everything on `tailscale0`, and Tailscale's UDP
  port (41641) only
- 2 GB swap file

## Not installed yet

- Claude Code and Codex on the host (they ran inside the Springroll container
  before; that container and its logins are gone)
- Any Springroll software

## Notes

- Expose a private web app with `tailscale serve --bg <port>`; it appears at
  `https://springroll.tail07853f.ts.net`.
- Bind services to `127.0.0.1` and let Tailscale publish them; nothing should
  listen on the public IP except SSH.
- The owner's Claude setup token is in `~/.springroll/claude-token` on the Mac
  (owner-only); reuse it or make a new one with `claude setup-token`.

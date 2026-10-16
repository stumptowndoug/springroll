# The server

Springroll was built on a small Hetzner Cloud box (3 vCPU, 4 GB RAM, 80 GB disk, plus 2 GB swap,
Ubuntu) and runs on anything with systemd: [Packaging](packaging.md) has the tested distros and
sizes, [Installing](install.md) the steps.

## How that box is set up

- **Nothing public but SSH.** Springroll and every app bind to `127.0.0.1`; Tailscale publishes
  Springroll to the owner's devices (`tailscale serve --bg 8000`, HTTPS on the tailnet name).
- **Firewall (ufw):** inbound SSH, everything on `tailscale0`, and Tailscale's UDP port (41641).
  Nothing else.
- **SSH:** key only, from the owner's laptop; over Tailscale once it's up.
- **Backups:** the provider's daily snapshots, plus Springroll's own nightly backup (and off-machine
  copies once they're set up: `skills/backup`).
- **Docker** is installed but unused; Springroll doesn't need it.

## Notes

- Expose another private web app with `tailscale serve`; never on the public IP.
- A Claude setup token made on the laptop (`claude setup-token`) can be copied to the box at
  install (`seed/bootstrap.sh`), or sign in from Springroll later.

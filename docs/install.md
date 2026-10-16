# Installing Springroll

Written for the coding agent doing the install, on the owner's laptop. Do the steps; the owner
only clicks links, pays and signs in. Ask before creating an account or spending money, and never
ask for a password in the chat: send the owner to the page where they type it.

## What it needs

A Linux machine with systemd and root (sudo), x86_64 or ARM, apt/dnf/pacman, 4 GB RAM (2 GB plus
swap works), 30 GB disk, outbound internet. Not a plain container: it runs systemd services. Tested
on Ubuntu 24.04/26.04, Debian 12, Fedora, Arch ([Packaging](packaging.md)).

## 1. A machine

Ask the owner which, recommend the first:

- **exe.dev** (least to do: no token to copy, a private HTTPS address with its own login, $15/month
  for 2 vCPU / 4 GB shared by up to 50 VMs). Run `ssh exe.dev`: it asks for an email and prints a
  link; the owner opens it, then picks a plan (another link). Then:

      ssh exe.dev new --name=springroll --cpu=2 --memory=4GB --disk=30GB

  The machine is `springroll.exe.xyz`; `ssh springroll.exe.xyz` logs in as `exedev` with sudo.
  Check exe.dev's host key fingerprint against https://exe.dev/docs/faq/host-key first.
- **A VPS** (Hetzner, DigitalOcean, Vultr, …): Ubuntu 24.04, 4 GB. The owner makes the account and
  an API token; with the provider's CLI you create the server with the owner's SSH key. Or the owner
  creates it in the provider's console and gives you the IP.
- **Their own machine** (a mini PC, an old laptop, a Linux VM): anything that meets the needs above.
  It must stay on: jobs run on a schedule.

## 2. Install

On the machine:

    sudo apt-get install -y git 2>/dev/null || true   # dnf/pacman elsewhere
    sudo git clone https://github.com/stumptowndoug/springroll /opt/springroll
    sudo /opt/springroll/seed/install.sh               # add --no-tailscale on exe.dev without Tailscale

It takes a few minutes (Node, the coding agents, a browser) and is safe to re-run. `--check` prints
the preflight only. Updates come from this checkout: the weekly Update Springroll job pulls it.

## 3. A way in

Springroll listens on `127.0.0.1:8000` only. Pick one:

- **Tailscale** (any machine; the default): `sudo tailscale up` prints a login link for the owner,
  then `sudo tailscale serve --bg 8000`. The owner installs Tailscale on their phone and laptop and
  opens `https://<machine>.<tailnet>.ts.net`.
- **exe.dev's login** (exe.dev only, no Tailscale): below.

### exe.dev without Tailscale

Install with `--no-tailscale`, then let exe.dev's private proxy reach Springroll: this forwards
the VM's own address, port 8000, to Springroll on localhost, and survives restarts.

```sh
sudo apt-get install -y socat
sudo tee /etc/systemd/system/springroll-exe-proxy.service >/dev/null <<'EOF'
[Unit]
Description=Let exe.dev's private proxy reach Springroll
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/bin/sh -c 'exec socat TCP-LISTEN:8000,bind=$$(hostname -I | cut -d" " -f1),fork,reuseaddr TCP:127.0.0.1:8000'
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload && sudo systemctl enable --now springroll-exe-proxy
```

The owner opens `https://<name>.exe.xyz` and signs in with exe.dev. Keep it private (the default):
never `share set-public`, because whoever reaches Springroll can run commands on the machine.

## 4. Sign in a coding agent

The owner opens Springroll → Connections → Coding agents and signs in Claude or Codex (their
subscription). That's what runs the chats and jobs.

## 5. Check and hand over

`curl -fsS localhost:8000/api/agent/health` on the machine says ok. Give the owner the address and
tell them to start a chat: everything else (mail, jobs, apps) they ask Springroll for. Email defaults
to "Ask me first": agents show each email before it's sent until the owner changes that in
Connections → Gmail.

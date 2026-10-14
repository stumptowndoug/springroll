# Browser

A real browser agents drive while you watch, and click into to sign in or get past a check.

## What it does

Agents start a browser with `browser start` and drive it with `agent-browser --session <name> …`
(Vercel's agent-browser CLI). This app shows that browser live (frames from agent-browser's stream)
and sends your mouse, scroll and keys back, so you can take over (sign in, enter a 2FA code, solve a
captcha) and hand it back. On a phone, drag scrolls, tap clicks, and the keyboard button types into
the focused field.

Backends (`--via`):
- `home`: the local browser, but leaving the internet from the owner's home: Chromium's
  `--proxy-server=socks5://127.0.0.1:1055` (plus WebRTC limited to the proxy), which is a second,
  userspace tailscaled (`tailscale-browser.service`, node `springroll-browser`, state in
  `~/.config/springroll/tailscale-browser/`, socket `/run/user/<uid>/tailscale-browser.sock`) using
  a device of the owner's at home (a Mac, Apple TV, Raspberry Pi…) as its exit node. Nothing else on the machine is routed. `home.mjs` checks it:
  that node is logged in, the home device is online and offering an exit node, and the address seen
  through the proxy is the recorded home address and not this server's. Checked before a home
  browser starts and every 3 minutes while one runs (`guardHome`): if it fails, home browsers are
  stopped and a Timeline signal (`browser:home-down`) says why. Settings in
  `~/data/browser/home.json`: `enabled` (home is the default for `browser start`), `fallback`
  (stop | kernel | local, used only when home was the default, not when asked for by name, and
  only for browsers without a profile: sign-ins always wait for home),
  `node`, `homeIP`.
- `local`: headless Chromium on this machine, as a transient user unit `browser-<name>`
  (MemoryMax 1G, at most two local/home browsers at once, `--no-sandbox` because Ubuntu's AppArmor blocks Chromium's sandbox here).
  Profiles (sign-ins) in `~/.config/springroll/browser/profiles/<profile>`, so backups encrypt them
  with the other sign-ins; caches in `~/.cache/springroll-browser/` (not backed up). Default profile
  `default`; home browsers use
  `home-<profile>`, so an account's cookies never travel from both addresses. Local and home
  Chromium hide that they're headless (Linux Chrome user agent, no `navigator.webdriver`): Reddit
  blocks a plain headless one even from home. Home browsers also keep WebRTC to the proxy via the
  profile's Preferences (the command-line flag alone isn't honored).
- `kernel`: Kernel cloud browser (`KERNEL_API_KEY`), headful, stealth on by default, 15 min
  inactivity timeout, Kernel profiles for sign-ins. Default when the key is set.
- `browserbase`: Browserbase session (`BROWSERBASE_API_KEY`); a Browserbase context per profile
  (ids in `sessions.json` → `contexts`).

Kernel's local Docker image (kernel-images, headful with its own live view) is the planned
`local` upgrade for a bigger machine; it wants `--privileged` and several GB of RAM.

## How it's built

- `lib.mjs`: backends, state, agent-browser glue. `startSession` creates the browser, then runs
  `agent-browser --session <name> connect <cdp>` inside its own systemd scope so the daemon outlives
  the chat that started it. `listSessions` stops and drops any session whose browser is gone or
  whose agent-browser session is no longer attached (the daemon exits after 1 h idle), so nothing
  bills unattended; the server runs it every minute.
- `cli.mjs`: the `browser` command (`bin/browser` execs it).
- `server.mjs` (port in `PORT`, unit `browser.service`): the JSON API, and `/stream/<name>`, a raw
  WebSocket relay to agent-browser's stream port (it only accepts localhost origins, so the relay
  rewrites `Origin`).
- `home.mjs`: the home route's settings and checks (`homeStatus`).
- `setup.mjs`: the parts and their setup (`parts`, `setupHome`, `removeHome`); `ensure.sh` installs
  the tools.
- `index.html`: the page. Frames are decoded off-screen (`createImageBitmap`) and painted on a
  canvas: swapping an `<img>` src flickers in Safari. The page size follows the viewer's stage
  (and is taken back on focus/visibility when another viewer resized it). A Home internet section (switch, fallback, last check) on the start page. Toolbar (session picker, back, reload, address, type, Chat, ⋯ with New /
  Provider live view / Stop), the live image, a meta line.

Data: `~/data/browser/sessions.json` (running sessions, Browserbase contexts), `home.json` (home
settings); sign-ins in `~/.config/springroll/browser/profiles/` (moved there from `~/data` on first
use). Agents' usage guide: `skills/web/SKILL.md`.

## Setup

The app sets itself up; its start page lists **Ways to browse** with each part's state, a one-click
setup and Chat (`setup.mjs`, `GET api/setup`):
- **This machine**: ready out of the box. `browser.service` runs `ensure.sh` first, which installs
  agent-browser and Chromium when missing (a new or restored machine).
- **Home internet**: optional. Set up (`POST api/setup/home`) creates
  `~/.config/springroll/tailscale-browser/`, starts `tailscale-browser.service` (which only runs
  when that folder exists, so a fresh install doesn't start it) and returns an approval link; then
  the owner turns on Run as exit node on a home device and approves it in Tailscale's admin page.
  Remove (`POST api/setup/home/remove`) signs it out and stops it. Restoring a backup brings it back
  already signed in (state is in `~/.config/springroll`, encrypted); don't run the old and new
  machine at once with the same state, or remove it and set it up again.
- **Kernel / Browserbase**: Connect opens their Connections entry (`#/connections/<id>`).

Don't give agent-browser launch options in
`~/.agent-browser/config.json` or `AGENT_BROWSER_ARGS`/`_PROXY`/…: with any set, `connect` launches
a browser of its own instead of attaching to ours (skipping the home proxy and profiles).
`attach` strips those env vars and checks the CDP URL it got, and fails loudly if it's not ours.

## JSON API

- `GET api/sessions` → `[{name, via, id, live, profile, started, title, url}]` (never the CDP URL)
- `POST api/sessions` `{name?, via?, profile?, stealth?, url?}` → the session (reuses one by name)
- `POST api/sessions/<name>/open` `{url}`, `/back`, `/reload` → `{title, url}`
- `POST api/sessions/<name>/viewport` `{w, h}`: the page size (the app sets it to its stage)
- `POST api/sessions/<name>/stop`
- `GET api/setup` → `[{id, title, state: ready|needs|installing|off, detail, action?, authURL?, enabled?, fallback?}]`;
  `POST api/setup/home`, `POST api/setup/home/remove`
- `GET api/backends` → `[{via, ready, key | reason, …}]`
- `GET api/home` → the home route's checks `{ok, reason, enabled, fallback, homeIP, ip, serverIP, exitNode, nodes, authURL?}`;
  `POST api/home` `{enabled?, fallback?, node?, accept?}` changes settings and returns the same
- WebSocket `stream/<name>?pacing=ack&maxFps=15`: agent-browser's stream protocol
  (`frame`/`url`/`tabs`/`status` out; `input_mouse`/`input_keyboard`/`ack` in).

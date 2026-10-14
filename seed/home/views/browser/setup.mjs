// The Browser app's parts and their setup. The browser on this machine comes ready (ensure.sh
// installs its tools); home internet and the cloud providers are optional, set up from the app with
// one click (or by an agent: POST api/setup/<id>).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homeStatus, writeHome, SOCK, STATE_DIR } from './home.mjs';
import { key } from './lib.mjs';

const run = promisify(execFile);
const HOME = os.homedir();
const UNIT = 'tailscale-browser.service';
const has = async (cmd) => run('bash', ['-lc', `command -v ${cmd}`]).then(() => true, () => false);
const chromium = () => fs.existsSync(path.join(HOME, '.cache/ms-playwright')) &&
  fs.readdirSync(path.join(HOME, '.cache/ms-playwright')).some((d) => /^chromium-\d+$/.test(d));

export async function parts() {
  const [ab, ts] = await Promise.all([has('agent-browser'), has('tailscaled')]);
  const local = ab && chromium()
    ? { state: 'ready', detail: 'Headless Chromium here. Free. Sites see this server’s address.' }
    : { state: 'installing', detail: 'Installing agent-browser and Chromium (a few minutes).' };
  let home;
  if (!fs.existsSync(STATE_DIR)) home = { state: 'off', detail: 'Sites see your home connection instead of this server, through a device of yours on Tailscale.', action: ts ? 'Set up' : null };
  else {
    const h = await homeStatus().catch((e) => ({ ok: false, reason: e.message }));
    home = h.ok
      ? { state: 'ready', detail: `Sites see ${h.ip} through ${h.exitNode.name}.`, enabled: h.enabled, fallback: h.fallback }
      : { state: 'needs', detail: h.reason, authURL: h.authURL || null, enabled: h.enabled, fallback: h.fallback };
  }
  const cloud = (id, name, k, detail) => (key(k)
    ? { id, title: name, state: 'ready', detail, connection: id }
    : { id, title: name, state: 'off', detail, connection: id, action: 'Connect' });
  return [
    { id: 'local', title: 'This machine', ...local },
    { id: 'home', title: 'Home internet', ...home },
    cloud('kernel', 'Kernel', 'KERNEL_API_KEY', 'Cloud browsers with stealth and captcha solving. Free tier, then pay as you go.'),
    cloud('browserbase', 'Browserbase', 'BROWSERBASE_API_KEY', 'A second cloud provider, for when a site blocks the first.'),
  ];
}

// Home internet: start the browser's own Tailscale connection and ask to approve it. The owner then
// picks a device of theirs as exit node; homeStatus says what's left.
export async function setupHome() {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  await run('systemctl', ['--user', 'link', path.join(HOME, 'home/views/browser', UNIT)]).catch(() => {});
  await run('systemctl', ['--user', 'enable', '--now', UNIT]);
  for (let i = 0; i < 20 && !fs.existsSync(SOCK); i++) await new Promise((r) => setTimeout(r, 250));
  await run('tailscale', [`--socket=${SOCK}`, 'up', `--hostname=${os.hostname()}-browser`, '--accept-dns=false', '--timeout=8s']).catch(() => {});
  return homeStatus();
}

export async function removeHome() {
  await run('tailscale', [`--socket=${SOCK}`, 'logout']).catch(() => {});
  await run('systemctl', ['--user', 'disable', '--now', UNIT]).catch(() => {});
  fs.rmSync(STATE_DIR, { recursive: true, force: true });
  writeHome({ enabled: false, homeIP: null, node: null });
  await run('signal', ['--clear', 'browser:home-down']).catch(() => {});
}

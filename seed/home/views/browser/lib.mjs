// Browser sessions: start one on a backend (this machine, Kernel or Browserbase), attach an
// agent-browser session of the same name to it, remember it, stop it. Used by `browser` (cli.mjs)
// and the Browser app (server.mjs). State: ~/data/browser/sessions.json.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { homeStatus, readHome, PROXY } from './home.mjs';
import * as history from './history.mjs';

const run = promisify(execFile);
const HOME = os.homedir();
export const DATA = path.join(HOME, 'data/browser');
const STATE = path.join(DATA, 'sessions.json');
const SECRETS = path.join(HOME, '.config/springroll/secrets.env');
// Browser profiles hold sign-ins (cookies), so they live with Springroll's other sign-ins, which
// backups encrypt; their caches go to ~/.cache, which isn't backed up.
export const PROFILES = path.join(HOME, '.config/springroll/browser/profiles');
const CACHES = path.join(HOME, '.cache/springroll-browser');
const OLD_PROFILES = path.join(DATA, 'profiles'); // before 2026-10-14: moved on first use
if (fs.existsSync(OLD_PROFILES) && !fs.existsSync(PROFILES)) {
  fs.mkdirSync(path.dirname(PROFILES), { recursive: true, mode: 0o700 });
  fs.renameSync(OLD_PROFILES, PROFILES);
}
const AB = fs.existsSync(path.join(HOME, '.npm-global/bin/agent-browser')) ? path.join(HOME, '.npm-global/bin/agent-browser') : 'agent-browser';

// No ~/.agent-browser/config.json launch options (args, proxy, …): with any set, `connect` launches
// a fresh browser of agent-browser's own instead of attaching to ours, silently skipping the home
// proxy and the profile. Agents using agent-browser on its own pass --args --no-sandbox instead.
const AB_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^AGENT_BROWSER_(ARGS|PROXY|PROFILE|EXECUTABLE_PATH|HEADED|PROVIDER|CDP|STATE|RESTORE)/.test(k)));

// Cloud browsers end after this long with nothing connected (agent-browser holds a connection while
// its daemon runs; it exits after an hour idle).
const IDLE_SECONDS = 900;
const MAX_HERE = 2;
export const VIA = ['home', 'local', 'kernel', 'browserbase'];
const APP_PORT = fs.readFileSync(new URL('./PORT', import.meta.url), 'utf8').trim();
const KEYS = { kernel: 'KERNEL_API_KEY', browserbase: 'BROWSERBASE_API_KEY' };

// A key from the environment, else from secrets.env (the app's service doesn't get them as env vars).
export function key(name) {
  if (process.env[name]) return process.env[name];
  try {
    const m = fs.readFileSync(SECRETS, 'utf8').match(new RegExp(`^${name}='(.*)'$`, 'm'));
    return m ? m[1].replace(/'\\''/g, "'") : '';
  } catch { return ''; }
}
export async function backends() {
  const home = await homeStatus().catch((e) => ({ ok: false, reason: e.message }));
  return VIA.map((via) => via === 'home'
    ? { via, ready: home.ok, reason: home.reason || null, ip: home.ip, node: home.exitNode?.name || null, enabled: home.enabled }
    : { via, ready: via === 'local' || !!key(KEYS[via]), key: KEYS[via] || null });
}
const cloudVia = () => (key('KERNEL_API_KEY') ? 'kernel' : key('BROWSERBASE_API_KEY') ? 'browserbase' : 'local');

export const read = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return { sessions: [], contexts: {} }; } };
function write(s) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(STATE + '.tmp', JSON.stringify(s, null, 2) + '\n');
  fs.renameSync(STATE + '.tmp', STATE);
}

async function api(via, method, url, body) {
  const headers = via === 'kernel'
    ? { authorization: `Bearer ${key('KERNEL_API_KEY')}` }
    : { 'x-bb-api-key': key('BROWSERBASE_API_KEY') };
  const base = via === 'kernel' ? 'https://api.onkernel.com' : 'https://api.browserbase.com';
  const r = await fetch(base + url, {
    method, headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000),
  });
  const text = await r.text();
  if (!r.ok) {
    const err = new Error(`${via} ${method} ${url}: ${r.status} ${text.slice(0, 300)}`);
    err.status = r.status;
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

export async function ab(name, ...args) {
  const { stdout } = await run(AB, ['--session', name, ...args], { timeout: 60000, env: process.env });
  return stdout.trim();
}

// Attach agent-browser session `name` to a browser. Its daemon starts in a scope of its own so it
// outlives the chat or job that ran this; it exits after an hour without commands or viewers.
async function attach(name, cdp) {
  await run('systemd-run', ['--user', '--scope', '--quiet', '--collect', `--unit=agent-browser-${name}-${Date.now()}`,
    AB, '--session', name, 'connect', cdp], { timeout: 60000, env: AB_ENV });
  // Make sure it really attached to this browser and didn't launch one of its own.
  const got = await ab(name, 'get', 'cdp-url').catch(() => '');
  const port = (u) => (u.match(/:(\d+)\//) || [])[1];
  if (!got.includes(new URL(cdp).host) && !(port(got) && port(got) === port(cdp))) {
    await ab(name, 'close').catch(() => {});
    throw new Error(`agent-browser didn't attach to the new browser (got ${got || 'nothing'}). Is ~/.agent-browser/config.json setting launch options?`);
  }
}
async function attachedNames() {
  const { stdout } = await run(AB, ['session', 'list', '--json'], { timeout: 15000 });
  const j = JSON.parse(stdout);
  return new Set((j.data?.sessions || []).map((s) => (typeof s === 'string' ? s : s.name || s.session)));
}

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  s.on('error', rej);
});
const chromium = () => {
  const dir = path.join(HOME, '.cache/ms-playwright');
  const found = fs.existsSync(dir) && fs.readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()
    .map((d) => path.join(dir, d, 'chrome-linux64/chrome')).find((p) => fs.existsSync(p));
  if (!found) throw new Error('No Chromium here: run `agent-browser install`.');
  return found;
};
const unit = (name) => `browser-${name}`;
// What a headless Chromium says about itself gives it away ("HeadlessChrome", navigator.webdriver):
// Reddit's network security blocks it even from a home address. Look like ordinary Chrome on Linux.
const userAgent = (bin) => {
  let major = '156';
  try { major = String(execFileSync(bin, ['--version'], { encoding: 'utf8' })).match(/(\d+)\./)?.[1] || major; } catch {}
  return `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
};
// WebRTC can reveal this server's address around a proxy; keep it to the proxy (a profile setting:
// the command-line flag alone isn't honored).
function webrtcViaProxyOnly(dir) {
  const f = path.join(dir, 'Default', 'Preferences');
  let prefs = {};
  try { prefs = JSON.parse(fs.readFileSync(f, 'utf8')); } catch {}
  prefs.webrtc = { ...prefs.webrtc, ip_handling_policy: 'disable_non_proxied_udp', multiple_routes_enabled: false, nonproxied_udp_enabled: false };
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(prefs));
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

// ---- Backends: each returns { id, cdp, live? } ----
const start = {
  // Headless Chromium on this machine, as its own small systemd service so it outlives the chat that
  // started it. Its profile (sign-ins) lives in ~/.config/springroll/browser/profiles/<profile>.
  async local({ name, profile, proxy }) {
    const port = await freePort();
    // Home profiles live apart from this server's (home-<profile>): a site shouldn't see one
    // account's cookies arrive from both addresses.
    const base = (proxy ? 'home-' : '') + slug(profile || 'default');
    const dir = path.join(PROFILES, base);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    for (const f of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) fs.rmSync(path.join(dir, f), { force: true });
    if (proxy) webrtcViaProxyOnly(dir);
    const bin = chromium();
    await run('systemctl', ['--user', 'reset-failed', unit(name)]).catch(() => {});
    await run('systemd-run', ['--user', '--quiet', '--collect', `--unit=${unit(name)}`,
      '-p', 'MemoryHigh=700M', '-p', 'MemoryMax=1G', '-p', 'OOMScoreAdjust=300',
      bin, '--headless=new', '--no-sandbox', '--disable-blink-features=AutomationControlled', `--user-agent=${userAgent(bin)}`, `--remote-debugging-port=${port}`, '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${dir}`, `--disk-cache-dir=${path.join(CACHES, base)}`, ...(proxy ? [`--proxy-server=${proxy}`, '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'] : []), '--no-first-run', '--no-default-browser-check', '--window-size=1280,800', 'about:blank']);
    for (let i = 0; i < 40; i++) {
      try {
        const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
        return { id: unit(name), cdp: v.webSocketDebuggerUrl, port };
      } catch { await new Promise((r) => setTimeout(r, 250)); }
    }
    await run('systemctl', ['--user', 'stop', unit(name)]).catch(() => {});
    throw new Error('Chromium did not start (journalctl --user -u ' + unit(name) + ').');
  },

  // Home: the local browser, through the home route's proxy (home.mjs). WebRTC can't leak this
  // server's address around it.
  home: (opts) => start.local({ ...opts, proxy: PROXY }),

  // Kernel: a headful cloud Chromium with its own live view. Stealth (proxy + captcha solving) on by
  // default since this machine's address is a data center's. A profile keeps sign-ins between sessions.
  async kernel({ profile, stealth = true }) {
    const body = { headless: false, stealth, timeout_seconds: IDLE_SECONDS };
    if (profile) {
      try { await api('kernel', 'GET', `/profiles/${encodeURIComponent(profile)}`); }
      catch (e) { if (e.status === 404) await api('kernel', 'POST', '/profiles', { name: profile }); else throw e; }
      body.profile = { name: profile, save_changes: true };
    }
    const b = await api('kernel', 'POST', '/browsers', body);
    return { id: b.session_id, cdp: b.cdp_ws_url, live: b.browser_live_view_url || null };
  },

  // Browserbase: a context per profile keeps sign-ins; proxies and captcha solving when stealth.
  async browserbase({ profile, stealth = false }, state) {
    const body = { timeout: IDLE_SECONDS * 4, browserSettings: { solveCaptchas: stealth } };
    if (stealth) body.proxies = true;
    if (profile) {
      state.contexts ||= {};
      state.contexts[profile] ||= (await api('browserbase', 'POST', '/v1/contexts', {})).id;
      body.browserSettings.context = { id: state.contexts[profile], persist: true };
    }
    const s = await api('browserbase', 'POST', '/v1/sessions', body);
    const dbg = await api('browserbase', 'GET', `/v1/sessions/${s.id}/debug`).catch(() => ({}));
    return { id: s.id, cdp: s.connectUrl, live: dbg.debuggerFullscreenUrl || null };
  },
};

const stop = {
  local: (s) => run('systemctl', ['--user', 'stop', s.id]).catch(() => {}),
  home: (s) => stop.local(s),
  kernel: (s) => api('kernel', 'DELETE', `/browsers/${s.id}`).catch((e) => { if (e.status !== 404) throw e; }),
  browserbase: (s) => api('browserbase', 'POST', `/v1/sessions/${s.id}`, { status: 'REQUEST_RELEASE' }).catch((e) => { if (e.status !== 404 && e.status !== 409) throw e; }),
};

const alive = {
  home: (s) => alive.local(s),
  local: async (s) => { try { await fetch(`http://127.0.0.1:${s.port}/json/version`, { signal: AbortSignal.timeout(2000) }); return true; } catch { return false; } },
  kernel: async (s) => { try { const b = await api('kernel', 'GET', `/browsers/${s.id}`); return !b.deleted_at; } catch (e) { return e.status ? e.status !== 404 : true; } },
  browserbase: async (s) => { try { const b = await api('browserbase', 'GET', `/v1/sessions/${s.id}`); return b.status === 'RUNNING'; } catch (e) { return e.status ? e.status !== 404 : true; } },
};

// Start a browser and attach agent-browser session `name` to it. Reuses a running one of that name.
// `by` says who asked ({ origin: 'app' } from the Browser app); otherwise the chat or job running this.
// Every start, and every failed one, goes into the history (history.mjs).
export async function startSession({ name = 'main', via, profile, stealth, url, by } = {}) {
  name = slug(name) || 'main';
  const asked = via || null;
  by = await history.who(by);
  const note = {};
  try {
    return await startOne({ name, via, profile, stealth, url, asked, by, note });
  } catch (e) {
    if (!e.recorded) try { history.failed({ name, via: note.via || via || null, asked, profile: profile || null, fallback_from: note.from, fallback_reason: note.why }, by, e.message); } catch {}
    throw e;
  }
}
async function startOne({ name, via, profile, stealth, url, asked, by, note }) {
  via ||= readHome().enabled ? 'home' : cloudVia();
  note.via = via;
  if (!VIA.includes(via)) throw new Error(`Unknown backend ${via}: ${VIA.join(', ')}`);
  let exitIP = null;
  if (via === 'home') {
    const h = await homeStatus();
    if (h.ok) exitIP = h.ip;
    else {
      // Asked for home by name: refuse. Home by default: the owner's fallback, but only for
      // signed-out browsing. A profile holds the owner's sign-ins; it waits for home, so an account
      // never shows up from another address (and the cloud's profile of that name is empty anyway).
      const fb = asked ? 'stop' : h.fallback;
      if (fb !== 'stop' && profile) throw new Error(`Home internet isn't available (${h.reason}). Profile "${profile}" holds sign-ins, so it waits for home rather than using ${fb === 'kernel' ? 'Kernel' : 'this server'}.`);
      if (fb === 'stop') throw new Error(`Home internet isn't available: ${h.reason} (browser home status)`);
      if (fb === 'kernel' && !key('KERNEL_API_KEY')) throw new Error(`Home internet isn't available (${h.reason}) and Kernel isn't connected.`);
      Object.assign(note, { via: fb, from: 'home', why: h.reason });
      via = fb;
    }
  }
  if (KEYS[via] && !key(KEYS[via])) throw new Error(`${via} needs ${KEYS[via]} (Connections → ${via === 'kernel' ? 'Kernel' : 'Browserbase'}).`);
  const existing = (await listSessions()).find((s) => s.name === name);
  if (existing) {
    // Asked for another route by name: don't hand back this one (it would look like the step up worked).
    if (asked && asked !== existing.via) throw new Error(`${name} is already running on ${existing.via}. To switch: browser stop ${name} && browser start ${name} --via ${asked}`);
    history.reused(existing.hid, by);
    if (url) await ab(name, 'open', url);
    return { ...existing, reused: true };
  }
  // Each Chromium here takes 200–450 MB (more on heavy sites) on a ~4 GB machine: at most two at once.
  if ((via === 'local' || via === 'home') && (await listSessions()).filter((x) => x.via === 'local' || x.via === 'home').length >= MAX_HERE) {
    throw new Error(`Already ${MAX_HERE} browsers running on this machine (each takes 200–450 MB): stop one (browser list, browser stop <name>), reuse one by name, or use --via kernel.`);
  }
  const state = read();
  const opts = { name, profile: profile || (via === 'local' || via === 'home' ? 'default' : undefined), stealth };
  if (stealth === undefined) delete opts.stealth;
  const b = await start[via](opts, state);
  const s = { name, via, id: b.id, cdp: b.cdp, live: b.live || null, port: b.port || null, profile: opts.profile || null, started: Date.now(), ...(exitIP ? { exitIP } : {}) };
  try {
    await attach(name, b.cdp);
  } catch (e) {
    await stop[via](s).catch(() => {});
    throw e;
  }
  s.hid = history.begin(s, by, { asked, fallback_from: note.from, fallback_reason: note.why });
  const fresh = read();
  fresh.contexts = { ...fresh.contexts, ...state.contexts };
  fresh.sessions = [...fresh.sessions.filter((x) => x.name !== name), s];
  write(fresh);
  // Have the app's recorder listening before the first page, so the history has it.
  await fetch(`http://127.0.0.1:${APP_PORT}/api/history/watch`, { method: 'POST', signal: AbortSignal.timeout(4000) }).catch(() => {});
  if (url) {
    try { await ab(name, 'open', url); } catch (e) {
      await stopSession(name, 'failed').catch(() => {});
      try { history.end(s.hid, 'failed', { error: e.message }); } catch {}
      throw Object.assign(e, { recorded: true });
    }
  }
  return s;
}

// `reason` goes into the history: stopped (an agent or the terminal), owner (the Browser app), home-down.
export async function stopSession(name, reason = 'stopped') {
  const state = read();
  const s = state.sessions.find((x) => x.name === name);
  if (!s) throw new Error(`No browser named ${name}.`);
  await ab(name, 'close').catch(() => {});
  await stop[s.via](s);
  const fresh = read();
  fresh.sessions = fresh.sessions.filter((x) => x.name !== name);
  write(fresh);
  await ended(s, reason);
  return s;
}
// Record the end; Browserbase also says how much proxy traffic it used (what stealth bills by).
async function ended(s, reason) {
  let data_bytes;
  if (s.via === 'browserbase' && s.hid) data_bytes = (await api('browserbase', 'GET', `/v1/sessions/${s.id}`).catch(() => ({}))).proxyBytes;
  try { history.end(s.hid, reason, { data_bytes }); } catch {}
}

// Running sessions. One whose browser has gone (timed out, stopped elsewhere), or that agent-browser
// let go of (its daemon idled out after an hour), is stopped and dropped, so nothing runs (or bills)
// unattended.
export async function listSessions() {
  const state = read();
  if (!state.sessions.length) return [];
  const names = await attachedNames();
  const checks = await Promise.all(state.sessions.map(async (s) => names.has(s.name) && alive[s.via](s)));
  const gone = state.sessions.filter((_, i) => !checks[i]);
  if (gone.length) {
    // Not attached any more: agent-browser idled out (an hour without commands). Attached but gone:
    // the browser itself ended (a cloud timeout, a crash, stopped elsewhere).
    for (const s of gone) { ab(s.name, 'close').catch(() => {}); stop[s.via](s).catch(() => {}); ended(s, names.has(s.name) ? 'gone' : 'idle'); }
    const now = read();
    now.sessions = now.sessions.filter((x) => !gone.some((g) => g.name === x.name));
    write(now);
  }
  return state.sessions.filter((_, i) => checks[i]);
}

// The port of agent-browser's live stream for a session (frames out, mouse and keys in).
export async function streamPort(name) {
  let st = JSON.parse(await ab(name, 'stream', 'status', '--json'));
  st = st.data || st;
  if (!st.enabled || !st.port) {
    await ab(name, 'stream', 'enable');
    st = JSON.parse(await ab(name, 'stream', 'status', '--json'));
    st = st.data || st;
  }
  return st.port;
}

export async function pageInfo(name) {
  const [title, url] = await Promise.all([ab(name, 'get', 'title').catch(() => ''), ab(name, 'get', 'url').catch(() => '')]);
  return { title: title.replace(/^✓\s*/, ''), url: url.replace(/^✓\s*/, '') };
}

// While home browsers run, keep checking the route. If it breaks (the home device sleeps or leaves home),
// stop them and say so on the Timeline: a site shouldn't see the account jump to another address.
export async function guardHome() {
  const running = (await listSessions()).filter((s) => s.via === 'home');
  if (!running.length) return { checked: false };
  const h = await homeStatus();
  if (h.ok) {
    run('signal', ['--clear', 'browser:home-down']).catch(() => {});
    return { checked: true, ok: true };
  }
  for (const s of running) await stopSession(s.name, 'home-down').catch(() => {});
  await run('signal', ['--key', 'browser:home-down', '--source', 'Browser', '--icon', 'wifi-off', '--hours', '12',
    '--note', `Stopped browsers: ${running.map((s) => s.name).join(', ')}. Check with \`browser home status\`; start again with \`browser start <name> --via home\` once it's ok.`,
    `Home internet dropped: stopped ${running.length === 1 ? `the ${running[0].name} browser` : `${running.length} browsers`}`, h.reason]).catch(() => {});
  return { checked: true, ok: false, stopped: running.map((s) => s.name), reason: h.reason };
}

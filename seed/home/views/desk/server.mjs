// Springroll: serves the shell UI, lists Views, proxies /v/<name>/ to each View
// and /term/ to the agent terminal (ttyd), and relays show/notify/focus.
// No dependencies: Node's standard library only.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { listConnections, connect as connectService, testConnection, disconnect, setMcp, startSignin, signinStatus, cancelSignin } from './connections.mjs';
import * as files from './files.mjs';
import { listPersonas } from '../../agentd/personas.mjs';
import { usage } from './usage.mjs';
import { usageSettings, patchUsageSettings, visibleUsage } from './public/app/usage-settings.mjs';
import * as google from './google.mjs';
import { listSecrets, setSecret, revealSecret, revealManaged, deleteSecret, NAME_RE } from './secrets.mjs';
import * as needs from './needs.mjs';
import { nextRun } from '../../agentd/cron.mjs';

const HOME = os.homedir();
// The live Springroll runs from ~/home on 8000. A copy for work on Springroll itself (`change up`, a git
// worktree) sets these: its own repo, port, settings file, and SPRINGROLL_COPY=1 (serve its files as they are).
const REPO = process.env.SPRINGROLL_REPO || path.join(HOME, 'home');
const VIEWS = path.join(REPO, 'views');
const DESK_STATE = path.join(HOME, '.desk');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const PORT = Number(process.env.SPRINGROLL_PORT) || 8000;
const TERM_PORT = 7681;
const AGENTD_PORT = Number(process.env.SPRINGROLL_AGENTD_PORT) || 8090;

const SETTINGS = process.env.SPRINGROLL_SETTINGS || path.join(REPO, 'desk.json');
const AGENTS = path.join(REPO, 'agents', 'agents.json');
const ENV = `. ${HOME}/.config/springroll/env`;
process.env.PATH = `${HOME}/.local/bin:${HOME}/.npm-global/bin:${HOME}/home/bin:${process.env.PATH}`;
const THEMES = path.join(HERE, 'public', 'ui', 'themes.json');

fs.mkdirSync(DESK_STATE, { recursive: true });

// Springroll settings live in the home repo so every device (and the agent) shares them.
function readSettings() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch {}
  const themes = JSON.parse(fs.readFileSync(THEMES, 'utf8'));
  const theme = themes.find((t) => t.id === s.theme) || themes[0];
  let ntfyTopic = null;
  try { ntfyTopic = fs.readFileSync(path.join(HOME, '.config', 'springroll', 'ntfy-topic'), 'utf8').trim(); } catch {}
  return {
    theme, ntfyTopic,
    fontSize: s.fontSize || 'medium', density: s.density || 'comfortable', radius: s.radius || 'soft', sidebar: s.sidebar || 'recessed',
    font: s.font || 'system', monoFont: s.monoFont || 'system', accent: s.accent || null, defaultAgent: s.defaultAgent || null,
    sidebarApps: s.sidebarApps || {}, // app name -> shown in the sidebar (default: shown unless a placeholder)
    timezone: s.timezone || null, // the owner's clock: jobs, agents and the machine follow it
    chatDefaults: s.chatDefaults || {}, // agent id -> { model, effort } a new chat starts on (unset: last picked / the agent's own)
    persona: { default: s.persona?.default || null }, // the persona a new chat starts with (~/home/personas)
    utilization: usageSettings(s.utilization),
    keys: { reveal: s.keys?.reveal !== false }, // the Keys page can show values (off: masked everywhere)
  };
}

function writeSettings(patch) {
  let s = {}, tzChanged = false;
  try { s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch {}
  for (const k of ['theme', 'fontSize', 'density', 'radius', 'sidebar', 'font', 'monoFont', 'defaultAgent']) if (typeof patch[k] === 'string' && patch[k]) s[k] = patch[k];
  if (patch.utilization && typeof patch.utilization === 'object' && !Array.isArray(patch.utilization))
    s.utilization = patchUsageSettings(s.utilization, patch.utilization);
  if (patch.sidebarApps && typeof patch.sidebarApps === 'object') {
    s.sidebarApps = { ...(s.sidebarApps || {}) };
    for (const [k, v] of Object.entries(patch.sidebarApps)) if (/^[A-Za-z0-9_-]{1,60}$/.test(k)) { if (typeof v === 'boolean') s.sidebarApps[k] = v; else delete s.sidebarApps[k]; }
  }
  // { persona: { default: 'graham' } }: the persona a new chat starts with (~/home/personas); null or '' for none.
  if (patch.persona && typeof patch.persona === 'object' && 'default' in patch.persona) {
    const id = patch.persona.default;
    if (typeof id === 'string' && /^[a-z0-9-]{1,40}$/.test(id)) s.persona = { ...(s.persona || {}), default: id };
    else if (!id) { delete s.persona?.default; if (s.persona && !Object.keys(s.persona).length) delete s.persona; }
  }
  // { chatDefaults: { claude: { model: 'opus', effort: null } } }: merged per agent; null or '' clears one.
  if (patch.chatDefaults && typeof patch.chatDefaults === 'object') {
    s.chatDefaults = { ...(s.chatDefaults || {}) };
    for (const [a, d] of Object.entries(patch.chatDefaults)) {
      if (!/^[a-z0-9_-]{1,40}$/.test(a) || !d || typeof d !== 'object') continue;
      const cur = { ...(s.chatDefaults[a] || {}) };
      for (const k of ['model', 'effort']) if (k in d) { if (typeof d[k] === 'string' && /^[\w.:\/\[\]-]{1,100}$/.test(d[k])) cur[k] = d[k]; else delete cur[k]; }
      if (Object.keys(cur).length) s.chatDefaults[a] = cur; else delete s.chatDefaults[a];
    }
    if (!Object.keys(s.chatDefaults).length) delete s.chatDefaults;
  }
  if (typeof patch.timezone === 'string' && patch.timezone !== s.timezone) {
    let ok = false; try { new Intl.DateTimeFormat('en', { timeZone: patch.timezone }); ok = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(patch.timezone); } catch {}
    if (ok) { s.timezone = patch.timezone; tzChanged = true; }
  }
  if (typeof patch.keys?.reveal === 'boolean') s.keys = { ...(s.keys || {}), reveal: patch.keys.reveal };
  if ('accent' in patch) { if (/^#[0-9a-f]{6}$/i.test(patch.accent || '')) s.accent = patch.accent.toLowerCase(); else delete s.accent; }
  fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + '\n');
  // A new time zone: the machine's clock (logs, `date`, cron-like tools) and agentd's schedules follow.
  if (tzChanged) {
    execFile('sudo', ['-n', 'timedatectl', 'set-timezone', s.timezone], () => {});
    fetch(`http://127.0.0.1:${AGENTD_PORT}/timezone`, { method: 'POST' }).catch(() => {});
  }
  const out = readSettings();
  // Keep Claude Code's own colors on the same side of light/dark (applies to new sessions).
  if (out.theme.appearance !== 'system') {
    const cj = path.join(HOME, '.claude.json');
    try { const c = JSON.parse(fs.readFileSync(cj, 'utf8')); c.theme = out.theme.appearance; fs.writeFileSync(cj, JSON.stringify(c, null, 2)); } catch {}
  }
  broadcast('settings', out);
  return out;
}

// Type a message into the agent's tmux session, as if the owner had.
function askAgent(text, session) {
  const target = `=${session}:`;
  const load = spawn('tmux', ['load-buffer', '-b', 'desk-ask', '-']);
  load.stdin.end(text);
  load.on('close', () => execFile('tmux', ['paste-buffer', '-p', '-d', '-b', 'desk-ask', '-t', target], () =>
    setTimeout(() => execFile('tmux', ['send-keys', '-t', target, 'Enter']), 300)));
}

/* ---------- Agents and sessions ---------- */

const expand = (p) => p.replace(/^~/, HOME);
const tmux = (args) => new Promise((resolve) => execFile('tmux', args, (err, out) => resolve(err ? '' : out)));
const sh = (cmd) => new Promise((resolve) => execFile('bash', ['-c', `${ENV}; ${cmd}`], { timeout: 8000 }, (err, out) => resolve(err ? null : out.trim())));
const versions = new Map();

function readAgents() {
  try { return JSON.parse(fs.readFileSync(AGENTS, 'utf8')); } catch { return []; }
}

async function agentStatus() {
  return Promise.all(readAgents().map(async (a) => {
    const where = await sh(`command -v ${a.bin}`);
    if (where && !versions.has(a.id)) versions.set(a.id, (await sh(`${a.bin} --version 2>&1 | head -1`)) || '');
    if (!where) versions.delete(a.id);
    // An auth file counts once it holds something (some CLIs create an empty "{}").
    const signedIn = (a.auth || []).some((p) => { try { return fs.statSync(expand(p)).size > 4; } catch { return false; } });
    // Chat needs the harness's ACP mode: built in (opencode acp) or an adapter (claude-agent-acp), and for some
    // (Antigravity's runtime) a sign-in of its own (agents.json "chatSignin").
    const acpInstalled = !!a.acp && (a.acp[0] === a.bin ? !!where : !!(await sh(`command -v ${a.acp[0]}`)));
    const chatSignedIn = !a.chatSignin || authStamp(a.chatSignin.auth) > 0;
    return { ...a, installed: !!where, version: versions.get(a.id) || null, signedIn, acpInstalled, chatSignedIn, disk: diskUse(a, !!where, acpInstalled) };
  }));
}

// What each agent's parts take on disk (agents.json "disk": paths, "npm:<package>" for a global npm package):
// measured with du in the background, at most every 10 minutes per agent or right after an install or removal.
// Until measured, or for a part that isn't installed, agents.json "size" (MB) is the estimate.
const diskCache = new Map(); // agent id -> { at, cli, chat } (MB) | { at, pending: true }
let npmRoot = null;
function diskUse(a, cli, chat) {
  const c = diskCache.get(a.id);
  if (!c || (Date.now() - c.at > 600000 && !c.pending)) measureDisk(a);
  const builtIn = !!a.acp && (a.acp[0] === a.bin);
  return { cli: cli ? c?.cli ?? a.size?.cli ?? null : 0, chat: chat && !builtIn ? c?.chat ?? a.size?.chat ?? null : 0, measured: !!c && !c.pending };
}
async function measureDisk(a) {
  const prev = diskCache.get(a.id);
  diskCache.set(a.id, { ...prev, at: Date.now(), pending: true });
  npmRoot ||= await sh('npm root -g');
  const du = async (paths = []) => {
    const args = paths.map((p) => (p.startsWith('npm:') ? `${npmRoot}/${p.slice(4)}` : expand(p)).split('*').map((x) => shq(x)).join('*'));
    return args.length ? Number(await sh(`du -scm -- ${args.join(' ')} 2>/dev/null | tail -1 | cut -f1`)) || 0 : 0;
  };
  diskCache.set(a.id, { at: Date.now(), cli: await du(a.disk?.cli), chat: await du(a.disk?.chat) });
  broadcast('connections', {}); // pages showing sizes refresh
}

/* ---------- Guided sign-in ----------
   An agent's own login command (agents.json "signin") runs in a hidden terminal, on this machine or on a
   Sprite (`sprite exec --tty`); the sign-in panel shows what the owner needs from it: the sign-in link, a
   code to enter on the provider's page ("device"), or a box to paste the provider's code back into
   ("paste"), and notices when the sign-in lands. Installs the agent (and here, its chat adapter) first.
   part "chat": the chat runtime's own sign-in (agents.json "chatSignin": Antigravity's runtime doesn't use agy's
   login), installing the runtime first. */
const agentSignins = new Map(); // "<agent>[:chat]" or "<agent>@<sprite>" -> { session, started, before, auth, sprite, spec }
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const spriteName = (s) => (s && /^[a-z0-9][a-z0-9-]{0,39}$/.test(s) ? s : null);
const signinKey = (a, sprite, part) => (sprite ? `${a.id}@${sprite}` : part === 'chat' ? `${a.id}:chat` : a.id);
// What a sign-in runs: the agent's login, or its chat runtime's ({command, kind, auth, paste}).
const signinSpec = (a, part) => (part === 'chat' ? a.chatSignin : a.signin && { ...a.signin, auth: a.auth });

// When sign-in files (an agent's "auth", or its chat's) last changed here (0: none holding anything).
function authStamp(auth) {
  return Math.max(0, ...(auth || []).map((p) => { try { const s = fs.statSync(expand(p)); return s.size > 4 ? s.mtimeMs : 0; } catch { return 0; } }));
}

// Whether the agent is signed in on a Sprite (one of its auth files there holds something).
async function spriteSignedIn(a, sprite) {
  const test = (a.auth || []).map((p) => `[ -s ${p.replace(/^~/, '"$HOME"')} ] && echo yes`).join('; ');
  const out = await new Promise((resolve) => execFile('bash', ['-c', `${ENV}; sprite exec -s ${sprite} --no-stdin -- bash -lc ${shq(test + '; true')}`], { timeout: 60000 }, (err, o) => resolve(err ? '' : o)));
  return /yes/.test(out);
}

async function startAgentSignin(a, sprite = null, part = null) {
  const spec = signinSpec(a, part);
  await stopAgentSignin(signinKey(a, sprite, part));
  let command;
  if (sprite) {
    const remote = ['export PATH="$HOME/.local/bin:$PATH"',
      `command -v ${a.bin} >/dev/null || { echo "Installing ${a.name} on ${sprite}…"; ${a.install}; hash -r; }`,
      'echo "Starting sign-in…"', `${spec.command}; echo "__signin_exit $?"`].join('; ');
    command = `echo "Connecting to ${sprite}…"; sprite exec -s ${sprite} --tty -- bash -lc ${shq(remote)}`;
  } else {
    const steps = [];
    if (part !== 'chat' && !(await sh(`command -v ${a.bin}`))) steps.push(`echo "Installing ${a.name}…"`, a.install, 'hash -r');
    if (a.acpInstall && !(await sh(`command -v ${a.acp[0]}`))) steps.push(`echo "Installing ${a.name}'s chat ${a.chatSignin ? 'runtime' : 'adapter'}…"`, a.acpInstall, 'hash -r');
    steps.push('echo "Starting sign-in…"', `${spec.command}; echo "__signin_exit $?"`);
    command = steps.join('; ');
    diskCache.delete(a.id); // installs change it
  }
  const session = await newSession({ name: sprite ? `signin-${a.id}-${sprite}`.slice(0, 40) : `signin-${a.id}${part === 'chat' ? '-chat' : ''}`, command });
  agentSignins.set(signinKey(a, sprite, part), { spec, session, started: Date.now(), before: sprite ? 0 : authStamp(spec.auth), auth: spec.auth, sprite });
  return session;
}

async function stopAgentSignin(key) {
  const s = agentSignins.get(key);
  if (!s) return;
  agentSignins.delete(key);
  await tmux(['kill-session', '-t', s.session]);
}

// A link the tool printed, rejoined if a full-screen interface broke it across lines.
function signinUrl(text) {
  const lines = text.split('\n');
  const urls = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /https:\/\/\S+/.exec(lines[i]);
    if (!m) continue;
    let url = m[0];
    // Continued on the next lines: a run of non-space characters, nothing else on the line.
    while (m.index + m[0].length >= lines[i].trimEnd().length && /^\s*[^\s]+\s*$/.test(lines[i + 1] || '') && /^[\w%&=+\-./?#:~]+$/.test(lines[i + 1].trim())) url += lines[++i].trim();
    urls.push(url.replace(/[).,;'"]+$/, ''));
  }
  return urls.filter((u) => /auth|login|device|oauth|activate|verify/i.test(u)).pop() || null;
}

async function agentSigninState(a, sprite = null, part = null) {
  const s = agentSignins.get(signinKey(a, sprite, part));
  if (!s) return { state: 'idle' };
  if (s.result) return s.result;
  const raw = await tmux(['capture-pane', '-p', '-J', '-S', '-500', '-t', s.session]);
  if (!raw) return { state: 'failed', message: 'The sign-in stopped. Try again.' };
  const text = raw.slice(raw.lastIndexOf('Starting sign-in…') + 1 || 0);
  const lines = raw.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('__signin'));
  const exit = /__signin_exit (\d+)/.exec(raw)?.[1];
  // Signed in: the login wrote its file, or (already signed in) the command just succeeded. On a Sprite,
  // checked there once the login has finished.
  if (!s.sprite && (authStamp(s.auth) > s.before || (exit === '0' && authStamp(s.auth) > 0))) return { state: 'done' };
  if (s.sprite && exit === '0') {
    s.result = (await spriteSignedIn(a, s.sprite)) ? { state: 'done' } : { state: 'failed', message: `${a.name} finished without signing in on ${s.sprite}.` };
    return s.result;
  }
  if (exit != null) return { state: 'failed', message: exit === '0' ? `${a.name} finished without signing in.` : lines.slice(-3).join(' ').slice(0, 300) };
  const started = raw.includes('Starting sign-in…');
  const url = started ? signinUrl(text) : null;
  const code = s.spec.kind === 'device' ? /\b[A-Z0-9]{4,5}-[A-Z0-9]{4,6}\b/.exec(text)?.[0] || null : null;
  return { state: started ? 'waiting' : 'installing', kind: s.spec.kind, paste: s.spec.paste || null, url, code, progress: lines.at(-1)?.slice(0, 160) || '', session: s.session, sprite: s.sprite };
}

// Adding an agent's chat part (POST /api/agents/<id>/chat): idle | installing (progress: its last line) | done | failed.
const agentInstalls = new Map(); // agent id -> { session, result }
async function chatInstallState(a) {
  const s = agentInstalls.get(a.id);
  if (!s) return { state: 'idle' };
  if (s.result) return s.result;
  const raw = await tmux(['capture-pane', '-p', '-J', '-S', '-200', '-t', s.session]);
  const lines = raw.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('__install'));
  const exit = /__install_exit (\d+)/.exec(raw)?.[1];
  if (!raw || exit != null) {
    s.result = exit === '0' ? { state: 'done' } : { state: 'failed', message: lines.slice(-2).join(' ').slice(0, 300) || 'The install stopped.' };
    tmux(['kill-session', '-t', s.session]);
    diskCache.delete(a.id);
    broadcast('connections', {});
    return s.result;
  }
  return { state: 'installing', progress: lines.at(-1)?.slice(0, 160) || '' };
}

function lastSession() {
  try { return fs.readFileSync(path.join(DESK_STATE, 'session'), 'utf8').trim() || 'claude'; } catch { return 'claude'; }
}

// A session "needs you" when the bottom of its screen matches its harness's
// waitingPattern (agents.json), e.g. an approval prompt.
const waiting = new Set();
async function needsYou(name, agentId, agentsList) {
  const a = agentsList.find((x) => x.id === agentId);
  const pattern = a?.waitingPattern || '\\[y/N\\]|\\(y/n\\)';
  const screen = await tmux(['capture-pane', '-p', '-t', `=${name}:`, '-S', '-12']);
  try { return new RegExp(pattern, 'i').test(screen); } catch { return false; }
}

async function listSessions() {
  const out = await tmux(['list-sessions', '-F', '#{session_name}\t#{window_activity}\t#{session_created}\t#{pane_current_command}\t#{pane_current_path}']);
  const agentsList = readAgents();
  const ids = new Set(agentsList.map((a) => a.id));
  const now = Date.now() / 1000;
  const list = await Promise.all(out.trim().split('\n').filter(Boolean).map(async (line) => {
    const [name, activity, created, command, cwd] = line.split('\t');
    const prefix = name.replace(/^setup-/, '').split('-')[0];
    const agent = ids.has(prefix) ? prefix : null;
    const attention = await needsYou(name, agent, agentsList);
    if (attention && !waiting.has(name)) {
      waiting.add(name);
      broadcast('notify', { text: `${name} needs you` });
      execFile('bash', ['-c', `${ENV}; notify "${name} is waiting for you in Springroll"`], () => {});
    } else if (!attention) waiting.delete(name);
    return {
      name, command, cwd: cwd.replace(HOME, '~'), created: +created, agent,
      busy: !attention && now - +activity < 4,
      attention,
      idleFor: Math.round(now - +activity),
    };
  }));
  return list.sort((a, b) => a.created - b.created);
}

// Templates: Views you can add, from the seed this machine was installed from.
function seedDir() {
  try { return fs.readFileSync(path.join(HOME, '.config', 'springroll', 'seed'), 'utf8').trim(); } catch { return '/opt/springroll-seed'; }
}

function listTemplates() {
  const dir = path.join(seedDir(), 'templates');
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => fs.statSync(path.join(dir, n)).isDirectory()); } catch {}
  return names.map((name) => {
    let title = name, description = '', icon = null;
    try {
      const md = fs.readFileSync(path.join(dir, name, 'README.md'), 'utf8');
      title = (md.match(/^#\s+(.+)$/m) || [])[1] || name;
      description = (md.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !p.startsWith('#')) || '').replace(/\s+/g, ' ').replace(/[`*_]/g, '').split(/(?<=\.)\s/)[0].slice(0, 160);
    } catch {}
    try { icon = fs.readFileSync(path.join(dir, name, 'ICON'), 'utf8').trim(); } catch {}
    return { name, title, description, icon, needsSetup: fs.existsSync(path.join(dir, name, 'SETUP.md')),
      installed: fs.existsSync(path.join(VIEWS, name)) };
  });
}

// Setting up a View is a chat: an agent follows the View's SETUP.md with the owner.
async function startSetup(view) {
  const agents = await agentStatus();
  const a = agents.find((x) => x.id === 'claude' && x.signedIn && x.acp) || agents.find((x) => x.installed && x.signedIn && x.acp);
  if (!a) throw new Error('Sign in to a coding agent first (Settings → Coding agents).');
  const r = await fetch(`http://127.0.0.1:${AGENTD_PORT}/threads`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agent: a.id, cwd: '~/home', title: `Set up ${view}`, text: `Set up the ${view} View with me: read views/${view}/SETUP.md and follow it, one step at a time.` }) });
  const t = await r.json();
  if (!r.ok) throw new Error(t.error || 'could not start the agent');
  return t.id;
}

function folders() {
  const out = ['~/home'];
  try { for (const d of fs.readdirSync(path.join(HOME, 'projects'))) if (!d.startsWith('.')) out.push(`~/projects/${d}`); } catch {}
  return out;
}

async function newSession({ agent, dir, name, command }) {
  const existing = new Set((await listSessions()).map((s) => s.name));
  const base = name || agent || 'shell';
  let n = base, i = 2;
  while (existing.has(n)) n = `${base}-${i++}`;
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(n)) throw new Error('bad session name');
  const cwd = path.resolve(expand(dir || '~/home'));
  if (!cwd.startsWith(HOME) || !fs.existsSync(cwd)) throw new Error('folder must exist under ~');
  const a = readAgents().find((x) => x.id === agent);
  const cmd = command || (a ? a.start : 'bash -l');
  const inner = `bash -c '${ENV}; ${cmd.replace(/'/g, "'\\''")}; exec bash -l'`;
  await tmux(['-f', path.join(HERE, 'tmux.conf'), 'new-session', '-d', '-s', n, '-c', cwd, `${HOME}/home/bin/in-scope ${n} ${inner}`]);
  broadcast('sessions', await listSessions());
  return n;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

const SYSTEM_VIEWS = new Set(['settings', 'gallery', 'files']);

function listViews() {
  let names = [];
  try { names = fs.readdirSync(VIEWS); } catch { return []; }
  return names
    .filter((n) => n !== 'desk' && !n.startsWith('.') && fs.statSync(path.join(VIEWS, n)).isDirectory())
    .map((name) => {
      const dir = path.join(VIEWS, name);
      let title = name, description = '';
      try {
        const md = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
        const m = md.match(/^#\s+(.+)$/m);
        if (m) title = m[1].trim();
        const para = md.split(/\n\s*\n/).map((p) => p.trim()).find((p) => p && !p.startsWith('#'));
        if (para) description = para.replace(/\s+/g, ' ').replace(/[`*_]/g, '').split(/(?<=\.)\s/)[0].slice(0, 140);
      } catch {}
      let icon = null, status = null;
      try { status = fs.readFileSync(path.join(dir, 'STATUS'), 'utf8').trim().replace(/^\/+/, '') || null; } catch {}
      try { icon = fs.readFileSync(path.join(dir, 'ICON'), 'utf8').trim().replace(/[^a-z0-9-]/g, '') || null; } catch {}
      const setupPending = fs.existsSync(path.join(dir, '.setup-pending'));
      const placeholder = fs.existsSync(path.join(dir, '.placeholder')); // not built yet: hidden from the sidebar unless shown
      return { name, title, description, icon, status, setupPending, placeholder, system: SYSTEM_VIEWS.has(name), url: `/v/${name}/`, source: dir, port: viewPort(name) };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

function viewPort(name) {
  try { return parseInt(fs.readFileSync(path.join(VIEWS, name, 'PORT'), 'utf8'), 10) || null; } catch { return null; }
}

// Server-sent events to every open Springroll.
const clients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
setInterval(() => broadcast('ping', {}), 25000);
needs.init({ broadcast });

// Springroll's page code (public/): index.html, app/, ui/. The owner's ui/custom.css always comes from the
// folder: Settings and "make lists denser" change it, and those should show at once.
const PUBLIC = path.join(HERE, 'public');
const CUSTOM_CSS = path.join(PUBLIC, 'ui', 'custom.css');
const LIVE = path.join(DESK_STATE, 'live');
const live = { tree: null, dir: PUBLIC };
function mtime(f) { try { const st = fs.statSync(f); return st.isFile() ? `${st.mtimeMs}:${st.size}` : ''; } catch { return ''; } }
function git(args, opts = {}) { return execFileSync('git', ['-C', PUBLIC, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000, ...opts }); }
function refreshLive() {
  if (process.env.SPRINGROLL_COPY) return;
  let tree;
  try { tree = git(['rev-parse', 'HEAD:./']).trim(); } catch { live.tree = null; live.dir = PUBLIC; return; } // not committed yet: the folder
  if (tree === live.tree) return;
  const dir = path.join(LIVE, tree);
  try {
    if (!fs.existsSync(path.join(dir, 'index.html'))) {
      const tmp = `${dir}.tmp`;
      fs.rmSync(tmp, { recursive: true, force: true });
      fs.mkdirSync(tmp, { recursive: true });
      // From the top of the repo: in a subfolder, git archive keeps only that subfolder's paths of the tree.
      const top = git(['rev-parse', '--show-toplevel']).trim();
      execFileSync('tar', ['-x', '-C', tmp], { input: git(['-C', top, 'archive', '--format=tar', tree], { encoding: 'buffer', maxBuffer: 256 << 20 }), timeout: 20000 });
      fs.renameSync(tmp, dir);
    }
    const old = live.tree;
    Object.assign(live, { tree, dir });
    for (const d of fs.readdirSync(LIVE)) if (d !== tree && d !== old) fs.rmSync(path.join(LIVE, d), { recursive: true, force: true });
  } catch (e) { console.error('live page code:', e.message); }
}
refreshLive();

let viewsSnapshot = JSON.stringify(listViews());
// Connections and keys change when an agent edits their files too: tell open pages.
const connSig = () => [path.join(HOME, 'home', 'connections'), path.join(HOME, '.config', 'springroll')]
  .flatMap((d) => { try { return fs.readdirSync(d, { recursive: true }).map((f) => { try { return `${f}:${fs.statSync(path.join(d, f)).mtimeMs}`; } catch { return f; } }); } catch { return []; } }).join('|');
let connSnapshot = connSig();
// Springroll's own page code (index.html, app/, ui/): open tabs compare it and reload when it changed,
// rather than keep running the old code (an update, or an agent's change to Springroll).
// The live one serves them as last committed (live.dir), so an edit reaches the owner's screen when it's
// committed (a change merged), never half-way; a copy serves its files as they are.
const clientBuild = () => (live.tree ? `${live.tree}|${mtime(CUSTOM_CSS)}` : [path.join(PUBLIC, 'index.html'), ...['app', 'ui'].flatMap((d) => {
  try { return fs.readdirSync(path.join(PUBLIC, d)).map((f) => path.join(PUBLIC, d, f)); } catch { return []; }
})].map(mtime).join('|'));
const hash = (t) => { let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
let buildSnapshot = hash(clientBuild());
setInterval(() => {
  refreshLive();
  const b = hash(clientBuild());
  if (b !== buildSnapshot) { buildSnapshot = b; broadcast('build', { build: b }); }
  const now = JSON.stringify(listViews());
  if (now !== viewsSnapshot) { viewsSnapshot = now; broadcast('views', JSON.parse(now)); }
  const c = connSig();
  if (c !== connSnapshot) { connSnapshot = c; broadcast('connections', {}); }
}, 2000);

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve({}); } });
  });
}

function json(res, code, data) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

function serveFile(res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

function proxy(req, res, port, upstreamPath) {
  const up = http.request(
    { host: '127.0.0.1', port, method: req.method, path: upstreamPath, headers: { ...req.headers, host: `127.0.0.1:${port}` } },
    (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); },
  );
  up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(`View on port ${port} isn't responding.`); });
  req.pipe(up);
}

// /v/<name>/rest -> { name, rest }
function splitView(url) {
  const m = url.match(/^\/v\/([^/?#]+)(\/[^]*)?$/);
  if (!m) return null;
  return { name: decodeURIComponent(m[1]), rest: m[2] };
}

const server = http.createServer(async (req, res) => {
  const url = req.url;

  if (url === '/api/views') return json(res, 200, listViews());

  if (url === '/api/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    res.write(`event: views\ndata: ${JSON.stringify(listViews())}\n\n`);
    res.write(`event: build\ndata: ${JSON.stringify({ build: buildSnapshot })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (url === '/api/show' && req.method === 'POST') {
    const { target, thread } = await readBody(req);
    if (!target) return json(res, 400, { error: 'target required' });
    const view = listViews().find((v) => v.name === target);
    // A file or folder opens in Files (at a line with path:12); a Springroll route (#/jobs) is followed.
    const fileMatch = !view && /^[~/]/.test(target) && target.match(/^(.*?)(?::(\d+)(?:-(\d+))?)?$/);
    const abs = fileMatch && files.resolvePath(fileMatch[1]);
    let payload;
    if (view) payload = { name: view.name, title: view.title, url: view.url };
    else if (target.startsWith('#/')) payload = { hash: target };
    else if (abs && fs.existsSync(abs)) {
      // From a chat (`show` gets $SPRINGROLL_THREAD), a file opens beside that chat if a desk is showing it.
      const lines = fileMatch[2] ? [+fileMatch[2], +(fileMatch[3] || fileMatch[2])] : null;
      payload = { hash: `#/v/files#p=${encodeURIComponent(abs)}${lines ? `&l=${lines[0]}${lines[1] !== lines[0] ? '-' + lines[1] : ''}` : ''}` };
      if (thread && /^[\w-]{4,64}$/.test(thread) && !fs.statSync(abs).isDirectory()) Object.assign(payload, { file: abs, lines, thread });
    }
    else payload = { name: target, title: target, url: target };
    broadcast('show', payload);
    return json(res, 200, { shown: payload, desks: clients.size });
  }

  // The persona presets (~/home/personas), read here too so Settings doesn't depend on agentd.
  if (url === '/api/personas') return json(res, 200, listPersonas().map(({ body, ...p }) => p));
  if (url === '/api/settings') {
    if (req.method === 'POST') return json(res, 200, writeSettings(await readBody(req)));
    return json(res, 200, readSettings());
  }

  // desk.ask(text) from a View: start a chat about that View and open it.
  if (url === '/api/ask' && req.method === 'POST') {
    const { text, view } = await readBody(req);
    if (!text) return json(res, 400, { error: 'text required' });
    const v = view && listViews().find((x) => x.name === view);
    const r = await fetch(`http://127.0.0.1:${AGENTD_PORT}/threads`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, origin: v ? `view:${v.name}` : 'chat', context: v ? { view: v.name, title: v.title, source: v.source } : undefined }) });
    const t = await r.json();
    if (!r.ok) return json(res, 400, t);
    broadcast('go', { hash: `#/t/${t.id}` });
    return json(res, 200, { ok: true, threadId: t.id });
  }


  if (url === '/api/agents') return json(res, 200, await agentStatus());
  if (url === '/api/usage') {
    const providers = await usage(await agentStatus());
    return json(res, 200, visibleUsage(providers, readSettings().utilization));
  }

  if (url === '/api/templates') return json(res, 200, listTemplates());

  if (url === '/api/connections') return json(res, 200, listConnections());

  // Google accounts (Connections → Gmail): app passwords by default, Sign in with Google as the fallback.
  if (url === '/api/google' && req.method === 'GET') return json(res, 200, google.listGoogle());
  if (url.startsWith('/api/google/')) {
    const u = new URL(url, 'http://x'), sub = u.pathname.slice('/api/google/'.length);
    if (sub === 'callback') {
      // Google sends the browser back here after "Sign in with Google".
      let to = '#/connections/gmail';
      try { const r = await google.finishSignin(Object.fromEntries(u.searchParams)); to += `?signed=${encodeURIComponent(r.email)}${r.ok ? '' : '&warn=' + encodeURIComponent(r.output || '')}`; }
      catch (e) { to += `?error=${encodeURIComponent(e.message)}`; }
      res.writeHead(302, { location: `/${to}` });
      return res.end();
    }
    try {
      const b = req.method === 'GET' ? {} : await readBody(req);
      if (sub === 'accounts' && req.method === 'POST') return json(res, 200, await google.addAppPassword(b));
      if (sub === 'client' && req.method === 'POST') return json(res, 200, google.setClient(b));
      if (sub === 'policy' && req.method === 'POST') return json(res, 200, google.setPolicy(b));
      if (sub === 'start' && req.method === 'POST') return json(res, 200, google.startSignin(b.origin));
      const am = sub.match(/^accounts\/([^/]+)(\/test)?$/);
      if (am && am[2] && req.method === 'POST') return json(res, 200, await google.retest(decodeURIComponent(am[1])));
      if (am && !am[2] && req.method === 'DELETE') return json(res, 200, google.removeAccount(decodeURIComponent(am[1])));
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  // The Timeline's Upcoming: every scheduled job run in the next days (default 7, at most 14), from each
  // enabled job's cron (at most 1500 runs a job, enough for every 5 minutes for 5 days); the page folds frequent ones.
  if (url.startsWith('/api/upcoming')) {
    try {
      const days = Math.min(14, Math.max(1, Number(new URL(url, 'http://desk').searchParams.get('days')) || 7));
      const until = Date.now() + days * 86400e3, out = [];
      const jobs = await (await fetch(`http://127.0.0.1:${AGENTD_PORT}/jobs`)).json();
      for (const j of jobs) {
        if (!j.enabled || !j.schedule) continue;
        let t = new Date(), n = 0;
        while (n++ < 1500) {
          t = nextRun(j.schedule, t);
          if (!t || t.getTime() > until) break;
          out.push({ job: j.name, title: j.title || j.name, describe: j.describe, at: t.getTime(), onlyIf: !!j.onlyIf, type: j.type || 'agent' });
        }
      }
      return json(res, 200, out.sort((a, b) => a.at - b.at));
    } catch (e) { return json(res, 500, { error: e.message }); }
  }

  // Needs you, read by a model (needs.mjs): the Timeline's Needs you section.
  if (url.startsWith('/api/needs')) {
    try {
      if (url === '/api/needs' || url === '/api/needs?opened=1') { if (url.endsWith('opened=1')) needs.maybe('opened'); return json(res, 200, needs.current()); }
      if (url === '/api/needs/refresh' && req.method === 'POST') return json(res, 200, { started: await needs.maybe('asked', true) });
      if (url === '/api/needs/preferences') return json(res, 200, req.method === 'POST' ? needs.setPreferences((await readBody(req)).text) : needs.preferences());
      if (url === '/api/needs/config') return json(res, 200, req.method === 'POST' ? needs.setConfig(await readBody(req)) : needs.getConfig());
      const nm = url.match(/^\/api\/needs\/([a-z0-9-]+)\/(done|up|down)$/);
      if (nm && req.method === 'POST') return json(res, 200, await needs.act(nm[1], nm[2]));
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  // Keys (the Keys page, #/keys). Values only come back on an explicit reveal.
  if (url === '/api/secrets' && req.method === 'GET') return json(res, 200, await listSecrets());
  if (url === '/api/secrets' && req.method === 'POST') {
    try { return json(res, 200, await setSecret(await readBody(req))); } catch (e) { return json(res, 400, { error: e.message }); }
  }
  const sm = url.match(/^\/api\/secrets\/signin\/([a-z0-9.-]+)\/reveal$/);
  if (sm && req.method === 'POST') { try { return json(res, 200, revealManaged(sm[1])); } catch (e) { return json(res, 400, { error: e.message }); } }
  const sk = url.match(/^\/api\/secrets\/([A-Z0-9_]+)(\/reveal)?$/);
  if (sk && NAME_RE.test(sk[1])) {
    try {
      if (sk[2] && req.method === 'POST') return json(res, 200, revealSecret(sk[1]));
      if (!sk[2] && req.method === 'DELETE') return json(res, 200, deleteSecret(sk[1]));
    } catch (e) { return json(res, 400, { error: e.message }); }
  }
  const cn = url.match(/^\/api\/connections\/([a-z0-9-]+)(?:\/(test|mcp|signin))?$/);
  if (cn) {
    try {
      if (cn[2] === 'signin') {
        if (req.method === 'POST') return json(res, 200, await startSignin(cn[1]));
        if (req.method === 'DELETE') { cancelSignin(cn[1]); return json(res, 200, { ok: true }); }
        return json(res, 200, signinStatus(cn[1]));
      }
      if (req.method === 'POST' && !cn[2]) return json(res, 200, await connectService(cn[1], (await readBody(req)).values));
      if (req.method === 'POST' && cn[2] === 'test') return json(res, 200, await testConnection(cn[1]));
      if (req.method === 'POST' && cn[2] === 'mcp') { setMcp(cn[1], !!(await readBody(req)).enabled); return json(res, 200, { ok: true }); }
      if (req.method === 'DELETE') { await disconnect(cn[1]); return json(res, 200, { ok: true }); }
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  if (url === '/api/folders') return json(res, 200, folders());

  // Files (the Files View's API): see files.mjs.
  if (url.startsWith('/api/files/')) {
    const u = new URL(url, 'http://desk');
    const q = Object.fromEntries(u.searchParams);
    try {
      switch (u.pathname.slice('/api/files/'.length)) {
        case 'places': return json(res, 200, files.places());
        case 'list': return json(res, 200, await files.list(q.path));
        case 'read': return json(res, 200, await files.read(q.path));
        case 'raw': return files.raw(q.path, q.download, res);
        case 'write': if (req.method === 'PUT') return json(res, 200, files.write(await readBody(req))); break;
        case 'diff': return json(res, 200, await files.diff(q.path));
        case 'search': return json(res, 200, await files.search(q.q));
        case 'recent': return json(res, 200, await files.recent());
        case 'sqlite': return json(res, 200, await files.sqlite(q.path, q.table, q.offset));
      }
      return json(res, 404, { error: 'unknown' });
    } catch (e) {
      const code = e.status || (e.code === 'ENOENT' ? 404 : e.code === 'EACCES' ? 403 : 400);
      return json(res, code, { error: e.code === 'ENOENT' ? 'Not found' : e.code === 'EACCES' ? 'Permission denied' : e.message, mtime: e.mtime });
    }
  }

  // Backups: ~/backups/springroll-*.tar.gz (older ones agentos-*), made by bin/backup (nightly job by default).
  const BACKUPS = path.join(HOME, 'backups');
  const PASSFILE = path.join(HOME, '.config', 'springroll', 'backup-passphrase');
  if (url === '/api/backups' && req.method === 'GET') {
    let files = [];
    try { files = fs.readdirSync(BACKUPS).filter((f) => /^(springroll|agentos)-.*\.tar\.gz$/.test(f)).map((f) => { const st = fs.statSync(path.join(BACKUPS, f)); return { name: f, size: st.size, at: st.mtimeMs }; }).sort((a, b) => b.at - a.at); } catch {}
    // Off-machine (bin/backup offsite): the repository from desk.json, the last run from ~/data/backup.
    let offsite = null;
    try { offsite = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')).backup?.offsite || null; } catch {}
    if (!offsite?.repository) offsite = null;
    else try { offsite.last = JSON.parse(fs.readFileSync(path.join(HOME, 'data', 'backup', 'offsite.json'), 'utf8')); } catch { offsite.last = null; }
    return json(res, 200, { files, hasPassphrase: fs.existsSync(PASSFILE) && fs.statSync(PASSFILE).size > 0, offsite });
  }
  if (url === '/api/backups' && req.method === 'POST') {
    const out = await new Promise((resolve) => execFile('bash', ['-c', `${ENV}; backup --keep 7`], { timeout: 1800000 }, (err, stdout, stderr) => resolve({ ok: !err, output: (stdout || stderr).trim() })));
    return json(res, out.ok ? 200 : 400, out.ok ? out : { error: out.output });
  }
  if (url === '/api/backups/passphrase' && req.method === 'POST') {
    const { passphrase } = await readBody(req);
    if (!passphrase || passphrase.length < 10) return json(res, 400, { error: 'Use at least 10 characters.' });
    fs.writeFileSync(PASSFILE, passphrase + '\n', { mode: 0o600 });
    return json(res, 200, { ok: true });
  }
  const bf = url.match(/^\/api\/backups\/file\/((?:springroll|agentos)-[\w.-]+\.tar\.gz)$/);
  if (bf) {
    const file = path.join(BACKUPS, bf[1]);
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'application/gzip', 'content-disposition': `attachment; filename="${bf[1]}"`, 'content-length': fs.statSync(file).size });
    return fs.createReadStream(file).pipe(res);
  }

  const add = url.match(/^\/api\/templates\/([a-z0-9-]+)\/add$/);
  if (add && req.method === 'POST') {
    const out = await new Promise((resolve) => execFile('bash', ['-c', `${ENV}; add-view ${add[1]}`], { timeout: 120000 },
      (err, stdout, stderr) => resolve({ ok: !err, text: (stdout + stderr).trim() })));
    if (!out.ok) return json(res, 400, { error: out.text });
    broadcast('views', listViews());
    let threadId = null;
    if (fs.existsSync(path.join(VIEWS, add[1], '.setup-pending'))) {
      try { threadId = await startSetup(add[1]); } catch (e) { return json(res, 200, { added: add[1], note: e.message }); }
    }
    return json(res, 200, { added: add[1], threadId });
  }

  const setupView = url.match(/^\/api\/views\/([a-z0-9-]+)\/setup$/);
  if (setupView && req.method === 'POST') {
    try { return json(res, 200, { threadId: await startSetup(setupView[1]) }); }
    catch (e) { return json(res, 400, { error: e.message }); }
  }

  // Who an agent is signed in as (agents.json "account": a command printing {account, plan, method}), for its sheet in Connections.
  const acct = url.match(/^\/api\/agents\/([a-z0-9-]+)\/account$/);
  if (acct && req.method === 'GET') {
    const a = readAgents().find((x) => x.id === acct[1]);
    if (!a) return json(res, 404, { error: 'No such agent' });
    let r = {};
    try { r = a.account ? JSON.parse(await sh(a.account) || '{}') : {}; } catch {}
    return json(res, 200, { account: r.account || null, plan: r.plan || null, method: r.method || null });
  }
  const setup = url.match(/^\/api\/agents\/([a-z0-9-]+)\/setup$/);
  if (setup && req.method === 'POST') {
    const a = readAgents().find((x) => x.id === setup[1]);
    if (!a) return json(res, 404, { error: 'unknown agent' });
    const installed = !!(await sh(`command -v ${a.bin}`));
    const steps = [`echo "Setting up ${a.name}"`];
    if (!installed) steps.push(`echo "+ ${a.install}"`, a.install, 'hash -r');
    if (a.acpInstall && !(await sh(`command -v ${a.acp[0]}`))) steps.push(`echo "+ ${a.acpInstall}  (chat adapter)"`, a.acpInstall, 'hash -r');
    steps.push(`echo; echo "Sign in: ${a.login.replace(/"/g, '')}"`, a.login.replace(/\s+#.*$/, ''));
    steps.push(`echo; echo "Done. Start a ${a.name} session from the + menu."`);
    try {
      const name = await newSession({ name: `setup-${a.id}`, command: steps.join('; ') });
      broadcast('agent', { session: name });
      return json(res, 200, { session: name });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  // ?sprite=<name>: sign in on that Sprite instead of this machine.
  // ?part=chat: the chat runtime's own sign-in (agents.json "chatSignin").
  const signin = url.match(/^\/api\/agents\/([a-z0-9-]+)\/signin(\/code)?(?:\?(.*))?$/);
  if (signin) {
    const a = readAgents().find((x) => x.id === signin[1]);
    const q = new URLSearchParams(signin[3] || '');
    const part = q.get('part') === 'chat' ? 'chat' : null;
    if (!a || !signinSpec(a, part)) return json(res, 404, { error: `${a?.name || 'that agent'} signs in in the terminal` });
    const sprite = part ? null : spriteName(q.get('sprite'));
    try {
      if (signin[2] && req.method === 'POST') {
        const s = agentSignins.get(signinKey(a, sprite, part));
        const { code } = await readBody(req);
        if (!s || !code?.trim()) return json(res, 400, { error: 'no sign-in is waiting for a code' });
        await tmux(['send-keys', '-t', s.session, '-l', code.trim()]);
        await tmux(['send-keys', '-t', s.session, 'Enter']);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST') { await startAgentSignin(a, sprite, part); return json(res, 200, await agentSigninState(a, sprite, part)); }
      if (req.method === 'DELETE') { await stopAgentSignin(signinKey(a, sprite, part)); return json(res, 200, { ok: true }); }
      return json(res, 200, await agentSigninState(a, sprite, part));
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  // An agent's chat part on its own (agents.json "acpInstall" / "acpRemove"): POST installs it in a hidden terminal
  // (GET: its progress), DELETE removes it. A chat runtime with a sign-in of its own installs through that instead.
  const chatPart = url.match(/^\/api\/agents\/([a-z0-9-]+)\/chat$/);
  if (chatPart) {
    const a = readAgents().find((x) => x.id === chatPart[1]);
    if (!a?.acp) return json(res, 404, { error: `${a?.name || 'that agent'} has no chat` });
    try {
      if (req.method === 'POST') {
        if (!a.acpInstall) return json(res, 400, { error: `${a.name}'s chat is built in` });
        await tmux(['kill-session', '-t', `=install-${a.id}`]);
        const session = await newSession({ name: `install-${a.id}`, command: `echo "Installing ${a.name}'s chat ${a.chatSignin ? 'runtime' : 'adapter'}…"; ${a.acpInstall}; echo "__install_exit $?"` });
        agentInstalls.set(a.id, { session });
        diskCache.delete(a.id);
        return json(res, 200, await chatInstallState(a));
      }
      if (req.method === 'DELETE') {
        if (!a.acpRemove) return json(res, 400, { error: `${a.name}'s chat is built in` });
        const out = await new Promise((resolve) => execFile('bash', ['-c', `${ENV}; ${a.acpRemove} 2>&1`], { timeout: 120000 }, (err, o) => resolve({ ok: !err, text: String(o || err?.message || '').trim() })));
        diskCache.delete(a.id);
        broadcast('connections', {});
        return json(res, out.ok ? 200 : 400, out.ok ? { ok: true } : { error: out.text.split('\n').slice(-2).join(' ') });
      }
      return json(res, 200, await chatInstallState(a));
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  // A full sign-in for an agent that chats with a long-lived token (Claude: usage needs it).
  const login = url.match(/^\/api\/agents\/([a-z0-9-]+)\/login$/);
  if (login && req.method === 'POST') {
    const a = readAgents().find((x) => x.id === login[1]);
    if (!a?.fullLogin) return json(res, 404, { error: 'nothing to sign in to' });
    const steps = [`echo "Sign in to ${a.name} in your browser, then paste the code here."`, a.fullLogin, `echo; echo "Done. Usage shows up in the sidebar within a minute; chats keep working as before."`];
    try {
      const name = await newSession({ name: `login-${a.id}`, command: steps.join('; ') });
      broadcast('agent', { session: name });
      return json(res, 200, { session: name });
    } catch (e) { return json(res, 400, { error: e.message }); }
  }

  if (url === '/api/sessions') {
    if (req.method === 'POST') {
      try { return json(res, 200, { session: await newSession(await readBody(req)) }); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }
    return json(res, 200, { sessions: await listSessions(), folders: folders(), last: lastSession() });
  }

  const kill = url.match(/^\/api\/sessions\/([A-Za-z0-9_-]+)$/);
  if (kill && req.method === 'DELETE') {
    await tmux(['kill-session', '-t', `=${kill[1]}`]);
    broadcast('sessions', await listSessions());
    return json(res, 200, { ok: true });
  }

  if (url === '/api/notify' && req.method === 'POST') {
    broadcast('notify', await readBody(req));
    return json(res, 200, { ok: true });
  }

  if (url === '/api/focus' && req.method === 'POST') {
    const body = await readBody(req);
    const view = body.name && listViews().find((v) => v.name === body.name);
    const session = /^[A-Za-z0-9_-]{1,40}$/.test(body.session || '') ? body.session : lastSession();
    fs.writeFileSync(path.join(DESK_STATE, 'session'), session + '\n');
    const focus = view
      ? { view: view.name, title: view.title, page: body.page || view.url, source: view.source, port: view.port, agentSession: session, at: new Date().toISOString() }
      : { view: null, page: body.page || null, agentSession: session, at: new Date().toISOString() };
    fs.writeFileSync(path.join(DESK_STATE, 'focus'), JSON.stringify(focus, null, 2) + '\n');
    return json(res, 200, focus);
  }

  if (url === '/term' || url.startsWith('/term/') || url.startsWith('/term?')) return proxy(req, res, TERM_PORT, url);
  if (url.startsWith('/api/agent/')) return proxy(req, res, AGENTD_PORT, url.slice('/api/agent'.length));

  const v = splitView(url);
  if (v) {
    if (v.rest === undefined) { res.writeHead(301, { location: `/v/${v.name}/` }); return res.end(); }
    const port = viewPort(v.name);
    if (port) return proxy(req, res, port, v.rest);
    const dir = path.join(VIEWS, v.name);
    let rel = decodeURIComponent(v.rest.split('?')[0]);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.normalize(path.join(dir, rel));
    if (!file.startsWith(dir + path.sep)) { res.writeHead(403); return res.end(); }
    return serveFile(res, file);
  }

  const rel = url.split('?')[0] === '/' ? 'index.html' : url.split('?')[0].slice(1);
  const base = rel === 'ui/custom.css' ? PUBLIC : live.dir;
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base + path.sep)) { res.writeHead(403); return res.end(); }
  serveFile(res, file);
});

// WebSocket upgrades (the terminal, and any View that uses websockets).
server.on('upgrade', (req, socket, head) => {
  let port = null, upstreamPath = req.url;
  if (req.url.startsWith('/term')) port = TERM_PORT;
  else {
    const v = splitView(req.url);
    if (v) { port = viewPort(v.name); upstreamPath = v.rest || '/'; }
  }
  if (!port) return socket.destroy();
  const up = net.connect(port, '127.0.0.1', () => {
    const headers = Object.entries(req.headers).map(([k, val]) => `${k}: ${val}`).join('\r\n');
    up.write(`${req.method} ${upstreamPath} HTTP/1.1\r\n${headers}\r\n\r\n`);
    if (head?.length) up.write(head);
    up.pipe(socket).pipe(up);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});

server.listen(PORT, '127.0.0.1', () => console.log(`Springroll on 127.0.0.1:${PORT}`));

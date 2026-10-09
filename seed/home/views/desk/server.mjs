// Springroll: serves the shell UI, lists Views, proxies /v/<name>/ to each View
// and /term/ to the agent terminal (ttyd), and relays show/notify/focus.
// No dependencies: Node's standard library only.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';
import { listConnections, connect as connectService, testConnection, disconnect, setMcp, startSignin, signinStatus, cancelSignin } from './connections.mjs';
import * as files from './files.mjs';
import { usage } from './usage.mjs';

const HOME = os.homedir();
const VIEWS = path.join(HOME, 'home', 'views');
const DESK_STATE = path.join(HOME, '.desk');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const PORT = 8000;
const TERM_PORT = 7681;
const AGENTD_PORT = 8090;

const SETTINGS = path.join(HOME, 'home', 'desk.json');
const AGENTS = path.join(HOME, 'home', 'agents', 'agents.json');
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
    fontSize: s.fontSize || 'medium', density: s.density || 'comfortable', radius: s.radius || 'soft',
    font: s.font || 'system', monoFont: s.monoFont || 'system', accent: s.accent || null, defaultAgent: s.defaultAgent || null,
    weatherLocation: s.weatherLocation || '',
    sidebarApps: s.sidebarApps || {}, // app name -> shown in the sidebar (default: shown unless a placeholder)
  };
}

function writeSettings(patch) {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch {}
  for (const k of ['theme', 'fontSize', 'density', 'radius', 'font', 'monoFont', 'defaultAgent']) if (typeof patch[k] === 'string' && patch[k]) s[k] = patch[k];
  if (patch.sidebarApps && typeof patch.sidebarApps === 'object') {
    s.sidebarApps = { ...(s.sidebarApps || {}) };
    for (const [k, v] of Object.entries(patch.sidebarApps)) if (/^[A-Za-z0-9_-]{1,60}$/.test(k)) { if (typeof v === 'boolean') s.sidebarApps[k] = v; else delete s.sidebarApps[k]; }
  }
  if (typeof patch.weatherLocation === 'string') { const w = patch.weatherLocation.trim().slice(0, 80); if (w) s.weatherLocation = w; else delete s.weatherLocation; }
  if ('accent' in patch) { if (/^#[0-9a-f]{6}$/i.test(patch.accent || '')) s.accent = patch.accent.toLowerCase(); else delete s.accent; }
  fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + '\n');
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

/* ---------- Weather (Today) ---------- */

// Open-Meteo: no key. The place is geocoded once per setting; forecasts are cached 20 minutes.
const weatherCache = { place: null, geo: null, at: 0, data: null };
const WMO = [[0, 'Clear', 'sun'], [1, 'Mostly clear', 'sun'], [2, 'Partly cloudy', 'cloud-sun'], [3, 'Cloudy', 'cloud'], [45, 'Fog', 'cloud-fog'],
  [51, 'Drizzle', 'cloud-drizzle'], [61, 'Rain', 'cloud-rain'], [63, 'Rain', 'cloud-rain'], [65, 'Heavy rain', 'cloud-rain'], [66, 'Freezing rain', 'cloud-hail'],
  [71, 'Snow', 'cloud-snow'], [77, 'Snow grains', 'cloud-snow'], [80, 'Showers', 'cloud-rain'], [85, 'Snow showers', 'cloud-snow'], [95, 'Thunderstorms', 'cloud-lightning']];
const wmo = (code) => [...WMO].reverse().find(([c]) => code >= c) || WMO[0];

async function weather() {
  let place = '';
  try { place = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')).weatherLocation || ''; } catch {}
  if (!place) return { place: null };
  if (weatherCache.place === place && weatherCache.data && Date.now() - weatherCache.at < 20 * 60000) return weatherCache.data;
  if (weatherCache.place !== place || !weatherCache.geo) {
    const name = place.split(',')[0].trim();
    const g = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=10&name=${encodeURIComponent(name)}`)).json();
    const rest = place.split(',').slice(1).join(' ').trim().toLowerCase();
    const hit = (g.results || []).find((r) => !rest || [r.admin1, r.country, r.country_code, r.admin1_code].some((x) => x && (x.toLowerCase() === rest || x.toLowerCase().startsWith(rest)))) || g.results?.[0];
    if (!hit) return { place, error: `couldn't find "${place}"` };
    Object.assign(weatherCache, { place, geo: hit });
  }
  const { latitude, longitude, timezone, country_code: cc, name } = weatherCache.geo;
  const imperial = ['US', 'LR', 'MM'].includes(cc);
  const f = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&timezone=${encodeURIComponent(timezone || 'auto')}`
    + `&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max&forecast_days=1${imperial ? '&temperature_unit=fahrenheit' : ''}`)).json();
  const [, text, icon] = wmo(f.current?.weather_code ?? 0);
  const data = {
    place: name, temp: Math.round(f.current?.temperature_2m), text, icon,
    high: Math.round(f.daily?.temperature_2m_max?.[0]), low: Math.round(f.daily?.temperature_2m_min?.[0]),
    rain: f.daily?.precipitation_probability_max?.[0] ?? null, unit: imperial ? 'F' : 'C',
  };
  Object.assign(weatherCache, { at: Date.now(), data });
  return data;
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
    // Chat needs the harness's ACP mode: built in (opencode acp) or an adapter (claude-agent-acp).
    const acpInstalled = !!a.acp && (a.acp[0] === a.bin ? !!where : !!(await sh(`command -v ${a.acp[0]}`)));
    return { ...a, installed: !!where, version: versions.get(a.id) || null, signedIn, acpInstalled };
  }));
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

let viewsSnapshot = JSON.stringify(listViews());
setInterval(() => {
  const now = JSON.stringify(listViews());
  if (now !== viewsSnapshot) { viewsSnapshot = now; broadcast('views', JSON.parse(now)); }
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
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (url === '/api/show' && req.method === 'POST') {
    const { target } = await readBody(req);
    if (!target) return json(res, 400, { error: 'target required' });
    const view = listViews().find((v) => v.name === target);
    // A file or folder opens in Files (at a line with path:12); a Springroll route (#/jobs) is followed.
    const fileMatch = !view && /^[~/]/.test(target) && target.match(/^(.*?)(?::(\d+)(?:-(\d+))?)?$/);
    const abs = fileMatch && files.resolvePath(fileMatch[1]);
    let payload;
    if (view) payload = { name: view.name, title: view.title, url: view.url };
    else if (target.startsWith('#/')) payload = { hash: target };
    else if (abs && fs.existsSync(abs)) payload = { hash: `#/v/files#p=${encodeURIComponent(abs)}${fileMatch[2] ? `&l=${fileMatch[2]}${fileMatch[3] ? '-' + fileMatch[3] : ''}` : ''}` };
    else payload = { name: target, title: target, url: target };
    broadcast('show', payload);
    return json(res, 200, { shown: payload, desks: clients.size });
  }

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

  if (url === '/api/weather') return weather().then((w) => json(res, 200, w), (e) => json(res, 200, { error: e.message }));

  if (url === '/api/agents') return json(res, 200, await agentStatus());
  if (url === '/api/usage') return json(res, 200, await usage(await agentStatus()));

  if (url === '/api/templates') return json(res, 200, listTemplates());

  if (url === '/api/connections') return json(res, 200, listConnections());
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
    return json(res, 200, { files, hasPassphrase: fs.existsSync(PASSFILE) && fs.statSync(PASSFILE).size > 0 });
  }
  if (url === '/api/backups' && req.method === 'POST') {
    const out = await new Promise((resolve) => execFile('bash', ['-c', `${ENV}; backup --keep 7`], { timeout: 600000 }, (err, stdout, stderr) => resolve({ ok: !err, output: (stdout || stderr).trim() })));
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
  const file = path.normalize(path.join(HERE, 'public', rel));
  if (!file.startsWith(path.join(HERE, 'public'))) { res.writeHead(403); return res.end(); }
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

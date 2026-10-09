// The Desk: serves the shell UI, lists Views, proxies /v/<name>/ to each View
// and /term/ to the agent terminal (ttyd), and relays show/notify/focus.
// No dependencies: Node's standard library only.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';

const HOME = os.homedir();
const VIEWS = path.join(HOME, 'home', 'views');
const DESK_STATE = path.join(HOME, '.desk');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const PORT = 8000;
const TERM_PORT = 7681;

const SETTINGS = path.join(HOME, 'home', 'desk.json');
const AGENTS = path.join(HOME, 'home', 'agents', 'agents.json');
const ENV = `. ${HOME}/.config/agentos/env`;
process.env.PATH = `${HOME}/.local/bin:${HOME}/.npm-global/bin:${HOME}/home/bin:${process.env.PATH}`;
const THEMES = path.join(HERE, 'public', 'ui', 'themes.json');

fs.mkdirSync(DESK_STATE, { recursive: true });

// Desk settings live in the home repo so every device (and the agent) shares them.
function readSettings() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch {}
  const themes = JSON.parse(fs.readFileSync(THEMES, 'utf8'));
  const theme = themes.find((t) => t.id === s.theme) || themes[0];
  let ntfyTopic = null;
  try { ntfyTopic = fs.readFileSync(path.join(HOME, '.config', 'agentos', 'ntfy-topic'), 'utf8').trim(); } catch {}
  return { theme, fontSize: s.fontSize || 'medium', ntfyTopic };
}

function writeSettings(patch) {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')); } catch {}
  for (const k of ['theme', 'fontSize']) if (patch[k]) s[k] = patch[k];
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
    return { ...a, installed: !!where, version: versions.get(a.id) || null, signedIn };
  }));
}

function lastSession() {
  try { return fs.readFileSync(path.join(DESK_STATE, 'session'), 'utf8').trim() || 'claude'; } catch { return 'claude'; }
}

async function listSessions() {
  const out = await tmux(['list-sessions', '-F', '#{session_name}\t#{window_activity}\t#{session_created}\t#{pane_current_command}\t#{pane_current_path}']);
  const ids = new Set(readAgents().map((a) => a.id));
  const now = Date.now() / 1000;
  return out.trim().split('\n').filter(Boolean).map((line) => {
    const [name, activity, created, command, cwd] = line.split('\t');
    const prefix = name.replace(/^setup-/, '').split('-')[0];
    return {
      name, command, cwd: cwd.replace(HOME, '~'), created: +created,
      agent: ids.has(prefix) ? prefix : null,
      busy: now - +activity < 4,
      idleFor: Math.round(now - +activity),
    };
  }).sort((a, b) => a.created - b.created);
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
  await tmux(['-f', path.join(HERE, 'tmux.conf'), 'new-session', '-d', '-s', n, '-c', cwd, `bash -c '${ENV}; ${cmd.replace(/'/g, "'\\''")}; exec bash -l'`]);
  broadcast('sessions', await listSessions());
  return n;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

const SYSTEM_VIEWS = new Set(['settings']);

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
      return { name, title, description, system: SYSTEM_VIEWS.has(name), url: `/v/${name}/`, source: dir, port: viewPort(name) };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

function viewPort(name) {
  try { return parseInt(fs.readFileSync(path.join(VIEWS, name, 'PORT'), 'utf8'), 10) || null; } catch { return null; }
}

// Server-sent events to every open Desk.
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
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
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
    const payload = view ? { name: view.name, title: view.title, url: view.url } : { name: target, title: target, url: target };
    broadcast('show', payload);
    return json(res, 200, { shown: payload, desks: clients.size });
  }

  if (url === '/api/settings') {
    if (req.method === 'POST') return json(res, 200, writeSettings(await readBody(req)));
    return json(res, 200, readSettings());
  }

  if (url === '/api/ask' && req.method === 'POST') {
    const { text, view, session } = await readBody(req);
    if (!text) return json(res, 400, { error: 'text required' });
    const target = session || lastSession();
    askAgent(view ? `[From the ${view} View] ${text}` : text, target);
    broadcast('agent', { session: target });
    return json(res, 200, { ok: true, session: target });
  }

  if (url === '/api/agents') return json(res, 200, await agentStatus());

  const setup = url.match(/^\/api\/agents\/([a-z0-9-]+)\/setup$/);
  if (setup && req.method === 'POST') {
    const a = readAgents().find((x) => x.id === setup[1]);
    if (!a) return json(res, 404, { error: 'unknown agent' });
    const installed = !!(await sh(`command -v ${a.bin}`));
    const steps = [`echo "Setting up ${a.name}"`];
    if (!installed) steps.push(`echo "+ ${a.install}"`, a.install, 'hash -r');
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

server.listen(PORT, '127.0.0.1', () => console.log(`Desk on 127.0.0.1:${PORT}`));

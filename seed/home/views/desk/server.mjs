// The Desk: serves the shell UI, lists Views, proxies /v/<name>/ to each View
// and /term/ to the agent terminal (ttyd), and relays show/notify/focus.
// No dependencies: Node's standard library only.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const HOME = os.homedir();
const VIEWS = path.join(HOME, 'home', 'views');
const DESK_STATE = path.join(HOME, '.desk');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const PORT = 8000;
const TERM_PORT = 7681;

fs.mkdirSync(DESK_STATE, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};

function listViews() {
  let names = [];
  try { names = fs.readdirSync(VIEWS); } catch { return []; }
  return names
    .filter((n) => n !== 'desk' && !n.startsWith('.') && fs.statSync(path.join(VIEWS, n)).isDirectory())
    .map((name) => {
      const dir = path.join(VIEWS, name);
      let title = name;
      try {
        const m = fs.readFileSync(path.join(dir, 'README.md'), 'utf8').match(/^#\s+(.+)$/m);
        if (m) title = m[1].trim();
      } catch {}
      return { name, title, url: `/v/${name}/`, source: dir, port: viewPort(name) };
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

  if (url === '/api/notify' && req.method === 'POST') {
    broadcast('notify', await readBody(req));
    return json(res, 200, { ok: true });
  }

  if (url === '/api/focus' && req.method === 'POST') {
    const body = await readBody(req);
    const view = body.name && listViews().find((v) => v.name === body.name);
    const focus = view
      ? { view: view.name, title: view.title, page: body.page || view.url, source: view.source, port: view.port, at: new Date().toISOString() }
      : { view: null, page: body.page || null, at: new Date().toISOString() };
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

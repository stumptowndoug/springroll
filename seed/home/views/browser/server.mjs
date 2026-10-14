// Browser app server: the sessions as a JSON API, and each session's live stream (agent-browser's
// WebSocket: frames out, mouse and keys in) relayed so the page can show it through Springroll.
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSession, stopSession, listSessions, backends, streamPort, pageInfo, ab, guardHome } from './lib.mjs';
import { homeStatus, writeHome } from './home.mjs';
import { parts, setupHome, removeHome } from './setup.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(fs.readFileSync(path.join(HERE, 'PORT'), 'utf8').trim());

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
});
// What the page may see: never the CDP address (cloud ones carry credentials).
const pub = ({ cdp, port, ...s }) => s;
// Only talk to agent-browser about sessions that are attached: otherwise it would quietly launch a
// fresh browser of its own under that name.
const live = async (name) => { if (!(await listSessions()).some((s) => s.name === name)) throw Object.assign(new Error(`No browser named ${name}.`), { code: 404 }); };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/' || p === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      return fs.createReadStream(path.join(HERE, 'index.html')).pipe(res);
    }
    if (p === '/api/backends') return json(res, 200, await backends());
    if (p === '/api/setup' && req.method === 'GET') return json(res, 200, await parts());
    if (p === '/api/setup/home' && req.method === 'POST') return json(res, 200, await setupHome());
    if (p === '/api/setup/home/remove' && req.method === 'POST') { await removeHome(); return json(res, 200, await parts()); }
    if (p === '/api/home' && req.method === 'GET') return json(res, 200, await homeStatus());
    if (p === '/api/home' && req.method === 'POST') {
      const b = await readBody(req);
      const patch = {};
      if ('enabled' in b) patch.enabled = !!b.enabled;
      if (['stop', 'kernel', 'local'].includes(b.fallback)) patch.fallback = b.fallback;
      if ('node' in b) patch.node = b.node || null;
      if (b.accept) patch.homeIP = null; // the next check records the current address as home
      writeHome(patch);
      return json(res, 200, await homeStatus());
    }
    if (p === '/api/sessions' && req.method === 'GET') {
      const all = await listSessions();
      const info = await Promise.all(all.map((s) => pageInfo(s.name).catch(() => ({}))));
      return json(res, 200, all.map((s, i) => ({ ...pub(s), ...info[i] })));
    }
    if (p === '/api/sessions' && req.method === 'POST') {
      const b = await readBody(req);
      return json(res, 200, pub(await startSession(b)));
    }
    let m = p.match(/^\/api\/sessions\/([a-z0-9-]+)\/viewport$/);
    if (m && req.method === 'POST') {
      await live(m[1]);
      const { w, h } = await readBody(req);
      const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
      await ab(m[1], 'set', 'viewport', String(clamp(w, 320, 1920)), String(clamp(h, 400, 1200)));
      return json(res, 200, { ok: true });
    }
    m = p.match(/^\/api\/sessions\/([a-z0-9-]+)\/(stop|open|back|reload)$/);
    if (m && req.method === 'POST') {
      const [, name, act] = m;
      if (act === 'stop') return json(res, 200, pub(await stopSession(name)));
      await live(name);
      if (act === 'open') {
        let { url: to } = await readBody(req);
        if (!to) return json(res, 400, { error: 'url required' });
        if (!/^[a-z]+:/i.test(to)) to = 'https://' + to;
        await ab(name, 'open', to);
      } else await ab(name, act);
      return json(res, 200, await pageInfo(name));
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, e.code === 404 ? 404 : 500, { error: e.message });
  }
});

// /stream/<name> → ws://127.0.0.1:<agent-browser stream port>/, with the Origin it accepts.
server.on('upgrade', async (req, socket, head) => {
  const m = req.url.match(/^\/stream\/([a-z0-9-]+)(\?.*)?$/);
  if (!m) return socket.destroy();
  let port;
  try { await live(m[1]); port = await streamPort(m[1]); } catch { return socket.destroy(); }
  const up = net.connect(port, '127.0.0.1', () => {
    const headers = { ...req.headers, host: `127.0.0.1:${port}`, origin: 'http://127.0.0.1' };
    up.write(`GET /${m[2] || ''} HTTP/1.1\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
    if (head?.length) up.write(head);
    up.pipe(socket).pipe(up);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
});

// Tidy up every minute: browsers nobody is attached to any more get stopped (see listSessions).
setInterval(() => listSessions().catch(() => {}), 60000);
// And while home browsers run, check the home route every 3 minutes (guardHome).
setInterval(() => guardHome().catch(() => {}), 180000);

server.listen(PORT, '127.0.0.1', () => console.log(`Browser on 127.0.0.1:${PORT}`));

// agentd: the agent runtime behind Springroll. Owns threads (conversations with
// any ACP-capable harness), their timeline, and scheduled jobs. Runs as its own
// service so restarting Springroll never interrupts an agent. HTTP + SSE on
// 127.0.0.1:8090; Springroll proxies it at /api/agent/.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { openStore } from './store.mjs';
import { ThreadManager } from './threads.mjs';
import { Jobs } from './jobs.mjs';
import { describeCron, nextRun } from './cron.mjs';

const HOME = os.homedir();
const PORT = 8090;
const AGENTS = path.join(HOME, 'home', 'agents', 'agents.json');
const CONNECTIONS = path.join(HOME, 'home', 'connections');
const ENV = `. ${HOME}/.config/agentos/env`;

const store = openStore(path.join(HOME, 'data', 'agentd'));
for (const col of ["options text", "access text default 'full'", "effort text"]) {
  try { store.db.exec(`alter table threads add column ${col}`); } catch {}
}

const clients = new Set();
function emit(event) {
  const msg = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(msg);
}
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000).unref();

function notify(text) {
  execFile('bash', ['-c', `${ENV}; notify "$0"`, text.slice(0, 400)], () => {});
}

const readAgents = () => { try { return JSON.parse(fs.readFileSync(AGENTS, 'utf8')); } catch { return []; } };

function defaultAgent() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(HOME, 'home', 'desk.json'), 'utf8'));
    if (s.defaultAgent) return s.defaultAgent;
  } catch {}
  return 'claude';
}

// Connected services that provide MCP servers (connections/<name>/mcp.json),
// handed to every new agent session.
function mcpServers() {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(CONNECTIONS); } catch { return out; }
  for (const n of names) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(CONNECTIONS, n, 'mcp.json'), 'utf8'));
      if (m.enabled === false) continue;
      const env = Object.entries(m.env || {}).map(([name, value]) => ({ name, value: String(value).replace(/\$\{(\w+)\}/g, (_, k) => process.env[k] || secret(k) || '') }));
      if (m.url) out.push({ type: m.type || 'http', name: m.name || n, url: m.url, headers: Object.entries(m.headers || {}).map(([name, value]) => ({ name, value: String(value).replace(/\$\{(\w+)\}/g, (_, k) => secret(k) || '') })) });
      else out.push({ name: m.name || n, command: m.command, args: m.args || [], env });
    } catch {}
  }
  return out;
}

function secret(key) {
  try {
    const line = fs.readFileSync(path.join(HOME, '.config', 'agentos', 'secrets.env'), 'utf8').split('\n').find((l) => l.startsWith(key + '='));
    return line ? line.slice(key.length + 1).replace(/^['"]|['"]$/g, '') : null;
  } catch { return null; }
}

const threads = new ThreadManager({ store, agents: readAgents, emit, notify: (t, text) => notify(text), mcpServers });
threads.onWaiting = (t, what) => notify(`${t.title || 'An agent'} needs you: approve ${what}`);
const jobs = new Jobs({ store, threads, emit, notify, defaultAgent, signal: (b) => postSignal(b),
  clearSignal: (key) => { if (store.clearSignal(key)) emit({ type: 'signals' }); } });

// Long chat turns notify when they finish, unless the owner was looking.
const jobTurnEnd = threads.onTurnEnd;
threads.onTurnEnd = (t, r) => {
  jobTurnEnd?.(t, r);
  // A job run that ends on a question is waiting on the owner: put it on Today.
  const q = !r.error && t?.origin?.startsWith('job:') && finalQuestion(r.text);
  if (q) postSignal({ level: 'needs', key: `ask:${t.id}`, thread: t.id, title: `${sourceOf(t)} has a question`, body: q, notify: false }); // the run's report already notified
  if (!t || t.origin !== 'chat') return;
  const watched = Date.now() - (t.last_read || 0) < 30000;
  if (r.duration > 60000 && !watched) notify(`${t.title || 'Agent'}: ${(r.error || r.text || 'done').split('\n').find((l) => l.trim())?.slice(0, 200) || 'done'}`);
};

// ----- Signals (what Today shows) -----
const HOURS = 3600000;
const DEFAULT_EXPIRY = { notable: 72 * HOURS, brief: 20 * HOURS };

function sourceOf(t) {
  if (t?.origin?.startsWith('job:')) { const j = jobs.read(t.origin.slice(4)); return j?.title || t.origin.slice(4); }
  return t?.title || 'An agent';
}

function postSignal(b) {
  const level = ['needs', 'notable', 'brief'].includes(b.level) ? b.level : 'notable';
  const title = String(b.title || '').trim().slice(0, 200);
  if (!title) throw new Error('a signal needs a title');
  const t = b.thread ? store.thread(b.thread) : null;
  const hours = Number(b.hours);
  const expires = hours > 0 ? Date.now() + hours * HOURS : DEFAULT_EXPIRY[level] ? Date.now() + DEFAULT_EXPIRY[level] : null;
  const id = store.signal({
    level, title, key: b.key ? String(b.key).slice(0, 120) : null, body: b.body ? String(b.body).slice(0, 2000) : null,
    source: (b.source || (t ? sourceOf(t) : null))?.slice(0, 80) || null, href: b.href || (t ? `#/t/${t.id}` : null), thread: t?.id || null, expires,
  });
  emit({ type: 'signals' });
  if (level === 'needs' && b.notify !== false) notify(`${t ? sourceOf(t) + ': ' : ''}${title}`);
  return id;
}

// The last paragraph of a final message, if it asks something.
function finalQuestion(text) {
  const last = (text || '').trim().split(/\n\s*\n/).pop()?.replace(/[*_`>#]/g, '').trim();
  return last && last.endsWith('?') ? last.slice(-400) : null;
}

store.pruneSignals();
setInterval(() => store.pruneSignals(), 6 * HOURS).unref();

function threadOut(t) {
  if (!t) return null;
  return { ...t, running: threads.running.has(t.id), live: threads.live.has(t.id) };
}

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

const route = (method, pattern) => (req) => {
  if (req.method !== method) return null;
  const m = req.url.split('?')[0].match(pattern);
  return m;
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  let m;
  try {
    if (p === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': hello\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    // ----- Threads -----
    if (req.method === 'GET' && p === '/threads') {
      const q = url.searchParams.get('q');
      const list = q ? store.search(q) : store.threads({ archived: url.searchParams.get('archived') === '1' });
      return json(res, 200, list.map(threadOut));
    }
    if (req.method === 'POST' && p === '/threads') {
      const b = await readBody(req);
      const agent = b.agent || defaultAgent();
      const cwd = path.resolve((b.cwd || '~/home').replace(/^~/, HOME));
      if (!fs.existsSync(cwd)) return json(res, 400, { error: `no folder ${b.cwd}` });
      const t = store.createThread({ agent, cwd, origin: b.origin || 'chat', title: b.title || null });
      store.updateThread(t.id, { last_read: Date.now(), ...(b.model ? { model: b.model } : {}) });
      if (b.access) store.db.prepare('update threads set access = ? where id = ?').run(b.access === 'ask' ? 'ask' : 'full', t.id);
      if (b.text) await threads.prompt(t.id, { text: b.text, context: b.context });
      threads.threadEvent(t.id);
      return json(res, 200, threadOut(store.thread(t.id)));
    }
    if ((m = route('GET', /^\/threads\/([0-9a-f]+)$/)(req))) {
      const t = store.thread(m[1]);
      if (!t) return json(res, 404, { error: 'no such thread' });
      return json(res, 200, { thread: threadOut(t), items: store.items(t.id, Number(url.searchParams.get('after') || 0)) });
    }
    if ((m = route('POST', /^\/threads\/([0-9a-f]+)\/messages$/)(req))) {
      const b = await readBody(req);
      const r = await threads.prompt(m[1], { text: b.text, context: b.context });
      store.updateThread(m[1], { last_read: Date.now() });
      if (store.clearThreadNeeds(m[1])) emit({ type: 'signals' }); // the owner answered
      return json(res, 200, r);
    }
    if ((m = route('POST', /^\/threads\/([0-9a-f]+)\/cancel$/)(req))) {
      return json(res, 200, { ok: threads.cancel(m[1]) });
    }
    if ((m = route('POST', /^\/threads\/([0-9a-f]+)\/permissions\/(\d+)$/)(req))) {
      const b = await readBody(req);
      threads.answerPermission(m[1], m[2], b.optionId || null);
      return json(res, 200, { ok: true });
    }
    if ((m = route('PATCH', /^\/threads\/([0-9a-f]+)$/)(req))) {
      const b = await readBody(req);
      const fields = {};
      if (typeof b.title === 'string') fields.title = b.title.slice(0, 120);
      if (typeof b.archived === 'boolean') fields.archived = b.archived;
      if (typeof b.pinned === 'boolean') fields.pinned = b.pinned;
      if (b.read) fields.last_read = Date.now();
      store.updateThread(m[1], fields);
      if (b.model) await threads.setModel(m[1], b.model);
      if (typeof b.effort === 'string' && b.effort) await threads.setEffort(m[1], b.effort);
      if (b.access) store.db.prepare('update threads set access = ? where id = ?').run(b.access === 'ask' ? 'ask' : 'full', m[1]);
      if (b.archived) threads.stop(m[1]);
      threads.threadEvent(m[1]);
      return json(res, 200, threadOut(store.thread(m[1])));
    }
    if ((m = route('DELETE', /^\/threads\/([0-9a-f]+)$/)(req))) {
      threads.stop(m[1]);
      store.deleteThread(m[1]);
      emit({ type: 'deleted', threadId: m[1] });
      return json(res, 200, { ok: true });
    }

    // ----- Jobs -----
    if (req.method === 'GET' && p === '/jobs') return json(res, 200, jobs.list().map((j) => jobs.summary(j)));
    if (req.method === 'POST' && p === '/jobs') {
      const b = await readBody(req);
      const name = b.name || slug(b.title || 'job');
      return json(res, 200, await jobs.save(name, { title: b.title, type: b.type || 'agent', schedule: b.schedule || null, agent: b.agent, cwd: b.cwd, prompt: b.prompt, command: b.command, enabled: b.enabled !== false, catchUp: b.catchUp, notify: b.notify }, { create: true }));
    }
    if ((m = route('GET', /^\/jobs\/([a-z0-9-]+)$/)(req))) {
      const d = jobs.detail(m[1]);
      return d ? json(res, 200, d) : json(res, 404, { error: 'no such job' });
    }
    if ((m = route('PATCH', /^\/jobs\/([a-z0-9-]+)$/)(req))) {
      const b = await readBody(req);
      const allowed = ['title', 'schedule', 'agent', 'cwd', 'prompt', 'command', 'enabled', 'catchUp', 'notify'];
      return json(res, 200, await jobs.save(m[1], Object.fromEntries(Object.entries(b).filter(([k]) => allowed.includes(k)))));
    }
    if ((m = route('DELETE', /^\/jobs\/([a-z0-9-]+)$/)(req))) { await jobs.remove(m[1]); return json(res, 200, { ok: true }); }
    if ((m = route('POST', /^\/jobs\/([a-z0-9-]+)\/run$/)(req))) return json(res, 200, await jobs.run(m[1], 'manual'));
    if (req.method === 'GET' && p === '/cron') {
      const expr = url.searchParams.get('expr') || '';
      try { return json(res, 200, { describe: describeCron(expr), next: nextRun(expr)?.getTime() || null }); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }

    // ----- Signals -----
    if (req.method === 'GET' && p === '/signals') return json(res, 200, store.signals());
    if (req.method === 'POST' && p === '/signals') return json(res, 200, { id: postSignal(await readBody(req)) });
    if (req.method === 'POST' && p === '/signals/clear') {
      const b = await readBody(req);
      const n = b.key ? store.clearSignal(String(b.key)) : 0;
      if (n) emit({ type: 'signals' });
      return json(res, 200, { cleared: n });
    }
    if ((m = route('POST', /^\/signals\/(\d+)\/dismiss$/)(req))) {
      store.dismissSignal(Number(m[1]));
      emit({ type: 'signals' });
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && p === '/health') return json(res, 200, { ok: true, live: threads.live.size, running: threads.running.size, clients: clients.size });
    json(res, 404, { error: 'not found' });
  } catch (e) {
    json(res, 400, { error: e.message });
  }
});

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'job';
}

process.on('SIGTERM', () => { threads.shutdown(); process.exit(0); });
server.listen(PORT, '127.0.0.1', () => console.log(`agentd on 127.0.0.1:${PORT}`));

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
const ENV = `. ${HOME}/.config/springroll/env`;

// The owner's time zone (Settings → Time zone, desk.json "timezone"): schedules are worked out on it,
// and agents and commands run with it, whatever the machine's clock was set to.
const validTz = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };
function applyTimezone() {
  try { const tz = JSON.parse(fs.readFileSync(path.join(HOME, 'home', 'desk.json'), 'utf8')).timezone; if (tz && validTz(tz)) process.env.TZ = tz; } catch {}
  return process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
}
applyTimezone();

const store = openStore(path.join(HOME, 'data', 'agentd'));
for (const col of ["options text", "access text default 'full'", "effort text"]) {
  try { store.db.exec(`alter table threads add column ${col}`); } catch {}
}
// Agents with no remembered model list yet: take it from their latest chat that has one.
for (const r of store.db.prepare("select agent, options from threads where options is not null order by updated desc").all()) {
  if (store.agentOptions(r.agent)) continue;
  try { const o = JSON.parse(r.options); if (o.models?.length || o.effort) store.setAgentOptions(r.agent, { models: o.models || [], currentModel: o.currentModel || null, effort: o.effort || null }); } catch {}
}

// Never store the owner's keys in a timeline: values from secrets.env and the sign-in files are
// replaced with ••••NAME wherever they appear (tool output, messages, previews). Re-read on change.
const CONF = path.join(HOME, '.config', 'springroll');
let keyCache = { stamp: '', pairs: [] };
function keyPairs() {
  const files = ['secrets.env', 'claude-token', 'gmail', 'backup-passphrase', 'google.json'].map((f) => path.join(CONF, f));
  const stamp = files.map((f) => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } }).join(',');
  if (stamp === keyCache.stamp) return keyCache.pairs;
  const pairs = [];
  try {
    for (const line of fs.readFileSync(files[0], 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)='(.*)'$/);
      if (m) pairs.push([m[2].replace(/'\\''/g, "'"), m[1]]);
    }
  } catch {}
  // The Gmail file is address then app password: only the password is secret.
  for (const [f, name, line] of [[files[1], 'CLAUDE_TOKEN', 0], [files[2], 'GMAIL_PASSWORD', 1], [files[3], 'BACKUP_PASSPHRASE', 0]]) {
    try { const v = fs.readFileSync(f, 'utf8').split('\n')[line]?.trim(); if (v) pairs.push([v, name]); } catch {}
  }
  try { // Gmail accounts: app passwords, refresh tokens, the sign-in client's secret
    const g = JSON.parse(fs.readFileSync(files[4], 'utf8'));
    for (const a of g.accounts || []) for (const v of [a.password, a.refresh_token]) if (v) pairs.push([v, 'GMAIL_ACCOUNT']);
    if (g.client?.secret) pairs.push([g.client.secret, 'GOOGLE_CLIENT_SECRET']);
  } catch {}
  // Long values only (short ones would mask ordinary words); JSON-escaped, as they appear in stored items.
  keyCache = { stamp, pairs: pairs.filter(([v]) => v.length >= 8).map(([v, n]) => [JSON.stringify(v).slice(1, -1), n]).sort((a, b) => b[0].length - a[0].length) };
  return keyCache.pairs;
}
store.setRedactor((s) => {
  if (typeof s !== 'string') return s;
  for (const [v, name] of keyPairs()) if (s.includes(v)) s = s.split(v).join(`••••${name}`);
  return s;
});

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
    const line = fs.readFileSync(path.join(HOME, '.config', 'springroll', 'secrets.env'), 'utf8').split('\n').find((l) => l.startsWith(key + '='));
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

// One item for Home. Anything can post one (jobs, agents, apps, connector syncs):
//   level  needs | notable | brief        title, body (one or two lines)
//   key    stable id ("github:pr:acme/api#123"); the same key replaces the item
//   source who it's from ("GitHub")       icon   a Lucide name ("git-pull-request")
//   href   where View goes: a Springroll route (#/…) or a URL (opens in a new tab)
//   note   what an agent needs to act on it when the owner presses Chat ("gh pr view 123 -R acme/api")
//   rev    what it looks like upstream now (updated_at): marked done stays done until rev changes
//   hours  expiry; notify: false for no phone ping (needs items ping once, when they're new)
function normalizeSignal(b) {
  const level = ['needs', 'notable', 'brief'].includes(b.level) ? b.level : 'notable';
  const title = String(b.title || '').trim().slice(0, 200);
  if (!title) throw new Error('a signal needs a title');
  const t = b.thread ? store.thread(b.thread) : null;
  const hours = Number(b.hours);
  const str = (v, n) => (v == null || v === '' ? null : String(v).slice(0, n));
  return {
    level, title, key: str(b.key, 160), body: str(b.body, 2000),
    source: (str(b.source, 80) || (t ? sourceOf(t) : null))?.slice(0, 80) || null,
    href: str(b.href || b.url, 1000) || (t ? `#/t/${t.id}` : null), thread: t?.id || null,
    icon: /^[a-z0-9-]{1,40}$/.test(b.icon || '') ? b.icon : null, note: str(b.note, 4000), rev: str(b.rev, 200),
    expires: hours > 0 ? Date.now() + hours * HOURS : DEFAULT_EXPIRY[level] ? Date.now() + DEFAULT_EXPIRY[level] : null,
    notify: b.notify !== false,
  };
}

function postSignal(b, { quietEmit = false } = {}) {
  const s = normalizeSignal(b);
  const { id, fresh } = store.signal(s);
  if (!quietEmit) emit({ type: 'signals' });
  if (s.level === 'needs' && s.notify && fresh) notify(`${s.source && !s.title.startsWith(s.source) ? s.source + ': ' : ''}${s.title}`);
  return { id, fresh };
}

// A connector's whole list at once: every item's key starts with prefix; items under the prefix that
// aren't in the list any more (the PR merged, the ticket closed) come off Home. Several fresh needs
// items make one notification, not one each.
function syncSignals(b) {
  const prefix = String(b.prefix || '').trim();
  if (prefix.length < 3) throw new Error('sync needs a prefix (3+ characters), e.g. "github:review:"');
  const items = Array.isArray(b.items) ? b.items.slice(0, 500) : [];
  const keys = new Set(), fresh = [];
  for (const it of items) {
    const key = String(it.key || '');
    if (!key.startsWith(prefix)) throw new Error(`every key must start with ${prefix} (got "${key}")`);
    keys.add(key);
    const s = normalizeSignal({ source: b.source, icon: b.icon, level: b.level, ...it, notify: false });
    const r = store.signal(s);
    if (r.fresh && s.level === 'needs') fresh.push(s);
  }
  let cleared = 0;
  for (const old of store.activeSignals(prefix)) if (!keys.has(old.key)) cleared += store.clearSignal(old.key);
  emit({ type: 'signals' });
  if (fresh.length && b.notify !== false) notify(fresh.length === 1 ? `${fresh[0].source ? fresh[0].source + ': ' : ''}${fresh[0].title}` : `${fresh.length} new from ${b.source || fresh[0].source || prefix}: ${fresh.slice(0, 3).map((s) => s.title).join('; ')}`);
  return { posted: items.length, fresh: fresh.length, cleared };
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
      if (typeof b.effort === 'string' && b.effort) store.db.prepare('update threads set effort = ? where id = ?').run(b.effort, t.id);
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
    // Settings changed the time zone: reschedule on the new clock.
    if (req.method === 'POST' && p === '/timezone') { const tz = applyTimezone(); jobs.plan(); emit({ type: 'jobs' }); return json(res, 200, { timezone: tz }); }
    if (req.method === 'GET' && p === '/jobs') return json(res, 200, jobs.list().map((j) => jobs.summary(j)));
    if (req.method === 'GET' && p === '/jobs/queue') return json(res, 200, store.queuedRuns());
    if (req.method === 'POST' && p === '/jobs') {
      const b = await readBody(req);
      const name = b.name || slug(b.title || 'job');
      return json(res, 200, await jobs.save(name, { title: b.title, type: b.type || 'agent', schedule: b.schedule || null, agent: b.agent, cwd: b.cwd, prompt: b.prompt, command: b.command, enabled: b.enabled !== false, catchUp: b.catchUp, notify: b.notify, report: b.report, model: b.model || undefined, effort: b.effort || undefined, group: b.group || undefined, timeout: b.timeout || undefined, retries: b.retries || undefined, retryDelay: b.retryDelay || undefined }, { create: true }));
    }
    if ((m = route('GET', /^\/jobs\/([a-z0-9-]+)$/)(req))) {
      const d = jobs.detail(m[1]);
      return d ? json(res, 200, d) : json(res, 404, { error: 'no such job' });
    }
    if ((m = route('PATCH', /^\/jobs\/([a-z0-9-]+)$/)(req))) {
      const b = await readBody(req);
      const allowed = ['title', 'group', 'schedule', 'agent', 'model', 'effort', 'cwd', 'prompt', 'command', 'enabled', 'catchUp', 'notify', 'report', 'timeout', 'retries', 'retryDelay', 'keep'];
      return json(res, 200, await jobs.save(m[1], Object.fromEntries(Object.entries(b).filter(([k]) => allowed.includes(k)))));
    }
    if ((m = route('DELETE', /^\/jobs\/([a-z0-9-]+)$/)(req))) { await jobs.remove(m[1]); return json(res, 200, { ok: true }); }
    if ((m = route('POST', /^\/jobs\/([a-z0-9-]+)\/run$/)(req))) {
      // {"trigger": true}: started by something else (Mail's sync on new mail): skipped while the job is paused.
      const b = await readBody(req);
      if (b.trigger) {
        const j = jobs.read(m[1]);
        if (!j) return json(res, 404, { error: 'no such job' });
        if (!j.enabled) return json(res, 200, { skipped: 'paused' });
        if (jobs.busy(m[1])) return json(res, 200, { skipped: 'running' });
        return json(res, 200, await jobs.run(m[1], 'triggered'));
      }
      return json(res, 200, await jobs.run(m[1], 'manual'));
    }
    if ((m = route('POST', /^\/jobs\/([a-z0-9-]+)\/cancel$/)(req))) return json(res, 200, { cancelled: jobs.cancel(m[1]) });
    if (req.method === 'GET' && p === '/cron') {
      const expr = url.searchParams.get('expr') || '';
      try { return json(res, 200, { describe: describeCron(expr), next: nextRun(expr)?.getTime() || null }); }
      catch (e) { return json(res, 400, { error: e.message }); }
    }

    // ----- Run reports (what a job run tells the owner; Rollmark) -----
    if (req.method === 'POST' && p === '/runs/report') {
      const b = await readBody(req);
      return json(res, 200, jobs.publishReport(b.thread, String(b.markdown || ''), b.title));
    }
    if ((m = route('GET', /^\/runs\/thread\/([0-9a-f]+)$/)(req))) {
      const r = jobs.runView(m[1]);
      return r ? json(res, 200, r) : json(res, 404, { error: 'no run for that thread' });
    }

    // ----- Agents: what a new chat can offer before its session starts -----
    if ((m = route('GET', /^\/agents\/([a-z0-9_-]+)\/options$/)(req))) return json(res, 200, store.agentOptions(m[1]) || { models: [], effort: null });

    // ----- Signals -----
    if (req.method === 'GET' && p === '/signals') return json(res, 200, store.signals());
    if (req.method === 'POST' && p === '/signals') return json(res, 200, postSignal(await readBody(req)));
    if (req.method === 'POST' && p === '/signals/sync') return json(res, 200, syncSignals(await readBody(req)));
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

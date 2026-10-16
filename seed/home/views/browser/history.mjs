// Browser history: every session (where it ran, who started it, how long, how it ended) and every
// page it showed. lib.mjs writes a session's start and end; the server's recorder (watch) listens to
// each running browser over CDP and writes its pages. Data: ~/data/browser/history.db.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const FILE = path.join(os.homedir(), 'data/browser/history.db');
const KEEP_DAYS = 180;

let db;
function open() {
  if (db) return db;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  db = new DatabaseSync(FILE);
  // The `browser` command (from chats and jobs) and the app's server both write.
  db.exec(`pragma journal_mode = wal; pragma busy_timeout = 5000;
    create table if not exists sessions (
      id integer primary key, name text not null, via text, asked text, fallback_from text, fallback_reason text,
      profile text, exit_ip text, provider_id text, thread text, origin text, thread_title text, also text,
      started integer not null, ended integer, end_reason text, error text, pages integer not null default 0,
      data_bytes integer);
    create index if not exists sessions_started on sessions(started);
    create table if not exists pages (
      id integer primary key, session integer not null, at integer not null, url text not null, title text);
    create index if not exists pages_session on pages(session, at);`);
  return db;
}

// Who's asking: the chat or job run (agentd sets SPRINGROLL_THREAD), else the owner in the app or a terminal.
export async function who(by = {}) {
  const thread = by.thread !== undefined ? by.thread : process.env.SPRINGROLL_THREAD || null;
  const out = { thread, origin: by.origin || (thread ? 'chat' : 'terminal'), thread_title: null };
  if (thread) {
    try {
      const r = await fetch(`http://127.0.0.1:8090/threads/${thread}?after=${Number.MAX_SAFE_INTEGER}`, { signal: AbortSignal.timeout(3000) });
      const t = (await r.json()).thread;
      if (t) Object.assign(out, { origin: t.origin || 'chat', thread_title: t.title || null });
    } catch {}
  }
  return out;
}

const cols = (o) => Object.keys(o).filter((k) => o[k] !== undefined);
function insert(row) {
  const k = cols(row);
  return Number(open().prepare(`insert into sessions (${k.join(',')}) values (${k.map(() => '?').join(',')})`).run(...k.map((x) => row[x])).lastInsertRowid);
}

export function begin(s, by, extra = {}) {
  return insert({ name: s.name, via: s.via, profile: s.profile, exit_ip: s.exitIP || null, provider_id: s.id || null, started: s.started, ...by, ...extra });
}
export function failed(fields, by, error) {
  const now = Date.now();
  return insert({ ...fields, ...by, started: now, ended: now, end_reason: 'failed', error: String(error).slice(0, 500) });
}
// Another chat or job picked up a running browser by name.
export function reused(id, by) {
  if (!id || !by.thread) return;
  const r = open().prepare('select thread, also from sessions where id = ?').get(id);
  if (!r || r.thread === by.thread) return;
  const also = JSON.parse(r.also || '[]');
  if (!also.includes(by.thread)) open().prepare('update sessions set also = ? where id = ?').run(JSON.stringify([...also, by.thread]), id);
}
export function end(id, reason, extra = {}) {
  if (!id) return;
  open().prepare('update sessions set ended = coalesce(ended, ?), end_reason = ?, error = coalesce(?, error), data_bytes = coalesce(?, data_bytes) where id = ?')
    .run(Date.now(), reason, extra.error ? String(extra.error).slice(0, 500) : null, extra.data_bytes ?? null, id);
}

// Sessions that never got an end (the server was down when they went): close them at their last page.
export function closeLost(liveIds) {
  const cutoff = Date.now() - 120000; // a start being written right now isn't lost
  for (const r of open().prepare('select id, started from sessions where ended is null and started < ?').all(cutoff)) {
    if (liveIds.has(r.id)) continue;
    const last = open().prepare('select max(at) at from pages where session = ?').get(r.id)?.at;
    open().prepare("update sessions set ended = ?, end_reason = 'lost' where id = ?").run(last || r.started, r.id);
  }
}
export function prune() {
  const before = Date.now() - KEEP_DAYS * 864e5;
  open().prepare('delete from pages where session in (select id from sessions where started < ?)').run(before);
  open().prepare('delete from sessions where started < ?').run(before);
}

export function addPage(id, url, title) {
  const d = open();
  const last = d.prepare('select id, url, at from pages where session = ? order by id desc limit 1').get(id);
  if (last && last.url === url && Date.now() - last.at < 5000) return last.id; // a second tab or event for the same load
  const pid = Number(d.prepare('insert into pages (session, at, url, title) values (?, ?, ?, ?)').run(id, Date.now(), url, title || null).lastInsertRowid);
  d.prepare('update sessions set pages = pages + 1 where id = ?').run(id);
  return pid;
}
export function setTitle(pageId, title) { open().prepare('update pages set title = ? where id = ?').run(title, pageId); }

// ---- Reading ----
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
const out = (r) => ({
  id: r.id, name: r.name, via: r.via, asked: r.asked, fallbackFrom: r.fallback_from, fallbackReason: r.fallback_reason,
  profile: r.profile, exitIP: r.exit_ip, providerId: r.provider_id,
  thread: r.thread, origin: r.origin, threadTitle: r.thread_title, alsoThreads: JSON.parse(r.also || '[]'),
  job: r.origin?.startsWith('job:') ? r.origin.slice(4) : null,
  started: r.started, ended: r.ended, live: !r.ended, seconds: Math.round(((r.ended || Date.now()) - r.started) / 1000),
  endReason: r.end_reason, error: r.error, pages: r.pages, dataBytes: r.data_bytes,
});

// Newest first. Filters: job (name), thread, origin (chat|app|terminal|job:<name>), site (a host, matched
// on any page), before (a started time, for paging).
export function list({ limit = 50, before, job, thread, origin, site } = {}) {
  const where = [], args = [];
  if (before) { where.push('started < ?'); args.push(Number(before)); }
  if (job) { where.push('origin = ?'); args.push(`job:${job}`); }
  if (origin) { where.push('origin = ?'); args.push(origin); }
  if (thread) { where.push('(thread = ? or also like ?)'); args.push(thread, `%"${thread}"%`); }
  if (site) { where.push('id in (select session from pages where url like ?)'); args.push(`%${String(site).replace(/[%_]/g, '')}%`); }
  const rows = open().prepare(`select * from sessions ${where.length ? 'where ' + where.join(' and ') : ''} order by started desc limit ?`)
    .all(...args, Math.min(Number(limit) || 50, 500));
  const pg = open().prepare('select url from pages where session = ? order by id');
  return rows.map((r) => {
    const sites = [...new Set(pg.all(r.id).map((p) => host(p.url)).filter(Boolean))];
    return { ...out(r), sites };
  });
}
export function get(id) {
  const r = open().prepare('select * from sessions where id = ?').get(Number(id));
  if (!r) return null;
  const pages = open().prepare('select at, url, title from pages where session = ? order by id').all(r.id);
  return { ...out(r), sites: [...new Set(pages.map((p) => host(p.url)).filter(Boolean))], pageList: pages };
}

// ---- Recorder: one CDP connection per running browser, logging each page it shows ----
const SKIP = /^(about:|chrome:|devtools:|chrome-extension:|edge:)/;
const watchers = new Map(); // history id → WebSocket

// Until a page has loaded, Chrome gives its address as its title.
const realTitle = (t) => (t.title && !t.url.replace(/^[a-z]+:\/\//i, '').startsWith(t.title) ? t.title : null);

function watchOne(s) {
  const ws = new WebSocket(s.cdp);
  let listening;
  ws.ready = new Promise((r) => (listening = r));
  const targets = new Map(); // targetId → { url, page, title }
  let seq = 1;
  const send = (method, params) => ws.readyState === 1 && ws.send(JSON.stringify({ id: ++seq, method, params }));
  watchers.set(s.hid, ws);
  const seen = (t, poll) => {
    if (t.type !== 'page' || !t.url || SKIP.test(t.url)) return;
    const was = targets.get(t.targetId), title = realTitle(t);
    try {
      if (!was || was.url !== t.url) {
        if (poll) return; // a late answer about a page it has since left
        targets.set(t.targetId, { url: t.url, page: addPage(s.hid, t.url, title), title });
        // Chrome announces navigations, not titles: ask again once the page has had time to load.
        if (!title) for (const ms of [2000, 6000, 15000]) setTimeout(() => !targets.get(t.targetId)?.title && send('Target.getTargetInfo', { targetId: t.targetId }), ms);
      } else if (title && title !== was.title) { setTitle(was.page, title); was.title = title; }
    } catch (e) { console.error('history:', e.message); }
  };
  ws.onopen = () => send('Target.setDiscoverTargets', { discover: true });
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.id === 2) listening();
    if (m.method === 'Target.targetCreated' || m.method === 'Target.targetInfoChanged') seen(m.params.targetInfo);
    else if (m.result?.targetInfo) seen(m.result.targetInfo, true);
  };
  const done = () => { if (watchers.get(s.hid) === ws) watchers.delete(s.hid); };
  ws.onclose = () => { done(); listening(); };
  ws.onerror = () => { done(); listening(); try { ws.close(); } catch {} };
}

// Called often with the running sessions (from sessions.json): watch new ones, let go of ended ones.
export function watch(sessions) {
  const ids = new Set(sessions.map((s) => s.hid).filter(Boolean));
  for (const s of sessions) if (s.hid && s.cdp && !watchers.has(s.hid)) watchOne(s);
  for (const [id, ws] of watchers) if (!ids.has(id)) { watchers.delete(id); try { ws.close(); } catch {} }
  return ids;
}
// Resolves once every watcher is listening (or has given up).
export const listening = () => Promise.all([...watchers.values()].map((ws) => ws.ready));

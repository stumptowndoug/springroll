// Threads and their timeline items, in SQLite (node:sqlite, no dependencies).
// A thread is one conversation with one agent harness. Items are the
// normalized timeline: user, text, thought, tool, plan, permission, turn, notice.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function openStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'agentd.db'));
  db.exec(`
    pragma journal_mode = wal;
    create table if not exists threads (
      id text primary key, title text, agent text not null, cwd text not null,
      session_id text, status text not null default 'idle', origin text not null default 'chat',
      created integer not null, updated integer not null, last_read integer not null default 0,
      archived integer not null default 0, pinned integer not null default 0,
      model text, mode text, error text, usage text, commands text, preview text
    );
    create table if not exists items (
      id integer primary key autoincrement, thread_id text not null, turn integer not null,
      kind text not null, ref text, data text not null, created integer not null, updated integer not null
    );
    create index if not exists items_thread on items(thread_id, id);
    create index if not exists items_ref on items(thread_id, ref);
    create table if not exists runs (
      id integer primary key autoincrement, job text not null, thread_id text, started integer not null,
      finished integer, status text not null, summary text
    );
    create index if not exists runs_job on runs(job, id);
  `);

  const now = () => Date.now();
  const parseThread = (r) => r && {
    ...r, archived: !!r.archived, pinned: !!r.pinned,
    usage: r.usage ? JSON.parse(r.usage) : null, commands: r.commands ? JSON.parse(r.commands) : [],
    options: r.options ? JSON.parse(r.options) : null,
    unread: r.updated > r.last_read && r.status !== 'running',
  };
  const parseItem = (r) => r && { id: r.id, threadId: r.thread_id, turn: r.turn, kind: r.kind, ref: r.ref, created: r.created, updated: r.updated, ...JSON.parse(r.data) };

  const q = {
    insertThread: db.prepare(`insert into threads (id, title, agent, cwd, origin, created, updated, last_read, mode) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    thread: db.prepare('select * from threads where id = ?'),
    threads: db.prepare('select * from threads where archived = ? order by pinned desc, updated desc limit ?'),
    threadsByOrigin: db.prepare('select * from threads where origin = ? order by updated desc limit ?'),
    items: db.prepare('select * from items where thread_id = ? order by id'),
    itemsAfter: db.prepare('select * from items where thread_id = ? and id > ? order by id'),
    item: db.prepare('select * from items where id = ?'),
    itemByRef: db.prepare('select * from items where thread_id = ? and ref = ? order by id desc limit 1'),
    lastItem: db.prepare('select * from items where thread_id = ? order by id desc limit 1'),
    insertItem: db.prepare('insert into items (thread_id, turn, kind, ref, data, created, updated) values (?, ?, ?, ?, ?, ?, ?)'),
    updateItem: db.prepare('update items set data = ?, updated = ? where id = ?'),
    maxTurn: db.prepare('select coalesce(max(turn), 0) as t from items where thread_id = ?'),
    deleteThread: db.prepare('delete from threads where id = ?'),
    deleteItems: db.prepare('delete from items where thread_id = ?'),
    search: db.prepare(`select distinct t.* from threads t left join items i on i.thread_id = t.id
      where t.title like ? or (i.kind in ('user', 'text') and i.data like ?) order by t.updated desc limit 50`),
    insertRun: db.prepare('insert into runs (job, thread_id, started, status) values (?, ?, ?, ?)'),
    finishRun: db.prepare('update runs set finished = ?, status = ?, summary = ? where id = ?'),
    runs: db.prepare('select * from runs where job = ? order by id desc limit ?'),
    lastRuns: db.prepare('select * from runs where id in (select max(id) from runs group by job)'),
  };

  return {
    db,
    createThread({ agent, cwd, origin = 'chat', title = null, mode = null }) {
      const id = crypto.randomBytes(6).toString('hex');
      const t = now();
      q.insertThread.run(id, title, agent, cwd, origin, t, t, t, mode);
      return this.thread(id);
    },
    thread: (id) => parseThread(q.thread.get(id)),
    threads: ({ archived = false, limit = 200 } = {}) => q.threads.all(archived ? 1 : 0, limit).map(parseThread),
    threadsByOrigin: (origin, limit = 50) => q.threadsByOrigin.all(origin, limit).map(parseThread),
    search: (text) => q.search.all(`%${text}%`, `%${text}%`).map(parseThread),
    updateThread(id, fields) {
      const allowed = ['title', 'session_id', 'status', 'updated', 'last_read', 'archived', 'pinned', 'model', 'mode', 'error', 'usage', 'commands', 'preview', 'agent', 'cwd'];
      const keys = Object.keys(fields).filter((k) => allowed.includes(k));
      if (!keys.length) return this.thread(id);
      const vals = keys.map((k) => (k === 'usage' || k === 'commands') && fields[k] != null && typeof fields[k] !== 'string' ? JSON.stringify(fields[k]) : typeof fields[k] === 'boolean' ? (fields[k] ? 1 : 0) : fields[k]);
      db.prepare(`update threads set ${keys.map((k) => `${k} = ?`).join(', ')} where id = ?`).run(...vals, id);
      return this.thread(id);
    },
    deleteThread(id) { q.deleteItems.run(id); q.deleteThread.run(id); },
    items: (threadId, after = 0) => (after ? q.itemsAfter.all(threadId, after) : q.items.all(threadId)).map(parseItem),
    item: (id) => parseItem(q.item.get(id)),
    itemByRef: (threadId, ref) => parseItem(q.itemByRef.get(threadId, ref)),
    lastItem: (threadId) => parseItem(q.lastItem.get(threadId)),
    maxTurn: (threadId) => q.maxTurn.get(threadId).t,
    addItem(threadId, turn, kind, data, ref = null) {
      const t = now();
      const r = q.insertItem.run(threadId, turn, kind, ref, JSON.stringify(data), t, t);
      return this.item(Number(r.lastInsertRowid));
    },
    updateItem(id, data) {
      q.updateItem.run(JSON.stringify(data), now(), id);
      return this.item(id);
    },
    startRun: (job, threadId) => Number(q.insertRun.run(job, threadId, now(), 'running').lastInsertRowid),
    finishRun: (id, status, summary) => q.finishRun.run(now(), status, summary, id),
    runs: (job, limit = 30) => q.runs.all(job, limit),
    lastRuns: () => Object.fromEntries(q.lastRuns.all().map((r) => [r.job, r])),
  };
}

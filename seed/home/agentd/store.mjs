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
    create index if not exists runs_thread on runs(thread_id);
    create table if not exists signals (
      id integer primary key autoincrement, key text, level text not null, title text not null, body text,
      source text, href text, thread_id text, created integer not null, updated integer not null,
      expires integer, dismissed integer not null default 0
    );
    create index if not exists signals_key on signals(key);
    create table if not exists agent_options (agent text primary key, options text not null, updated integer not null);
  `);

  // Columns added after the first release (each fails harmlessly once it exists).
  // The runs table is also the jobs' queue: a run waits as 'queued' (until not_before, and until there's
  // room) and survives restarts; attempt counts retries; how is scheduled | manual | retry.
  // Threads: the agent's settings as it reports them, Full access or Ask first, the effort chosen.
  for (const col of ['options text', "access text default 'full'", 'effort text', 'persona text']) { try { db.exec(`alter table threads add column ${col}`); } catch {} }
  for (const col of ['report text', 'title text', 'attempt integer not null default 1', 'not_before integer', 'how text']) { try { db.exec(`alter table runs add column ${col}`); } catch {} }
  // Signals from connectors: an icon, the note an agent gets when the owner asks about it, and a revision
  // (what changed upstream) so an item the owner marked done stays done until something new happens.
  for (const col of ['icon text', 'note text', 'rev text']) { try { db.exec(`alter table signals add column ${col}`); } catch {} }

  const now = () => Date.now();
  let redact = (s) => s; // masks the owner's key values in anything stored (set by agentd)
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
    jobThreads: db.prepare("select * from threads where origin like 'job:%' and archived = 0 and updated < ? order by updated desc limit ?"),
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
    deleteItem: db.prepare('delete from items where id = ?'),
    search: db.prepare(`select distinct t.* from threads t left join items i on i.thread_id = t.id
      where t.title like ? or (i.kind in ('user', 'text') and i.data like ?) order by t.updated desc limit 50`),
    run: db.prepare('select * from runs where id = ?'),
    insertRun: db.prepare('insert into runs (job, thread_id, started, status) values (?, ?, ?, ?)'),
    finishRun: db.prepare('update runs set finished = ?, status = ?, summary = ? where id = ?'),
    runs: db.prepare('select id, job, thread_id, started, finished, status, summary, title, attempt, not_before, how from runs where job = ? order by id desc limit ?'),
    runByThread: db.prepare('select * from runs where thread_id = ? order by id desc limit 1'),
    setReport: db.prepare('update runs set report = ?, title = ?, summary = ? where id = ?'),
    lastRuns: db.prepare("select * from runs where id in (select max(id) from runs where status != 'queued' group by job)"),
    queueRun: db.prepare("insert into runs (job, started, status, attempt, not_before, how) values (?, ?, 'queued', ?, ?, ?)"),
    queued: db.prepare("select * from runs where status = 'queued' order by coalesce(not_before, 0), id"),
    beginRun: db.prepare("update runs set status = 'running', thread_id = ?, started = ? where id = ?"),
    signals: db.prepare('select * from signals where dismissed = 0 and (expires is null or expires > ?) order by updated desc limit 200'),
    signalByKey: db.prepare('select * from signals where key = ? order by id desc limit 1'),
    insertSignal: db.prepare('insert into signals (key, level, title, body, source, href, thread_id, icon, note, rev, created, updated, expires) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    updateSignal: db.prepare('update signals set level = ?, title = ?, body = ?, source = ?, href = ?, thread_id = ?, icon = ?, note = ?, rev = ?, updated = ?, expires = ?, dismissed = ? where id = ?'),
    activeByPrefix: db.prepare("select id, key from signals where key like ? escape '\\' and dismissed = 0"),
    dismissSignal: db.prepare('update signals set dismissed = 1, updated = ? where id = ?'),
    dismissKey: db.prepare('update signals set dismissed = 2, updated = ? where key = ? and dismissed = 0'), // gone at the source, not done by the owner
    // Key requests and sign-ins keep waiting until they're done, whatever else is said in the chat.
    dismissThreadNeeds: db.prepare("update signals set dismissed = 1, updated = ? where thread_id = ? and level = 'needs' and dismissed = 0 and coalesce(key, '') not like 'secret:%' and coalesce(key, '') not like 'signin:%'"),
    pruneSignals: db.prepare('delete from signals where updated < ? and (dismissed > 0 or (expires is not null and expires < ?))'),
    touchSignal: db.prepare('update signals set expires = ? where id = ?'),
  };

  return {
    dir,
    db,
    setRedactor(fn) { redact = fn; },
    createThread({ agent, cwd, origin = 'chat', title = null, mode = null }) {
      const id = crypto.randomBytes(6).toString('hex');
      const t = now();
      q.insertThread.run(id, title, agent, cwd, origin, t, t, t, mode);
      return this.thread(id);
    },
    thread: (id) => parseThread(q.thread.get(id)),
    threads: ({ archived = false, limit = 200 } = {}) => q.threads.all(archived ? 1 : 0, limit).map(parseThread),
    threadsByOrigin: (origin, limit = 50) => q.threadsByOrigin.all(origin, limit).map(parseThread),
    // Job runs before a time, newest first: the Timeline's history, a page at a time.
    jobThreads: ({ before = Date.now() + 1, limit = 200 } = {}) => q.jobThreads.all(before, Math.min(limit, 1000)).map(parseThread),
    search: (text) => q.search.all(`%${text}%`, `%${text}%`).map(parseThread),
    updateThread(id, fields) {
      const allowed = ['title', 'session_id', 'status', 'updated', 'last_read', 'archived', 'pinned', 'model', 'mode', 'error', 'usage', 'commands', 'preview', 'agent', 'cwd', 'persona'];
      const keys = Object.keys(fields).filter((k) => allowed.includes(k) && fields[k] !== undefined);
      if (!keys.length) return this.thread(id);
      const vals = keys.map((k) => (k === 'usage' || k === 'commands') && fields[k] != null && typeof fields[k] !== 'string' ? JSON.stringify(fields[k]) : typeof fields[k] === 'boolean' ? (fields[k] ? 1 : 0) : (k === 'preview' || k === 'error' || k === 'title') && typeof fields[k] === 'string' ? redact(fields[k]) : fields[k]);
      db.prepare(`update threads set ${keys.map((k) => `${k} = ?`).join(', ')} where id = ?`).run(...vals, id);
      return this.thread(id);
    },
    deleteThread(id) { q.deleteItems.run(id); q.deleteThread.run(id); },
    forgetRunThread: (runId) => db.prepare('update runs set thread_id = null where id = ?').run(runId),
    items: (threadId, after = 0) => (after ? q.itemsAfter.all(threadId, after) : q.items.all(threadId)).map(parseItem),
    item: (id) => parseItem(q.item.get(id)),
    deleteItem: (id) => q.deleteItem.run(id),
    itemByRef: (threadId, ref) => parseItem(q.itemByRef.get(threadId, ref)),
    lastItem: (threadId) => parseItem(q.lastItem.get(threadId)),
    maxTurn: (threadId) => q.maxTurn.get(threadId).t,
    addItem(threadId, turn, kind, data, ref = null) {
      const t = now();
      const r = q.insertItem.run(threadId, turn, kind, ref, redact(JSON.stringify(data)), t, t);
      return this.item(Number(r.lastInsertRowid));
    },
    updateItem(id, data) {
      q.updateItem.run(redact(JSON.stringify(data)), now(), id);
      return this.item(id);
    },
    startRun: (job, threadId) => Number(q.insertRun.run(job, threadId, now(), 'running').lastInsertRowid),
    queueRun: (job, { attempt = 1, notBefore = null, how = 'manual' } = {}) => Number(q.queueRun.run(job, now(), attempt, notBefore, how).lastInsertRowid),
    queuedRuns: () => q.queued.all(),
    beginRun: (id, threadId) => q.beginRun.run(threadId, now(), id),
    run: (id) => q.run.get(id),
    finishRun: (id, status, summary) => q.finishRun.run(now(), status, summary, id),
    runs: (job, limit = 30) => q.runs.all(job, limit),
    runByThread: (threadId) => q.runByThread.get(threadId) || null,
    setReport: (id, report, title, summary) => q.setReport.run(report, title, summary, id),
    lastRuns: () => Object.fromEntries(q.lastRuns.all().map((r) => [r.job, r])),

    // Signals: what jobs and agents tell the owner through Today. Levels:
    // needs (blocked on the owner), notable (worth knowing), brief (the morning brief).
    // A key makes a signal replaceable: posting the same key again updates it.
    signals: () => q.signals.all(now()),
    // Returns { id, fresh }: fresh when the owner hasn't seen this yet (new, back after being done or
    // expired, or changed upstream), which is when it's worth a notification. Posting an item the owner
    // marked done again with the same rev keeps it done; without a rev it comes back (a job failing again).
    signal(s) {
      const t = now();
      const old = s.key ? q.signalByKey.get(s.key) : null;
      const vals = [s.level, s.title, s.body ?? null, s.source ?? null, s.href ?? null, s.thread ?? null, s.icon ?? null, s.note ?? null, s.rev ?? null];
      if (old) {
        const gone = old.dismissed || (old.expires && old.expires < t);
        // Posted again unchanged (a sync every few minutes): keep its time and place, just extend it.
        const same = ['level', 'title', 'body', 'source', 'href', 'icon', 'note', 'rev'].every((k) => (old[k] ?? null) === (s[k] ?? null)) && (old.thread_id ?? null) === (s.thread ?? null);
        if (!gone && same) { q.touchSignal.run(s.expires ?? null, old.id); return { id: old.id, fresh: false }; }
        const keepDone = old.dismissed === 1 && s.rev != null && old.rev === s.rev; // 1: the owner marked it done
        q.updateSignal.run(...vals, t, s.expires ?? null, keepDone ? 1 : 0, old.id);
        return { id: old.id, fresh: !keepDone && (gone || (s.rev != null && old.rev !== s.rev) || old.level !== s.level) };
      }
      return { id: Number(q.insertSignal.run(s.key ?? null, ...vals, t, t, s.expires ?? null).lastInsertRowid), fresh: true };
    },
    // Keys under a prefix that are showing now (for a sync to clear what's no longer there).
    activeSignals: (prefix) => q.activeByPrefix.all(prefix.replace(/[\\%_]/g, (c) => '\\' + c) + '%'),
    signalByKey: (key) => q.signalByKey.get(key),
    // The models and effort levels each agent offered at its last session start, so a new chat
    // can offer them before its own session exists.
    agentOptions: (agent) => { const r = db.prepare('select options from agent_options where agent = ?').get(agent); return r ? JSON.parse(r.options) : null; },
    setAgentOptions: (agent, options) => db.prepare('insert into agent_options (agent, options, updated) values (?, ?, ?) on conflict(agent) do update set options = excluded.options, updated = excluded.updated').run(agent, JSON.stringify(options), now()),
    dismissSignal: (id) => q.dismissSignal.run(now(), id).changes,
    clearSignal: (key) => q.dismissKey.run(now(), key).changes,
    clearThreadNeeds: (threadId) => q.dismissThreadNeeds.run(now(), threadId).changes,
    pruneSignals: () => q.pruneSignals.run(now() - 14 * 86400000, now()),
  };
}

// Scheduled jobs. A job is a folder ~/home/jobs/<name>/ with job.json and
// NOTES.md (the agent's memory between runs). Each run is a thread, so it shows
// in Springroll like any conversation; its final message is the run's report.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { nextRun, describeCron, parseCron } from './cron.mjs';
import { agentEnv } from './threads.mjs';

const HOME = os.homedir();
const JOBS = path.join(HOME, 'home', 'jobs');
const GRACE_MS = 60000;
// Agent runs at once (each is a model session and a few hundred MB); more wait as "queued". Command
// jobs aren't counted. SPRINGROLL_MAX_AGENT_JOBS in ~/.config/springroll/env changes it.
const envFile = (() => { try { return fs.readFileSync(path.join(os.homedir(), '.config', 'springroll', 'env'), 'utf8'); } catch { return ''; } })();
const MAX_AGENT_RUNS = Math.max(1, Number(process.env.SPRINGROLL_MAX_AGENT_JOBS || envFile.match(/^(?:export\s+)?SPRINGROLL_MAX_AGENT_JOBS=["']?(\d+)/m)?.[1]) || 2);
const RETRY_DELAY = 5 * 60000;

// job.json durations: "30m", "2h", "90s", "1h30m", or a number of minutes.
export function duration(v) {
  if (v == null || v === '' || v === false) return null;
  if (typeof v === 'number') return v > 0 ? v * 60000 : null;
  const str = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(str)) return Number(str) * 60000 || null;
  let ms = 0, m;
  const re = /(\d+(?:\.\d+)?)\s*(h|m|s)/gi;
  while ((m = re.exec(str))) ms += Number(m[1]) * { h: 3600000, m: 60000, s: 1000 }[m[2].toLowerCase()];
  return ms > 0 ? ms : null;
}
const spoken = (ms) => (ms >= 3600000 && ms % 3600000 === 0 ? `${ms / 3600000}h` : ms >= 60000 ? `${Math.round(ms / 60000)}m` : `${Math.round(ms / 1000)}s`);

function git(args) {
  return new Promise((resolve) => execFile('git', ['-C', path.join(HOME, 'home'), ...args], () => resolve()));
}

export class Jobs {
  constructor({ store, threads, emit, notify, defaultAgent, signal, clearSignal }) {
    this.store = store;
    this.signal = signal;            // put a failed run on Today
    this.clearSignal = clearSignal;  // a good run takes it off
    this.threads = threads;
    this.emit = emit;
    this.notify = notify;
    this.defaultAgent = defaultAgent;
    this.active = new Map();   // job name -> { runId, threadId }
    this.due = new Map();      // job name -> Date of next slot
    this.startedAt = new Date();
    fs.mkdirSync(JOBS, { recursive: true });
    this.migrateNames();
    this.plan(true);
    this.starting = new Map(); // run id -> promise of { threadId, runId } while it starts
    setInterval(() => this.tick(), 20000).unref();
    threads.onTurnEnd = (t, r) => this.onTurnEnd(t, r);
    setTimeout(() => this.closeStale(), 1000);
    this.watch();
  }

  // Jobs are usually created by an agent writing jobs/<name>/job.json, not through the API: notice
  // that at once (schedule it, tell open pages), with a slow check as a backstop.
  watch() {
    const sig = () => this.list().map((j) => { try { return `${j.name}:${fs.statSync(path.join(JOBS, j.name, 'job.json')).mtimeMs}`; } catch { return j.name; } }).join('|');
    let last = sig(), timer = null;
    const check = () => { const now = sig(); if (now !== last) { last = now; this.plan(); this.emit({ type: 'jobs' }); } };
    const soon = () => { clearTimeout(timer); timer = setTimeout(check, 300); };
    try { fs.watch(JOBS, { recursive: true }, soon).on('error', () => {}); } catch {}
    setInterval(check, 15000).unref();
  }

  // Runs still marked running from before agentd started were cut off: close
  // them as failed and say so on Today. Also put recent failures that never
  // reached Today there (once per failure).
  closeStale() {
    const summary = 'Stopped partway: the agent service restarted during the run.';
    const stale = this.store.db.prepare("select * from runs where status = 'running'").all().filter((r) => this.active.get(r.job)?.runId !== r.id);
    const retried = new Set();
    for (const r of stale) {
      const job = this.read(r.job);
      const retry = job && (r.attempt || 1) <= this.retries(job);
      this.store.finishRun(r.id, 'failed', retry ? `${summary} Trying again.` : summary);
      if (retry) { this.store.queueRun(r.job, { attempt: (r.attempt || 1) + 1, how: 'retry' }); retried.add(r.job); }
    }
    for (const job of this.list()) {
      const last = this.store.runs(job.name, 2).find((r) => r.status !== 'queued');
      if (!last || retried.has(job.name) || this.active.has(job.name) || last.status !== 'failed') continue;
      if (stale.some((r) => r.id === last.id)) { this.failed(job, last.thread_id, summary, true); continue; }
      if (Date.now() - (last.finished || last.started) > 3 * 86400000) continue;
      const s = this.store.signalByKey(`job:${job.name}`);
      if (!s || s.updated < (last.finished || last.started)) this.failed(job, last.thread_id, last.summary, false);
    }
    this.emit({ type: 'jobs' });
    this.pump();
  }

  retries(job) { return Math.min(10, Math.max(0, Math.floor(Number(job.retries) || 0))); }

  failed(job, threadId, summary, notify) {
    const title = job.title || job.name;
    try {
      this.signal({ level: 'needs', key: `job:${job.name}`, thread: threadId, href: threadId ? (job.report === false ? `#/t/${threadId}` : `#/r/${threadId}`) : `#/jobs/${job.name}`, source: title, title: `${title} failed`, body: summary || null, notify });
    } catch (e) { console.error('signal', e.message); }
  }

  // Jobs renamed upstream keep their history: runs, run threads and Home signals.
  migrateNames() {
    for (const [from, to] of Object.entries({ 'agentos-update': 'springroll-update' })) {
      if (!fs.existsSync(path.join(JOBS, to, 'job.json'))) continue;
      this.store.db.prepare('update runs set job = ? where job = ?').run(to, from);
      this.store.db.prepare('update threads set origin = ? where origin = ?').run(`job:${to}`, `job:${from}`);
      this.store.db.prepare('update signals set key = ? where key = ?').run(`job:${to}`, `job:${from}`);
    }
  }

  read(name) {
    try {
      const dir = path.join(JOBS, name);
      const job = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8'));
      return { name, enabled: true, type: 'agent', catchUp: 'skip', notify: true, report: true, ...job };
    } catch { return null; }
  }

  list() {
    let names = [];
    try { names = fs.readdirSync(JOBS).filter((n) => fs.existsSync(path.join(JOBS, n, 'job.json'))); } catch {}
    return names.map((n) => this.read(n)).filter(Boolean);
  }

  // Next slot per job. Skip policy: missed slots while agentd was down are dropped.
  // Catch-up policy: run once for the most recent missed slot, never the backlog.
  plan(startup = false) {
    const last = this.store.lastRuns();
    for (const j of this.list()) {
      if (!j.enabled || !j.schedule) { this.due.delete(j.name); continue; }
      try {
        parseCron(j.schedule);
        const since = startup && j.catchUp === 'once' && last[j.name] ? new Date(last[j.name].started) : new Date();
        this.due.set(j.name, nextRun(j.schedule, since));
      } catch { this.due.delete(j.name); }
    }
  }

  tick() {
    const now = Date.now();
    for (const [name, at] of this.due) {
      if (!at || at.getTime() > now) continue;
      const job = this.read(name);
      this.due.set(name, job?.schedule ? nextRun(job.schedule, new Date()) : null);
      if (!job || !job.enabled) continue;
      if (now - at.getTime() > GRACE_MS && job.catchUp !== 'once') continue; // missed: skip
      if (this.busy(name)) continue; // never overlap, never pile up
      if (job.onlyIf) this.check(job).then((go) => go && !this.busy(name) && this.enqueue(name, 'scheduled').catch((e) => console.error('job', name, e.message)));
      else this.enqueue(name, 'scheduled').catch((e) => console.error('job', name, e.message));
    }
    this.pump(); // retries whose time has come, runs waiting for room
  }

  busy(name) { return this.active.has(name) || this.store.queuedRuns().some((r) => r.job === name && r.how !== 'retry'); }
  agentRuns() { return [...this.active.values()].filter((a) => a.agent).length; }

  // Every run goes through the queue (the runs table): it starts at once when there's room, or waits
  // ("queued") until an agent run finishes or its retry time comes. Survives restarts.
  async enqueue(name, how = 'manual') {
    const job = this.read(name);
    if (!job) throw new Error('no such job');
    if (this.active.has(name)) throw new Error('already running');
    if (this.store.queuedRuns().some((r) => r.job === name)) throw new Error('already queued');
    const runId = this.store.queueRun(name, { how });
    this.emit({ type: 'jobs' });
    this.pump();
    const started = this.starting.get(runId);
    return started ? await started : { runId, queued: true };
  }

  pump() {
    const now = Date.now();
    for (const r of this.store.queuedRuns()) {
      if (r.not_before && r.not_before > now) continue;
      if (this.active.has(r.job)) continue;
      const job = this.read(r.job);
      if (!job) { this.store.finishRun(r.id, 'cancelled', 'The job was removed before it started.'); continue; }
      if (!job.enabled && r.how !== 'manual') { this.store.finishRun(r.id, 'cancelled', 'Paused before it started.'); continue; }
      const agent = job.type !== 'command';
      if (agent && this.agentRuns() >= MAX_AGENT_RUNS) continue;
      const p = (agent ? this.startAgent(job, r) : Promise.resolve(this.runCommand(job, r)))
        .catch((e) => { console.error('job', job.name, e.message); return { runId: r.id, error: e.message }; })
        .finally(() => this.starting.delete(r.id));
      this.starting.set(r.id, p);
    }
    this.emit({ type: 'jobs' });
  }

  // Queued runs of a job are dropped; a running one is stopped.
  cancel(name) {
    let n = 0;
    for (const r of this.store.queuedRuns()) if (r.job === name) { this.store.finishRun(r.id, 'cancelled', 'Cancelled before it started.'); n++; }
    const a = this.active.get(name);
    if (a) { a.cancelled = true; this.kill(a); n++; }
    this.emit({ type: 'jobs' });
    return n;
  }

  // Stop a run: an agent is asked to cancel, then stopped; a command gets SIGTERM, then SIGKILL.
  kill(a) {
    if (a.proc) {
      const sig = (s) => { try { process.kill(-a.proc.pid, s); } catch { try { a.proc.kill(s); } catch {} } };
      sig('SIGTERM'); setTimeout(() => sig('SIGKILL'), 10000).unref(); return;
    }
    this.threads.cancel(a.threadId);
    setTimeout(() => {
      if (a.done) return;
      this.threads.stop(a.threadId);
      setTimeout(() => { if (!a.done) this.settle(a.job, a, 'failed', null); }, 5000).unref();
    }, 30000).unref();
  }

  // job.json "timeout" ("30m"): a run still going then is stopped and counts as failed.
  arm(job, a) {
    const ms = duration(job.timeout);
    if (!ms) return;
    a.timer = setTimeout(() => { if (!a.done) { a.timedOut = ms; this.kill(a); } }, ms);
    a.timer.unref?.();
  }

  // The end of every run: record it, retry it if the job asks (job.json "retries", "retryDelay"),
  // otherwise put a failure on Home or take one off. Returns true when a retry was queued.
  settle(job, a, status, summary) {
    if (a.done) return false;
    a.done = true;
    clearTimeout(a.timer);
    if (a.timedOut) { status = 'failed'; summary = `Timed out after ${spoken(a.timedOut)}.${summary ? ' ' + summary : ''}`; }
    if (a.cancelled && status !== 'done') { status = 'cancelled'; summary = summary || 'Stopped by the owner.'; }
    const retry = status === 'failed' && a.attempt <= this.retries(job);
    let note = summary;
    if (retry) {
      const delay = duration(job.retryDelay) ?? RETRY_DELAY;
      this.store.queueRun(job.name, { attempt: a.attempt + 1, notBefore: Date.now() + delay, how: 'retry' });
      note = `${summary || 'Failed'} · trying again in ${spoken(delay)} (attempt ${a.attempt + 1} of ${this.retries(job) + 1})`;
    }
    this.store.finishRun(a.runId, status, note);
    if (this.active.get(job.name) === a) this.active.delete(job.name);
    if (!retry && status === 'failed') this.failed(job, a.threadId, summary, false);
    if (status === 'done') this.clearSignal(`job:${job.name}`);
    this.emit({ type: 'jobs' });
    setImmediate(() => this.pump());
    return retry;
  }

  // job.json "onlyIf": a quick shell check before a scheduled run (exit 0 = there's work). Nothing to
  // do means no agent, no run, nothing in Runs: a frequent schedule stays cheap and quiet.
  check(job) {
    const cwd = path.resolve((job.cwd || '~/home').replace(/^~/, HOME));
    return new Promise((resolve) => execFile('bash', ['-c', job.onlyIf], { cwd, env: agentEnv(), timeout: 30000 }, (err) => resolve(!err)));
  }

  summary(job) {
    const recent = this.store.runs(job.name, 9);
    const waiting = recent.find((r) => r.status === 'queued');
    const last = recent.filter((r) => r.status !== 'queued').slice(0, 7);
    let next = null;
    try { next = job.enabled && job.schedule ? nextRun(job.schedule)?.getTime() : null; } catch {}
    return {
      ...job,
      // A job started by something else (job.json "trigger": "new mail arrives") says so instead of "Manual only".
      describe: (job.schedule ? safeDescribe(job.schedule) : job.trigger ? `When ${job.trigger}` : 'Manual only') + (job.schedule && job.onlyIf ? ', when there\'s work' : ''),
      next, running: this.active.has(job.name),
      queued: waiting ? { at: waiting.not_before || null, attempt: waiting.attempt, how: waiting.how } : null,
      last: last[0] || null,
      trail: last.map((r) => r.status).reverse(),
    };
  }

  detail(name) {
    const job = this.read(name);
    if (!job) return null;
    let notes = '';
    try { notes = fs.readFileSync(path.join(JOBS, name, 'NOTES.md'), 'utf8'); } catch {}
    return { ...this.summary(job), notes, runs: this.store.runs(name, 50) };
  }

  async save(name, fields, { create = false } = {}) {
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(name)) throw new Error('job names are lowercase letters, numbers and dashes');
    const dir = path.join(JOBS, name);
    if (create && fs.existsSync(dir)) throw new Error(`a job named ${name} already exists`);
    const current = create ? {} : this.read(name);
    if (!current) throw new Error('no such job');
    const job = { ...current, ...fields };
    delete job.name;
    for (const k of ['model', 'effort', 'group', 'timeout', 'retryDelay']) if (!job[k]) delete job[k]; // empty = the default
    if (!Number(job.retries)) delete job.retries; // no retries unless the job asks
    // timeline: which runs the Timeline lists ("failures", "never"); every run, unless set.
    if (!job.timeline || job.timeline === 'always') delete job.timeline;
    else if (!['failures', 'never'].includes(job.timeline)) throw new Error('timeline: use "always", "failures" or "never"');
    for (const k of ['timeout', 'retryDelay']) if (job[k] && !duration(job[k])) throw new Error(`${k}: use a length like "30m" or "2h"`);
    if (job.schedule) parseCron(job.schedule);
    if (job.type === 'command' ? !job.command : !job.prompt) throw new Error(job.type === 'command' ? 'a command job needs a command' : 'a job needs a prompt');
    fs.mkdirSync(dir, { recursive: true });
    const ordered = Object.fromEntries(['title', 'group', 'type', 'schedule', 'onlyIf', 'trigger', 'agent', 'model', 'effort', 'cwd', 'prompt', 'command', 'keep', 'timeout', 'retries', 'retryDelay', 'enabled', 'catchUp', 'notify', 'report', 'timeline']
      .filter((k) => job[k] !== undefined).map((k) => [k, job[k]]));
    fs.writeFileSync(path.join(dir, 'job.json'), JSON.stringify(ordered, null, 2) + '\n');
    if (create && !fs.existsSync(path.join(dir, 'NOTES.md'))) fs.writeFileSync(path.join(dir, 'NOTES.md'), `# ${job.title || name}\n\nNotes the agent keeps between runs.\n`);
    await git(['add', `jobs/${name}`]);
    await git(['commit', '-qm', `${create ? 'Add' : 'Update'} job ${name}`]);
    this.plan();
    this.emit({ type: 'jobs' });
    return this.summary(this.read(name));
  }

  async remove(name) {
    const dir = path.join(JOBS, name);
    if (!fs.existsSync(dir)) throw new Error('no such job');
    fs.rmSync(dir, { recursive: true, force: true });
    await git(['add', '-A', `jobs/${name}`]);
    await git(['commit', '-qm', `Remove job ${name}`]);
    this.due.delete(name);
    this.emit({ type: 'jobs' });
  }

  run(name, how = 'manual') { return this.enqueue(name, how); }

  async startAgent(job, r) {
    const name = job.name;
    const cwd = path.resolve((job.cwd || '~/home').replace(/^~/, HOME));
    const agent = job.agent || this.defaultAgent();
    const thread = this.store.createThread({ agent, cwd, origin: `job:${name}`, title: `${job.title || name}` });
    // The job's model and effort (thinking), applied when its session starts; unset = the agent's default.
    if (job.model) this.store.updateThread(thread.id, { model: job.model });
    if (job.effort) this.store.db.prepare('update threads set effort = ? where id = ?').run(job.effort, thread.id);
    if (job.persona) try { this.threads.setPersona(thread.id, job.persona); } catch {} // jobs speak plainly unless set
    this.store.beginRun(r.id, thread.id);
    const a = { runId: r.id, threadId: thread.id, attempt: r.attempt || 1, agent: true, job };
    this.active.set(name, a);
    this.arm(job, a);
    this.emit({ type: 'jobs' });
    const how = r.how || 'manual';
    const memory = `This is a ${how === 'retry' ? `retry (attempt ${a.attempt}; the last attempt failed)` : how} run of the job "${job.title || name}" (folder ~/home/jobs/${name}/). Read NOTES.md there first: it's your memory from earlier runs (background, not answers to copy into this run). Update it with lasting patterns worth remembering next time, not a log of this run; keep it short and merge what repeats.`;
    const finish = job.report === false
      // Reports off: the run is a chat; its final message is the result.
      ? `Finish with the result for the owner: what you found or did, concise and specific. It's sent to their phone, so lead with the most important line.`
      : `The owner reads your report, not this prompt or your steps. Publish it with the \`report\` command, written as ~/home/skills/report/SKILL.md says (Springroll's report format: Markdown, plus charts when there are numbers to compare). Lead with the result. If the work continues elsewhere (a Sprite, a long build), report where it stands and publish again when it changes. The report shows at the end of this chat, so after publishing it end with one short line (like "Published the report."), never a recap of it.`;
    const prompt = `${job.prompt.trim()}\n\n---\n${memory}\n\n${finish}`;
    try { await this.threads.prompt(thread.id, { text: prompt }); }
    catch (e) { this.settle(job, a, 'failed', e.message); } // the agent couldn't start: that's a failed run too
    return { threadId: thread.id, runId: r.id };
  }

  // A run's report: what the owner reads (Rollmark: Markdown plus charts). Published with the
  // `report` command (again to update it); otherwise the run's final message becomes it.
  publishReport(threadId, markdown, title) {
    const run = threadId && this.store.runByThread(threadId);
    if (!run) throw new Error('not a job run (report works inside a job run)');
    const body = markdown.trim();
    if (!body) throw new Error('empty report');
    const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
    const job = this.read(run.job);
    const t = (title || heading || job?.title || run.job).slice(0, 160);
    const summary = reportPreview(body);
    this.store.setReport(run.id, body, t, summary);
    this.store.updateThread(threadId, { preview: summary || t, title: t });
    this.emit({ type: 'jobs' });
    this.emit({ type: 'run', threadId });
    const th = this.store.thread(threadId);
    if (th) this.emit({ type: 'thread', thread: th });
    return { ok: true, title: t };
  }

  runView(threadId) {
    const run = this.store.runByThread(threadId);
    if (!run) return null;
    const job = this.read(run.job);
    return { ...run, jobTitle: job?.title || run.job, jobType: job?.type || 'agent', running: this.active.get(run.job)?.runId === run.id, attempt: run.attempt || 1 };
  }

  onTurnEnd(thread, result) {
    if (!thread?.origin?.startsWith('job:')) return;
    const name = thread.origin.slice(4);
    const a = this.active.get(name);
    if (!a || a.threadId !== thread.id || a.done) return;
    const status = result.error ? 'failed' : result.stopReason === 'cancelled' ? 'cancelled' : 'done';
    let run = this.store.runByThread(thread.id);
    // No report published: the final message is the report.
    if (run && !run.report && result.text && status === 'done' && this.read(name)?.report !== false) { try { this.publishReport(thread.id, result.text); } catch {} run = this.store.runByThread(thread.id); }
    const summary = (status === 'done' && run?.summary) || (result.error || result.text || '').trim().split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').slice(0, 300) || null;
    const job = this.read(name) || a.job;
    if (this.settle(job, a, a.timedOut ? 'failed' : status, summary)) return; // retrying: the last attempt reports
    const final = this.store.run(a.runId);
    const head = run?.title && run.title !== (job?.title || name) ? `${job?.title || name}: ${run.title}` : job?.title || name;
    if (job?.notify !== false) this.notify(`${head}: ${final.status === 'done' ? final.summary || 'done' : final.status + (final.summary ? ' · ' + final.summary : '')}`);
  }

  runCommand(job, r) {
    const cwd = path.resolve((job.cwd || '~/home').replace(/^~/, HOME));
    const how = r.how || 'manual';
    const thread = this.store.createThread({ agent: 'shell', cwd, origin: `job:${job.name}`, title: job.title || job.name });
    this.store.beginRun(r.id, thread.id);
    const a = { runId: r.id, threadId: thread.id, attempt: r.attempt || 1, agent: false, job };
    this.active.set(job.name, a);
    const turn = 1;
    this.store.addItem(thread.id, turn, 'user', { text: `${how === 'scheduled' ? 'Scheduled run' : how === 'retry' ? `Retry (attempt ${a.attempt})` : 'Run'}: ${job.command}`, system: true });
    const tool = this.store.addItem(thread.id, turn, 'tool', { toolKind: 'execute', title: job.command, status: 'in_progress', rawInput: { command: job.command } }, 'tool:cmd');
    this.store.updateThread(thread.id, { status: 'running' });
    this.emit({ type: 'thread', thread: this.store.thread(thread.id) });
    this.emit({ type: 'jobs' });
    const started = Date.now();
    let out = '';
    // Its own process group, so stopping it (timeout, cancel) stops everything it started.
    const p = spawn('bash', ['-c', job.command], { cwd, env: { ...agentEnv(), SPRINGROLL_THREAD: thread.id }, detached: true });
    a.proc = p;
    this.arm(job, a);
    const add = (d) => { out = (out + d).slice(-60000); };
    p.stdout.on('data', add);
    p.stderr.on('data', add);
    p.on('error', (e) => add(`\n${e.message}`));
    p.on('close', (code) => {
      const ok = code === 0 && !a.timedOut && !a.cancelled;
      this.store.updateItem(tool.id, { toolKind: 'execute', title: job.command, status: ok ? 'completed' : 'failed', rawInput: { command: job.command },
        content: [{ type: 'content', content: { type: 'text', text: out || '(no output)' } }], exitCode: code });
      this.store.addItem(thread.id, turn, 'turn', { stopReason: ok ? 'end_turn' : 'error', durationMs: Date.now() - started, error: ok ? null : a.timedOut ? 'timed out' : `exit code ${code}` });
      // A command that published a report (the `report` command) is summarized by it, not its last line.
      const rep = this.store.runByThread(thread.id);
      const last = (ok && rep?.report && rep.summary) || out.trim().split('\n').pop()?.slice(0, 300) || (ok ? 'done' : `exit ${code}`);
      this.store.updateThread(thread.id, { status: ok ? 'idle' : 'error', updated: Date.now(), preview: last });
      const before = this.store.runs(job.name, 3).find((x) => x.id !== a.runId && x.status !== 'queued');
      const retrying = this.settle(job, a, ok ? 'done' : 'failed', last);
      if (!ok) this.store.updateThread(thread.id, { preview: this.store.run(a.runId)?.summary || last }); // why it failed, in Runs
      // keep: "failures" (a sync every few minutes): a good run is counted, not kept as a chat.
      if (ok && job.keep === 'failures') {
        this.store.forgetRunThread(a.runId); this.store.deleteThread(thread.id);
        this.emit({ type: 'deleted', threadId: thread.id });
      } else this.emit({ type: 'thread', thread: this.store.thread(thread.id) });
      if (retrying) return;
      // Failures ping when a job starts failing, not on every run of a job that keeps failing.
      const final = this.store.run(a.runId);
      if (job.notify !== false && (ok ? job.notify === 'always' : before?.status !== 'failed' && final.status === 'failed')) this.notify(`${job.title || job.name}: ${ok ? last : 'failed · ' + final.summary}`);
    });
    return { threadId: thread.id, runId: r.id };
  }
}

function safeDescribe(s) { try { return describeCron(s); } catch { return s; } }

// A report's preview for lists and notifications: its first paragraph of prose (no headings,
// tables, lists' markers or chart blocks), up to 300 characters.
export function reportPreview(md) {
  const text = md.replace(/```[\s\S]*?```/g, '').split(/\n\s*\n/).map((p) => p.trim())
    .find((p) => p && !/^#/.test(p) && !/^\|/.test(p) && !/^[-*_]{3,}$/.test(p));
  return text ? text.replace(/^[-*+]\s+|^\d+\.\s+/gm, '').replace(/[*_`>#]/g, '').replace(/\s+/g, ' ').slice(0, 300) : null;
}

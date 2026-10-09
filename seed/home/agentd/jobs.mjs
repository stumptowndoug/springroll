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
    this.plan(true);
    setInterval(() => this.tick(), 20000).unref();
    threads.onTurnEnd = (t, r) => this.onTurnEnd(t, r);
    setTimeout(() => this.closeStale(), 1000);
  }

  // Runs still marked running from before agentd started were cut off: close
  // them as failed and say so on Today. Also put recent failures that never
  // reached Today there (once per failure).
  closeStale() {
    for (const job of this.list()) {
      const last = this.store.runs(job.name, 1)[0];
      if (!last || this.active.has(job.name)) continue;
      if (last.status === 'running') {
        const summary = 'Stopped partway: the agent service restarted during the run.';
        this.store.finishRun(last.id, 'failed', summary);
        this.failed(job, last.thread_id, summary, true);
      } else if (last.status === 'failed' && Date.now() - (last.finished || last.started) < 3 * 86400000) {
        const s = this.store.signalByKey(`job:${job.name}`);
        if (!s || s.updated < (last.finished || last.started)) this.failed(job, last.thread_id, last.summary, false);
      }
    }
    this.emit({ type: 'jobs' });
  }

  failed(job, threadId, summary, notify) {
    const title = job.title || job.name;
    try {
      this.signal({ level: 'needs', key: `job:${job.name}`, thread: threadId, source: title, title: `${title} failed`, body: summary || null, notify });
    } catch (e) { console.error('signal', e.message); }
  }

  read(name) {
    try {
      const dir = path.join(JOBS, name);
      const job = JSON.parse(fs.readFileSync(path.join(dir, 'job.json'), 'utf8'));
      return { name, enabled: true, type: 'agent', catchUp: 'skip', notify: true, ...job };
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
      if (this.active.has(name)) continue; // never overlap
      this.run(name, 'scheduled').catch((e) => console.error('job', name, e.message));
    }
  }

  summary(job) {
    const last = this.store.runs(job.name, 7);
    let next = null;
    try { next = job.enabled && job.schedule ? nextRun(job.schedule)?.getTime() : null; } catch {}
    return {
      ...job,
      describe: job.schedule ? safeDescribe(job.schedule) : 'Manual only',
      next, running: this.active.has(job.name),
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
    if (job.schedule) parseCron(job.schedule);
    if (job.type === 'command' ? !job.command : !job.prompt) throw new Error(job.type === 'command' ? 'a command job needs a command' : 'a job needs a prompt');
    fs.mkdirSync(dir, { recursive: true });
    const ordered = Object.fromEntries(['title', 'type', 'schedule', 'agent', 'cwd', 'prompt', 'command', 'enabled', 'catchUp', 'notify']
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

  async run(name, how = 'manual') {
    const job = this.read(name);
    if (!job) throw new Error('no such job');
    if (this.active.has(name)) throw new Error('already running');
    const cwd = path.resolve((job.cwd || '~/home').replace(/^~/, HOME));
    if (job.type === 'command') return this.runCommand(job, cwd, how);
    const agent = job.agent || this.defaultAgent();
    const thread = this.store.createThread({ agent, cwd, origin: `job:${name}`, title: `${job.title || name}` });
    const runId = this.store.startRun(name, thread.id);
    this.active.set(name, { runId, threadId: thread.id });
    this.emit({ type: 'jobs' });
    const prompt = `${job.prompt.trim()}

---
This is a ${how} run of the job "${job.title || name}" (folder ~/home/jobs/${name}/). Read NOTES.md there first: it's your memory from earlier runs. Update it with anything worth remembering next time (keep it short). Finish with the result for the owner: what you found or did, concise and specific. That final message is the run's report and is sent to their phone, so lead with the most important line.`;
    await this.threads.prompt(thread.id, { text: prompt });
    return { threadId: thread.id, runId };
  }

  onTurnEnd(thread, result) {
    if (!thread?.origin?.startsWith('job:')) return;
    const name = thread.origin.slice(4);
    const active = this.active.get(name);
    if (!active || active.threadId !== thread.id) return;
    this.active.delete(name);
    const status = result.error ? 'failed' : result.stopReason === 'cancelled' ? 'cancelled' : 'done';
    const summary = (result.error || result.text || '').trim().split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '').slice(0, 300) || null;
    this.store.finishRun(active.runId, status, summary);
    this.emit({ type: 'jobs' });
    const job = this.read(name);
    if (status === 'failed') this.failed(job || { name }, thread.id, summary, false);
    if (status === 'done') this.clearSignal(`job:${name}`);
    if (job?.notify !== false) this.notify(`${job?.title || name}: ${status === 'done' ? summary || 'done' : status + (summary ? ' · ' + summary : '')}`);
  }

  runCommand(job, cwd, how) {
    const thread = this.store.createThread({ agent: 'shell', cwd, origin: `job:${job.name}`, title: job.title || job.name });
    const runId = this.store.startRun(job.name, thread.id);
    this.active.set(job.name, { runId, threadId: thread.id });
    const turn = 1;
    this.store.addItem(thread.id, turn, 'user', { text: `${how === 'scheduled' ? 'Scheduled run' : 'Run'}: ${job.command}`, system: true });
    const tool = this.store.addItem(thread.id, turn, 'tool', { toolKind: 'execute', title: job.command, status: 'in_progress', rawInput: { command: job.command } }, 'tool:cmd');
    this.store.updateThread(thread.id, { status: 'running' });
    this.emit({ type: 'thread', thread: this.store.thread(thread.id) });
    this.emit({ type: 'jobs' });
    const started = Date.now();
    let out = '';
    const p = spawn('bash', ['-c', job.command], { cwd, env: { ...agentEnv(), AGENTOS_THREAD: thread.id } });
    const add = (d) => { out = (out + d).slice(-60000); };
    p.stdout.on('data', add);
    p.stderr.on('data', add);
    p.on('close', (code) => {
      const ok = code === 0;
      this.store.updateItem(tool.id, { toolKind: 'execute', title: job.command, status: ok ? 'completed' : 'failed', rawInput: { command: job.command },
        content: [{ type: 'content', content: { type: 'text', text: out || '(no output)' } }], exitCode: code });
      this.store.addItem(thread.id, turn, 'turn', { stopReason: ok ? 'end_turn' : 'error', durationMs: Date.now() - started, error: ok ? null : `exit code ${code}` });
      const last = out.trim().split('\n').pop()?.slice(0, 300) || (ok ? 'done' : `exit ${code}`);
      this.store.updateThread(thread.id, { status: ok ? 'idle' : 'error', updated: Date.now(), preview: last });
      this.store.finishRun(runId, ok ? 'done' : 'failed', last);
      this.active.delete(job.name);
      if (ok) this.clearSignal(`job:${job.name}`); else this.failed(job, thread.id, last, false);
      this.emit({ type: 'thread', thread: this.store.thread(thread.id) });
      this.emit({ type: 'jobs' });
      if (job.notify !== false && (!ok || job.notify === 'always')) this.notify(`${job.title || job.name}: ${ok ? last : 'failed · ' + last}`);
    });
    return { threadId: thread.id, runId };
  }
}

function safeDescribe(s) { try { return describeCron(s); } catch { return s; } }

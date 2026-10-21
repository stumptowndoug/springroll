// Thread manager: runs each thread's agent over ACP, turns ACP updates into
// timeline items, handles permissions, queued messages and resuming.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AcpConnection } from './acp.mjs';
import { background, watching } from './background.mjs';
import { PERSONAS_DIR, getPersona, listPersonas, personaText } from './personas.mjs';

const HOME = os.homedir();
const REPO = process.env.SPRINGROLL_REPO || path.join(HOME, 'home');
const MEMORY_FILE = path.join(REPO, 'notes', 'memory.md');
const MAX_TEXT = 24000;
// Idle chats keep their agent running, so one can keep supervising long work between messages
// (a refresh cycle, a deploy). The nightly housekeeping job stops what's truly abandoned, and the
// System watchdog handles memory pressure. A small machine can bring the idle stop back with
// SPRINGROLL_IDLE_MINUTES in ~/.config/springroll/env (upstream used 15).
const IDLE_MS = (() => {
  let env = '';
  try { env = fs.readFileSync(path.join(os.homedir(), '.config', 'springroll', 'env'), 'utf8'); } catch {}
  const m = Number(process.env.SPRINGROLL_IDLE_MINUTES || env.match(/^(?:export\s+)?SPRINGROLL_IDLE_MINUTES=["']?(\d+)/m)?.[1]);
  return m > 0 ? m * 60 * 1000 : 0;
})();
 // Scopes need the user's systemd manager (present when agentd runs as a user service).
const SCOPES = (() => { try { execFileSync('systemctl', ['--user', 'show-environment'], { stdio: 'ignore' }); return true; } catch { return false; } })();
// What we tell an agent we are (ACP clientInfo): Springroll as of its last commit.
const CLIENT_INFO = { name: 'springroll', title: 'Springroll', version: (() => { try { return execFileSync('git', ['-C', REPO, 'log', '-1', '--format=%cs-%h'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return 'unknown'; } })() };
const MEMORY_HIGH = `${Math.round((os.totalmem() / 2 ** 20) * 0.6)}M`;
// A job run's agent, once its turn is over and nothing it started is still going (a background task, a
// timer, a subagent, a Monitor before its deadline), is stopped after this long: runs otherwise pile up idle agents (mail triage every few
// minutes). A reply to the run, or a message from work it supervises, resumes the conversation.
const JOB_IDLE_MS = 2 * 60 * 1000;
const START_MS = 60 * 1000;
// Reading a new agent's models: how long to wait, and how long before trying again after a failure.
const PROBE_MS = 45 * 1000;
const PROBE_RETRY_MS = 10 * 60 * 1000;
// Stop asks the agent to cancel; it finishes the tool it's in first. One that hasn't stopped by then is closed.
const CANCEL_MS = 30 * 1000;
// Streamed text is written and sent at most this often (and at once past FLUSH_CHARS unsent).
const FLUSH_MS = 100;
const FLUSH_CHARS = 64000;
const FULL_MODES = ['bypassPermissions', 'agent-full-access', 'full-access', 'yolo', 'full', 'agent-full'];
// "Ask first": the harness's mode that asks before acting (Claude's default, Codex's agent).
const ASK_MODES = ['default', 'agent', 'auto', 'manual', 'ask', 'ask-first'];
const MAX_DIFFS = 8;            // diffs kept per tool call
const MAX_DIFF_LINES = 2000;
const MAX_IMAGE = 4 * 2 ** 20;   // base64 characters of an image an agent shows
// Images the owner attaches to a message: how many, and the most base64 characters each (the composer scales them to fit).
const MAX_PROMPT_IMAGES = 6;
// What claude-agent-acp and codex-acp report when the client opts in with JetBrains AIR's capabilities:
// delegated agents as sessions of their own (nativeSubagentSessions), and work left running after a tool
// call returns, from start to end (asyncTasks: a backgrounded command). An AIR client gets Codex's command
// output only as chunks it asked for (terminal_output_delta).
const AIR_CAPS = { _meta: { jetbrains: { air: { version: 1, capabilities: ['nativeSubagentSessions', 'asyncTasks'] } }, terminal_output_delta: true } };
// Cursor announces its subagents the same way (subagent_spawned/state_update) when asked with `_meta.subagents`.
const AGENT_CAPS = { claude: AIR_CAPS, codex: AIR_CAPS, cursor: { _meta: { subagents: true } } };
// Agents whose ACP says nothing about work left running in the background (checked 2026-10-16: Cursor
// backgrounds commands but never reports them; OpenCode and Pi use `&`). Their first prompt asks them not to.
const FOREGROUND_AGENTS = new Set(['cursor', 'opencode', 'pi']);
const FOREGROUND_NOTE = "[From Springroll] Nothing tracks work you leave running after your turn ends: the owner can't see it or stop it. Run commands in the foreground and wait for them; hand anything long (hours) to a job (skills/jobs/SKILL.md).";
const WORKER_END = new Set(['completed', 'failed', 'cancelled']);
// Command output that comes a chunk at a time (Codex) is written at most this often.
const OUTPUT_MS = 250;
// How much of a background task's output file is read for the chat.
const TASK_OUTPUT_BYTES = 64 * 1024;
const str = (v, max = 1000) => (typeof v === 'string' ? v.slice(0, max) : '');
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const LIMIT = /rate[ -]?limit|usage limit|quota|too many requests|\b429\b|overloaded|credit balance|out of credits/i;
const clip = (s) => (typeof s === 'string' && s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + `\n… (${s.length - MAX_TEXT} more characters)` : s);
// Output keeps its end: that's where a log says what happened.
const clipTail = (s) => (typeof s === 'string' && s.length > MAX_TEXT ? `(${s.length - MAX_TEXT} earlier characters) …\n` + s.slice(-MAX_TEXT) : s);
const lineCount = (s) => (typeof s === 'string' ? s.split('\n').length : 0);

// A diff too big to show whole is kept as just its path ("Large change"): half a diff misleads.
function clipContent(content) {
  if (!Array.isArray(content)) return content;
  let diffs = 0;
  return content.flatMap((c) => {
    if (c.type === 'content' && c.content?.type === 'text') return [{ ...c, content: { ...c.content, text: clipTail(c.content.text) } }];
    if (c.type === 'diff') {
      if (++diffs > MAX_DIFFS) return [];
      const big = (c.oldText?.length || 0) > MAX_TEXT || (c.newText?.length || 0) > MAX_TEXT || lineCount(c.oldText) + lineCount(c.newText) > MAX_DIFF_LINES;
      return [big ? { type: 'diff', path: c.path, truncated: true } : c];
    }
    return [c];
  });
}

function clipRaw(v) {
  if (v == null) return v;
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > MAX_TEXT ? clip(s) : v;
}

// A select's choices; the protocol allows them in groups.
const choices = (list = []) => list.flatMap((o) => (Array.isArray(o.options) ? o.options : [o]));

// Models, effort, modes and the agent's other settings, for the composer's
// pickers. All come from the adapter (session/new, set_config_option's reply,
// config_option_update), so they're whatever the harness offers today. Config
// options first: they list each model once (the models list may repeat a model
// per effort level, e.g. codex-acp's "gpt-6-sol[high]"). An update carries only
// config options, so the legacy models and modes lists are kept from `prev`.
function readOptions({ configOptions, models, modes }, prev = null) {
  const cfg = configOptions || [];
  const isModel = (c) => c.category === 'model' || c.id === 'model';
  const isEffort = (c) => c.category === 'thought_level';
  const isMode = (c) => c.category === 'mode' || c.id === 'mode';
  const o = { models: [], currentModel: null, source: null, effort: null, modes: [], currentMode: null, extra: [], images: !!prev?.images };
  const m = cfg.find(isModel);
  if (m?.options?.length) Object.assign(o, { models: choices(m.options).map((v) => ({ id: v.value, name: v.name, description: v.description })), currentModel: m.currentValue, source: 'config', configId: m.id });
  else if (models?.availableModels?.length) Object.assign(o, { models: models.availableModels.map((v) => ({ id: v.modelId, name: v.name, description: v.description })), currentModel: models.currentModelId, source: 'models' });
  else if (prev?.source === 'models') Object.assign(o, { models: prev.models, currentModel: prev.currentModel, source: 'models' });
  const e = cfg.find(isEffort);
  if (e?.options?.length) o.effort = { configId: e.id, current: e.currentValue, values: choices(e.options).map((v) => ({ id: v.value, name: v.name })) };
  const md = cfg.find(isMode);
  if (md?.options?.length) Object.assign(o, { modes: choices(md.options).map((v) => ({ id: v.value, name: v.name, description: v.description })), currentMode: md.currentValue, modeConfigId: md.id });
  else if (modes?.availableModes) Object.assign(o, { modes: modes.availableModes.map((v) => ({ id: v.id, name: v.name, description: v.description })), currentMode: modes.currentModeId });
  else if (prev && !prev.modeConfigId) Object.assign(o, { modes: prev.modes || [], currentMode: prev.currentMode || null });
  // Everything else with choices (Claude's Fast mode), behind the composer's settings button.
  o.extra = cfg.filter((c) => !isModel(c) && !isEffort(c) && !isMode(c) && c.type !== 'boolean' && c.options?.length)
    .map((c) => ({ id: c.id, name: c.name, description: c.description, current: c.currentValue, values: choices(c.options).map((v) => ({ id: v.value, name: v.name, description: v.description })) }));
  return o;
}

// Models the agent lists but can't use here. OpenCode lists its own service's models (OpenCode Zen)
// whether or not you've signed in to it, and starts on one of them: a chat that only ever gets
// "Invalid credential". For an agent with `providerAuth` in agents.json (model ids "provider/model"),
// keep the models of providers it has a key for: one in its auth file, one its config sets up, or
// <PROVIDER>_API_KEY in the environment. If the model it starts on isn't one of them,
// `fallbackModel` is the one to switch to: the newest match for the first of `preferModels` it has,
// else the first listed. Nothing is hidden when no provider has a key (the error says what's wrong).
export function usableModels(o, def, env = process.env) {
  const pa = def?.providerAuth;
  if (!pa || !o.models.length) return o;
  const read = (p) => { try { return JSON.parse(fs.readFileSync(p.replace(/^~/, HOME), 'utf8')) || {}; } catch { return {}; } };
  const have = new Set([...(pa.auth || []).flatMap((p) => Object.keys(read(p))), ...(pa.config || []).flatMap((p) => Object.keys(read(p).provider || {}))]);
  const keyed = (id) => { const p = id.split('/')[0]; return have.has(p) || !!env[`${p.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_API_KEY`]; };
  const models = o.models.filter((m) => keyed(m.id));
  if (!models.length) return o;
  if (models.some((m) => m.id === o.currentModel)) return { ...o, models };
  const ids = models.map((m) => m.id);
  // Newest version first ("4-5" in claude-sonnet-4-5-20250929, "5.2" in gpt-5.2-pro); of equals, the plain one (gpt-5.2, not -pro).
  const version = (id, w) => (id.slice(id.indexOf(w)).match(/\d+(?:[.-]\d{1,2}(?!\d))*/)?.[0] || '').split(/[.-]/).map(Number);
  const newer = (w) => (a, b) => { const x = version(a, w), y = version(b, w); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((y[i] || 0) !== (x[i] || 0)) return (y[i] || 0) - (x[i] || 0); return a.length - b.length; };
  const newest = (w) => ids.filter((id) => id.includes(w)).sort(newer(w))[0];
  return { ...o, models, fallbackModel: (def.preferModels || []).map(newest).find(Boolean) || ids[0] };
}

// The environment agents run with: the owner's shell env file (tokens, PATH)
// and connected services' secrets.
export function agentEnv() {
  try {
    const out = execFileSync('bash', ['-c', `. "${HOME}/.config/springroll/env" 2>/dev/null; [ -f "${HOME}/.config/springroll/secrets.env" ] && set -a && . "${HOME}/.config/springroll/secrets.env"; env -0`], { encoding: 'utf8' });
    return Object.fromEntries(out.split('\0').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  } catch { return { ...process.env }; }
}

export class ThreadManager {
  constructor({ store, agents, emit, notify, mcpServers, cancelMs = CANCEL_MS, memoryFile = MEMORY_FILE, personasDir = PERSONAS_DIR }) {
    this.store = store;
    this.agents = agents;        // () => registry entries
    this.emit = emit;            // (event) => broadcast to clients
    this.notify = notify;        // (thread, text) => phone notification
    this.mcpServers = mcpServers; // () => ACP mcpServers for new sessions
    this.cancelMs = cancelMs;
    this.memoryFile = memoryFile; // the owner's memory, sent with a fresh session's first prompt
    this.personasDir = personasDir; // presets for how the agent talks (personas.mjs)
    this.live = new Map();       // threadId -> { conn, sessionId, loading, last, permissions: Map }
    this.running = new Map();    // threadId -> { started, turn }
    this.cancelled = new Set();  // threads stopped while their agent was still starting
    this.streams = new Map();    // "threadId\nowner" -> the text item being streamed: { id, kind, turn, messageId, text, sent, dirty, timer }
                                 // (owner: '' for the chat's agent, else a delegated agent's session id)
    if (IDLE_MS) setInterval(() => this.reapIdle(), 60000).unref();
    setInterval(() => this.reapJobs(), 60000).unref();
    // Anything that was mid-turn when agentd stopped is over now.
    for (const t of store.threads()) {
      if (t.status === 'running' || t.status === 'waiting' || t.status === 'starting') {
        const turn = store.maxTurn(t.id);
        store.addItem(t.id, turn, 'turn', { stopReason: 'interrupted', note: 'Stopped when the agent service restarted.' });
        store.updateThread(t.id, { status: 'idle' });
      }
    }
    for (const a of store.db.prepare(`select id from items where kind = 'agent' and data like '%"state":"running"%'`).all()) this.endWorker(a.id, 'disconnected');
    for (const t of store.db.prepare(`select id from items where kind = 'task' and data like '%"state":"running"%'`).all()) this.endTask(this.store.item(t.id), 'disconnected');
  }

  agentDef(id) {
    const a = this.agents().find((x) => x.id === id);
    if (!a) throw new Error(`unknown agent "${id}"`);
    if (!a.acp) throw new Error(`${a.name} has no ACP mode in agents.json`);
    return a;
  }

  threadEvent(id) {
    const t = this.store.thread(id);
    if (t) this.emit({ type: 'thread', thread: { ...t, running: this.running.has(id), live: this.live.has(id), stopping: !!this.running.get(id)?.cancelled } });
    return t;
  }

  itemEvent(item) { if (item) this.emit({ type: 'item', item }); return item; }

  // A new timeline item. Streamed text (its owner's) is written first, so items stay in the order they happened.
  add(threadId, turn, kind, data, ref = null, owner = data.worker || '') {
    this.flushText(threadId, { owner });
    return this.itemEvent(this.store.addItem(threadId, turn, kind, data, ref));
  }

  // Streamed text is held in memory and written every FLUSH_MS, not per chunk (a long answer is
  // thousands of chunks). Clients get what was added since the last write ('append'), or the whole
  // item if it changed some other way (a key masked across a chunk boundary).
  appendText(threadId, turn, kind, text, messageId, owner = '') {
    const key = `${threadId}\n${owner}`;
    let s = this.streams.get(key);
    const same = s && s.kind === kind && s.turn === turn && (!messageId || !s.messageId || s.messageId === messageId);
    if (!same) {
      const item = this.add(threadId, turn, kind, { text, messageId, ...(owner ? { worker: owner } : {}) });
      this.streams.set(key, { id: item.id, kind, turn, messageId, owner, text, sent: item.text, dirty: false, timer: null });
      return;
    }
    s.text += glue(s, messageId, text) + text;
    s.messageId ||= messageId;
    s.dirty = true;
    if (s.text.length - s.sent.length > FLUSH_CHARS) this.flushText(threadId, { keep: true, owner });
    else s.timer ||= setTimeout(() => this.flushText(threadId, { keep: true, owner }), FLUSH_MS);
  }

  // Write the streamed text; unless keep, the next chunk starts a new item. owner: whose stream (all: every one).
  flushText(threadId, { keep = false, owner = '', all = false } = {}) {
    if (all) { for (const k of [...this.streams.keys()]) if (k.startsWith(`${threadId}\n`)) this.flushText(threadId, { keep, owner: k.slice(threadId.length + 1) }); return; }
    const key = `${threadId}\n${owner}`;
    const s = this.streams.get(key);
    if (!s) return;
    clearTimeout(s.timer);
    s.timer = null;
    if (!keep) this.streams.delete(key);
    if (!s.dirty) return;
    s.dirty = false;
    const item = this.store.updateItem(s.id, { text: s.text, messageId: s.messageId, ...(s.owner ? { worker: s.owner } : {}) });
    if (!item) return;
    if (item.text.startsWith(s.sent)) this.emit({ type: 'append', threadId, id: item.id, from: s.sent.length, text: item.text.slice(s.sent.length), updated: item.updated });
    else this.itemEvent(item);
    s.sent = item.text;
  }

  // ---------- Connection lifecycle ----------

  async connect(thread) {
    const existing = this.live.get(thread.id);
    if (existing && !existing.conn.closed) return existing;
    const def = this.agentDef(thread.agent);
    const [command, ...args] = def.acp;
    const env = { ...agentEnv(), SPRINGROLL_THREAD: thread.id };
    const conn = new AcpConnection({ command, args, cwd: thread.cwd, env, scope: SCOPES ? `agentd-${thread.id}-${Date.now().toString(36)}` : null, memoryHigh: MEMORY_HIGH });
    // early: updates that arrive before session/new returns, held until we know what to drop (Pi's banner).
    const live = { conn, sessionId: null, loading: false, started: Date.now(), last: Date.now(), permissions: new Map(), early: [], usable: (o) => usableModels(o, def, env), workers: new Map(), outputs: new Map() };
    this.live.set(thread.id, live);
    conn.on('notification', (method, params) => this.onNotification(thread.id, method, params));
    conn.on('request', (method, params, reply) => this.onRequest(thread.id, method, params, reply));
    conn.on('close', (err) => {
      this.flushText(thread.id, { all: true });
      for (const w of live.workers.values()) this.endWorker(w.itemId, 'disconnected');
      for (const ref of [...live.outputs.keys()]) this.flushOutput(live, ref);
      // What it left running stopped with it (its scope or process group).
      for (const t of this.store.items(thread.id)) if (t.kind === 'task' && t.state === 'running') this.endTask(t, 'disconnected');
      if (this.live.get(thread.id) === live) this.live.delete(thread.id);
      for (const p of live.permissions.values()) this.resolvePermissionItem(thread.id, p.itemId, { outcome: 'cancelled' });
      if (this.running.has(thread.id) && !live.stopping) {
        this.add(thread.id, this.running.get(thread.id).turn, 'notice', { level: 'danger', text: `The agent stopped unexpectedly. ${err.message}` });
      }
      this.threadEvent(thread.id);
    });

    const init = await conn.request('initialize', {
      protocolVersion: 1,
      // session.notices: the agent sends warnings as notices rather than bold text in its answer.
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, session: { notices: {} }, ...(AGENT_CAPS[def.id] || {}) },
      clientInfo: CLIENT_INFO,
    });
    live.capabilities = init?.agentCapabilities || {};
    // Which adapter (and version) this chat really runs: the CLI's own version can differ (bin/updates).
    const ai = init?.agentInfo;
    live.agentInfo = ai && typeof ai === 'object' ? { name: str(ai.name, 100), title: str(ai.title, 100), version: str(ai.version, 50) } : null;
    const mcpServers = this.mcpServers();
    let session = null;
    if (thread.session_id && live.capabilities.loadSession) {
      live.loading = true; // history is replayed as updates; we already have it
      try {
        session = await conn.request('session/load', { sessionId: thread.session_id, cwd: thread.cwd, mcpServers });
        session = { sessionId: thread.session_id, ...(session || {}) };
      } catch (e) {
        this.add(thread.id, this.store.maxTurn(thread.id), 'notice', { level: 'warn', text: `Couldn't resume the previous ${def.name} session (${e.message}); started a fresh one. Earlier messages are still shown here but the agent won't remember them.` });
      }
      live.loading = false;
    } else if (thread.session_id) {
      this.add(thread.id, this.store.maxTurn(thread.id), 'notice', { level: 'warn', text: `${def.name} can't resume earlier conversations, so this is a fresh session. Earlier messages are still shown here but the agent won't remember them.` });
    }
    if (!session) {
      try {
        session = await conn.request('session/new', { cwd: thread.cwd, mcpServers });
        live.fresh = true; // its first prompt carries notes/memory.md (memoryText)
      } catch (e) {
        conn.kill();
        if (e.code === -32000 || /auth/i.test(e.message)) throw new Error(`${def.name} isn't signed in. Open Settings → Coding agents to sign in.`);
        throw e;
      }
    }
    live.sessionId = session.sessionId;
    // Pi greets a new session with a banner (version, extensions): not part of any answer.
    live.banner = session._meta?.piAcp?.startupInfo || null;
    const early = live.early;
    live.early = null;
    for (const params of early) this.onNotification(thread.id, 'session/update', params);
    live.options = live.usable(readOptions(session, { images: !!live.capabilities.promptCapabilities?.image }));
    const prefs = this.store.agentOptions(thread.agent) || {};
    if (live.options.models.length || live.options.effort) this.store.setAgentOptions(thread.agent, { ...prefs, models: live.options.models, currentModel: live.options.fallbackModel || live.options.currentModel, effort: live.options.effort, images: live.options.images });
    const t = this.store.thread(thread.id);
    this.store.updateThread(thread.id, { session_id: session.sessionId });
    await this.applyAccess(thread.id, live, t.access || 'full');
    // The thread's model (chosen in it, or by its job), else for a new chat the one the owner last picked for this
    // agent, else (the agent started on a model it can't use here) its fallback; the first it offers.
    const model = [t.model, !thread.session_id && prefs.preferredModel, live.options.fallbackModel].find((id) => id && live.options.models.some((m) => m.id === id));
    if (model && model !== live.options.currentModel) await this.setOption(thread.id, 'model', model, { live });
    if (t.effort && live.options.effort && t.effort !== live.options.effort.current) await this.setOption(thread.id, 'effort', t.effort, { live });
    this.saveOptions(thread.id, live);
    return live;
  }

  // An agent nobody has chatted with yet has no remembered models: start a session just to read what it
  // offers (models, effort), remember that, and stop it. One probe per agent at a time; a failed one
  // (not signed in, adapter broken) isn't retried for PROBE_RETRY_MS.
  probeOptions(agentId) {
    this.probes ||= new Map(); // agent id -> Promise | { failed: time }
    const p = this.probes.get(agentId);
    if (p instanceof Promise) return p;
    if (p && Date.now() - p.failed < PROBE_RETRY_MS) return Promise.resolve(null);
    const def = this.agentDef(agentId);
    const [command, ...args] = def.acp;
    const cwd = fs.existsSync(REPO) ? REPO : HOME;
    const env = agentEnv();
    const conn = new AcpConnection({ command, args, cwd, env });
    const timer = setTimeout(() => conn.kill(), PROBE_MS);
    const run = (async () => {
      const init = await conn.request('initialize', { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: CLIENT_INFO });
      const o = usableModels(readOptions(await conn.request('session/new', { cwd, mcpServers: [] })), def, env);
      if (!o.models.length && !o.effort) throw new Error('no models offered');
      const saved = { ...(this.store.agentOptions(agentId) || {}), models: o.models, currentModel: o.fallbackModel || o.currentModel, effort: o.effort, images: !!init?.agentCapabilities?.promptCapabilities?.image };
      this.store.setAgentOptions(agentId, saved);
      this.probes.delete(agentId);
      return saved;
    })().catch(() => { this.probes.set(agentId, { failed: Date.now() }); return null; })
      .finally(() => { clearTimeout(timer); conn.kill(); });
    this.probes.set(agentId, run);
    return run;
  }

  // What the agent says it's using now, saved on the thread (a reconnect asks for the same) and shown.
  saveOptions(threadId, live) {
    const o = { ...live.options, agentInfo: live.agentInfo || undefined };
    this.store.updateThread(threadId, { ...(o.currentModel ? { model: o.currentModel } : {}), mode: o.currentMode || null });
    this.store.db.prepare('update threads set options = ?, effort = coalesce(?, effort) where id = ?').run(JSON.stringify(o), o.effort?.current ?? null, threadId);
    // The agent switched itself to its full-access mode: it won't ask any more, so say so.
    if (FULL_MODES.includes(o.currentMode)) this.store.db.prepare("update threads set access = 'full' where id = ?").run(threadId);
    this.threadEvent(threadId);
  }

  // Change one of the agent's settings: 'model', 'effort', 'mode' or another config option's id. The agent
  // may refuse or adjust it (Fast mode unavailable, effort the model lacks): what it reports back is shown.
  async setOption(threadId, which, value, { live = this.live.get(threadId) } = {}) {
    const o = live?.options;
    if (!o || !live.sessionId) return false;
    const extra = o.extra?.find((x) => x.id === which);
    const known = which === 'model' ? o.models.some((m) => m.id === value) : which === 'effort' ? o.effort?.values.some((v) => v.id === value)
      : which === 'mode' ? o.modes.some((m) => m.id === value) : extra?.values.some((v) => v.id === value);
    if (!known) return false;
    const sessionId = live.sessionId;
    try {
      let res;
      if (which === 'model' && o.source === 'models') await live.conn.request('session/set_model', { sessionId, modelId: value });
      else if (which === 'mode' && !o.modeConfigId) await live.conn.request('session/set_mode', { sessionId, modeId: value });
      else {
        const configId = which === 'model' ? o.configId : which === 'effort' ? o.effort.configId : which === 'mode' ? o.modeConfigId : which;
        res = await live.conn.request('session/set_config_option', { sessionId, configId, value });
      }
      if (res?.configOptions) live.options = live.usable(readOptions(res, o));
      else if (which === 'model') o.currentModel = value;
      else if (which === 'effort') o.effort.current = value;
      else if (which === 'mode') o.currentMode = value;
      else extra.current = value;
      return true;
    } catch (e) {
      const name = which === 'model' ? 'the model' : which === 'effort' ? 'the effort' : which === 'mode' ? 'the mode' : extra?.name || which;
      this.add(threadId, this.running.get(threadId)?.turn ?? this.store.maxTurn(threadId), 'notice', { level: 'warn', text: `Couldn't change ${name}: ${e.message}` });
      return false;
    }
  }

  // Full access: the box is the sandbox, so use the harness's full mode if it has one. Ask first: leave
  // it, so the harness asks (and Springroll shows the request), right away rather than next session.
  async applyAccess(threadId, live, access) {
    const o = live.options, ids = o.modes.map((m) => m.id);
    const want = access === 'full' ? FULL_MODES.find((id) => ids.includes(id))
      : FULL_MODES.includes(o.currentMode) ? ASK_MODES.find((id) => ids.includes(id)) || ids.find((id) => !FULL_MODES.includes(id) && !/read|plan/i.test(id)) : null;
    if (want && want !== o.currentMode) await this.setOption(threadId, 'mode', want, { live });
  }

  // What the chat has going on in the background (background tasks, timers, subagents), as its agent reported it.
  background(threadId) {
    const live = this.live.get(threadId);
    if (!live) return [];
    return background({ live, items: this.store.items(threadId) });
  }

  reapIdle() {
    for (const [id, live] of this.live) {
      if (!this.running.has(id) && Date.now() - live.last > IDLE_MS) {
        live.conn.kill();
        this.live.delete(id);
        this.threadEvent(id);
      }
    }
  }

  reapJobs(idleMs = JOB_IDLE_MS) {
    for (const [id, live] of this.live) {
      if (this.running.has(id) || live.loading || Date.now() - live.last < idleMs) continue;
      if (!this.store.thread(id)?.origin?.startsWith('job:') || this.background(id).length || watching({ live, items: this.store.items(id) })) continue;
      this.stop(id);
      this.threadEvent(id);
    }
  }

  stop(threadId) {
    const live = this.live.get(threadId);
    if (live) { live.stopping = true; live.conn.kill(); this.live.delete(threadId); }
  }

  shutdown() {
    for (const k of [...this.streams.keys()]) { const [id, owner] = k.split('\n'); this.flushText(id, { owner }); }
    for (const live of this.live.values()) live.conn.kill();
  }

  // ---------- Prompting ----------

  async prompt(threadId, { text = '', context, images }) {
    const thread = this.store.thread(threadId);
    if (!thread) throw new Error('no such thread');
    images = this.saveImages(images);
    if (!text?.trim() && !images) throw new Error('empty message');
    if (!thread.title) this.store.updateThread(threadId, { title: text.trim() ? titleFrom(text) : 'Image' });
    // `/persona <id>` (or `off`) switches how the agent talks; agentd handles it, the agent never sees it.
    const pm = !images && text.trim().match(/^\/persona(?:\s+([\w-]+))?$/i);
    if (pm) {
      if (pm[1]) this.setPersona(threadId, pm[1]);
      else {
        const list = listPersonas(this.personasDir).map((p) => p.id).join(', ');
        this.add(threadId, this.store.maxTurn(threadId), 'notice', { level: 'info', text: `Persona: ${getPersona(thread.persona, this.personasDir)?.name || 'none'}. Switch with /persona <name> (${list || 'none in ~/home/personas'}), or /persona off.` });
        this.threadEvent(threadId);
      }
      return { queued: false, persona: this.store.thread(threadId).persona || null };
    }
    const msg = { text, context, ...(images ? { images } : {}) };
    if (this.running.has(threadId)) {
      // Queue it: sent when the current turn ends.
      this.add(threadId, this.running.get(threadId).turn + 1, 'user', { ...msg, queued: true });
      this.threadEvent(threadId);
      return { queued: true };
    }
    const turn = this.store.maxTurn(threadId) + 1;
    this.add(threadId, turn, 'user', msg);
    this.run(threadId, turn, [msg]);
    return { queued: false };
  }

  // Switch a chat's persona (null, '', 'off' or 'plain' for none). Its next prompt carries the change.
  setPersona(threadId, id) {
    id = !id || ['off', 'plain', 'none'].includes(String(id).toLowerCase()) ? null : String(id).toLowerCase();
    const p = id && getPersona(id, this.personasDir);
    if (id && !p) throw new Error(`no persona ${id} (have: ${listPersonas(this.personasDir).map((x) => x.id).join(', ') || 'none'})`);
    const t = this.store.thread(threadId);
    if (!t) throw new Error('no such thread');
    if ((t.persona || null) === id) return t;
    this.store.updateThread(threadId, { persona: id });
    this.add(threadId, this.store.maxTurn(threadId), 'notice', { level: 'info', text: p ? `Persona: ${p.name}` : 'Persona off' });
    this.threadEvent(threadId);
    return this.store.thread(threadId);
  }

  // Attached images are kept as files (named by their content) beside the database, not in the timeline:
  // a chat stays light to load, and the agent is sent each one as it was.
  saveImages(images) {
    if (!Array.isArray(images) || !images.length) return null;
    if (images.length > MAX_PROMPT_IMAGES) throw new Error(`at most ${MAX_PROMPT_IMAGES} images per message`);
    const dir = path.join(this.store.dir, 'images');
    fs.mkdirSync(dir, { recursive: true });
    return images.map((im) => {
      const ext = IMAGE_TYPES[im?.mimeType];
      if (!ext || typeof im.data !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(im.data)) throw new Error('images must be PNG, JPEG, GIF or WebP');
      if (im.data.length > MAX_IMAGE) throw new Error('an image is too large to send');
      const file = `${createHash('sha256').update(im.data).digest('hex').slice(0, 32)}.${ext}`;
      const p = path.join(dir, file);
      if (!fs.existsSync(p)) fs.writeFileSync(p, Buffer.from(im.data, 'base64'));
      return { file, mimeType: im.mimeType, ...(typeof im.name === 'string' ? { name: im.name.slice(0, 120) } : {}) };
    });
  }

  imagePath(file) {
    if (!/^[0-9a-f]{32}\.(png|jpg|gif|webp)$/.test(file)) return null;
    const p = path.join(this.store.dir, 'images', file);
    return fs.existsSync(p) ? p : null;
  }

  async run(threadId, turn, messages) {
    const started = Date.now();
    const run = { started, turn };
    this.running.set(threadId, run);
    this.store.updateThread(threadId, { status: 'starting', updated: started, error: null });
    this.threadEvent(threadId);
    let stopReason = 'end_turn', error = null;
    try {
      // An agent that never finishes starting (a hung sign-in, no network) mustn't hold the chat forever.
      let timer;
      const live = await Promise.race([this.connect(this.store.thread(threadId)), new Promise((_, reject) => {
        timer = setTimeout(() => {
          this.stop(threadId);
          reject(new Error(`${this.agentDef(this.store.thread(threadId).agent).name} didn't finish starting within a minute. Check that it's signed in (Settings → Coding agents) and try again.`));
        }, START_MS);
      })]).finally(() => clearTimeout(timer));
      live.last = Date.now();
      this.store.updateThread(threadId, { status: 'running' });
      this.threadEvent(threadId);
      const prompt = [];
      if (live.fresh) {
        live.fresh = false;
        const t = this.store.thread(threadId), mem = memoryText(t.agent, t.cwd, this.memoryFile);
        if (mem) prompt.push({ type: 'text', text: mem });
        if (FOREGROUND_AGENTS.has(t.agent)) prompt.push({ type: 'text', text: FOREGROUND_NOTE });
      }
      const persona = personaText(this.store.thread(threadId).persona, live.personaSent || null, this.personasDir);
      live.personaSent = persona.sent;
      if (persona.text) prompt.push({ type: 'text', text: persona.text });
      for (const m of messages) {
        if (m.context) prompt.push({ type: 'text', text: contextText(m.context) });
        // Images first, then what the owner wrote about them.
        for (const im of m.images || []) {
          const p = this.imagePath(im.file);
          if (p) prompt.push({ type: 'image', mimeType: im.mimeType, data: fs.readFileSync(p).toString('base64') });
        }
        if (m.text?.trim()) prompt.push(...mentionBlocks(m.text, this.store.thread(threadId).cwd));
      }
      const res = await live.conn.request('session/prompt', { sessionId: live.sessionId, prompt });
      stopReason = res?.stopReason || 'end_turn';
      live.last = Date.now();
    } catch (e) {
      // Some agents answer a cancel by failing the prompt: that's still a stop, not an error.
      if (this.cancelled.delete(threadId) || run.cancelled) stopReason = 'cancelled';
      else { error = e.message; stopReason = 'error'; }
    }
    this.cancelled.delete(threadId);
    const duration = Date.now() - started;
    this.running.delete(threadId);
    this.add(threadId, turn, 'turn', { stopReason, durationMs: duration, error });
    const last = this.lastText(threadId, turn);
    this.store.updateThread(threadId, { status: error ? 'error' : 'idle', error, updated: Date.now(), preview: last ? last.slice(0, 200) : undefined });
    const t = this.threadEvent(threadId);
    this.onTurnEnd?.(t, { stopReason, error, duration, text: last });
    // Send anything queued while it was working, unless the owner stopped it: Stop means stop.
    const queued = this.store.items(threadId).filter((i) => i.kind === 'user' && i.queued && i.turn > turn);
    if (queued.length && run.cancelled) {
      for (const q of queued) this.itemEvent(this.store.updateItem(q.id, { ...message(q), unsent: true }));
    } else if (queued.length) {
      for (const q of queued) this.store.updateItem(q.id, message(q));
      const next = this.store.maxTurn(threadId);
      this.store.db.prepare("update items set turn = ? where thread_id = ? and kind = 'user' and turn > ?").run(next, threadId, turn);
      for (const q of queued) this.itemEvent(this.store.item(q.id));
      this.run(threadId, next, queued.map(message));
    }
  }

  // The owner took back a message that hasn't gone to the agent yet (queued, or not sent after a Stop):
  // to edit it in the composer, or drop it. One already sent stays.
  removeUnsent(threadId, itemId) {
    const item = this.store.item(Number(itemId));
    if (!item || item.threadId !== threadId || item.kind !== 'user' || !(item.queued || item.unsent)) throw new Error('that message was already sent');
    this.store.deleteItem(item.id);
    this.emit({ type: 'removed', threadId, id: item.id });
    return item;
  }

  // The turn's final message: the text after the last tool call (the answer,
  // not the narration before the work).
  lastText(threadId, turn) {
    const items = this.store.items(threadId).filter((i) => i.turn === turn && i.kind !== 'turn' && !i.worker);
    let end = items.length;
    while (end > 0 && items[end - 1].kind !== 'text') end--;
    let start = end;
    while (start > 0 && items[start - 1].kind === 'text') start--;
    const text = items.slice(start, end).map((i) => i.text).join('\n\n').trim();
    return text || null;
  }

  cancel(threadId) {
    const live = this.live.get(threadId);
    if (!live) return false;
    // Still starting: there's no session to cancel, so stop the agent (the next message starts it again).
    if (!live.sessionId) { this.cancelled.add(threadId); this.stop(threadId); return true; }
    const run = this.running.get(threadId);
    live.conn.notify('session/cancel', { sessionId: live.sessionId });
    for (const [rpcId, p] of live.permissions) {
      p.reply.respond({ outcome: { outcome: 'cancelled' } });
      this.resolvePermissionItem(threadId, p.itemId, { outcome: 'cancelled' });
      live.permissions.delete(rpcId);
    }
    if (!run || run.cancelled) return true;
    run.cancelled = true;
    if (this.store.thread(threadId)?.status === 'waiting') this.store.updateThread(threadId, { status: 'running' });
    this.threadEvent(threadId);
    // An agent that ignores the cancel (or is stuck in a tool) is closed; its session resumes on the next message.
    setTimeout(() => {
      if (this.running.get(threadId) !== run || this.live.get(threadId) !== live) return;
      const name = this.agentDef(this.store.thread(threadId).agent).name;
      this.add(threadId, run.turn, 'notice', { level: 'warn', text: `${name} didn't stop within ${Math.round(this.cancelMs / 1000)}s, so it was closed. Your next message picks the conversation up again.` });
      this.cancelled.add(threadId);
      this.stop(threadId);
    }, this.cancelMs).unref();
    return true;
  }

  // The owner changed a setting in the composer. With the agent running it changes now (or is refused,
  // with a notice); otherwise model and effort are saved for when it starts, and other settings start it.
  async changeSetting(threadId, which, value) {
    const thread = this.store.thread(threadId);
    if (!thread) throw new Error('no such thread');
    let live = this.live.get(threadId);
    if (!live?.sessionId && (which === 'model' || which === 'effort')) {
      const listed = which === 'model' ? thread.options?.models : thread.options?.effort?.values;
      if (listed?.length && !listed.some((v) => v.id === value)) throw new Error(`${thread.agent} doesn't offer ${which} "${value}"`);
      if (which === 'model') this.store.updateThread(threadId, { model: value });
      else this.store.db.prepare('update threads set effort = ? where id = ?').run(value, threadId);
      if (which === 'model') this.rememberModel(thread.agent, value);
      return this.threadEvent(threadId);
    }
    if (!live?.sessionId) live = await this.connect(thread);
    if (await this.setOption(threadId, which, value, { live }) && which === 'model' && live.options.currentModel === value) this.rememberModel(thread.agent, value);
    this.saveOptions(threadId, live);
  }

  // A model the owner picked becomes the one new chats with that agent start on.
  rememberModel(agent, model) { this.store.setAgentOptions(agent, { ...(this.store.agentOptions(agent) || {}), preferredModel: model }); }

  async setAccess(threadId, access) {
    this.store.db.prepare('update threads set access = ? where id = ?').run(access, threadId);
    const live = this.live.get(threadId);
    // Full access answers what's already waiting too, the way it answers what comes next.
    if (access === 'full' && live?.permissions.size) {
      for (const [rpcId, p] of live.permissions) {
        const opts = this.store.item(p.itemId)?.options || [];
        const allow = opts.find((o) => o.kind === 'allow_once') || opts.find((o) => o.kind === 'allow_always');
        if (!allow) continue;
        p.reply.respond({ outcome: { outcome: 'selected', optionId: allow.optionId } });
        live.permissions.delete(rpcId);
        this.resolvePermissionItem(threadId, p.itemId, { outcome: 'selected', optionId: allow.optionId });
      }
      if (!live.permissions.size && this.store.thread(threadId)?.status === 'waiting') this.store.updateThread(threadId, { status: 'running' });
    }
    if (live?.sessionId) {
      await this.applyAccess(threadId, live, access);
      this.saveOptions(threadId, live);
    } else this.threadEvent(threadId);
  }

  // ---------- ACP updates -> timeline ----------

  onNotification(threadId, method, params) {
    const live = this.live.get(threadId);
    if (method !== 'session/update' || !live || live.loading) return;
    if (live.early) { live.early.push(params); return; }
    live.last = Date.now();
    const u = params.update || {};
    // A delegated agent's own session: its updates go in its transcript (items with `worker`), in the
    // turn it was started in. Sessions nobody announced are ignored.
    let worker = null;
    if (params.sessionId && live.sessionId && params.sessionId !== live.sessionId) {
      worker = live.workers.get(params.sessionId);
      if (!worker) return;
    }
    if (!worker && live.banner && u.sessionUpdate === 'agent_message_chunk' && u.content?.text === live.banner) { live.banner = null; return; }
    const run = this.running.get(threadId);
    const turn = worker ? worker.turn : run ? run.turn : this.store.maxTurn(threadId);
    const owner = worker?.sessionId || '';
    const mine = owner ? { worker: owner } : {};
    const chunk = (u.sessionUpdate === 'agent_message_chunk' || u.sessionUpdate === 'agent_thought_chunk') && u.content?.type === 'text';
    // Write pending text first; only a new item (add) ends the message (usage and command updates come mid-message).
    if (!chunk) this.flushText(threadId, { keep: true, owner });
    if (u.sessionUpdate === 'subagent_spawned' || u.sessionUpdate === 'subagent_state_update') return this.onWorker(threadId, live, worker, turn, u);
    if (u.sessionUpdate?.startsWith('async_task_')) return this.onTask(threadId, turn, owner, u);
    // A delegated agent's settings and commands are its own business, not the chat's.
    if (worker && !['agent_message_chunk', 'agent_thought_chunk', 'tool_call', 'tool_call_update', 'plan', 'notice', 'session_info_update'].includes(u.sessionUpdate)) return;
    switch (u.sessionUpdate) {
      case 'agent_message_chunk':
      case 'agent_thought_chunk': {
        const kind = u.sessionUpdate === 'agent_message_chunk' ? 'text' : 'thought';
        const c = u.content || {};
        if (c.type === 'text') {
          if (c.text) this.appendText(threadId, turn, kind, c.text, u.messageId || null, owner);
        } else if (c.type === 'image' && (c.data?.length || 0) > MAX_IMAGE) {
          this.add(threadId, turn, 'notice', { level: '', text: `The agent showed an image too large to keep here (${Math.round(c.data.length * 0.75 / 2 ** 20)} MB).`, ...mine });
        } else if (c.type === 'image' || c.type === 'resource_link') {
          this.add(threadId, turn, 'media', { content: c, ...mine });
        }
        return;
      }
      case 'tool_call':
      case 'tool_call_update': {
        const ref = `tool:${owner ? owner + ':' : ''}${u.toolCallId}`;
        const existing = this.store.itemByRef(threadId, ref);
        const meta = u._meta || {};
        const delta = typeof meta.terminal_output_delta?.data === 'string' ? meta.terminal_output_delta.data : '';
        // Output alone (most of a command's updates): held and written every OUTPUT_MS.
        if (existing && delta && u.sessionUpdate === 'tool_call_update' && Object.keys(u).every((k) => ['sessionUpdate', 'toolCallId', '_meta'].includes(k)) && Object.keys(meta).length === 1) {
          const o = live.outputs.get(ref) || { threadId, itemId: existing.id, text: '', timer: null };
          o.text += delta;
          o.timer ||= setTimeout(() => this.flushOutput(live, ref), OUTPUT_MS);
          live.outputs.set(ref, o);
          return;
        }
        const held = this.takeOutput(live, ref);
        const next = { ...(existing || {}), toolCallId: u.toolCallId, ...mine };
        if (held || delta) next.output = clipTail((next.output || '') + held + delta);
        if (typeof meta.terminal_exit?.exit_code === 'number') next.exitCode = meta.terminal_exit.exit_code;
        // The command went on in the background: the call is done, the work isn't (a 'task' item follows it).
        if (meta.jetbrains?.air?.asyncTasks?.backgrounded === true) next.backgrounded = true;
        for (const k of ['title', 'status', 'locations']) if (u[k] !== undefined) next[k] = u[k];
        if (u.kind !== undefined) next.toolKind = u.kind;
        if (u.rawInput !== undefined && (Object.keys(u.rawInput || {}).length || !next.rawInput)) next.rawInput = clipRaw(u.rawInput);
        if (u.rawOutput !== undefined) next.rawOutput = clipRaw(u.rawOutput);
        if (u.content !== undefined && (u.content.length || !next.content)) next.content = clipContent(u.content);
        const tool = u._meta?.claudeCode?.toolName;
        if (tool) next.tool = tool;
        if (existing) this.itemEvent(this.store.updateItem(existing.id, strip(next)));
        else this.add(threadId, turn, 'tool', strip(next), ref);
        return;
      }
      case 'plan': {
        const ref = `plan:${owner ? owner + ':' : ''}${turn}`;
        const existing = this.store.itemByRef(threadId, ref);
        const data = { entries: u.entries || [], ...mine };
        if (existing) this.itemEvent(this.store.updateItem(existing.id, data));
        else this.add(threadId, turn, 'plan', data, ref);
        return;
      }
      case 'available_commands_update':
        this.store.updateThread(threadId, { commands: (u.availableCommands || []).map((c) => ({ name: c.name, description: c.description, hint: c.input?.hint })) });
        this.threadEvent(threadId);
        return;
      case 'current_mode_update':
        if (!live.options) return; // still starting: connect saves the mode
        live.options.currentMode = u.currentModeId;
        this.saveOptions(threadId, live);
        return;
      case 'config_option_update':
      case 'config_options_update': // the agent changed a setting itself (Claude after a plan is approved, or a clamp)
        if (!live.options || !u.configOptions) return;
        live.options = live.usable(readOptions({ configOptions: u.configOptions }, live.options));
        this.saveOptions(threadId, live);
        return;
      case 'usage_update':
        this.store.updateThread(threadId, { usage: { used: u.used, size: u.size, cost: u.cost } });
        this.threadEvent(threadId);
        return;
      case 'notice': {
        // A warning from the harness (rate limit, a hook, auto mode off): shown in the timeline, never part of the answer.
        const title = typeof u.title === 'string' ? u.title.trim() : '';
        if (!title) return;
        const text = u.description?.trim() ? `${title}: ${u.description.trim()}` : title;
        const last = this.store.lastItem(threadId);
        if (last?.kind === 'notice' && last.turn === turn && last.text === text && last.worker === mine.worker) return;
        // A limit (rate, usage, quota) is something to wait out: a warning, whatever severity it came with.
        this.add(threadId, turn, 'notice', { level: u.severity === 'error' && !LIMIT.test(text) ? 'danger' : u.severity === 'error' || u.severity === 'warning' ? 'warn' : '', text, ...mine });
        return;
      }
      case 'session_info_update': { // a delegated agent's better name
        const name = str(u.title).trim();
        const item = worker && name && this.store.item(worker.itemId);
        if (item) this.itemEvent(this.store.updateItem(item.id, { ...strip(item), name }));
        return;
      }
      default:
        return;
    }
  }

  // A delegated agent started (by the chat's agent or another delegated one), or finished. It shows as an
  // 'agent' item in the turn it started in; nested ones name their parent's session.
  onWorker(threadId, live, worker, turn, u) {
    const parent = worker?.sessionId || null;
    const id = str(u.subagentSessionId, 200);
    if (!id || id === live.sessionId) return;
    const known = live.workers.get(id);
    if (u.sessionUpdate === 'subagent_spawned') {
      if (known) { // announced again: better details, never a new parent
        const item = known.parent === parent && this.store.item(known.itemId);
        if (item) this.itemEvent(this.store.updateItem(item.id, { ...strip(item), name: str(u.name) || item.name, task: str(u.task, 4000) || item.task }));
        return;
      }
      const item = this.add(threadId, turn, 'agent', { sessionId: id, parent, name: str(u.name) || 'Agent', task: str(u.task, 4000), prompt: str(u.prompt, MAX_TEXT), state: 'running', ended: null }, `agent:${id}`, parent || '');
      live.workers.set(id, { sessionId: id, parent, turn, itemId: item.id });
      return;
    }
    if (!known || known.parent !== parent || !WORKER_END.has(u.state)) return;
    this.flushText(threadId, { owner: id });
    this.endWorker(known.itemId, u.state);
  }

  // Work the agent left running after a tool call returned (a backgrounded command), as Claude's and Codex's
  // adapters report it: a 'task' item in the turn of the call that started it, updated until it ends.
  onTask(threadId, turn, owner, u) {
    const id = str(u.asyncTaskId, 200);
    if (!id) return;
    const ref = `task:${owner ? owner + ':' : ''}${id}`;
    const existing = this.store.itemByRef(threadId, ref);
    if (!existing && u.sessionUpdate !== 'async_task_spawned') return; // never announced
    const next = { ...(existing || { state: 'running', ended: null }), taskId: id, ...(owner ? { worker: owner } : {}) };
    for (const k of ['name', 'description', 'taskType', 'toolCallId', 'summary']) if (str(u[k], 4000)) next[k] = str(u[k], 4000);
    if (typeof u.canStop === 'boolean') next.canStop = u.canStop;
    if (typeof u.outputFilePath === 'string' && path.isAbsolute(u.outputFilePath)) next.outputFile = u.outputFilePath;
    if (u.sessionUpdate === 'async_task_state_update' && str(u.state)) {
      next.state = str(u.state, 40);
      next.ended = ['running', 'paused'].includes(next.state) ? null : next.ended || Date.now();
    }
    if (existing) return this.itemEvent(this.store.updateItem(existing.id, strip(next)));
    const tool = next.toolCallId && this.store.itemByRef(threadId, `tool:${owner ? owner + ':' : ''}${next.toolCallId}`);
    this.add(threadId, tool?.turn ?? turn, 'task', strip(next), ref, owner);
  }

  endTask(item, state) {
    if (!item || item.state !== 'running') return;
    this.itemEvent(this.store.updateItem(item.id, { ...strip(item), state, ended: Date.now() }));
  }

  // Command output held since the last write: written now, or handed to the update that's being written.
  takeOutput(live, ref) {
    const o = live.outputs.get(ref);
    if (!o) return '';
    clearTimeout(o.timer);
    live.outputs.delete(ref);
    return o.text;
  }

  flushOutput(live, ref) {
    const o = live.outputs.get(ref);
    const text = this.takeOutput(live, ref);
    const item = o && this.store.item(o.itemId);
    if (item && text) this.itemEvent(this.store.updateItem(item.id, { ...strip(item), output: clipTail((item.output || '') + text) }));
  }

  // A background task's output so far: the end of its output file (Claude), or what its command streamed (Codex).
  taskOutput(threadId, taskId) {
    const items = this.store.items(threadId);
    const t = items.find((i) => i.kind === 'task' && i.taskId === taskId);
    if (!t) return null;
    if (t.outputFile) {
      try {
        const fd = fs.openSync(t.outputFile, 'r');
        try {
          const size = fs.fstatSync(fd).size, len = Math.min(size, TASK_OUTPUT_BYTES);
          const buf = Buffer.alloc(len);
          fs.readSync(fd, buf, 0, len, size - len);
          return { text: buf.toString('utf8'), truncated: size > len, file: t.outputFile };
        } finally { fs.closeSync(fd); }
      } catch { return { text: '', missing: true, file: t.outputFile }; }
    }
    const tool = items.find((i) => i.kind === 'tool' && i.toolCallId === t.toolCallId && (i.worker || '') === (t.worker || ''));
    return { text: tool?.output || '', exitCode: tool?.exitCode ?? null };
  }

  // Stop a background task: the agent's adapter stops it (and tells the agent).
  async stopTask(threadId, taskId) {
    const live = this.live.get(threadId);
    const t = this.store.items(threadId).find((i) => i.kind === 'task' && i.taskId === taskId && i.state === 'running');
    if (!live?.sessionId || !t || t.canStop === false) return false;
    const r = await live.conn.request('_session/async_task/stop', { sessionId: live.sessionId, asyncTaskId: taskId });
    return r?.stopped !== false;
  }

  endWorker(itemId, state) {
    const item = this.store.item(itemId);
    if (!item || item.state !== 'running') return;
    this.itemEvent(this.store.updateItem(itemId, { ...strip(item), state, ended: Date.now() }));
  }

  onRequest(threadId, method, params, reply) {
    const live = this.live.get(threadId);
    if (method !== 'session/request_permission') return reply.fail(-32601, `${method} is not supported by this client`);
    const options = params.options || [];
    const thread = this.store.thread(threadId);
    const turn = this.running.get(threadId)?.turn ?? this.store.maxTurn(threadId);
    if ((thread.access || 'full') === 'full') {
      const allow = options.find((o) => o.kind === 'allow_once') || options.find((o) => o.kind === 'allow_always') || options[0];
      if (allow) return reply.respond({ outcome: { outcome: 'selected', optionId: allow.optionId } });
    }
    // Asked by a delegated agent: say which.
    const w = params.sessionId && live?.workers.get(params.sessionId);
    const by = w ? this.store.item(w.itemId)?.name : null;
    const item = this.add(threadId, turn, 'permission', { toolCall: params.toolCall, options, outcome: null, ...(by ? { by } : {}) }, 'perm:' + reply.id, '');
    live?.permissions.set(reply.id, { reply, itemId: item.id });
    this.store.updateThread(threadId, { status: 'waiting' });
    const t = this.threadEvent(threadId);
    this.onWaiting?.(t, params.toolCall?.title || 'an action');
  }

  answerPermission(threadId, itemId, optionId) {
    const live = this.live.get(threadId);
    if (!live) throw new Error('the agent is no longer running');
    for (const [rpcId, p] of live.permissions) {
      if (p.itemId !== Number(itemId)) continue;
      p.reply.respond(optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } });
      live.permissions.delete(rpcId);
      this.resolvePermissionItem(threadId, p.itemId, optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' });
      this.store.updateThread(threadId, { status: live.permissions.size ? 'waiting' : 'running' });
      this.threadEvent(threadId);
      return true;
    }
    throw new Error('that request was already answered');
  }

  resolvePermissionItem(threadId, itemId, outcome) {
    const item = this.store.item(itemId);
    if (!item || item.outcome) return;
    const { id, threadId: _t, turn, kind, ref, created, updated, ...data } = item; // eslint-disable-line no-unused-vars
    this.itemEvent(this.store.updateItem(itemId, { ...data, outcome }));
  }
}

// Text added to a streamed message. Chunks of one message are joined as they are (a chunk can start with
// the closing ** of bold text: "repo." + "** The…"). Some agents send consecutive messages with no ids
// and no separator ("done.Next…"): only then guess a paragraph break, and never inside code.
function glue(s, messageId, text) {
  if (messageId && s.messageId === messageId) return '';
  if (!/[.!?:)]$/.test(s.text) || !/^[A-Z`#]/.test(text)) return '';
  const fences = (s.text.match(/^\s*(```|~~~)/gm) || []).length;
  const ticks = (s.text.slice(s.text.lastIndexOf('\n') + 1).match(/`/g) || []).length;
  return fences % 2 || ticks % 2 ? '' : '\n\n';
}

// `@path` mentions of files in the chat's folder go to the agent as resource links, in place (the way
// editors send them); other @words stay text.
export function mentionBlocks(text, cwd) {
  const blocks = [];
  let last = 0;
  for (const m of text.matchAll(/(^|\s)@(\S+)/g)) {
    const rel = m[2].replace(/[.,;:!?)\]]+$/, ''); // "see @a.js." : the period isn't part of it
    const abs = path.resolve(cwd, rel);
    if (!abs.startsWith(cwd + path.sep)) continue;
    try { if (!fs.statSync(abs).isFile()) continue; } catch { continue; }
    const at = m.index + m[1].length;
    if (at > last) blocks.push({ type: 'text', text: text.slice(last, at) });
    blocks.push({ type: 'resource_link', uri: `file://${encodeURI(abs)}`, name: path.basename(rel) });
    last = at + 1 + rel.length;
  }
  if (last < text.length || !blocks.length) blocks.push({ type: 'text', text: text.slice(last) });
  return blocks;
}

// The files in a folder, for the composer's @ picker: git's tracked and unignored files, or (outside a
// repo) a short walk that skips dependencies and hidden folders.
const MAX_FILES = 20000;
export function listFiles(dir) {
  try {
    const out = execFileSync('git', ['-C', dir, 'ls-files', '-co', '--exclude-standard', '-z'], { encoding: 'utf8', maxBuffer: 64 * 2 ** 20, stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\0').filter(Boolean).slice(0, MAX_FILES);
  } catch {}
  const files = [];
  const walk = (rel, depth) => {
    let entries;
    try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (files.length >= MAX_FILES) return;
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '__pycache__') continue;
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (depth < 6) walk(p, depth + 1); } else if (e.isFile()) files.push(p);
    }
  };
  walk('', 0);
  return files;
}

// What a user item says: its text, context and images (not whether it's queued).
const message = (i) => ({ text: i.text, context: i.context, ...(i.images ? { images: i.images } : {}) });

// Item columns that shouldn't be written back into an item's data.
function strip(o) {
  const { id, threadId, turn, ref, created, updated, kind, ...rest } = o;
  return rest;
}

export function titleFrom(text) {
  const line = text.trim().split('\n')[0].replace(/\s+/g, ' ');
  if (line.length <= 60) return line;
  const cut = line.slice(0, 60);
  return cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : 60) + '…';
}

// The owner's memory (~/home/notes/memory.md) for a fresh session. Claude started in ~/home already
// has it (CLAUDE.md imports it); other agents can't import files, and agents started elsewhere don't
// read ~/home's instructions at all.
export function memoryText(agent, cwd, file) {
  if (!file) return null;
  const home = path.dirname(path.dirname(file));
  if (agent === 'claude' && (cwd === home || cwd?.startsWith(home + path.sep))) return null;
  let text;
  try { text = fs.readFileSync(file, 'utf8').trim(); } catch { return null; }
  return text ? `[Memory from Springroll: ${file.replace(HOME, '~')}; what every agent should know about the owner; add lasting facts there, one line each]\n${text}` : null;
}

function contextText(c) {
  const parts = [];
  if (c.view) parts.push(`The owner is looking at the ${c.title || c.view} View (source: ${c.source || '~/home/views/' + c.view}${c.page ? ', page ' + c.page : ''}). "This" probably means that.`);
  else if (c.page) parts.push(`The owner is looking at Springroll's ${c.title || 'home'} page (${c.page}; Springroll's code is ${c.source || '~/home/views/desk'}). "This" probably means that.`);
  if (c.files?.length) parts.push(`Attached files: ${c.files.join(', ')}`);
  if (c.note) parts.push(c.note);
  return `[Context from Springroll] ${parts.join(' ')}`;
}

// Thread manager: runs each thread's agent over ACP, turns ACP updates into
// timeline items, handles permissions, queued messages and resuming.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { AcpConnection } from './acp.mjs';

const HOME = os.homedir();
const MAX_TEXT = 24000;
const IDLE_MS = 15 * 60 * 1000;
 // Scopes need the user's systemd manager (present when agentd runs as a user service).
const SCOPES = (() => { try { execFileSync('systemctl', ['--user', 'show-environment'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const MEMORY_HIGH = `${Math.round((os.totalmem() / 2 ** 20) * 0.6)}M`;
const START_MS = 60 * 1000;
// Stop asks the agent to cancel; it finishes the tool it's in first. One that hasn't stopped by then is closed.
const CANCEL_MS = 30 * 1000;
// Streamed text is written and sent at most this often (and at once past FLUSH_CHARS unsent).
const FLUSH_MS = 100;
const FLUSH_CHARS = 64000;
const FULL_MODES = ['bypassPermissions', 'agent-full-access', 'full-access', 'yolo', 'full', 'agent-full'];
// "Ask first": the harness's mode that asks before acting (Claude's default, Codex's agent).
const ASK_MODES = ['default', 'agent', 'auto', 'manual', 'ask', 'ask-first'];
const clip = (s) => (typeof s === 'string' && s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + `\n… (${s.length - MAX_TEXT} more characters)` : s);

function clipContent(content) {
  if (!Array.isArray(content)) return content;
  return content.map((c) => {
    if (c.type === 'content' && c.content?.type === 'text') return { ...c, content: { ...c.content, text: clip(c.content.text) } };
    if (c.type === 'diff') return { ...c, oldText: clip(c.oldText), newText: clip(c.newText) };
    return c;
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
  const o = { models: [], currentModel: null, source: null, effort: null, modes: [], currentMode: null, extra: [] };
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

// The environment agents run with: the owner's shell env file (tokens, PATH)
// and connected services' secrets.
export function agentEnv() {
  try {
    const out = execFileSync('bash', ['-c', `. "${HOME}/.config/springroll/env" 2>/dev/null; [ -f "${HOME}/.config/springroll/secrets.env" ] && set -a && . "${HOME}/.config/springroll/secrets.env"; env -0`], { encoding: 'utf8' });
    return Object.fromEntries(out.split('\0').filter(Boolean).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  } catch { return { ...process.env }; }
}

export class ThreadManager {
  constructor({ store, agents, emit, notify, mcpServers }) {
    this.store = store;
    this.agents = agents;        // () => registry entries
    this.emit = emit;            // (event) => broadcast to clients
    this.notify = notify;        // (thread, text) => phone notification
    this.mcpServers = mcpServers; // () => ACP mcpServers for new sessions
    this.live = new Map();       // threadId -> { conn, sessionId, loading, last, permissions: Map }
    this.running = new Map();    // threadId -> { started, turn }
    this.cancelled = new Set();  // threads stopped while their agent was still starting
    this.streams = new Map();    // threadId -> the text item being streamed: { id, kind, turn, messageId, text, sent, dirty, timer }
    setInterval(() => this.reapIdle(), 60000).unref();
    // Anything that was mid-turn when agentd stopped is over now.
    for (const t of store.threads()) {
      if (t.status === 'running' || t.status === 'waiting' || t.status === 'starting') {
        const turn = store.maxTurn(t.id);
        store.addItem(t.id, turn, 'turn', { stopReason: 'interrupted', note: 'Stopped when the agent service restarted.' });
        store.updateThread(t.id, { status: 'idle' });
      }
    }
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

  // A new timeline item. Streamed text is written first, so items stay in the order they happened.
  add(threadId, turn, kind, data, ref = null) {
    this.flushText(threadId);
    return this.itemEvent(this.store.addItem(threadId, turn, kind, data, ref));
  }

  // Streamed text is held in memory and written every FLUSH_MS, not per chunk (a long answer is
  // thousands of chunks). Clients get what was added since the last write ('append'), or the whole
  // item if it changed some other way (a key masked across a chunk boundary).
  appendText(threadId, turn, kind, text, messageId) {
    let s = this.streams.get(threadId);
    const same = s && s.kind === kind && s.turn === turn && (!messageId || !s.messageId || s.messageId === messageId);
    if (!same) {
      const item = this.add(threadId, turn, kind, { text, messageId });
      this.streams.set(threadId, { id: item.id, kind, turn, messageId, text, sent: item.text, dirty: false, timer: null });
      return;
    }
    s.text += glue(s, messageId, text) + text;
    s.messageId ||= messageId;
    s.dirty = true;
    if (s.text.length - s.sent.length > FLUSH_CHARS) this.flushText(threadId, { keep: true });
    else s.timer ||= setTimeout(() => this.flushText(threadId, { keep: true }), FLUSH_MS);
  }

  // Write the streamed text; unless keep, the next chunk starts a new item.
  flushText(threadId, { keep = false } = {}) {
    const s = this.streams.get(threadId);
    if (!s) return;
    clearTimeout(s.timer);
    s.timer = null;
    if (!keep) this.streams.delete(threadId);
    if (!s.dirty) return;
    s.dirty = false;
    const item = this.store.updateItem(s.id, { text: s.text, messageId: s.messageId });
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
    const conn = new AcpConnection({ command, args, cwd: thread.cwd, env: { ...agentEnv(), SPRINGROLL_THREAD: thread.id }, scope: SCOPES ? `agentd-${thread.id}-${Date.now().toString(36)}` : null, memoryHigh: MEMORY_HIGH });
    // early: updates that arrive before session/new returns, held until we know what to drop (Pi's banner).
    const live = { conn, sessionId: null, loading: false, last: Date.now(), permissions: new Map(), early: [] };
    this.live.set(thread.id, live);
    conn.on('notification', (method, params) => this.onNotification(thread.id, method, params));
    conn.on('request', (method, params, reply) => this.onRequest(thread.id, method, params, reply));
    conn.on('close', (err) => {
      this.flushText(thread.id);
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
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, session: { notices: {} } },
      clientInfo: { name: 'springroll', title: 'Springroll', version: '0.1' },
    });
    live.capabilities = init?.agentCapabilities || {};
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
    live.options = readOptions(session);
    const prefs = this.store.agentOptions(thread.agent) || {};
    if (live.options.models.length || live.options.effort) this.store.setAgentOptions(thread.agent, { ...prefs, models: live.options.models, currentModel: live.options.currentModel, effort: live.options.effort });
    const t = this.store.thread(thread.id);
    this.store.updateThread(thread.id, { session_id: session.sessionId });
    await this.applyAccess(thread.id, live, t.access || 'full');
    // The thread's model (chosen in it, or by its job), else for a new chat the one the owner last picked for this agent.
    const model = t.model || (!thread.session_id && prefs.preferredModel);
    if (model && model !== live.options.currentModel && live.options.models.some((m) => m.id === model)) await this.setOption(thread.id, 'model', model, { live });
    if (t.effort && live.options.effort && t.effort !== live.options.effort.current) await this.setOption(thread.id, 'effort', t.effort, { live });
    this.saveOptions(thread.id, live);
    return live;
  }

  // What the agent says it's using now, saved on the thread (a reconnect asks for the same) and shown.
  saveOptions(threadId, live) {
    const o = live.options;
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
      if (res?.configOptions) live.options = readOptions(res, o);
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

  reapIdle() {
    for (const [id, live] of this.live) {
      if (!this.running.has(id) && Date.now() - live.last > IDLE_MS) {
        live.conn.kill();
        this.live.delete(id);
        this.threadEvent(id);
      }
    }
  }

  stop(threadId) {
    const live = this.live.get(threadId);
    if (live) { live.stopping = true; live.conn.kill(); this.live.delete(threadId); }
  }

  shutdown() {
    for (const id of [...this.streams.keys()]) this.flushText(id);
    for (const live of this.live.values()) live.conn.kill();
  }

  // ---------- Prompting ----------

  async prompt(threadId, { text, context }) {
    const thread = this.store.thread(threadId);
    if (!thread) throw new Error('no such thread');
    if (!text?.trim()) throw new Error('empty message');
    if (!thread.title) this.store.updateThread(threadId, { title: titleFrom(text) });
    if (this.running.has(threadId)) {
      // Queue it: sent when the current turn ends.
      this.add(threadId, this.running.get(threadId).turn + 1, 'user', { text, context, queued: true });
      this.threadEvent(threadId);
      return { queued: true };
    }
    const turn = this.store.maxTurn(threadId) + 1;
    this.add(threadId, turn, 'user', { text, context });
    this.run(threadId, turn, [{ text, context }]);
    return { queued: false };
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
      for (const m of messages) {
        if (m.context) prompt.push({ type: 'text', text: contextText(m.context) });
        prompt.push({ type: 'text', text: m.text });
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
      for (const q of queued) this.itemEvent(this.store.updateItem(q.id, { text: q.text, context: q.context, unsent: true }));
    } else if (queued.length) {
      for (const q of queued) this.store.updateItem(q.id, { text: q.text, context: q.context });
      const next = this.store.maxTurn(threadId);
      this.store.db.prepare("update items set turn = ? where thread_id = ? and kind = 'user' and turn > ?").run(next, threadId, turn);
      for (const q of queued) this.itemEvent(this.store.item(q.id));
      this.run(threadId, next, queued.map((q) => ({ text: q.text, context: q.context })));
    }
  }

  // The turn's final message: the text after the last tool call (the answer,
  // not the narration before the work).
  lastText(threadId, turn) {
    const items = this.store.items(threadId).filter((i) => i.turn === turn && i.kind !== 'turn');
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
      this.add(threadId, run.turn, 'notice', { level: 'warn', text: `${name} didn't stop within ${CANCEL_MS / 1000}s, so it was closed. Your next message picks the conversation up again.` });
      this.cancelled.add(threadId);
      this.stop(threadId);
    }, CANCEL_MS).unref();
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
    if (live.banner && u.sessionUpdate === 'agent_message_chunk' && u.content?.text === live.banner) { live.banner = null; return; }
    const run = this.running.get(threadId);
    const turn = run ? run.turn : this.store.maxTurn(threadId);
    const chunk = (u.sessionUpdate === 'agent_message_chunk' || u.sessionUpdate === 'agent_thought_chunk') && u.content?.type === 'text';
    if (!chunk) this.flushText(threadId); // a tool call or plan comes after the text before it
    switch (u.sessionUpdate) {
      case 'agent_message_chunk':
      case 'agent_thought_chunk': {
        const kind = u.sessionUpdate === 'agent_message_chunk' ? 'text' : 'thought';
        const c = u.content || {};
        if (c.type === 'text') {
          if (c.text) this.appendText(threadId, turn, kind, c.text, u.messageId || null);
        } else if (c.type === 'image' || c.type === 'resource_link') {
          this.add(threadId, turn, 'media', { content: c });
        }
        return;
      }
      case 'tool_call':
      case 'tool_call_update': {
        const ref = 'tool:' + u.toolCallId;
        const existing = this.store.itemByRef(threadId, ref);
        const next = { ...(existing || {}), toolCallId: u.toolCallId };
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
        const ref = 'plan:' + turn;
        const existing = this.store.itemByRef(threadId, ref);
        const data = { entries: u.entries || [] };
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
        live.options = readOptions({ configOptions: u.configOptions }, live.options);
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
        if (last?.kind === 'notice' && last.turn === turn && last.text === text) return;
        this.add(threadId, turn, 'notice', { level: u.severity === 'error' ? 'danger' : u.severity === 'warning' ? 'warn' : '', text });
        return;
      }
      default:
        return;
    }
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
    const item = this.add(threadId, turn, 'permission', { toolCall: params.toolCall, options, outcome: null }, 'perm:' + reply.id);
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

function contextText(c) {
  const parts = [];
  if (c.view) parts.push(`The owner is looking at the ${c.title || c.view} View (source: ${c.source || '~/home/views/' + c.view}${c.page ? ', page ' + c.page : ''}). "This" probably means that.`);
  else if (c.page) parts.push(`The owner is looking at Springroll's ${c.title || 'home'} page (${c.page}; Springroll's code is ${c.source || '~/home/views/desk'}). "This" probably means that.`);
  if (c.files?.length) parts.push(`Attached files: ${c.files.join(', ')}`);
  if (c.note) parts.push(c.note);
  return `[Context from Springroll] ${parts.join(' ')}`;
}

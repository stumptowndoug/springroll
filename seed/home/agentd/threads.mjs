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
const FULL_MODES = ['bypassPermissions', 'agent-full-access', 'full-access', 'yolo', 'full', 'agent-full'];
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

// The environment agents run with: the owner's shell env file (tokens, PATH)
// and connected services' secrets.
export function agentEnv() {
  try {
    const out = execFileSync('bash', ['-c', `. "${HOME}/.config/agentos/env" 2>/dev/null; [ -f "${HOME}/.config/agentos/secrets.env" ] && set -a && . "${HOME}/.config/agentos/secrets.env"; env -0`], { encoding: 'utf8' });
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
    if (t) this.emit({ type: 'thread', thread: { ...t, running: this.running.has(id), live: this.live.has(id) } });
    return t;
  }

  itemEvent(item) { if (item) this.emit({ type: 'item', item }); return item; }

  // ---------- Connection lifecycle ----------

  async connect(thread) {
    const existing = this.live.get(thread.id);
    if (existing && !existing.conn.closed) return existing;
    const def = this.agentDef(thread.agent);
    const [command, ...args] = def.acp;
    const conn = new AcpConnection({ command, args, cwd: thread.cwd, env: agentEnv(), scope: SCOPES ? `agentd-${thread.id}-${Date.now().toString(36)}` : null, memoryHigh: MEMORY_HIGH });
    const live = { conn, sessionId: null, loading: false, last: Date.now(), permissions: new Map() };
    this.live.set(thread.id, live);
    conn.on('notification', (method, params) => this.onNotification(thread.id, method, params));
    conn.on('request', (method, params, reply) => this.onRequest(thread.id, method, params, reply));
    conn.on('close', (err) => {
      if (this.live.get(thread.id) === live) this.live.delete(thread.id);
      for (const p of live.permissions.values()) this.resolvePermissionItem(thread.id, p.itemId, { outcome: 'cancelled' });
      if (this.running.has(thread.id)) {
        this.store.addItem(thread.id, this.running.get(thread.id).turn, 'notice', { level: 'danger', text: `The agent stopped unexpectedly. ${err.message}` });
      }
      this.threadEvent(thread.id);
    });

    const init = await conn.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'agentos', title: 'Springroll', version: '0.1' },
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
        this.itemEvent(this.store.addItem(thread.id, this.store.maxTurn(thread.id), 'notice', { level: 'warn', text: `Couldn't resume the previous ${def.name} session (${e.message}); started a fresh one. Earlier messages are still shown here but the agent won't remember them.` }));
      }
      live.loading = false;
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
    const fields = { session_id: session.sessionId };
    // Models, effort and modes, for the composer's pickers. All come from the
    // adapter, so they're whatever the harness offers today. Config options
    // first: they list each model once (the models list may repeat a model per
    // effort level, e.g. codex-acp's "gpt-6-sol[high]").
    const options = { models: [], currentModel: null, modes: [], source: null, effort: null };
    const cfg = (session.configOptions || []).find((o) => o.category === 'model' || o.id === 'model');
    if (cfg?.options?.length) {
      options.models = cfg.options.map((o) => ({ id: o.value, name: o.name, description: o.description }));
      options.currentModel = cfg.currentValue;
      options.source = 'config';
      options.configId = cfg.id;
    } else if (session.models?.availableModels?.length) {
      options.models = session.models.availableModels.map((m) => ({ id: m.modelId, name: m.name, description: m.description }));
      options.currentModel = session.models.currentModelId;
      options.source = 'models';
    }
    const eff = (session.configOptions || []).find((o) => o.category === 'thought_level');
    if (eff?.options?.length) options.effort = { configId: eff.id, current: eff.currentValue, values: eff.options.map((o) => ({ id: o.value, name: o.name })) };
    if (session.modes?.availableModes) options.modes = session.modes.availableModes.map((m) => ({ id: m.id, name: m.name, description: m.description }));
    live.options = options;
    fields.model = options.currentModel;
    fields.mode = session.modes?.currentModeId || null;
    // Full access: the box is the sandbox. Switch to the harness's full mode if it has one.
    const t = this.store.thread(thread.id);
    if ((t.access || 'full') === 'full' && session.modes?.availableModes) {
      const full = FULL_MODES.find((id) => session.modes.availableModes.some((m) => m.id === id));
      if (full && full !== session.modes.currentModeId) {
        try { await conn.request('session/set_mode', { sessionId: session.sessionId, modeId: full }); fields.mode = full; } catch {}
      }
    }
    if (t.model && t.model !== options.currentModel) await this.applyModel(thread.id, t.model).catch(() => {});
    if (t.effort && options.effort && t.effort !== options.effort.current) {
      await conn.request('session/set_config_option', { sessionId: session.sessionId, configId: options.effort.configId, value: t.effort }).then(() => (options.effort.current = t.effort), () => {});
    }
    this.store.updateThread(thread.id, fields);
    this.store.db.prepare('update threads set options = ? where id = ?').run(JSON.stringify(options), thread.id);
    this.threadEvent(thread.id);
    return live;
  }

  async applyModel(threadId, modelId) {
    const live = this.live.get(threadId);
    if (!live) return;
    if (live.options?.source === 'models') await live.conn.request('session/set_model', { sessionId: live.sessionId, modelId });
    else if (live.options?.source === 'config') await live.conn.request('session/set_config_option', { sessionId: live.sessionId, configId: live.options.configId, value: modelId });
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
    if (live) { live.conn.kill(); this.live.delete(threadId); }
  }

  shutdown() { for (const live of this.live.values()) live.conn.kill(); }

  // ---------- Prompting ----------

  async prompt(threadId, { text, context }) {
    const thread = this.store.thread(threadId);
    if (!thread) throw new Error('no such thread');
    if (!text?.trim()) throw new Error('empty message');
    if (!thread.title) this.store.updateThread(threadId, { title: titleFrom(text) });
    if (this.running.has(threadId)) {
      // Queue it: sent when the current turn ends.
      this.itemEvent(this.store.addItem(threadId, this.running.get(threadId).turn + 1, 'user', { text, context, queued: true }));
      this.threadEvent(threadId);
      return { queued: true };
    }
    const turn = this.store.maxTurn(threadId) + 1;
    this.itemEvent(this.store.addItem(threadId, turn, 'user', { text, context }));
    this.run(threadId, turn, [{ text, context }]);
    return { queued: false };
  }

  async run(threadId, turn, messages) {
    const started = Date.now();
    this.running.set(threadId, { started, turn });
    this.store.updateThread(threadId, { status: 'starting', updated: started, error: null });
    this.threadEvent(threadId);
    let stopReason = 'end_turn', error = null;
    try {
      const live = await this.connect(this.store.thread(threadId));
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
      error = e.message;
      stopReason = 'error';
    }
    const duration = Date.now() - started;
    this.running.delete(threadId);
    this.itemEvent(this.store.addItem(threadId, turn, 'turn', { stopReason, durationMs: duration, error }));
    const last = this.lastText(threadId, turn);
    this.store.updateThread(threadId, { status: error ? 'error' : 'idle', error, updated: Date.now(), preview: last ? last.slice(0, 200) : undefined });
    const t = this.threadEvent(threadId);
    this.onTurnEnd?.(t, { stopReason, error, duration, text: last });
    // Send anything queued while it was working.
    const queued = this.store.items(threadId).filter((i) => i.kind === 'user' && i.queued && i.turn > turn);
    if (queued.length) {
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
    live.conn.notify('session/cancel', { sessionId: live.sessionId });
    for (const [rpcId, p] of live.permissions) {
      p.reply.respond({ outcome: { outcome: 'cancelled' } });
      this.resolvePermissionItem(threadId, p.itemId, { outcome: 'cancelled' });
      live.permissions.delete(rpcId);
    }
    return true;
  }

  async setEffort(threadId, value) {
    this.store.db.prepare('update threads set effort = ? where id = ?').run(value, threadId);
    const live = this.live.get(threadId);
    const eff = live?.options?.effort;
    if (eff) {
      await live.conn.request('session/set_config_option', { sessionId: live.sessionId, configId: eff.configId, value }).catch(() => {});
      eff.current = value;
      this.store.db.prepare('update threads set options = ? where id = ?').run(JSON.stringify(live.options), threadId);
    }
    this.threadEvent(threadId);
  }

  async setModel(threadId, modelId) {
    this.store.updateThread(threadId, { model: modelId });
    await this.applyModel(threadId, modelId).catch(() => {});
    this.threadEvent(threadId);
  }

  // ---------- ACP updates -> timeline ----------

  onNotification(threadId, method, params) {
    const live = this.live.get(threadId);
    if (method !== 'session/update' || !live || live.loading) return;
    live.last = Date.now();
    const u = params.update || {};
    const run = this.running.get(threadId);
    const turn = run ? run.turn : this.store.maxTurn(threadId);
    switch (u.sessionUpdate) {
      case 'agent_message_chunk':
      case 'agent_thought_chunk': {
        const kind = u.sessionUpdate === 'agent_message_chunk' ? 'text' : 'thought';
        const c = u.content || {};
        if (c.type === 'text') {
          if (!c.text) return;
          const last = this.store.lastItem(threadId);
          const msgId = u.messageId || null;
          const sameMessage = last && last.kind === kind && last.turn === turn && (!msgId || !last.messageId || last.messageId === msgId);
          if (sameMessage) {
            // Some agents send consecutive messages with no separator ("done.Next…").
            const glue = /[.!?:)]$/.test(last.text) && /^[A-Z`*#]/.test(c.text) ? '\n\n' : '';
            this.itemEvent(this.store.updateItem(last.id, { text: last.text + glue + c.text, messageId: last.messageId || msgId }));
          } else this.itemEvent(this.store.addItem(threadId, turn, kind, { text: c.text, messageId: msgId }));
        } else if (c.type === 'image' || c.type === 'resource_link') {
          this.itemEvent(this.store.addItem(threadId, turn, 'media', { content: c }));
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
        else this.itemEvent(this.store.addItem(threadId, turn, 'tool', strip(next), ref));
        return;
      }
      case 'plan': {
        const ref = 'plan:' + turn;
        const existing = this.store.itemByRef(threadId, ref);
        const data = { entries: u.entries || [] };
        if (existing) this.itemEvent(this.store.updateItem(existing.id, data));
        else this.itemEvent(this.store.addItem(threadId, turn, 'plan', data, ref));
        return;
      }
      case 'available_commands_update':
        this.store.updateThread(threadId, { commands: (u.availableCommands || []).map((c) => ({ name: c.name, description: c.description, hint: c.input?.hint })) });
        return;
      case 'current_mode_update':
        this.store.updateThread(threadId, { mode: u.currentModeId });
        this.threadEvent(threadId);
        return;
      case 'usage_update':
        this.store.updateThread(threadId, { usage: { used: u.used, size: u.size, cost: u.cost } });
        return;
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
    const item = this.itemEvent(this.store.addItem(threadId, turn, 'permission', { toolCall: params.toolCall, options, outcome: null }, 'perm:' + reply.id));
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

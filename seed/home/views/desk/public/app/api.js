// Shared client state and live events for Springroll.
//   desk events  (/api/events):       views, show, notify, settings, agent, sessions
//   agent events (/api/agent/events): thread, item, append (streamed text), removed (a queued message taken back), jobs, signals, deleted
export const bus = new EventTarget();
export const on = (type, fn) => { const h = (e) => fn(e.detail); bus.addEventListener(type, h); return () => bus.removeEventListener(type, h); };
const fire = (type, detail) => bus.dispatchEvent(new CustomEvent(type, { detail }));

async function req(method, path, body) {
  const r = await fetch(path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await r.json(); } catch {}
  if (!r.ok) throw new Error(data?.error || `${r.status} ${r.statusText}`);
  return data;
}
export const api = {
  get: (p) => req('GET', p), post: (p, b = {}) => req('POST', p, b), patch: (p, b) => req('PATCH', p, b), del: (p) => req('DELETE', p),
};

// A limit (rate, usage, quota) is something to wait out, not a breakage: a warning, not an error.
const LIMIT = /rate[ -]?limit|usage limit|quota|too many requests|\b429\b|overloaded|credit balance|out of credits/i;
export const errorLevel = (text) => (LIMIT.test(text || '') ? 'warn' : 'danger');

export const state = { views: [], threads: [], agents: [], jobs: [], signals: [], folders: ['~/home'], archived: false };

export async function loadThreads() {
  state.threads = await api.get(`api/agent/threads${state.archived ? '?archived=1' : ''}`).catch(() => state.threads);
  fire('threads', state.threads);
}
export async function loadAgents() {
  state.agents = await api.get('api/agents').catch(() => state.agents);
  fire('agents', state.agents);
}
export async function loadJobs() {
  state.jobs = await api.get('api/agent/jobs').catch(() => state.jobs);
  fire('jobs', state.jobs);
}
export async function loadSignals() {
  state.signals = await api.get('api/agent/signals').catch(() => state.signals);
  fire('signals', state.signals);
}
export async function loadFolders() {
  const r = await api.get('api/sessions').catch(() => null);
  if (r?.folders) state.folders = r.folders;
}

export function upsertThread(t) {
  const i = state.threads.findIndex((x) => x.id === t.id);
  if (t.archived !== state.archived) { if (i >= 0) state.threads.splice(i, 1); }
  else if (i >= 0) state.threads[i] = t;
  else state.threads.unshift(t);
  state.threads.sort((a, b) => (b.pinned - a.pinned) || (b.updated - a.updated));
  fire('threads', state.threads);
}

// Agents that can chat: installed, with an ACP mode. Signed-in ones first.
export const chatAgents = () => state.agents.filter((a) => a.installed && a.acpInstalled).sort((a, b) => b.signedIn - a.signedIn);
export const agentName = (id) => state.agents.find((a) => a.id === id)?.name || (id === 'shell' ? 'Shell' : id);
export function defaultAgent() {
  const pref = desk.settings?.defaultAgent;
  const ok = chatAgents().filter((a) => a.signedIn);
  return (ok.find((a) => a.id === pref) || ok.find((a) => a.id === 'claude') || ok[0] || chatAgents()[0])?.id || 'claude';
}

export function connect() {
  const desk = new EventSource('api/events');
  for (const t of ['views', 'show', 'notify', 'settings', 'agent', 'sessions', 'go', 'connections']) desk.addEventListener(t, (e) => fire('desk:' + t, JSON.parse(e.data)));
  const agent = new EventSource('api/agent/events');
  agent.onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'thread') upsertThread(ev.thread);
    if (ev.type === 'deleted') { state.threads = state.threads.filter((t) => t.id !== ev.threadId); fire('threads', state.threads); }
    if (ev.type === 'jobs') loadJobs();
    if (ev.type === 'signals') loadSignals();
    fire('agent:' + ev.type, ev);
  };
  // Reconnected after a drop: whatever happened meanwhile wasn't sent here, so open chats reload.
  let opened = false;
  agent.onopen = () => { loadThreads(); loadJobs(); loadSignals(); if (opened) fire('agent:reconnect'); opened = true; };
}

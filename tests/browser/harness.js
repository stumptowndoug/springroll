// The actual chat UI, with an in-memory backend and the same event bus as SSE.
import { api, bus, state } from '/app/api.js';
import * as thread from '/app/thread.js';

window.desk = { settings: { defaultAgent: 'claude' } };
state.agents = [{ id: 'claude', name: 'Claude Code', installed: true, acpInstalled: true, signedIn: true }];
let seq = 0;
const chats = new Map();
const backgrounds = new Map();
const posts = [];
const emit = (type, detail) => bus.dispatchEvent(new CustomEvent('agent:' + type, { detail }));
function model(id) {
  if (!chats.has(id)) chats.set(id, {
    thread: { id, agent: 'claude', title: 'Make chat easier to follow', cwd: '~/home', running: true, status: 'running', access: 'full', options: { models: [] } },
    items: [],
  });
  return chats.get(id);
}
api.get = async (url) => {
  const bg = url.match(/threads\/([^/]+)\/background$/)?.[1];
  if (bg) return { items: backgrounds.get(bg) || [] };
  if (url.endsWith('/output')) return { text: 'Checked deployment: still building.\n', missing: false };
  const id = url.match(/threads\/([^/]+)$/)?.[1];
  return id ? structuredClone(model(id)) : { models: [], effort: null };
};
api.post = async (url, body) => { posts.push({ url, body }); return { ok: true }; };
api.patch = async () => ({});
const ctx = { go() {}, threadMenu() {}, viewContext() {} };
const item = (data, id = 'main') => {
  const m = model(id);
  const next = { id: ++seq, threadId: id, turn: 1, created: Date.now() - 2000, ...data, updated: Date.now() + seq };
  const at = m.items.findIndex((i) => i.id === next.id);
  if (at === -1) m.items.push(next); else m.items[at] = next;
  emit('item', { item: structuredClone(next) });
  return next.id;
};
function status(patch, id = 'main') {
  Object.assign(model(id).thread, patch);
  emit('thread', { thread: structuredClone(model(id).thread) });
}
window.chatTest = {
  item, status, posts,
  background(items, id = 'main') { backgrounds.set(id, items); },
  finish() { item({ kind: 'turn', stopReason: 'end_turn', durationMs: 4200 }); status({ running: false, status: 'idle' }); },
  async theme(name) {
    const themes = await fetch('/ui/themes.json').then((r) => r.json());
    const theme = themes.find((t) => t.id === 'springroll-' + name);
    for (const [key, value] of Object.entries(theme.colors)) document.documentElement.style.setProperty('--' + key, value);
    document.documentElement.dataset.appearance = name;
    document.documentElement.style.colorScheme = name;
  },
  panel(only = false) {
    document.body.classList.toggle('panel-only', only);
    item({ kind: 'user', text: 'Check the tests' }, 'panel');
    thread.mountPanel(document.querySelector('#panel'), { id: 'panel', ctx });
  },
  closePanel() { thread.unmountPanel(); },
  reopen(id = 'main') { thread.show(null, { id }); },
};
item({ kind: 'user', text: 'Clean up the chat so I can follow the answer.' });
thread.init(document.querySelector('#chat'), ctx);
thread.show(null, { id: 'main' });

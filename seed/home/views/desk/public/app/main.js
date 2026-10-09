// Springroll shell: router, sidebar, View frames, the ask panel, launcher and shortcuts.
import { api, state, on, connect, loadThreads, loadAgents, loadJobs, loadFolders, agentName } from './api.js';
import * as Home from './home.js';
import * as Thread from './thread.js';
import * as Jobs from './jobs.js';
import * as Connections from './connections.js';
import * as Terminal from './terminal.js';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const shell = $('shell');
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const mobile = () => innerWidth <= 860;

/* ---------- Pages ---------- */
const PAGES = { home: Home, thread: Thread, jobs: Jobs, connections: Connections, terminal: Terminal };
const pageEls = {};
const viewFrames = new Map();
let current = null; // { page, params, view }

function pageEl(name, flex = false) {
  if (!pageEls[name]) {
    const el = document.createElement('div');
    el.className = 'page' + (flex ? ' flex' : '');
    el.dataset.page = name;
    $('pages').appendChild(el);
    pageEls[name] = el;
    PAGES[name]?.init?.(el, ctx);
  }
  return pageEls[name];
}

function parse(hash) {
  const raw = hash.replace(/^#/, '');
  // A View route keeps everything after its name as the View's own anchor: #/v/files#p=/a/b?c
  const vm = raw.match(/^\/v\/([^/#?]+)\/?(?:#(.*))?$/);
  if (vm) return { page: 'view', view: vm[1], anchor: vm[2] || null, q: {} };
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const q = Object.fromEntries(new URLSearchParams(query));
  if (!parts.length) return { page: 'home', q };
  if (parts[0] === 't') return { page: 'thread', id: parts[1], q };
  if (parts[0] === 'new') return { page: 'thread', id: null, q };
  if (parts[0] === 'jobs') return { page: 'jobs', name: parts[1] || null, q };
  if (parts[0] === 'connections') return { page: 'connections', name: parts[1] || null, q };
  if (parts[0] === 'terminal') return { page: 'terminal', session: parts[1] || null, q };
  return { page: 'home', q };
}

export function go(hash) { if (location.hash !== hash) location.hash = hash; else route(); }

function route() {
  const r = parse(location.hash);
  for (const el of $('pages').children) el.classList.remove('shown');
  if (r.page === 'view') {
    const v = state.views.find((x) => x.name === r.view) || { name: r.view, title: r.view, url: `/v/${r.view}/` };
    const f = frameFor(v);
    f.parentElement.classList.add('shown');
    if (r.anchor) { try { f.contentWindow.location.hash = r.anchor; } catch {} if (!f.dataset.loaded) f.src = `${v.url}#${r.anchor}`; }
    current = { page: 'view', view: v.name, params: r };
    document.title = `${v.title} · Springroll`;
    $('mobileTitle').textContent = v.title;
  } else {
    const el = pageEl(r.page, r.page === 'thread' || r.page === 'terminal');
    el.classList.add('shown');
    current = { page: r.page, params: r };
    PAGES[r.page].show?.(el, r, ctx);
    const title = PAGES[r.page].title?.(r) || 'Springroll';
    document.title = title === 'Springroll' ? 'Springroll' : `${title} · Springroll`;
    $('mobileTitle').textContent = title;
  }
  shell.classList.remove('side-open');
  // The Ask panel follows the View: another View gets its own chat; a non-View page closes it.
  if (shell.classList.contains('panel-open')) {
    const now = viewContext();
    if (!now) togglePanel(false);
    else if (panelView !== now.key) togglePanel(true);
  }
  renderNav();
  renderViews();
  renderChats();
  reportFocus();
  updateFab();
}

/* ---------- Views (iframes kept alive) ---------- */
function frameFor(v) {
  let f = viewFrames.get(v.name);
  if (!f) {
    const wrap = document.createElement('div');
    wrap.className = 'page';
    wrap.dataset.view = v.name;
    f = document.createElement('iframe');
    f.title = v.title;
    f.src = v.url;
    f.onload = () => { f.dataset.loaded = '1'; wireFrame(f); if (current?.view === v.name) reportFocus(); };
    wrap.appendChild(f);
    $('pages').appendChild(wrap);
    viewFrames.set(v.name, f);
  }
  return f;
}

function wireFrame(f) {
  try {
    f.contentWindow.addEventListener('keydown', onKey, true);
    f.contentWindow.postMessage({ type: 'desk:settings', settings: desk.settings }, '*');
  } catch {}
}

function currentPage() {
  if (current?.page !== 'view') return location.hash || '#/';
  try { const l = viewFrames.get(current.view).contentWindow.location; return l.pathname + l.search + l.hash; } catch { return null; }
}

function reportFocus() {
  api.post('api/focus', { name: current?.page === 'view' ? current.view : null, page: currentPage() }).catch(() => {});
}

/* ---------- Sidebar ---------- */
const NAV = [
  { id: 'home', label: 'Today', icon: 'sun', hash: '#/' },
  { id: 'thread', label: 'Chat', icon: 'message-square', hash: '#/new' },
  { id: 'jobs', label: 'Jobs', icon: 'calendar-clock', hash: '#/jobs' },
];
// Built into Springroll, listed after the owner's Views.
const BUILTIN_VIEWS = [
  { name: 'files', title: 'Files', icon: 'folder', hash: '#/v/files', description: 'Browse and read the machine’s files' },
  { name: 'terminal', title: 'Terminal', icon: 'square-terminal', hash: '#/terminal', page: 'terminal', description: 'Shells and agent terminals' },
];

function renderNav() {
  const running = state.jobs.filter((j) => j.running).length;
  ui.morph($('nav'), NAV.map((n) => {
    const on = n.view ? current?.page === 'view' && current.view === n.view : current?.page === n.id;
    const extra = n.id === 'jobs' && running ? `<span class="glyph"><span class="spin"></span></span>`
      : n.id === 'home' && Home.needsCount() ? `<span class="glyph"><span class="ui-dot warn" title="Needs you"></span></span>` : '';
    return `<a class="nav-item${on ? ' on' : ''}" href="${n.hash}">${ui.icon(n.icon)}<span>${n.label}</span>${extra}</a>`;
  }).join(''));
}

function renderViews() {
  const list = [...state.views.filter((v) => !v.system || v.name === 'system').map((v) => ({ ...v, hash: `#/v/${v.name}` })), ...BUILTIN_VIEWS];
  ui.morph($('viewList'), list.length ? list.map((v) => {
    const on = v.page ? current?.page === v.page : current?.page === 'view' && current.view === v.name;
    const glyph = v.setupPending ? '<span class="glyph"><span class="ui-dot warn"></span></span>' : '';
    return `<a class="nav-item${on ? ' on' : ''}" href="${v.hash}" title="${ui.esc(v.description || v.title)}">${ui.icon(v.icon || 'app-window')}<span class="t" style="overflow:hidden;text-overflow:ellipsis">${ui.esc(v.title)}</span>${glyph}</a>`;
  }).join('') : '<div class="side-empty">Ask the agent to build one.</div>');
}

export function threadGlyph(t) {
  if (t.status === 'waiting') return '<span class="ui-dot warn" title="Needs you"></span>';
  if (t.status === 'running' || t.status === 'starting' || t.running) return '<span class="spin" title="Working"></span>';
  if (t.status === 'error') return '<span class="ui-dot danger" title="Error"></span>';
  if (t.unread) return '<span class="ui-dot accent" title="Unread"></span>';
  return '';
}

function renderChats() {
  const list = state.threads.filter((t) => t.origin === 'chat' || t.origin?.startsWith('view:') || t.status === 'waiting');
  $('chatFilter').setAttribute('aria-pressed', state.archived);
  $('chatFilter').title = state.archived ? 'Show current chats' : 'Show archived';
  if (!list.length) { $('chatList').innerHTML = `<div class="side-empty">${state.archived ? 'Nothing archived.' : 'No chats yet.'}</div>`; return; }
  ui.morph($('chatList'), list.slice(0, 80).map((t) => {
    const on = current?.page === 'thread' && current.params.id === t.id;
    return `<a class="nav-item chat-item${on ? ' on' : ''}${t.unread && !on ? ' unread' : ''}" href="#/t/${t.id}" title="${ui.esc(t.title || 'New chat')} · ${agentName(t.agent)}">
      ${t.pinned ? ui.icon('pin', 'sm') : ''}<span class="t">${ui.esc(t.title || 'New chat')}</span>
      <span class="glyph">${threadGlyph(t)}</span><button class="more" data-thread-menu="${t.id}" title="More">${ui.icon('ellipsis', 'sm')}</button></a>`;
  }).join(''));
}

export function threadMenu(anchor, t, { onDeleted } = {}) {
  const m = document.createElement('div');
  m.className = 'ui-menu';
  m.innerHTML = `
    <button data-a="rename">${ui.icon('pencil')}Rename</button>
    <button data-a="pin">${ui.icon(t.pinned ? 'pin-off' : 'pin')}${t.pinned ? 'Unpin' : 'Pin'}</button>
    <button data-a="archive">${ui.icon(t.archived ? 'archive-restore' : 'archive')}${t.archived ? 'Unarchive' : 'Archive'}</button>
    <button data-a="terminal">${ui.icon('square-terminal')}Open a terminal here</button>
    <hr><button class="danger" data-a="delete">${ui.icon('trash-2')}Delete</button>`;
  m.onclick = async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    ui.closePopover();
    if (a === 'rename') {
      const title = prompt('Rename chat', t.title || '');
      if (title != null) await api.patch(`api/agent/threads/${t.id}`, { title });
    } else if (a === 'pin') await api.patch(`api/agent/threads/${t.id}`, { pinned: !t.pinned });
    else if (a === 'archive') { await api.patch(`api/agent/threads/${t.id}`, { archived: !t.archived }); if (current?.params?.id === t.id) go('#/'); }
    else if (a === 'terminal') {
      const r = await api.post('api/sessions', { agent: 'shell', dir: t.cwd.replace(/^\/home\/[^/]+/, '~') });
      go(`#/terminal/${r.session}`);
    } else if (a === 'delete') {
      if (!confirm(`Delete "${t.title || 'this chat'}"? This can't be undone.`)) return;
      await api.del(`api/agent/threads/${t.id}`);
      if (current?.params?.id === t.id) go('#/');
      onDeleted?.();
    }
  };
  ui.popover(anchor, m, { temp: true, align: 'end' });
}

$('chatList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-thread-menu]');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const t = state.threads.find((x) => x.id === b.dataset.threadMenu);
  if (t) threadMenu(b, t);
});
$('chatFilter').onclick = () => { state.archived = !state.archived; loadThreads(); };
$('addView').onclick = () => go('#/v/settings');
$('mobileNew').onclick = () => go('#/new');
$('brand').onclick = () => go('#/');
$('settingsBtn').onclick = () => go('#/v/settings');
$('collapse').onclick = $('expandSide').onclick = () => toggleSide();
$('menuBtn').onclick = () => shell.classList.add('side-open');
$('scrimSide').onclick = () => shell.classList.remove('side-open');
$('launchBtn').onclick = () => openLauncher();
$('exitFocus').onclick = () => setFocusMode(false);

function toggleSide(force) {
  if (mobile()) return shell.classList.toggle('side-open');
  const hidden = force ?? !shell.classList.contains('side-hidden');
  shell.classList.toggle('side-hidden', hidden);
  store.set('desk.sideHidden', hidden);
}

/* ---------- Status chips (Views with a STATUS file) ---------- */
async function refreshChips() {
  const withStatus = state.views.filter((v) => v.status);
  const results = await Promise.all(withStatus.map(async (v) => {
    try { return { v, s: await (await fetch(`/v/${v.name}/${v.status}`)).json() }; } catch { return null; }
  }));
  $('chips').innerHTML = results.filter(Boolean).map(({ v, s }) =>
    `<a class="chip-status ${s.level === 'ok' ? '' : s.level || ''}" href="#/v/${v.name}" title="${ui.esc(s.title || v.title)}">${s.level ? `<span class="ui-dot ${s.level}"></span>` : ''}${s.icon ? ui.icon(s.icon, 'sm') : ''}<span>${ui.esc(s.text || '')}</span></a>`).join('');
}
setInterval(() => { if (!document.hidden) refreshChips(); }, 10000);

/* ---------- Ask panel: talk about the View you're looking at ---------- */
let panelThread = null, panelView = null;
const fab = document.createElement('button');
fab.className = 'ask-fab';
fab.innerHTML = `${ui.icon('message-square', 'sm')}Chat`;
fab.title = 'Chat about this page';
fab.onclick = () => togglePanel(true);
$('main').appendChild(fab);

// The chat button sits on every page except chats themselves; it always knows the page.
function updateFab() { fab.style.display = current && current.page !== 'thread' && current.view !== 'settings' ? '' : 'none'; }

// What a View says the owner is looking at (desk.context in the View): {label, note}.
const viewNotes = new Map();
// What the owner is looking at, for the Ask panel: a View (plus what it says via
// desk.context), or a Springroll page (Today, Jobs, a job, Connections…).
function viewContext() {
  if (!current || current.page === 'thread') return null;
  if (current.page === 'view') {
    const v = state.views.find((x) => x.name === current.view);
    if (!v) return null;
    const extra = viewNotes.get(v.name) || {};
    return { key: v.name, view: v.name, title: v.title, source: v.source, page: currentPage(), label: extra.label || undefined, note: extra.note || undefined };
  }
  const title = PAGES[current.page]?.title?.(current.params) || 'Today';
  return { key: `page:${current.page}`, title, page: location.hash || '#/', source: '~/home/views/desk' };
}

export function togglePanel(open = !shell.classList.contains('panel-open')) {
  shell.classList.toggle('panel-open', open);
  if (!open) { Thread.unmountPanel(); return; }
  const context = viewContext();
  panelView = context?.key || null;
  const key = context ? `desk.panel.${context.key}` : 'desk.panel';
  panelThread = store.get(key, null);
  if (panelThread && !state.threads.find((t) => t.id === panelThread)) panelThread = null;
  Thread.mountPanel($('panel'), { id: panelThread, context, ctx, onCreated: (id) => store.set(key, id), onClose: () => togglePanel(false) });
}

/* ---------- Focus mode ---------- */
function setFocusMode(on) {
  root.dataset.layout = on ? 'focus' : 'desk';
  if (on) document.documentElement.requestFullscreen?.().catch(() => {});
  else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && root.dataset.layout === 'focus') root.dataset.layout = 'desk'; });

/* ---------- Launcher ---------- */
let items = [], sel = 0;
function launcherItems(q) {
  const out = [];
  out.push({ group: 'Go', label: 'Today', icon: 'sun', go: () => go('#/') });
  out.push({ group: 'Go', label: 'New chat', icon: 'square-pen', kind: 'Ctrl ⇧ N', go: () => go('#/new') });
  out.push({ group: 'Go', label: 'Files', icon: 'folder', kind: 'Ctrl P', go: () => go('#/v/files') });
  out.push({ group: 'Go', label: 'Jobs', icon: 'calendar-clock', go: () => go('#/jobs') });
  out.push({ group: 'Go', label: 'Connections', icon: 'plug', go: () => go('#/connections') });
  out.push({ group: 'Go', label: 'Terminal', icon: 'square-terminal', go: () => go('#/terminal') });
  out.push({ group: 'Go', label: 'Settings', icon: 'settings-2', go: () => go('#/v/settings') });
  out.push({ group: 'Go', label: 'Gallery', icon: 'layout-grid', go: () => go('#/v/gallery') });
  for (const v of state.views.filter((x) => !x.system || x.name === 'system')) out.push({ group: 'Views', label: v.title, icon: v.icon || 'app-window', go: () => go(`#/v/${v.name}`) });
  for (const t of state.threads.slice(0, q ? 200 : 8)) out.push({ group: 'Chats', label: t.title || 'New chat', icon: 'message-square', kind: ui.ago(t.updated), go: () => go(`#/t/${t.id}`) });
  for (const j of state.jobs) out.push({ group: 'Jobs', label: j.title || j.name, icon: 'calendar-clock', kind: j.describe, go: () => go(`#/jobs/${j.name}`) });
  out.push({ group: 'Actions', label: 'Focus mode', icon: 'maximize', kind: 'Ctrl ⇧ F', go: () => setFocusMode(true) });
  out.push({ group: 'Actions', label: 'Toggle sidebar', icon: 'panel-left', kind: 'Ctrl B', go: () => toggleSide() });
  if (q) {
    fetch('/ui/themes.json').then(() => {});
    for (const t of themes) out.push({ group: 'Themes', label: `Theme: ${t.name}`, swatch: t.colors || t.dark, go: () => desk.save({ theme: t.id }) });
    for (const f of fileHits.q === q ? fileHits.list : []) out.push({ group: 'Files', label: f.name, kind: f.display.replace(/\/[^/]*$/, ''), icon: 'file', always: true, go: () => go(`#/v/files#p=${encodeURIComponent(f.path)}`) });
    out.push({ group: 'Ask', label: `Ask: "${q}"`, icon: 'sparkles', go: () => Thread.startChat({ text: q }) });
  }
  return out;
}
let themes = [];
// File names matching the launcher query, fetched as you type.
let fileHits = { q: '', list: [] }, fileTimer = null;
function searchFiles(q) {
  clearTimeout(fileTimer);
  if (q.length < 2) return;
  fileTimer = setTimeout(async () => {
    try {
      const list = (await (await fetch('/api/files/search?q=' + encodeURIComponent(q))).json()).slice(0, 6);
      if (lq.value.trim().toLowerCase() !== q) return;
      fileHits = { q, list };
      renderLauncher();
    } catch {}
  }, 90);
}
fetch('/ui/themes.json').then((r) => r.json()).then((t) => (themes = t)).catch(() => {});

const scrim = document.createElement('div');
scrim.className = 'launcher-scrim';
scrim.innerHTML = `<div class="launcher" role="dialog" aria-label="Launcher"><input id="lq" placeholder="Search Views, chats, jobs, or ask anything" autocomplete="off" spellcheck="false"><ul id="lr"></ul></div>`;
document.body.appendChild(scrim);
const lq = scrim.querySelector('#lq'), lr = scrim.querySelector('#lr');

function renderLauncher() {
  const q = lq.value.trim().toLowerCase();
  items = launcherItems(q).filter((i) => !q || i.group === 'Ask' || i.always || q.split(/\s+/).every((w) => `${i.label} ${i.group}`.toLowerCase().includes(w)));
  sel = Math.min(sel, Math.max(0, items.length - 1));
  let group = null, html = '';
  items.forEach((it, i) => {
    if (it.group !== group) { group = it.group; html += `<div class="group">${group}</div>`; }
    const lead = it.swatch ? `<span class="swatch" style="background:linear-gradient(135deg, ${it.swatch.bg} 50%, ${it.swatch.accent} 50%)"></span>` : ui.icon(it.icon || 'dot');
    html += `<li data-i="${i}" class="${i === sel ? 'sel' : ''}">${lead}<span>${ui.esc(it.label)}</span>${it.kind ? `<span class="kind">${ui.esc(it.kind)}</span>` : ''}</li>`;
  });
  lr.innerHTML = html;
  lr.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
}
function openLauncher() {
  if (scrim.classList.contains('open')) return closeLauncher();
  scrim.classList.add('open'); lq.value = ''; sel = 0; renderLauncher(); lq.focus();
}
function closeLauncher() { scrim.classList.remove('open'); }
scrim.onclick = (e) => { if (e.target === scrim) closeLauncher(); };
lq.oninput = () => { sel = 0; renderLauncher(); searchFiles(lq.value.trim().toLowerCase()); };
lr.onclick = (e) => { const li = e.target.closest('[data-i]'); if (li) { const it = items[+li.dataset.i]; closeLauncher(); it.go(); } };
lr.onmousemove = (e) => { const li = e.target.closest('[data-i]'); if (li && +li.dataset.i !== sel) { sel = +li.dataset.i; renderLauncher(); } };
lq.onkeydown = (e) => {
  if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, items.length - 1); renderLauncher(); e.preventDefault(); }
  if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); renderLauncher(); e.preventDefault(); }
  if (e.key === 'Enter' && items[sel]) { const it = items[sel]; closeLauncher(); it.go(); }
};

/* ---------- Shortcuts (ui/hotkeys.json) ---------- */
let hotkeys = [];
fetch('ui/hotkeys.json').then((r) => r.json()).then((h) => (hotkeys = h)).catch(() => {});
const CODES = { '.': 'Period', ',': 'Comma', '/': 'Slash', ';': 'Semicolon' };
const codeFor = (k) => CODES[k] || (/^[a-z]$/i.test(k) ? 'Key' + k.toUpperCase() : /^\d$/.test(k) ? 'Digit' + k : k);

function run(action, arg) {
  switch (action) {
    case 'launcher': return openLauncher();
    case 'new-chat': return go('#/new');
    case 'ask': return current?.page !== 'thread' ? togglePanel() : go('#/new');
    case 'focus': return setFocusMode(root.dataset.layout !== 'focus');
    case 'sidebar': return toggleSide();
    case 'home': return go('#/');
    case 'jobs': return go('#/jobs');
    case 'files': return go('#/v/files#search');
    case 'settings': return go('#/v/settings');
    case 'view': { const v = state.views.filter((x) => !x.system || x.name === 'system')[arg - 1]; if (v) go(`#/v/${v.name}`); return; }
    case 'composer': if (Thread.focusComposer()) return; if (current?.page !== 'thread') { if (!shell.classList.contains('panel-open')) togglePanel(true); Thread.focusPanel(); } return;
    case 'exit':
      if (scrim.classList.contains('open')) return closeLauncher();
      if (root.dataset.layout === 'focus') return setFocusMode(false);
      if (shell.classList.contains('panel-open')) return togglePanel(false);
  }
}

function onKey(e) {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
  for (const h of hotkeys) {
    const parts = h.keys.split('+');
    const key = parts.pop();
    const want = { ctrl: parts.includes('Ctrl'), shift: parts.includes('Shift'), alt: parts.includes('Alt') };
    if (e.ctrlKey !== want.ctrl || e.shiftKey !== want.shift || e.altKey !== want.alt || e.metaKey) continue;
    // Bare keys ("/") never steal typing; Escape still closes Springroll's own launcher and panel.
    if (!want.ctrl && typing && !(key === 'Escape' && e.target.ownerDocument === document)) continue;
    let arg;
    if (key === '1-9') { const m = e.code.match(/^Digit([1-9])$/); if (!m) continue; arg = +m[1]; }
    else if (e.code !== codeFor(key)) continue;
    if (h.action === 'exit' && root.dataset.layout !== 'focus' && !scrim.classList.contains('open') && !shell.classList.contains('panel-open')) return;
    e.preventDefault(); e.stopPropagation();
    run(h.action, arg);
    return;
  }
}
addEventListener('keydown', onKey, true);

/* ---------- Context passed to pages ---------- */
const ctx = { go, togglePanel, threadMenu, threadGlyph, viewContext, refreshChips, openLauncher };

/* ---------- Live updates ---------- */
on('threads', () => { renderChats(); renderNav(); });
on('jobs', () => renderNav());
on('signals', () => renderNav());
on('desk:views', (views) => {
  state.views = views;
  renderViews();
  refreshChips();
  if (current?.page === 'home') Home.refresh?.();
});
on('desk:show', (v) => {
  if (v.hash) return go(v.hash);
  if (v.url && !v.url.startsWith('/v/')) { window.open(v.url, '_blank'); return; }
  const f = viewFrames.get(v.name);
  if (f) f.src = f.src;
  go(`#/v/${v.name}`);
});
on('desk:notify', (n) => ui.toast(n.text, { icon: 'bell' }));
on('desk:agent', (a) => { if (a.session) go(`#/terminal/${a.session}`); });
on('desk:go', (g) => { if (g.hash?.startsWith('#/') && !document.hidden) go(g.hash); });
desk.onTheme((t) => {
  $('themeColor').content = t.colors.bg;
  for (const f of viewFrames.values()) { try { f.contentWindow.postMessage({ type: 'desk:settings', settings: desk.settings }, '*'); } catch {} }
  Terminal.onTheme?.(t);
});
addEventListener('message', (e) => {
  if (e.data?.type === 'desk:open') go(`#/v/${e.data.name}`);
  const from = [...viewFrames].find(([, f]) => f.contentWindow === e.source)?.[0];
  if (e.data?.type === 'desk:context' && from) {
    viewNotes.set(from, { label: String(e.data.label || '').slice(0, 120), note: String(e.data.note || '').slice(0, 2000) });
    if (shell.classList.contains('panel-open') && current?.view === from) Thread.setPanelContext(viewContext());
  }
  if (e.data?.type === 'desk:discuss' && from && current?.view === from) { if (!shell.classList.contains('panel-open')) togglePanel(true); Thread.focusPanel?.(); }
  if (e.data?.type === 'desk:go' && typeof e.data.hash === 'string' && e.data.hash.startsWith('#/')) go(e.data.hash);
});
addEventListener('hashchange', route);

/* ---------- Start ---------- */
if (store.get('desk.sideHidden', false) && !mobile()) shell.classList.add('side-hidden');
connect();
Promise.all([loadAgents(), loadThreads(), loadJobs(), loadFolders(), api.get('api/views').then((v) => (state.views = v)).catch(() => {})])
  .finally(() => { route(); refreshChips(); });

// Springroll shell: router, sidebar, View frames, the ask panel, launcher and shortcuts.
import { api, state, on, connect, loadThreads, loadAgents, loadJobs, loadFolders, agentName } from './api.js';
import * as Home from './home.js';
import * as Thread from './thread.js';
import * as Jobs from './jobs.js';
import * as Connections from './connections.js';
import * as Terminal from './terminal.js';
import * as Apps from './apps.js';
import * as Chats from './chats.js';
import * as Run from './run.js';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const shell = $('shell');
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const mobile = () => innerWidth <= 860;

/* ---------- Pages ---------- */
const PAGES = { home: Home, thread: Thread, jobs: Jobs, connections: Connections, terminal: Terminal, apps: Apps, chats: Chats, run: Run };
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
  if (parts[0] === 'apps') return { page: 'apps', q };
  if (parts[0] === 'chats') return { page: 'chats', q };
  if (parts[0] === 'r') return { page: 'run', id: parts[1], q };
  return { page: 'home', q };
}

export function go(hash) { if (location.hash !== hash) location.hash = hash; else route(); }

function route() {
  const r = parse(location.hash);
  ui.closePopover?.(); // a menu belongs to the page it was opened on
  for (const el of $('pages').children) el.classList.remove('shown');
  if (r.page === 'view') {
    const v = state.views.find((x) => x.name === r.view) || { name: r.view, title: r.view, url: `/v/${r.view}/` };
    const f = frameFor(v);
    f.parentElement.classList.add('shown');
    if (f.dataset.loaded && !frameOk(f)) { f.dataset.tries = '0'; f.src = `${v.url}${r.anchor ? '#' + r.anchor : ''}`; } // kept but broken: load it again
    else if (r.anchor) { if (f.dataset.loaded) { try { f.contentWindow.location.hash = r.anchor; } catch {} } else f.src = `${v.url}#${r.anchor}`; }
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
    const stillThere = panelView?.startsWith('item:') && location.hash.split('#').slice(0, 2).join('#') === panelItemPage;
    if (stillThere) { /* asked about an item on this page: keep that chat */ }
    else if (!now) togglePanel(false);
    else if (panelView !== now.key) togglePanel(true);
  }
  renderNav();
  renderViews();
  renderChats();
  reportFocus();
  updateFab();
}

/* ---------- Views (iframes kept alive) ---------- */
// An app's page that didn't load (the server restarting, a network blip) shows as a blank frame and
// would stay blank: frames are kept alive. Same-origin, so an error page is one we can't read.
function frameOk(f) {
  try { const d = f.contentDocument; return !!d && f.contentWindow.location.href !== 'about:blank' && !!d.body && d.body.childElementCount > 0; } catch { return false; }
}

function frameFor(v) {
  let f = viewFrames.get(v.name);
  if (!f) {
    const wrap = document.createElement('div');
    wrap.className = 'page';
    wrap.dataset.view = v.name;
    f = document.createElement('iframe');
    f.title = v.title;
    f.src = v.url;
    f.onload = () => {
      f.dataset.loaded = '1';
      if (!frameOk(f)) { // try again a few times, a little later each time
        const n = Number(f.dataset.tries || 0);
        if (n < 4) { f.dataset.tries = String(n + 1); setTimeout(() => { f.src = f.src; }, 1500 * (n + 1)); }
        return;
      }
      f.dataset.tries = '0';
      wireFrame(f); fitFrame(f); setTimeout(() => fitFrame(f), 1500); // apps that draw their page after loading
      if (current?.view === v.name) reportFocus();
    };
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
  { id: 'home', label: 'Home', icon: 'house', hash: '#/' },
  { id: 'thread', label: 'Chat', icon: 'message-square', hash: '#/new' },
  { id: 'jobs', label: 'Jobs', icon: 'calendar-clock', hash: '#/jobs' },
  { id: 'connections', label: 'Connections', icon: 'plug', hash: '#/connections' },
  { id: 'settings', label: 'Settings', icon: 'settings', hash: '#/v/settings', view: 'settings' },
];
// Connections lights up when a connected service fails its check or an agent is waiting for a key.
let connAlert = false;
async function refreshConnAlert() {
  const list = await api.get('api/connections').catch(() => null);
  const failing = !!list?.some((c) => c.connected && c.lastTest && !c.lastTest.ok);
  const asked = state.signals.some((s) => s.key?.startsWith('secret:'));
  connAlert = failing || asked;
  renderNav();
}
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
      : n.id === 'home' && Home.needsCount() ? `<span class="glyph"><span class="ui-dot warn" title="Needs you"></span></span>`
      : n.id === 'connections' && connAlert ? `<span class="glyph"><span class="ui-dot warn" title="A connection needs you"></span></span>` : '';
    return `<a class="nav-item${on ? ' on' : ''}" href="${n.hash}">${ui.icon(n.icon)}<span>${n.label}</span>${extra}</a>`;
  }).join(''));
}

// Apps the owner keeps in the sidebar (Settings' sidebarApps; placeholders start hidden). The rest are on All apps.
export const allApps = () => [...state.views.filter((v) => !v.system || v.name === 'system').map((v) => ({ ...v, hash: `#/v/${v.name}` })), ...BUILTIN_VIEWS];
export const inSidebar = (v) => desk.settings?.sidebarApps?.[v.name] ?? !v.placeholder;
export const setInSidebar = (name, shown) => desk.save({ sidebarApps: { [name]: shown } });

function renderViews() {
  const all = allApps(), list = all.filter(inSidebar), hidden = all.length - list.length;
  ui.morph($('viewList'), list.map((v) => {
    const on = v.page ? current?.page === v.page : current?.page === 'view' && current.view === v.name;
    const glyph = v.setupPending ? '<span class="glyph"><span class="ui-dot warn"></span></span>' : '';
    return `<a class="nav-item app-item${on ? ' on' : ''}" href="${v.hash}" title="${ui.esc(v.description || v.title)}">${ui.icon(v.icon || 'app-window')}<span class="t">${ui.esc(v.title)}</span>${glyph}<button class="more" data-app-menu="${v.name}" title="More" aria-label="More for ${ui.esc(v.title)}">${ui.icon('ellipsis', 'sm')}</button></a>`;
  }).join('') + `<a class="nav-item app-all${current?.page === 'apps' ? ' on' : ''}" href="#/apps">${ui.icon('layout-grid')}<span class="t">All apps</span>${hidden ? `<span class="count">${hidden}</span>` : ''}</a>`);
}

function appMenu(anchor, v) {
  const m = document.createElement('div');
  m.className = 'ui-menu';
  m.innerHTML = `<button data-a="hide">${ui.icon('eye-off')}Hide from sidebar</button><button data-a="all">${ui.icon('layout-grid')}All apps</button>`;
  m.onclick = (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    ui.closePopover();
    if (a === 'hide') setInSidebar(v.name, false).then(() => ui.toast(`${v.title} is in All apps`, { icon: 'eye-off' }));
    else go('#/apps');
  };
  ui.popover(anchor, m, { temp: true, align: 'end' });
}

export function threadGlyph(t) {
  if (t.status === 'waiting') return '<span class="ui-dot warn" title="Needs you"></span>';
  if (t.status === 'running' || t.status === 'starting' || t.running) return '<span class="spin" title="Working"></span>';
  if (t.status === 'error') return '<span class="ui-dot danger" title="Error"></span>';
  if (t.unread) return '<span class="ui-dot accent" title="Unread"></span>';
  return '';
}

// The sidebar keeps the few latest chats (plus any that need you or are working); All chats has the rest.
const SIDE_CHATS = 4;
export const isChat = (t) => t.origin === 'chat' || t.origin?.startsWith('view:');
function renderChats() {
  const all = state.threads.filter((t) => isChat(t) || t.status === 'waiting');
  const busy = (t) => t.status === 'waiting' || t.status === 'running' || t.status === 'starting' || t.running;
  const shown = all.filter((t, i) => i < SIDE_CHATS || busy(t) || (current?.page === 'thread' && current.params.id === t.id));
  const rows = shown.map((t) => {
    const on = current?.page === 'thread' && current.params.id === t.id;
    return `<a class="nav-item chat-item${on ? ' on' : ''}${t.unread && !on ? ' unread' : ''}" href="#/t/${t.id}" title="${ui.esc(t.title || 'New chat')} · ${agentName(t.agent)}">
      ${t.pinned ? ui.icon('pin', 'sm') : ''}<span class="t">${ui.esc(t.title || 'New chat')}</span>
      <span class="glyph">${threadGlyph(t)}</span><button class="more" data-thread-menu="${t.id}" title="More">${ui.icon('ellipsis', 'sm')}</button></a>`;
  }).join('');
  const more = all.length - shown.length;
  ui.morph($('chatList'), (rows || '<div class="side-empty">No chats yet.</div>')
    + `<a class="nav-item app-all${current?.page === 'chats' ? ' on' : ''}" href="#/chats">${ui.icon('messages-square')}<span class="t">All chats</span>${more ? `<span class="count">${more}</span>` : ''}</a>`);
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
      const title = await ui.prompt('Rename chat', t.title || '');
      if (title != null) await api.patch(`api/agent/threads/${t.id}`, { title });
    } else if (a === 'pin') await api.patch(`api/agent/threads/${t.id}`, { pinned: !t.pinned });
    else if (a === 'archive') { await api.patch(`api/agent/threads/${t.id}`, { archived: !t.archived }); if (current?.params?.id === t.id) go('#/'); }
    else if (a === 'terminal') {
      const r = await api.post('api/sessions', { agent: 'shell', dir: t.cwd.replace(/^\/home\/[^/]+/, '~') });
      go(`#/terminal/${r.session}`);
    } else if (a === 'delete') {
      if (!(await ui.confirm(`Delete "${t.title || 'this chat'}"?`, { body: "This can't be undone.", ok: 'Delete', danger: true }))) return;
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
$('newChatSide').onclick = () => go('#/new');
$('addView').onclick = () => go('#/apps');
$('viewList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-app-menu]');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const v = allApps().find((x) => x.name === b.dataset.appMenu);
  if (v) appMenu(b, v);
});
$('mobileNew').onclick = () => go('#/new');
$('brand').onclick = () => go('#/');
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

/* ---------- Utilization: coding-agent plan windows (sidebar corner) ---------- */
// One row per plan window: a bar of how much is used, a tick for how much of the window has
// passed, and a color for the pace (under / on / over). Hover for the numbers; click for all.
let usageData = [];

// Compare % used with % of the window elapsed: 20% either side counts as on pace.
function pace(w) {
  if (!w.resetsAt || !w.windowMs) return null;
  const elapsed = Math.min(100, Math.max(0, 100 - ((w.resetsAt - Date.now()) / w.windowMs) * 100));
  const status = w.used <= elapsed * 0.8 ? 'under' : w.used >= elapsed * 1.2 ? 'over' : 'on';
  return { status, elapsed };
}
// Bar color: theme status colors. Nearly out is danger; ahead of pace or past half is warn.
function tone(w, p) {
  if (w.used >= 90) return 'danger';
  if (p?.status === 'over') return w.used >= 50 ? 'danger' : 'warn';
  if (w.used >= 75) return 'danger';
  if (w.used >= 50) return 'warn';
  return 'ok';
}
const PACE_TEXT = { under: 'Under pace', on: 'On pace', over: 'Over pace' };

function usageRows() {
  const rows = [];
  for (const a of usageData) {
    if (!a.windows.length) { rows.push({ a, w: null }); continue; }
    for (const w of a.windows) { const p = pace(w); rows.push({ a, w, p, tone: tone(w, p) }); }
  }
  const rank = { over: 0, on: 1, under: 2 };
  return rows.sort((x, y) => (x.w ? rank[x.p?.status] ?? 3 : 4) - (y.w ? rank[y.p?.status] ?? 3 : 4) || (y.w?.used ?? -1) - (x.w?.used ?? -1));
}

async function refreshUsage() {
  usageData = await api.get('api/usage').catch(() => usageData);
  const rows = usageRows(), el = $('usage');
  el.hidden = !rows.length;
  ui.morph(el, `<header><span>Utilization</span></header>` + rows.map((r, i) => `
    <button class="usage-row" data-usage="${i}" aria-label="${ui.esc(r.a.name)}${r.w ? ` ${r.w.label}: ${r.w.used}% used` : ''}">
      ${ui.agentMark(r.a.id, r.a.name)}
      <span class="usage-bar ${r.tone || 'none'}"><span class="fill" style="width:${r.w ? Math.min(100, r.w.used) : 0}%"></span>${r.p ? `<span class="tick" style="left:${r.p.elapsed}%"></span>` : ''}</span>
      <span class="usage-pct">${r.w ? `${r.w.used}%` : '–'}</span></button>`).join(''));
  el._rows = rows;
}

function usageWhen(ts) {
  if (!ts) return '';
  const m = Math.max(0, Math.round((ts - Date.now()) / 60000));
  return m < 60 ? `${m}m` : m < 48 * 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)}d ${Math.round((m % 1440) / 60)}h`;
}

function usageDetail(r) {
  const head = `<div class="usage-tip-head">${ui.agentMark(r.a.id, r.a.name)}<b>${ui.esc(r.a.name)}</b><span>${ui.esc(r.w?.label || r.a.plan || '')}</span></div>`;
  const next = r.a.nextCheck ? ` Springroll tries again at ${ui.time(r.a.nextCheck)}.` : '';
  const fix = r.a.fix === 'login' ? `<button class="ui-btn sm primary" data-usage-login="${r.a.id}">Sign in to see usage</button>` : '';
  if (r.a.fix) return head + `<p class="usage-tip-err">${ui.esc(r.a.error)}.</p>${fix}`;
  if (!r.w) return head + `<p class="usage-tip-err">${ui.esc((r.a.error || 'No usage yet') + '.' + next)}</p>`;
  const row = (k, v, cls = '') => `<div class="usage-tip-row"><span>${k}</span><span class="${cls}">${v}</span></div>`;
  return head + row('Used', `${r.w.used}%`, 'strong') + row('Remaining', `${100 - r.w.used}%`)
    + (r.p ? row('Pace', PACE_TEXT[r.p.status], `pace-${r.p.status}`) + row('Window elapsed', `${Math.round(r.p.elapsed)}%`) : '')
    + (r.w.resetsAt ? row('Resets in', usageWhen(r.w.resetsAt)) : '')
    + (r.a.error ? `<p class="usage-tip-err">${ui.esc(r.a.error + '.' + next)} Showing the last numbers.</p>` : '');
}

// Hover: a small card to the right of the row (Shep's tooltip). Click: every window, as a popover.
const usageTip = document.createElement('div');
usageTip.className = 'usage-tip';
usageTip.hidden = true;
document.body.appendChild(usageTip);
$('usage').addEventListener('mouseover', (e) => {
  const b = e.target.closest('[data-usage]');
  if (!b) return;
  const r = $('usage')._rows?.[b.dataset.usage];
  if (!r) return;
  usageTip.innerHTML = usageDetail(r);
  usageTip.hidden = false;
  const rect = b.getBoundingClientRect();
  usageTip.style.left = `${rect.right + 10}px`;
  usageTip.style.top = `${Math.max(8, Math.min(innerHeight - usageTip.offsetHeight - 8, rect.top + rect.height / 2 - usageTip.offsetHeight / 2))}px`;
});
$('usage').addEventListener('mouseleave', () => { usageTip.hidden = true; });
$('usage').addEventListener('click', (e) => {
  const b = e.target.closest('[data-usage]');
  if (!b) return;
  usageTip.hidden = true;
  const m = document.createElement('div');
  m.className = 'ui-popover usage-pop';
  m.innerHTML = `<div class="ui-label">Utilization</div>` + ($('usage')._rows || []).map((r) => `<div class="usage-pop-item">${usageDetail(r)}</div>`).join('');
  m.addEventListener('click', async (ev) => {
    const l = ev.target.closest('[data-usage-login]');
    if (!l) return;
    ui.closePopover();
    try { const r = await api.post(`api/agents/${l.dataset.usageLogin}/login`); go(`#/terminal/${r.session}`); }
    catch (err) { ui.toast(err.message, { icon: 'circle-alert' }); }
  });
  ui.popover(b, m, { temp: true, align: 'start' });
});
refreshUsage();
// The owner's time zone, from this device the first time (Settings → Time zone changes it): jobs and the
// machine run on it, so "Daily at 7:00 AM" means 7:00 here, not in UTC.
api.get('api/settings').then((s) => { const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; if (!s.timezone && tz) desk.save({ timezone: tz }); }).catch(() => {});
setInterval(refreshUsage, 60000);

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

// The chat button sits on every page except chats themselves and the Terminal (a full-screen tool); it
// always knows the page. On phones it's in the top bar instead (#mobileChat).
$('mobileChat').onclick = () => togglePanel(true);
function updateFab() {
  const on = !!current && current.page !== 'thread' && current.page !== 'terminal' && current.view !== 'settings';
  fab.style.display = on ? '' : 'none';
  $('mobileChat').hidden = !on;
  if (current?.view) fitFrame(viewFrames.get(current.view), on);
}

// An app built on the kit's page layout keeps a lane clear for the Chat button itself (--fab-room); any
// other app (full-width, like Mail) gets its frame shortened so the button sits below it.
function fitFrame(f, on = fab.style.display !== 'none') {
  if (!f) return;
  let paged = null;
  try {
    const d = f.contentDocument;
    if (d?.body) {
      paged = !!d.querySelector('.ui-page');
      const room = on ? getComputedStyle(document.documentElement).getPropertyValue('--fab-room').trim() : '';
      if (room) d.documentElement.style.setProperty('--fab-room', room); else d.documentElement.style.removeProperty('--fab-room');
    }
  } catch {}
  if (paged != null) f.parentElement.classList.toggle('fab-band', on && !paged);
}

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
  const title = PAGES[current.page]?.title?.(current.params) || 'Home';
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

// Agent first: "Chat" on anything (an email, a failed run, a question) opens the chat beside it, about
// that item. Its own chat when it has one (thread); else a chat that knows the item (label shows on
// the chip, note reaches the agent), the same one each time you ask about the same item (key).
let panelItemPage = null;
export function askAbout({ key, label, note, thread } = {}) {
  shell.classList.add('panel-open');
  const base = viewContext() || {};
  const context = { ...base, key: `item:${key || label}`, label: label || base.title, note: note || base.note };
  panelView = context.key;
  panelItemPage = location.hash.split('#').slice(0, 2).join('#'); // the page it was asked from
  const sk = `desk.panel.item:${key || label}`;
  let id = thread || store.get(sk, null);
  if (id && !thread && !state.threads.find((t) => t.id === id)) id = null;
  Thread.mountPanel($('panel'), { id, context: thread ? null : context, ctx, onCreated: (nid) => store.set(sk, nid), onClose: () => togglePanel(false) });
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
  out.push({ group: 'Go', label: 'Home', icon: 'house', go: () => go('#/') });
  out.push({ group: 'Go', label: 'New chat', icon: 'square-pen', kind: 'Ctrl ⇧ N', go: () => go('#/new') });
  out.push({ group: 'Go', label: 'Files', icon: 'folder', kind: 'Ctrl P', go: () => go('#/v/files') });
  out.push({ group: 'Go', label: 'Jobs', icon: 'calendar-clock', go: () => go('#/jobs') });
  out.push({ group: 'Go', label: 'Connections', icon: 'plug', go: () => go('#/connections') });
  out.push({ group: 'Go', label: 'Terminal', icon: 'square-terminal', go: () => go('#/terminal') });
  out.push({ group: 'Go', label: 'Settings', icon: 'settings-2', go: () => go('#/v/settings') });
  out.push({ group: 'Go', label: 'Gallery', icon: 'layout-grid', go: () => go('#/v/gallery') });
  out.push({ group: 'Go', label: 'All apps', icon: 'layout-grid', go: () => go('#/apps') });
  out.push({ group: 'Go', label: 'All chats', icon: 'messages-square', go: () => go('#/chats') });
  for (const v of state.views.filter((x) => !x.system || x.name === 'system')) out.push({ group: 'Apps', label: v.title, icon: v.icon || 'app-window', go: () => go(`#/v/${v.name}`) });
  for (const t of state.threads.slice(0, q ? 200 : 8)) out.push({ group: 'Chats', label: t.title || 'New chat', icon: 'message-square', kind: ui.ago(t.updated), go: () => go(`#/t/${t.id}`) });
  for (const j of state.jobs) out.push({ group: 'Jobs', label: j.title || j.name, icon: 'calendar-clock', kind: j.describe, go: () => go(`#/jobs/${j.name}`) });
  out.push({ group: 'Actions', label: 'Focus mode', icon: 'maximize', kind: 'Ctrl ⇧ F', go: () => setFocusMode(true) });
  out.push({ group: 'Actions', label: 'Toggle sidebar', icon: 'panel-left', kind: 'Ctrl B', go: () => toggleSide() });
  if (q) {
    fetch('/ui/themes.json').then(() => {});
    for (const t of themes) out.push({ group: 'Themes', label: `Theme: ${t.name}`, swatch: t.colors || t.dark, go: () => desk.save({ theme: t.id }) });
    for (const f of fileHits.q === q ? fileHits.list : []) out.push({ group: 'Files', label: f.name, kind: f.display.replace(/\/[^/]*$/, ''), icon: 'file', always: true, go: () => go(`#/v/files#p=${encodeURIComponent(f.path)}`) });
    out.push({ group: 'Chat', label: `Chat: "${q}"`, icon: 'sparkles', go: () => Thread.startChat({ text: q }) });
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
scrim.innerHTML = `<div class="launcher" role="dialog" aria-label="Launcher"><input id="lq" placeholder="Search apps, chats, jobs, or ask anything" autocomplete="off" spellcheck="false"><ul id="lr"></ul></div>`;
document.body.appendChild(scrim);
const lq = scrim.querySelector('#lq'), lr = scrim.querySelector('#lr');

function renderLauncher() {
  const q = lq.value.trim().toLowerCase();
  items = launcherItems(q).filter((i) => !q || i.group === 'Chat' || i.always || q.split(/\s+/).every((w) => `${i.label} ${i.group}`.toLowerCase().includes(w)));
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
  // Escape stops a working chat before it closes anything (the panel, focus mode).
  if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && !e.isComposing && !ui.popoverOpen() && !scrim.classList.contains('open') && Thread.stopOnEscape(e.target)) {
    e.preventDefault(); e.stopPropagation();
    return;
  }
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
const ctx = { go, togglePanel, askAbout, threadMenu, threadGlyph, viewContext, refreshChips, openLauncher };

/* ---------- Live updates ---------- */
on('threads', () => { renderChats(); renderNav(); });
on('jobs', () => renderNav());
on('signals', () => refreshConnAlert());
on('desk:connections', () => refreshConnAlert());
setInterval(() => { if (!document.hidden) refreshConnAlert(); }, 60000);
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
  renderViews(); // sidebarApps may have changed
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
  if (e.data?.type === 'desk:ask-about' && from && current?.view === from) askAbout({ key: `${from}:${e.data.key || ''}`, label: String(e.data.label || '').slice(0, 120), note: String(e.data.note || '').slice(0, 4000), thread: /^[0-9a-f]{6,}$/.test(e.data.thread || '') ? e.data.thread : null });
  if (e.data?.type === 'desk:discuss' && from && current?.view === from) { if (!shell.classList.contains('panel-open')) togglePanel(true); Thread.focusPanel?.(); }
  if (e.data?.type === 'desk:go' && typeof e.data.hash === 'string' && e.data.hash.startsWith('#/')) go(e.data.hash);
});
addEventListener('hashchange', route);

/* ---------- Start ---------- */
if (store.get('desk.sideHidden', false) && !mobile()) shell.classList.add('side-hidden');
connect();
Promise.all([loadAgents(), loadThreads(), loadJobs(), loadFolders(), api.get('api/views').then((v) => (state.views = v)).catch(() => {})])
  .finally(() => { route(); refreshChips(); });

// All chats: every conversation with an agent, newest first, grouped by day, with search. Runs: the jobs'
// own chats (each scheduled run), kept out of the sidebar so they don't bury the owner's. Archived is a
// link at the bottom of Chats. The sidebar shows only the latest few.
import { api, state, on, agentName } from './api.js';
import { isChat } from './main.js';
import { modelLabel } from './models.js';

const RUNS_PAGE = 60;
let el, ctx, view = 'current', query = '', archived = [], runs = [], runsDone = false, results = null, timer = null;
const isRun = (t) => t.origin?.startsWith('job:');
const keep = (t) => (view === 'runs' ? isRun(t) : isChat(t));

export function init(root, c) {
  el = root; ctx = c;
  el.innerHTML = `<div class="ui-page chats">
    <header class="ui-heading"><div><span class="ui-eyebrow">Conversations</span><h1 class="ui-display">Chats.</h1></div>
      <div class="actions"><a class="ui-btn primary" href="#/new">${ui.icon('square-pen', 'sm')}New chat</a></div></header>
    <div class="ui-pagebar">
      <label class="ui-search"><span class="ui-sr-only">Search chats</span>${ui.icon('search', 'sm')}<input class="ui-input" id="chatQ" placeholder="Search chats" autocomplete="off"></label>
      <div class="ui-seg" id="chatView"><button data-v="current" aria-pressed="true">Chats</button><button data-v="runs" aria-pressed="false">Runs</button></div>
    </div>
    <div id="chatsList"></div></div>`;
  el.querySelector('#chatQ').addEventListener('input', (e) => {
    query = e.target.value.trim();
    clearTimeout(timer);
    timer = setTimeout(search, 200);
  });
  el.addEventListener('click', (e) => {
    const v = e.target.closest('[data-v]');
    if (v) { e.preventDefault(); return setView(v.dataset.v); }
    if (e.target.closest('[data-older]')) { e.preventDefault(); return loadRuns(); }
    const b = e.target.closest('[data-thread-menu]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const t = [...state.threads, ...archived, ...(results || [])].find((x) => x.id === b.dataset.threadMenu);
    if (t) ctx.threadMenu(b, t, { onDeleted: load });
  });
  on('threads', () => { if (el.closest('.shown')) load(); });
}

// #/chats is Chats; #/chats?runs and #/chats?archived open those (the tabs keep the address in step).
export function show(_el, r) {
  const v = 'runs' in (r?.q || {}) ? 'runs' : 'archived' in (r?.q || {}) ? 'archived' : 'current';
  if (v !== view) setView(v); else load();
  el.querySelector('#chatQ').focus({ preventScroll: true });
}

function setView(v) {
  if (v === view) return;
  view = v;
  const hash = v === 'current' ? '#/chats' : `#/chats?${v}`;
  if (location.hash.startsWith('#/chats') && location.hash !== hash) history.replaceState(null, '', hash);
  el.querySelectorAll('#chatView button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.v === view));
  el.querySelector('#chatQ').placeholder = view === 'runs' ? 'Search runs' : view === 'archived' ? 'Search archived chats' : 'Search chats';
  if (view === 'runs') { runs = []; runsDone = false; }
  load();
}

// Job runs, newest first, a page at a time (agentd: ?origin=job&before=<updated>).
async function loadRuns() {
  const before = runs.length ? `&before=${runs[runs.length - 1].updated}` : '';
  const got = (await api.get(`api/agent/threads?origin=job&limit=${RUNS_PAGE}${before}`).catch(() => [])).filter(isRun);
  const known = new Set(runs.map((t) => t.id));
  runs.push(...got.filter((t) => !known.has(t.id)));
  if (got.length < RUNS_PAGE) runsDone = true;
  render(runs);
}
export function title() { return 'Chats'; }

async function load() {
  if (query) return search();
  if (view === 'runs') {
    if (!runs.length && !runsDone) return loadRuns();
    // Live: the newest runs (and ones still working) come from state; older pages stay as loaded.
    const live = new Map(state.threads.filter((t) => isRun(t) && !t.archived).map((t) => [t.id, t]));
    runs = [...live.values(), ...runs.filter((t) => !live.has(t.id))].sort((a, b) => b.updated - a.updated);
    return render(runs);
  }
  if (view === 'archived') archived = (await api.get('api/agent/threads?archived=1').catch(() => [])).filter(isChat);
  render(view === 'archived' ? archived : state.threads.filter(isChat));
}

async function search() {
  if (!query) { results = null; return load(); }
  results = (await api.get(`api/agent/threads?q=${encodeURIComponent(query)}`).catch(() => [])).filter((t) => keep(t) && t.archived === (view === 'archived'));
  render(results);
}

const jobTitle = (t) => { const name = t.origin.slice(4), j = state.jobs.find((x) => x.name === name); return j?.title || name; };
// A run isn't marked unread: nobody opens every nightly run, so the dot would sit on nearly all of them.
// Its glyph shows only what matters: working, needs you, failed.
// What ran it, ahead of what it said: "Opus 5.5 · Funnel: accounts +42%…", "Script · Backup check".
const runModel = (t) => { const m = modelLabel(t, () => view === 'runs' && render(runs)); return m ? `<span class="run-model">${ui.esc(m)}</span> · ` : ''; };
const runRow = (t) => `<a class="ui-row chat-row run-row" href="#/r/${t.id}">
      <span class="lead">${ui.icon('calendar-clock', 'sm')}</span>
      <div class="body"><span class="title">${ui.esc(jobTitle(t))}</span>
        <span class="sub">${runModel(t)}${ui.esc((t.title || t.preview || '').replace(/[#*`_>]/g, '').slice(0, 160) || agentName(t.agent))}</span></div>
      <span class="meta">${ctx.threadGlyph({ ...t, unread: false })}${ui.esc(ui.time(t.updated))}</span>
      <button class="ui-icon-btn more" data-thread-menu="${t.id}" title="More" aria-label="More for this run">${ui.icon('ellipsis', 'sm')}</button></a>`;

// Under the list: older runs, or the way to archived chats (and back).
function foot() {
  if (query) return '';
  if (view === 'runs') return runsDone ? '' : `<div class="chats-foot"><button class="ui-btn sm quiet" data-older>${ui.icon('chevrons-down', 'sm')}Show older runs</button></div>`;
  if (view === 'archived') return `<div class="chats-foot"><button class="ui-btn sm quiet" data-v="current">${ui.icon('arrow-left', 'sm')}Back to chats</button></div>`;
  return `<div class="chats-foot"><button class="ui-btn sm quiet" data-v="archived">${ui.icon('archive', 'sm')}Archived chats</button></div>`;
}

function render(list) {
  const box = el.querySelector('#chatsList');
  if (!list.length) {
    const what = view === 'runs' ? 'runs' : 'chats';
    ui.morph(box, `<div class="ui-empty"><div class="orbit"></div><h2>${query ? `No ${what} match.` : view === 'archived' ? 'Nothing archived.' : view === 'runs' ? 'No runs yet.' : 'No chats yet.'}</h2>
      ${query || view !== 'current' ? '' : `<p>Ask an agent anything, or have it build you an app.</p><a class="ui-btn primary" href="#/new">${ui.icon('square-pen', 'sm')}New chat</a>`}</div>${foot()}`);
    return;
  }
  let day = null, html = '';
  for (const t of list) {
    const d = new Date(t.updated).toDateString();
    if (d !== day) { html += `${day ? '</div>' : ''}<div class="ui-feed-day">${ui.esc(ui.day(t.updated))}</div><div class="ui-group">`; day = d; }
    if (isRun(t)) { html += runRow(t); continue; }
    html += `<a class="ui-row chat-row${t.unread ? ' unread' : ''}" href="#/t/${t.id}">
      <span class="lead">${ui.agentMark(t.agent, agentName(t.agent))}</span>
      <div class="body"><span class="title">${t.pinned ? ui.icon('pin', 'xs') + ' ' : ''}${ui.esc(t.title || 'New chat')}</span>
        <span class="sub">${ui.esc((t.preview || '').replace(/[#*`_>]/g, '').slice(0, 160) || agentName(t.agent))}</span></div>
      <span class="meta">${ctx.threadGlyph(t)}${ui.esc(ui.time(t.updated))}</span>
      <button class="ui-icon-btn more" data-thread-menu="${t.id}" title="More" aria-label="More for ${ui.esc(t.title || 'this chat')}">${ui.icon('ellipsis', 'sm')}</button></a>`;
  }
  ui.morph(box, html + '</div>' + foot());
}

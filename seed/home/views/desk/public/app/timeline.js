// Timeline: everything that happens on this machine, in one place, newest first.
//   Pinned on top   Needs you, as a model read it (needs.mjs: merged, ranked, one line on why each
//                   matters, 👍/👎 to steer it), plus approvals, sign-ins, key requests and setup with
//                   their own buttons, and any flagged item the read doesn't cover yet; then what's
//                   running or queued right now.
//   By day          every job run (its report) and every worth-knowing item, tagged with where it came
//                   from. A job's fine runs fold into one line per day once there are three.
// Search and filters (All / Reports / Failed, one source) sit behind icons in the heading; the bar under
// it shows only while searching or filtered. The calendar icon switches the feed to Upcoming: every
// scheduled run in the next week, by day (GET api/upcoming), a frequent job folded to a line a day.
import { api, state, on, agentName, defaultAgent } from './api.js';
import { signinPanel, terminalSetup } from './signin.js';

let el, ctx, backupInfo = null;
let kind = 'all', from = ''; // filters: all | reports | failed; a source key (job:<name> or src:<Source>)
let query = '', searching = false; // search: needs rows and the feed, by title and text
let upcoming = false, planned = null, plannedAt = 0; // the Upcoming switch, and what's scheduled (fetched at most once a minute)
let history = [], historyDone = false, loadingOlder = false; // job runs fetched beyond what state.threads holds
const openFolds = new Set();
const perms = new Map(); // threadId -> { updated, perm } (the pending permission, fetched once per change)
let read = { items: [] }; // Needs you as the model read it: GET api/needs
const PAGE = 300;

export function init(root, c) {
  el = root; ctx = c;
  el.innerHTML = `
    <div class="ui-page tl-page">
      <header class="ui-heading"><div><span class="ui-eyebrow"><span id="tDate"></span><span id="tSort"></span></span><h1 class="ui-display">Timeline.</h1></div>
        <div class="actions tl-tools"><button class="ui-icon-btn" data-upcoming-btn aria-pressed="false" title="Upcoming" aria-label="Upcoming">${ui.icon('calendar-clock')}</button>
          <button class="ui-icon-btn" data-search-btn title="Search" aria-label="Search">${ui.icon('search')}</button>
          <button class="ui-icon-btn" data-filter-btn title="Filter" aria-label="Filter">${ui.icon('sliders-horizontal')}</button></div></header>
      <div class="ui-pagebar" id="tBar"></div>
      <section class="ui-section" id="tFeed"></section>
    </div>`;
  el.addEventListener('click', onClick);
  el.addEventListener('submit', onSubmit);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-open]')) e.target.click(); });
  el.addEventListener('input', (e) => { if (e.target.matches('[data-q]')) { query = e.target.value.trim().toLowerCase(); renderFeed(); } });
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && e.target.matches('[data-q]')) { query = ''; searching = false; renderAll(); } });
  const shown = () => el.closest('.shown');
  on('threads', () => { if (shown()) renderFeed(); });
  on('jobs', () => { if (shown()) { renderBar(); renderFeed(); } });
  on('agents', () => { if (shown()) renderFeed(); });
  on('signals', () => { if (shown()) { renderBar(); renderFeed(); } });
}

export function show(_el, r) {
  if (r?.q?.from != null) from = r.q.from;
  if (r?.q?.kind) kind = r.q.kind;
  if (r?.q?.view) upcoming = r.q.view === 'upcoming';
  refresh();
}
export function title() { return 'Timeline'; }
export function refresh() {
  if (!el) return;
  el.querySelector('#tDate').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  renderAll(); renderSort();
  api.get('api/backups').then((b) => { backupInfo = b; renderNeeds(); }).catch(() => {});
  loadRead(true);
  if (!history.length) loadOlder(true);
}
function renderAll() { renderBar(); renderFeed(); }
const renderNeeds = () => renderFeed(); // what waits on the owner is part of the feed

// Where each thing came from: a job (job:<name>) or whoever posted a signal (src:<Source>).
const jobOf = (origin) => state.jobs.find((j) => `job:${j.name}` === origin);
const jobTitle = (origin) => jobOf(origin)?.title || origin.replace(/^job:/, '').replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
function sourceOf(n) {
  if (n.kind === 'read') return n.i.sources[0]?.src || '';
  if (n.kind && !n.t && !n.s) return '';
  if (n.t) return n.t.origin?.startsWith('job:') ? n.t.origin : 'chat';
  const s = n.s || n, k = s.key || '';
  if (k.startsWith('job:')) return k;
  if (s.source) return `src:${s.source}`;
  return '';
}
const sourceLabel = (src) => (src.startsWith('job:') ? jobTitle(src) : src === 'chat' ? 'Chat' : src.replace(/^src:/, ''));
const matches = (src) => !from || src === from;
const tag = (src, title = '') => { const l = src ? sourceLabel(src) : ''; return l && l !== title ? `<span class="ui-tag" data-src="${ui.esc(src)}" title="Only ${ui.esc(l)}">${ui.esc(l)}</span>` : ''; };

/* ---------- Needs you ---------- */

// The read, fetched at start, when the Timeline opens (which may start a new one) and on every 'needs' event.
export async function loadRead(opened = false) {
  try { read = await api.get(`api/needs${opened ? '?opened=1' : ''}`); } catch {}
  if (el?.closest('.shown')) { renderSort(); renderFeed(); }
}

// An item stays until the next read, except one whose flagged signals were all handled elsewhere since.
const liveItems = () => read.items.filter((i) => {
  const sigs = i.sources.filter((x) => x.signal);
  return !sigs.length || sigs.some((x) => state.signals.some((s) => s.id === x.signal));
});

function needs() {
  const out = [];
  for (const t of state.threads.filter((x) => x.status === 'waiting')) out.push({ kind: 'permission', t, when: t.updated });
  const items = liveItems(), covered = new Set(items.flatMap((i) => i.sources.map((x) => x.signal).filter(Boolean)));
  for (const i of items) out.push({ kind: 'read', i, when: i.when });
  // A sign-in asked for on this machine is over once the agent is signed in (from anywhere).
  const signedIn = (k) => /^signin:[^@]+$/.test(k || '') && state.agents.some((a) => a.id === k.slice(7) && a.signedIn);
  for (const s of state.signals.filter((x) => x.level === 'needs' && !signedIn(x.key) && !covered.has(x.id))) out.push({ kind: 'signal', s, when: s.updated });
  for (const a of state.agents.filter((x) => x.installed && !x.signedIn && x.id === defaultAgent())) out.push({ kind: 'signin', agent: a.id, title: `Sign in to ${a.name}`, sub: 'Needed before it can chat' });
  for (const v of state.views.filter((x) => x.setupPending)) out.push({ kind: 'simple', icon: v.icon || 'app-window', title: `Set up ${v.title}`, sub: 'An agent will walk you through it', setup: v.name, action: 'Set up' });
  if (backupInfo && !backupInfo.hasPassphrase) out.push({ kind: 'simple', icon: 'shield', title: 'Set a backup passphrase', sub: 'So nightly backups include your keys and sign-ins', href: '#/v/settings#backups', action: 'Set up' });
  return out;
}
export const needsCount = () => needs().length;

// What waits on the owner, as the Today rows that lead the feed: approvals first, then the read's items (in
// its order), flagged items it doesn't cover, sign-ins and setup. Only on the unfiltered view.
function waiting() {
  if (kind !== 'all') return [];
  return needs().filter((n) => (!from || (n.kind === 'read' ? n.i.sources.some((x) => matches(x.src)) : matches(sourceOf(n))))
    && hit(n.i?.title, n.i?.insight, n.s?.title, n.s?.body, n.t?.title, n.title));
}
function renderSort() {
  const by = read.agent === 'claude' || !read.agent ? 'Claude' : agentName(read.agent);
  const t = el.querySelector('#tSort');
  t.title = read.error ? `The last sort failed: ${read.error}` : read.generated ? `What waits on you was sorted by ${by} at ${ui.time(read.generated)}` : '';
  ui.morph(t, read.generating ? '<span class="ui-shimmer">Sorting</span>' : read.error ? '<span class="ui-status"><span class="ui-dot danger"></span>Sort failed</span>' : '');
}

// Agent first: each thing that needs you is a pointer (what, why, when) and a conversation. Ask opens
// the chat beside it about that item (its own chat when it has one); View shows the thing itself;
// Done clears it. Only what an agent can't do for you stays a direct action (approve, paste a key).
const openPanels = new Set();
let focusNext = false;
const ask = (item, primary = true) => `<button class="ui-btn sm${primary ? ' primary' : ''}" data-ask='${ui.esc(JSON.stringify(item))}' aria-label="Chat">${ui.icon('message-square', 'sm')}<span class="label">Chat</span></button>`;
const external = (href) => /^https?:/i.test(href || '');
// Rows without a View keep its space, so every row's actions line up.
const view = (href) => (href ? `<a class="ui-btn sm quiet" href="${ui.esc(href)}"${external(href) ? ' target="_blank" rel="noopener"' : ''}>View</a>` : '<span class="ui-btn sm quiet" aria-hidden="true" style="visibility:hidden">View</span>');
const done = (attrs) => `<button class="ui-icon-btn more done" ${attrs} title="Done" aria-label="Done">${ui.icon('check')}</button>`;
const btn = (label, attrs, primary = true) => `<button class="ui-btn sm${primary ? ' primary' : ''}" ${attrs}>${label}</button>`;

function needRow(n) {
  if (n.kind === 'read') return readRow(n.i);
  const src = n.t || n.s ? sourceOf(n) : '';
  if (n.kind === 'permission') {
    const { t } = n, perm = perms.get(t.id)?.perm, tc = perm?.toolCall || {};
    const cmd = tc.rawInput?.command || tc.rawInput?.file_path || tc.rawInput?.path || '';
    const opts = perm?.options || [], allow = opts.find((o) => o.kind === 'allow_once') || opts.find((o) => o.kind?.startsWith('allow'));
    const deny = opts.find((o) => o.kind?.startsWith('reject'));
    return task({ id: `p:${t.id}`, src, icon: 'lock', title: t.title || 'A chat', when: t.updated, keep: true,
      sub: `${agentName(t.agent)} wants to ${tc.title ? tc.title.replace(/^./, (c) => c.toLowerCase()) : 'take an action'}`,
      code: cmd ? String(Array.isArray(cmd) ? cmd.join(' ') : cmd) : '',
      acts: (perm && allow ? btn('Allow', `data-perm="${t.id}:${perm.id}:${ui.esc(allow.optionId)}"`) : '')
        + (perm && deny ? btn('Deny', `data-perm="${t.id}:${perm.id}:${ui.esc(deny.optionId)}"`, false) : '')
        + ask({ thread: t.id }, !(perm && allow)) });
  }
  if (n.kind === 'signal') {
    const { s } = n, k = s.key || '';
    const clear = done(`data-dismiss="${s.id}"`);
    if (k.startsWith('job:')) {
      const name = k.slice(4), t = state.threads.find((x) => x.id === s.thread_id), agentRun = t && t.agent !== 'shell';
      return task({ id: `s:${s.id}`, src, icon: 'circle-x', danger: true, title: s.title, when: s.updated, sub: s.body || 'See the run for details',
        open: { ask: agentRun ? { thread: t.id } : null },
        acts: ask(agentRun ? { thread: t.id } : { key: `job:${name}`, label: s.title,
          note: `The job "${name}" failed: ${s.body || 'no details'}. Its run is thread ${s.thread_id || '?'} (curl -s localhost:8090/threads/${s.thread_id}); the job is in ~/home/jobs/${name}/. The owner wants to talk about it: find out why, fix what you can, run it again if that makes sense.` })
          + view(s.href) + clear });
    }
    if (k.startsWith('secret:')) {
      const name = k.slice(7);
      return task({ id: `s:${s.id}`, src, icon: 'key-round', title: `${s.source || 'An agent'} needs ${name}`, when: s.updated, sub: s.body || '', keep: true,
        acts: btn('Add key', `data-expand="s:${s.id}"`) + (s.thread_id ? ask({ thread: s.thread_id }, false) : '') + clear,
        panel: `<form data-secret="${ui.esc(name)}"><label class="ui-sr-only" for="sk${s.id}">Value for ${ui.esc(name)}</label>
          <input class="ui-input ui-mono" id="sk${s.id}" name="value" type="password" placeholder="Paste ${ui.esc(name)}" autocomplete="off" data-focus><button class="ui-btn sm primary">Save</button></form>` });
    }
    // A coding agent's sign-in lapsed (posted by a job: `signal --needs --key signin:<agent>[@<sprite>]`).
    if (k.startsWith('signin:')) {
      const [agent, sprite] = k.slice(7).split('@');
      return signinRow({ id: `s:${s.id}`, src, agent, sprite, title: s.title, sub: s.body, when: s.updated, signalKey: k,
        more: (s.thread_id ? ask({ thread: s.thread_id }, false) : '') + clear });
    }
    if (k.startsWith('mail:')) {
      const id = k.slice(5);
      const item = { key: `mail:${id}`, label: `Email: ${s.title}`, note: `This is about the email with Mail id ${id}: "${s.title}" (${s.body || ''}). Read it with \`gmail show ${id}\`; act with \`gmail reply ${id}\` (text on stdin) or \`gmail archive ${id}\`. Do what the owner asks.` };
      return task({ id: `s:${s.id}`, src, icon: 'mail', title: s.title, when: s.updated, sub: s.body || '', open: { ask: item },
        acts: ask(item, false) + view(s.href) + clear });
    }
    return signalRow(s, true);
  }
  if (n.kind === 'signin') return signinRow({ id: `g:${n.agent}`, agent: n.agent, title: n.title, sub: n.sub });
  if (n.kind === 'more') return `<button class="ui-feed-row tl-wait tl-more" data-group="${ui.esc(n.group)}"><span class="time"></span><span class="lead">${ui.icon('chevrons-down', 'sm')}</span>
    <span class="title">${n.count} more from ${ui.esc(n.group)}</span></button>`;
  return task({ id: `x:${n.title}`, icon: n.icon, title: n.title, sub: n.sub, keep: true,
    acts: n.setup ? btn(n.action, `data-setup="${n.setup}"`) : `<a class="ui-btn sm primary" href="${n.href}">${n.action}</a>` });
}

// Any item a job, agent, app or connector posted (signal / POST /signals): its own icon, who it's
// from, Chat with the note it came with (how to act on it), View (a route, or a URL in a new tab), Done.
function signalRow(s, primary) {
  return task({ id: `s:${s.id}`, src: sourceOf(s), icon: s.icon || (s.thread_id ? 'message-circle-question' : s.level === 'needs' ? 'circle-alert' : 'bell'), title: s.title, when: s.updated, sub: s.body || '',
    open: { ask: askItem(s) }, acts: ask(askItem(s), false) + view(s.href) + done(`data-dismiss="${s.id}"`) });
}
// An item from the read: why it matters underneath, what it came from, Chat (its new chat starts with the
// suggested next step in the box, unless Settings → Needs you turns starter prompts off) / View / Done,
// and 👍 / 👎 for what should show here.
function readRow(i) {
  const first = i.sources[0];
  const vote = (v, icon, label) => `<button class="ui-icon-btn more vote" data-vote="${ui.esc(i.id)}:${v}" aria-pressed="${i.vote === v}" title="${label}" aria-label="${label}">${ui.icon(icon, 'sm')}</button>`;
  const chat = { key: `needs:${i.id}`, label: i.title, note: readNote(i), ...(i.action && read.starter !== false ? { text: i.action.ask } : {}) };
  return task({ id: `r:${i.id}`, src: first?.src || '', icon: i.kind === 'watch' ? 'eye' : first?.icon || 'circle-alert', title: i.title, when: i.when, sub: i.insight,
    open: { ask: chat }, acts: ask(chat, false) + view(first?.href)
      + vote('up', 'thumbs-up', 'More like this') + vote('down', 'thumbs-down', 'Less like this') + done(`data-read-done="${ui.esc(i.id)}"`) });
}

// How an agent reads each source an item points at.
function readNote(i) {
  const how = (x) => {
    const [type, id] = x.ref.split(/:(.*)/);
    if (type === 'run') return `${x.label} run: curl -s localhost:8090/runs/thread/${id} (its report), the work in thread ${id}`;
    if (type === 'mail') return `email Mail id ${id}: gmail show ${id} (reply: gmail reply ${id}, archive: gmail archive ${id})`;
    if (type === 'signal') return `Timeline item ${id}${x.key ? ` (key ${x.key}; take it off with signal --clear ${x.key})` : ''}: curl -s localhost:8090/signals`;
    if (type === 'job') return `the job in ~/home/jobs/${id}/`;
    return `${x.label}: ${x.href}`;
  };
  return `In Needs you on the Timeline (sorted by a model): "${i.title}". ${i.insight} Sources: ${i.sources.map(how).join('; ')}.${i.action ? ` Suggested next step: ${i.action.ask}` : ''} Do what the owner asks.`;
}

// What an agent gets when the owner presses Chat on an item: its own chat, or the item and how to act on it.
function askItem(s) {
  if (s.thread_id && !s.note) return { thread: s.thread_id };
  const note = [`About this item on the Timeline: "${s.title}"${s.body ? `: ${s.body}` : ''}${s.source ? ` (from ${s.source})` : ''}.`,
    s.note ? `How to act on it: ${s.note}` : '', external(s.href) ? `Link: ${s.href}` : '', 'Do what the owner asks; when it\'s handled, run signal --clear ' + (s.key || '') + ' if it has a key.'].filter(Boolean).join(' ');
  return { key: s.key || `signal:${s.id}`, label: s.title, note };
}

// A source with many items (a connector's sync: twelve PRs to review) shows three, then "N more".
const openGroups = new Set();
function grouped(list) {
  const groupOf = (n) => (n.kind === 'signal' && n.s.source && !/^(job|secret|ask|mail|signin):/.test(n.s.key || '') ? n.s.source : null);
  const total = new Map(), seen = new Map(), out = [];
  for (const n of list) { const g = groupOf(n); if (g) total.set(g, (total.get(g) || 0) + 1); }
  for (const n of list) {
    const g = groupOf(n);
    if (!g || total.get(g) <= 4 || openGroups.has(g)) { out.push(n); continue; }
    const k = (seen.get(g) || 0) + 1; seen.set(g, k);
    if (k <= 3) out.push(n);
    if (k === 3) out.push({ kind: 'more', group: g, count: total.get(g) - 3 });
  }
  return out;
}

// Sign in right here: the row opens the sign-in steps (signin.js), which stay live across re-renders.
function signinRow({ id, src = '', agent, sprite = '', title, sub, when, signalKey = '', more = '' }) {
  const a = state.agents.find((x) => x.id === agent);
  // Signs in through its own menus (OpenCode, Pi): its terminal, with the steps queued.
  if (a && !a.signin && !sprite) return task({ id, src, icon: 'key-round', title, sub, when, keep: true, acts: btn('Open the terminal', `data-term-setup="${ui.esc(agent)}"`) + more });
  return task({ id, src, icon: 'key-round', title, sub, when, keep: true,
    acts: btn(openPanels.has(id) ? 'Close' : 'Sign in', `data-expand="${ui.esc(id)}"`, !openPanels.has(id)) + more,
    panel: `<div class="sg-mount" data-keep data-sg-id="${ui.esc(id)}" data-agent="${ui.esc(agent)}" data-sprite="${ui.esc(sprite)}" data-signal-key="${ui.esc(signalKey)}"></div>` });
}

const signins = new Map(); // row id -> { el, panel }
function mountSignins(sec) {
  for (const [id, m] of signins) if (!m.el.isConnected) { m.panel.stop(); signins.delete(id); }
  for (const box of sec.querySelectorAll('.sg-mount')) {
    const id = box.dataset.sgId;
    if (signins.get(id)?.el === box) continue;
    const panel = signinPanel(box, box.dataset.agent, {
      sprite: box.dataset.sprite || null,
      onDone: () => {
        const key = box.dataset.signalKey;
        if (key) api.post('api/agent/signals/clear', { key }).catch(() => {});
        setTimeout(() => { openPanels.delete(id); renderNeeds(); }, 1600);
      },
    });
    signins.set(id, { el: box, panel });
  }
}

// On touch (no hover), a waiting row shows Done and this; the rest of its buttons are in its menu.
const menuBtn = `<button class="ui-icon-btn more tl-menu" data-acts-menu title="More" aria-label="More">${ui.icon('ellipsis')}</button>`;

// A waiting row, shaped like every other feed row: how long it's waited · an amber icon · title, source,
// one line · its buttons (on hover, unless it needs a direct answer: keep) · a drawer for sign-ins and keys.
// open: what clicking the row does (its chat).
function task({ id, src = '', icon, danger, title, when, sub, code = '', acts = '', panel = '', keep = false, open: onRow = null }) {
  const open = panel && openPanels.has(id);
  return `<div class="ui-feed-row tl-wait${open ? ' open' : ''}${keep || open ? ' keep' : ''}" data-task="${ui.esc(id)}"${onRow ? ` data-open='${ui.esc(JSON.stringify(onRow))}' tabindex="0"` : ''}>
    <span class="time">${when ? ui.esc(ui.ago(when)) : 'now'}</span><span class="lead${danger ? ' danger' : ''}">${ui.icon(icon, 'sm')}</span>
    <span class="title">${ui.esc(title)}</span>${tag(src, title)}<span class="acts">${acts}${keep ? '' : menuBtn}</span>
    ${code ? `<code class="sub code">${ui.esc(code)}</code>` : `<span class="sub"${sub ? ` title="${ui.esc(sub)}"` : ''}>${ui.esc(sub || '')}</span>`}
    ${open ? `<div class="drawer">${panel}</div>` : ''}
  </div>`;
}

// The pending permission of a waiting chat: its tool call and options, for approving from here.
async function loadPerm(t) {
  const have = perms.get(t.id);
  if (have && have.updated === t.updated) return;
  perms.set(t.id, { updated: t.updated, perm: have?.perm || null });
  try {
    const r = await api.get(`api/agent/threads/${t.id}`);
    const perm = [...r.items].reverse().find((i) => i.kind === 'permission' && !i.outcome) || null;
    perms.set(t.id, { updated: t.updated, perm });
    renderNeeds();
  } catch {}
}

/* ---------- Filters ---------- */

function sources() {
  const srcs = new Map();
  for (const j of state.jobs) srcs.set(`job:${j.name}`, j.title || j.name);
  for (const s of state.signals) if (s.source && s.level !== 'brief' && !(s.key || '').startsWith('job:')) srcs.set(`src:${s.source}`, s.source);
  if (from && !srcs.has(from)) srcs.set(from, sourceLabel(from));
  return [...srcs].sort((a, b) => a[1].localeCompare(b[1]));
}

// Only while searching or filtered: the search box, and each filter as a chip that takes it off.
function renderBar() {
  const f = el.querySelector('[data-filter-btn]');
  if (kind !== 'all' || from) f.setAttribute('data-dot', ''); else f.removeAttribute('data-dot');
  const bar = el.querySelector('#tBar'), x = ui.icon('x', 'sm');
  const chips = (kind !== 'all' ? `<button class="ui-chip on" data-kind="all" title="Remove">${kind === 'failed' ? 'Failed' : 'Reports'}${x}</button>` : '')
    + (from ? `<button class="ui-chip on" data-from-clear title="Remove">${ui.esc(sourceLabel(from))}${x}</button>` : '');
  bar.style.display = searching || query || chips ? '' : 'none';
  const had = bar.querySelector('[data-q]');
  if (searching || query) {
    if (!had) bar.innerHTML = `<label class="ui-search"><span class="ui-sr-only">Search the Timeline</span>${ui.icon('search', 'sm')}<input class="ui-input" data-q placeholder="Search the Timeline" autocomplete="off"></label><div class="ui-chips"></div>`;
  } else bar.innerHTML = '<div class="ui-chips"></div>';
  const q = bar.querySelector('[data-q]');
  if (q && q.value.trim().toLowerCase() !== query) q.value = query;
  ui.morph(bar.querySelector('.ui-chips'), chips);
}

function filterMenu(anchor) {
  const m = document.createElement('div');
  m.className = 'ui-popover tl-filters';
  const paint = () => {
    m.innerHTML = `<span class="ui-label">Show</span><div class="ui-chips">${[['all', 'Everything'], ['reports', 'Reports'], ['failed', 'Failed']].map(([v, l]) => `<button class="ui-chip" data-k="${v}" aria-pressed="${kind === v}">${l}</button>`).join('')}</div>
      <span class="ui-label">From</span><div class="ui-chips">${[['', 'Anywhere'], ...sources()].map(([v, l]) => `<button class="ui-chip" data-f="${ui.esc(v)}" aria-pressed="${from === v}">${ui.esc(l)}</button>`).join('')}</div>
      ${kind !== 'all' || from ? '<hr><div class="clear"><button class="ui-link-action" data-c>Clear filters</button></div>' : ''}`;
  };
  paint();
  m.onclick = (e) => {
    const k = e.target.closest('[data-k]'), f = e.target.closest('[data-f]');
    if (k) kind = k.dataset.k; else if (f) from = f.dataset.f; else if (e.target.closest('[data-c]')) { kind = 'all'; from = ''; } else return;
    paint(); renderAll();
  };
  ui.popover(anchor, m, { temp: true, align: 'end' });
}

const isRunning = (t) => t.running || t.status === 'running';

// Running and queued runs, right after what's waiting.
function nowRows() {
  const running = state.threads.filter((t) => t.origin?.startsWith('job:') && isRunning(t) && matches(t.origin) && listed(t) && hit(t.title, jobTitle(t.origin)));
  const busy = new Set(running.map((t) => t.origin));
  const queued = state.jobs.filter((j) => j.queued && !busy.has(`job:${j.name}`) && matches(`job:${j.name}`) && (!j.timeline || from === `job:${j.name}`) && hit(j.title, j.name));
  // Long work outside a job run (signal --running): a cycle, an import, with its progress.
  const work = state.signals.filter((x) => x.level === 'running' && matches(sourceOf(x)) && hit(x.title, x.body, x.source));
  return work.map((x) => workRow(x)).join('') + running.map((t) => runRow(t)).join('') + queued.map((j) => `<a class="ui-feed-row" href="#/jobs/${ui.esc(j.name)}">
      <span class="time">${ui.esc(j.queued.at ? ui.time(j.queued.at) : '')}</span><span class="ui-dot"></span>
      <span class="title">${ui.esc(j.title || j.name)}</span><span class="chev">›</span>
      <span class="sub">${j.queued.how === 'retry' && j.queued.at ? `Trying again at ${ui.esc(ui.time(j.queued.at))}` : 'Queued: starts when there\'s room'}</span></a>`).join('');
}

function workRow(x) {
  const src = sourceOf(x), started = x.created || x.updated;
  return `<a class="ui-feed-row" href="${ui.esc(x.href || (x.thread_id ? `#/t/${x.thread_id}` : '#/'))}"><span class="time">${ui.time(started)}</span><span class="ui-dot run"></span>
    <span class="title">${ui.esc(x.title)}</span>${tag(src, x.title)}<span class="chev">›</span>
    <span class="sub"><span class="ui-shimmer">Running</span> · ${ui.esc((x.body || `started ${ui.ago(started)}`).slice(0, 200))}</span></a>`;
}

/* ---------- The feed: runs and worth-knowing items, by day ---------- */

// Every job run we know of: the live list (state.threads, newest 200 of everything) plus older pages.
function runs() {
  const byId = new Map();
  for (const t of history) byId.set(t.id, t);
  for (const t of state.threads) if (t.origin?.startsWith('job:')) byId.set(t.id, t);
  return [...byId.values()].sort((a, b) => b.updated - a.updated);
}

async function loadOlder(first = false) {
  if (loadingOlder || historyDone) return;
  loadingOlder = true;
  const all = runs(), before = first || !all.length ? '' : `&before=${all[all.length - 1].updated}`;
  try {
    const got = (await api.get(`api/agent/threads?origin=job&limit=${PAGE}${before}`)).filter((t) => t.origin?.startsWith('job:'));
    const known = new Set(history.map((t) => t.id));
    const fresh = got.filter((t) => !known.has(t.id));
    history.push(...fresh);
    if (got.length < PAGE || (!first && !fresh.length)) historyDone = true;
  } catch { historyDone = true; }
  loadingOlder = false;
  renderFeed();
}

// A job's "On the Timeline" setting (job.json timeline: failures | never) keeps its runs out of the feed,
// unless you're looking at that job (#/?from=job:<name>). Failures still wait under Needs you.
const listed = (t) => { const w = jobOf(t.origin)?.timeline; return from === t.origin || !w || (w === 'failures' && t.status === 'error'); };
const isReport = (t) => jobOf(t.origin)?.report !== false && t.status !== 'error';
const fine = (t) => t.status === 'idle' && !isRunning(t);

const hit = (...texts) => !query || texts.some((x) => String(x || '').toLowerCase().includes(query));

function renderFeed() {
  const sec = el.querySelector('#tFeed');
  el.querySelector('[data-upcoming-btn]').setAttribute('aria-pressed', upcoming);
  if (upcoming) { mountSignins(sec); return renderUpcoming(sec); }
  const wait = waiting();
  for (const n of wait) if (n.kind === 'permission') loadPerm(n.t);
  const top = (kind === 'all' ? grouped(wait).map(needRow).join('') : '') + (kind !== 'failed' ? nowRows() : '');
  let list = runs().filter((t) => !isRunning(t) && matches(t.origin) && listed(t) && hit(t.title, t.preview, t.error, jobTitle(t.origin)));
  if (kind === 'failed') list = list.filter((t) => t.status === 'error');
  if (kind === 'reports') list = list.filter(isReport);
  const entries = list.map((t) => ({ when: t.updated, t }));
  if (kind === 'all') for (const s of state.signals.filter((x) => x.level === 'notable' && matches(sourceOf(x)) && hit(x.title, x.body, x.source))) entries.push({ when: s.updated, s });
  entries.sort((a, b) => b.when - a.when);

  // A job's fine runs on one day fold into a line at the latest one, once there are three.
  const counts = new Map(), key = (t) => `${t.origin}|${new Date(t.updated).toDateString()}`;
  for (const e of entries) if (e.t && fine(e.t)) counts.set(key(e.t), (counts.get(key(e.t)) || 0) + 1);
  const out = [], folds = new Map();
  for (const e of entries) {
    const k = !query && e.t && fine(e.t) && counts.get(key(e.t)) >= 3 ? key(e.t) : null; // searching shows each match
    if (!k) { out.push(e); continue; }
    if (!folds.has(k)) { const f = { when: e.when, fold: k, items: [] }; folds.set(k, f); out.push(f); }
    folds.get(k).items.push(e.t);
  }

  if (!out.length && !top) {
    mountSignins(sec);
    ui.morph(sec, kind !== 'all' || from || query ? `<div class="ui-empty"><h2>Nothing here.</h2><button class="ui-link-action" data-clear>Clear ${query ? 'search and filters' : 'filters'}</button></div>`
      : `<div class="ui-empty"><div class="orbit"></div><h2>Nothing yet.</h2><p>Every job run and its report lands here, with anything worth knowing.</p><a class="ui-link-action" href="#/jobs">Set up a job</a></div>`);
    return;
  }
  // Today starts with what's waiting and what's running, then the day's runs; earlier days below.
  let day = new Date().toDateString(), html = top ? `<div class="ui-feed-day">${ui.esc(ui.day(Date.now()))}</div>${top}` : '';
  if (!top) day = null;
  for (const e of out) {
    const d = new Date(e.when).toDateString();
    if (d !== day) { day = d; html += `<div class="ui-feed-day">${ui.esc(ui.day(e.when))}</div>`; }
    html += e.fold ? foldRow(e) : e.t ? runRow(e.t) : knowRow(e.s);
  }
  ui.morph(sec, `<div class="ui-feed">${html}</div>
    ${historyDone ? '' : `<button class="ui-btn quiet muted tl-older" data-older>${loadingOlder ? 'Loading…' : 'Show older'}</button>`}`);
  mountSignins(sec);
  const want = sec.querySelector('.tl-wait.open [data-focus]');
  if (want && focusNext) { want.focus(); focusNext = false; }
}

// Upcoming: what's scheduled, by day. A job that runs more than three times a day is one line for the day
// (from its first run, with how often and how many); the rest are a row per run. Each opens the job.
async function renderUpcoming(sec) {
  if (!planned || Date.now() - plannedAt > 60e3) {
    if (!planned) ui.morph(sec, '<div class="ui-loading">Loading</div>');
    try { planned = await api.get('api/upcoming?days=7'); plannedAt = Date.now(); } catch { planned = planned || []; }
    if (!upcoming) return;
  }
  const list = planned.filter((p) => p.at > Date.now() && matches(`job:${p.job}`) && hit(p.title, p.describe));
  if (!list.length) {
    ui.morph(sec, `<div class="ui-empty"><div class="orbit"></div><h2>Nothing scheduled.</h2><p>${from || query ? 'Nothing matches in the next week.' : 'No job runs in the next week.'}</p><a class="ui-link-action" href="#/jobs">Jobs</a></div>`);
    return;
  }
  const days = new Map();
  for (const p of list) { const d = new Date(p.at).toDateString(); if (!days.has(d)) days.set(d, []); days.get(d).push(p); }
  let html = '';
  for (const [, items] of days) {
    html += `<div class="ui-feed-day">${ui.esc(ui.day(items[0].at))}</div>`;
    const per = new Map();
    for (const p of items) per.set(p.job, (per.get(p.job) || 0) + 1);
    const shown = new Set();
    for (const p of items) {
      const n = per.get(p.job);
      if (n > 3) {
        if (shown.has(p.job)) continue;
        shown.add(p.job);
        const last = items.filter((x) => x.job === p.job).pop();
        html += planRow(p, `${p.describe} · ${n} runs, until ${ui.time(last.at)}`);
      } else html += planRow(p, p.describe);
    }
  }
  ui.morph(sec, `<div class="ui-feed tl-plan">${html}</div>`);
}
const planRow = (p, sub) => `<a class="ui-feed-row" href="#/jobs/${ui.esc(p.job)}"><span class="time">${ui.time(p.at)}</span><span class="ui-dot scheduled"></span>
  <span class="title">${ui.esc(p.title)}</span><span class="chev">›</span><span class="sub">${ui.esc(sub || '')}</span></a>`;

// A run: time · status · the report's title (or the job's) · where it came from · what it said.
function runRow(t) {
  const job = jobOf(t.origin), jt = jobTitle(t.origin);
  const dot = t.status === 'waiting' ? 'warn' : t.status === 'error' ? 'danger' : isRunning(t) ? 'run' : t.unread ? 'accent' : 'ok';
  const title = t.title || jt;
  const sub = t.status === 'waiting' ? 'Needs you: approve an action' : t.status === 'error' ? (t.error || t.preview || 'Failed')
    : isRunning(t) ? '' : /^(i )?published the report\.?$/i.test((t.preview || '').trim()) ? '' : (t.preview || 'Done');
  return `<a class="ui-feed-row" href="#/${job?.report === false ? 't' : 'r'}/${t.id}"><span class="time">${ui.time(isRunning(t) ? t.created || t.updated : t.updated)}</span><span class="ui-dot ${dot}"></span>
    <span class="title">${ui.esc(title)}</span>${tag(t.origin, title)}<span class="chev">›</span>
    ${!sub && !isRunning(t) ? '' : `<span class="sub${t.status === 'error' ? ' danger' : ''}">${isRunning(t) ? `<span class="ui-shimmer">Running</span> · started ${ui.esc(ui.ago(t.created || t.updated))}` : ui.esc(sub.replace(/[#*`_>]/g, '').slice(0, 200))}</span>`}</a>`;
}

function foldRow(f) {
  const open = openFolds.has(f.fold), t = f.items[0], jt = jobTitle(t.origin);
  const latest = f.items.find((x) => x.title && x.title !== jt); // the newest run that titled its report
  return `<button class="ui-feed-row tl-fold" data-fold="${ui.esc(f.fold)}" aria-expanded="${open}"><span class="time">${ui.time(t.updated)}</span><span class="ui-dot ok"></span>
      <span class="title">${ui.esc(jt)}</span><span class="chev">${ui.icon('chevron-down', 'sm')}</span>
      <span class="sub">${f.items.length} runs, all fine · since ${ui.esc(ui.time(f.items[f.items.length - 1].updated))}${latest ? ` · latest: ${ui.esc(latest.title.replace(/[#*`_>]/g, '').slice(0, 120))}` : ''}</span></button>
    ${open ? `<div class="tl-folded">${f.items.map((x) => runRow(x)).join('')}</div>` : ''}`;
}

// Worth knowing (`signal "…"`): opens what it points at (or a chat about it); Chat and Done beside it.
function knowRow(s) {
  const src = sourceOf(s);
  return `<div class="ui-feed-row tl-know" data-open='${ui.esc(JSON.stringify(s.href ? { href: s.href } : { ask: askItem(s) }))}' tabindex="0">
    <span class="time">${ui.time(s.updated)}</span><span class="lead">${ui.icon(s.icon || 'bell', 'sm')}</span>
    <span class="title">${ui.esc(s.title)}</span>${tag(src, s.title)}
    <span class="acts"><button class="ui-icon-btn plain" data-ask='${ui.esc(JSON.stringify(askItem(s)))}' title="Chat about this" aria-label="Chat about this">${ui.icon('message-square', 'sm')}</button><button class="ui-icon-btn plain" data-dismiss="${s.id}" title="Done" aria-label="Done">${ui.icon('check', 'sm')}</button></span>
    ${s.body ? `<span class="sub">${ui.esc(s.body)}</span>` : ''}</div>`;
}

/* ---------- Actions ---------- */

async function onClick(e) {
  const mb = e.target.closest('[data-acts-menu]');
  if (mb) { e.preventDefault(); return actsMenu(mb); }
  const q = e.target.closest('[data-ask]');
  if (q) { e.preventDefault(); return ctx.askAbout(JSON.parse(q.dataset.ask)); }
  const ts = e.target.closest('[data-term-setup]');
  if (ts) { const a = state.agents.find((x) => x.id === ts.dataset.termSetup); if (a) terminalSetup(a); return; }
  const g = e.target.closest('[data-group]');
  if (g) { openGroups.add(g.dataset.group); return renderNeeds(); }
  // A tag shows only that source; tabs and the source picker filter; a fold opens in place.
  const src = e.target.closest('.ui-tag[data-src]');
  if (src) { e.preventDefault(); from = src.dataset.src; renderAll(); return el.querySelector('.ui-heading').scrollIntoView({ block: 'nearest' }); }
  const k = e.target.closest('[data-kind]');
  if (k) { kind = k.dataset.kind; return renderAll(); }
  if (e.target.closest('[data-from-clear]')) { from = ''; return renderAll(); }
  if (e.target.closest('[data-clear]')) { kind = 'all'; from = ''; query = ''; searching = false; return renderAll(); }
  const fb = e.target.closest('[data-filter-btn]');
  if (fb) return filterMenu(fb);
  if (e.target.closest('[data-upcoming-btn]')) { upcoming = !upcoming; return renderAll(); }
  if (e.target.closest('[data-search-btn]')) {
    searching = !(searching || query) ; if (!searching) query = '';
    renderAll(); return el.querySelector('[data-q]')?.focus();
  }
  const f = e.target.closest('[data-fold]');
  if (f) { const id = f.dataset.fold; if (openFolds.has(id)) openFolds.delete(id); else openFolds.add(id); return renderFeed(); }
  if (e.target.closest('[data-older]')) { loadOlder(); return renderFeed(); }
  const rd = e.target.closest('[data-vote],[data-read-done]');
  if (rd) return readAct(rd);
  const b = e.target.closest('[data-perm],[data-dismiss],[data-run],[data-setup],[data-fix],[data-expand]');
  if (!b) {
    const o = e.target.closest('[data-open]');
    if (o && !e.target.closest('a,button,input,form,.drawer')) { const x = JSON.parse(o.dataset.open); if (x.href) { if (external(x.href)) window.open(x.href, '_blank', 'noopener'); else ctx.go(x.href); } else if (x.ask) ctx.askAbout(x.ask); }
    return;
  }
  if (!b) return;
  e.preventDefault();
  act(b);
}

// A waiting row's other buttons (Chat, View, 👍, 👎) as a menu; each item presses the real one.
function actsMenu(b) {
  const m = document.createElement('div');
  m.className = 'ui-menu';
  for (const x of b.parentElement.children) {
    if (x === b || x.matches('.done, [aria-hidden="true"]')) continue;
    const i = document.createElement('button');
    i.innerHTML = `${x.querySelector('.ui-icon')?.outerHTML || ui.icon(x.matches('a') ? 'arrow-up-right' : 'circle', 'sm')}<span>${ui.esc(x.getAttribute('aria-label') || x.title || x.textContent.trim())}</span>${x.getAttribute('aria-pressed') === 'true' ? ui.icon('check', 'sm') : ''}`;
    i.onclick = () => x.click();
    m.append(i);
  }
  ui.popover(b, m, { temp: true, align: 'end' });
}

async function readAct(b) {
  b.disabled = true;
  try {
    if (b.dataset.vote) {
      const [id, v] = b.dataset.vote.split(':'), item = read.items.find((x) => x.id === id);
      await api.post(`api/needs/${id}/${v}`);
      if (item?.vote !== v) ui.toast(v === 'up' ? 'More like this from now on' : 'Less like this from now on', { icon: v === 'up' ? 'thumbs-up' : 'thumbs-down' });
    } else await api.post(`api/needs/${b.dataset.readDone}/done`);
    await loadRead();
  } catch (err) { ui.toast(err.message, { icon: 'circle-alert' }); }
  b.disabled = false;
}

async function act(b) {
  if (b.dataset.expand) {
    const id = b.dataset.expand;
    if (openPanels.has(id)) openPanels.delete(id); else { openPanels.add(id); focusNext = true; }
    return renderNeeds();
  }
  b.disabled = true;
  try {
    if (b.dataset.perm) {
      const [id, item, ...opt] = b.dataset.perm.split(':');
      await api.post(`api/agent/threads/${id}/permissions/${item}`, { optionId: opt.join(':') });
    } else if (b.dataset.dismiss) {
      await api.post(`api/agent/signals/${b.dataset.dismiss}/dismiss`);
    } else if (b.dataset.run) {
      await api.post(`api/agent/jobs/${b.dataset.run}/run`);
      ui.toast('Running again', { icon: 'play' });
    } else if (b.dataset.fix) {
      const s = state.signals.find((x) => String(x.id) === b.dataset.fix);
      const t = await api.post('api/agent/threads', { title: `Fix ${s.source || 'a job'}`, text: `${s.title}${s.body ? `: ${s.body}` : ''}\n\nLook at the run${s.thread_id ? ` (thread ${s.thread_id}, \`curl -s localhost:8090/threads/${s.thread_id}\`)` : ''} and the job's folder in ~/home/jobs/${s.key.slice(4)}/, find out why it failed, and fix it if you can. Then tell me what was wrong and what you changed.` });
      ctx.go(`#/t/${t.id}`);
    } else if (b.dataset.setup) {
      const r = await api.post(`api/views/${b.dataset.setup}/setup`);
      if (r.threadId) ctx.go(`#/t/${r.threadId}`);
    }
  } catch (err) { b.disabled = false; ui.toast(err.message, { icon: 'circle-alert' }); }
}

async function onSubmit(e) {
  const k = e.target.closest('[data-secret]');
  if (k) {
    e.preventDefault();
    const value = k.elements.value.value;
    if (!value) return k.elements.value.focus();
    k.querySelectorAll('input,button').forEach((x) => (x.disabled = true));
    try { await api.post('api/secrets', { name: k.dataset.secret, value }); ui.toast(`Saved ${k.dataset.secret}`, { icon: 'key-round' }); }
    catch (err) { k.querySelectorAll('input,button').forEach((x) => (x.disabled = false)); ui.toast(err.message, { icon: 'circle-alert' }); }
    return;
  }
  const f = e.target.closest('[data-reply]');
  if (!f) return;
  e.preventDefault();
  const text = f.elements.text.value.trim();
  if (!text) return f.elements.text.focus();
  f.querySelectorAll('input,button').forEach((x) => (x.disabled = true));
  try {
    await api.post(`api/agent/threads/${f.dataset.reply}/messages`, { text });
    ui.toast('Sent', { icon: 'send' });
  } catch (err) {
    f.querySelectorAll('input,button').forEach((x) => (x.disabled = false));
    ui.toast(err.message, { icon: 'circle-alert' });
  }
}

/* ---------- Shared with Jobs ---------- */

export function nextLabel(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const same = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now.getTime() + 86400000).toDateString() === d.toDateString();
  const t = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return same ? `Next ${t}` : tomorrow ? `Tomorrow ${t}` : `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${t}`;
}


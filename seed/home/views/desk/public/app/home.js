// Today: what needs you, your Views, what's coming, what your jobs did.
// (Chatting is the button in the corner of every page, or Chat in the sidebar.)
import { api, state, on, agentName, defaultAgent } from './api.js';

let el, ctx, backupInfo = null;

export function init(root, c) {
  el = root; ctx = c;
  el.innerHTML = `
    <div class="ui-page home">
      <header class="ui-heading"><div><span class="ui-eyebrow" id="hDate"></span><h1 class="ui-display">Today.</h1></div></header>
      <section class="ui-section" id="hNeeds"></section>
      <section class="ui-section"><header><span class="ui-label">Views</span><div class="ui-spacer"></div><a class="ui-btn quiet muted" href="#/v/settings">Add a View</a></header><div class="ui-grid tiles" id="hViews"></div></section>
      <section class="ui-section" id="hNext"></section>
      <section class="ui-section"><header><span class="ui-label">Latest runs</span><div class="ui-spacer"></div><a class="ui-btn quiet muted" href="#/jobs?view=runs">All runs</a></header>
        <div class="ui-feed" id="hFeed"></div></section>
    </div>`;
  el.querySelector('#hNeeds').onclick = onNeedsClick;
  on('threads', () => { if (el.closest('.shown')) { renderNeeds(); renderFeed(); } });
  on('jobs', () => { if (el.closest('.shown')) { renderNext(); renderNeeds(); } });
  on('agents', () => { if (el.closest('.shown')) renderNeeds(); });
}

export function show() { refresh(); }
export function title() { return 'Today'; }
export function refresh() {
  if (!el) return;
  el.querySelector('#hDate').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  renderNeeds(); renderViews(); renderNext(); renderFeed();
  api.get('api/backups').then((b) => { backupInfo = b; renderNeeds(); }).catch(() => {});
}

function renderNeeds() {
  const cards = [];
  for (const t of state.threads.filter((x) => x.status === 'waiting')) cards.push({ icon: 'lock', title: t.title || 'A chat', sub: `${agentName(t.agent)} is waiting for your approval`, href: `#/t/${t.id}`, action: 'Review' });
  for (const v of state.views.filter((x) => x.setupPending)) cards.push({ icon: v.icon || 'app-window', title: `Set up ${v.title}`, sub: 'An agent will walk you through it', setup: v.name, action: 'Set up' });
  for (const j of state.jobs.filter((x) => x.last?.status === 'failed')) cards.push({ icon: 'calendar-x', title: `${j.title || j.name} failed`, sub: j.last.summary || 'See the run for details', href: j.last.thread_id ? `#/t/${j.last.thread_id}` : `#/jobs/${j.name}`, action: 'Open' });
  for (const a of state.agents.filter((x) => x.installed && !x.signedIn && x.id === defaultAgent())) cards.push({ icon: 'key-round', title: `Sign in to ${a.name}`, sub: 'Needed before it can chat', href: '#/v/settings', action: 'Settings' });
  if (backupInfo && !backupInfo.hasPassphrase) cards.push({ icon: 'shield', title: 'Set a backup passphrase', sub: 'So nightly backups include your keys and sign-ins', href: '#/v/settings#backups', action: 'Set up' });
  const sec = el.querySelector('#hNeeds');
  sec.style.display = cards.length ? '' : 'none';
  sec.innerHTML = `<header><span class="ui-label">Needs you</span></header><div class="ui-grid needs" style="--min: 280px">${cards.map((c) => `
    <a class="ui-card hover need" ${c.href ? `href="${c.href}"` : `href="#" data-setup="${c.setup}"`}>
      <span class="need-icon">${ui.icon(c.icon)}</span>
      <span class="need-body"><b>${ui.esc(c.title)}</b><span>${ui.esc(c.sub)}</span></span>
      <span class="ui-btn quiet">${c.action}</span></a>`).join('')}</div>`;
}

async function onNeedsClick(e) {
  const s = e.target.closest('[data-setup]');
  if (!s) return;
  e.preventDefault();
  try { const r = await api.post(`api/views/${s.dataset.setup}/setup`); if (r.threadId) ctx.go(`#/t/${r.threadId}`); }
  catch (err) { ui.toast(err.message, { icon: 'circle-alert' }); }
}

function renderViews() {
  const list = state.views.filter((v) => !v.system || v.name === 'system');
  el.querySelector('#hViews').innerHTML = list.map((v) => `
    <a class="ui-card hover tile" href="#/v/${v.name}">
      <span class="tile-icon">${ui.icon(v.icon || 'app-window', 'lg')}</span>
      <span class="tile-title">${ui.esc(v.title)}${v.setupPending ? ' <span class="ui-dot warn"></span>' : ''}</span>
      <span class="tile-desc">${ui.esc(v.description || '')}</span></a>`).join('') + `
    <a class="tile-new" href="#/new?text=${encodeURIComponent('Build me a View that ')}">${ui.icon('plus')}<span>Build a new View</span><span class="ui-faint">Describe it and the agent builds it</span></a>`;
}

function renderNext() {
  const upcoming = state.jobs.filter((j) => j.enabled && j.next).sort((a, b) => a.next - b.next).slice(0, 3);
  const sec = el.querySelector('#hNext');
  sec.style.display = upcoming.length ? '' : 'none';
  sec.innerHTML = `<header><span class="ui-label">Coming up</span><div class="ui-spacer"></div><a class="ui-btn quiet muted" href="#/jobs">All jobs</a></header>
    <div class="ui-group">${upcoming.map((j) => `<a class="ui-row" href="#/jobs/${j.name}">
      <span class="lead">${ui.icon('clock', 'sm')}</span><div class="body"><span class="title">${ui.esc(j.title || j.name)}</span><span class="sub">${ui.esc(j.describe)}</span></div>
      <span class="meta">${nextLabel(j.next)}</span></a>`).join('')}</div>`;
}

export function nextLabel(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const same = d.toDateString() === now.toDateString();
  const tomorrow = new Date(now.getTime() + 86400000).toDateString() === d.toDateString();
  const t = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return same ? `Next ${t}` : tomorrow ? `Tomorrow ${t}` : `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${t}`;
}

function renderFeed() {
  ui.morph(el.querySelector('#hFeed'), runFeed(state.threads.filter((t) => t.origin?.startsWith('job:')).slice(0, 12)));
}

// Job runs as a feed grouped by day: time · status · job · what it reported. Shared with Jobs → Runs.
export function runFeed(list) {
  if (!list.length) return `<div class="ui-empty"><div class="orbit"></div><h2>No runs yet.</h2><p>When a job runs, its report lands here.</p><a class="ui-link-action" href="#/jobs">Set up a job</a></div>`;
  let day = null, html = '';
  for (const t of list) {
    const d = new Date(t.updated).toDateString();
    if (d !== day) { day = d; html += `<div class="ui-feed-day">${ui.esc(ui.day(t.updated))}</div>`; }
    const job = state.jobs.find((j) => `job:${j.name}` === t.origin);
    const dot = t.status === 'waiting' ? 'warn' : t.status === 'error' ? 'danger' : t.running || t.status === 'running' ? 'run' : t.unread ? 'accent' : 'ok';
    const sub = t.status === 'waiting' ? 'Needs you: approve an action' : t.status === 'error' ? (t.error || 'Failed') : t.running || t.status === 'running' ? 'Running…' : (t.preview || 'Done');
    html += `<a class="ui-feed-row" href="#/t/${t.id}"><span class="time">${ui.time(t.updated)}</span><span class="ui-dot ${dot}"></span>
      <span class="title">${ui.esc(job?.title || t.title || 'Run')}</span><span class="chev">›</span>
      <span class="sub${t.status === 'error' ? ' danger' : ''}">${ui.esc(sub.replace(/[#*`_>]/g, '').slice(0, 160))}</span></a>`;
  }
  return html;
}

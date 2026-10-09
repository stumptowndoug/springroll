// Today: start something, see what needs you, your Views, what's coming, what happened.
import { api, state, on, chatAgents, agentName, defaultAgent, upsertThread } from './api.js';

let el, ctx, recent = 'chats', draftAgent = null;

export function init(root, c) {
  el = root; ctx = c;
  el.innerHTML = `
    <div class="ui-page home">
      <header class="ui-heading"><div><span class="ui-eyebrow" id="hDate"></span><h1 class="ui-display">Today.</h1></div></header>
      <div class="home-composer composer">
        <textarea rows="2" id="hInput" placeholder="What should we work on? Ask, or describe something to build"></textarea>
        <div class="c-foot"><button class="ui-combo" id="hAgent"></button><div class="ui-spacer"></div><span class="hint">Enter to start</span><button class="c-send" id="hSend" disabled>${ui.icon('arrow-up')}</button></div>
      </div>
      <section class="ui-section" id="hNeeds"></section>
      <section class="ui-section"><header><span class="ui-label">Views</span><div class="ui-spacer"></div><a class="ui-btn quiet muted" href="#/v/settings">Add a View</a></header><div class="ui-grid tiles" id="hViews"></div></section>
      <section class="ui-section" id="hNext"></section>
      <section class="ui-section"><header><span class="ui-label">Recent</span><div class="ui-spacer"></div>
        <div class="ui-seg" id="hSeg"><button data-r="chats" aria-pressed="true">Chats</button><button data-r="runs">Runs</button></div></header>
        <div class="ui-feed" id="hFeed"></div></section>
    </div>`;
  const input = el.querySelector('#hInput');
  input.addEventListener('input', () => { el.querySelector('#hSend').disabled = !input.value.trim(); autosize(input); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); start(); } });
  el.querySelector('#hSend').onclick = start;
  el.querySelector('#hAgent').onclick = (e) => ui.combobox(e.currentTarget, {
    options: chatAgents().map((a) => ({ value: a.id, label: a.name, desc: a.signedIn ? a.maker : 'Not signed in: open Settings' })),
    value: draftAgent || defaultAgent(),
    onSelect: (v) => { const a = state.agents.find((x) => x.id === v); if (a && !a.signedIn) return ctx.go('#/v/settings'); draftAgent = v; renderAgent(); },
  });
  el.querySelector('#hSeg').onclick = (e) => { const b = e.target.closest('[data-r]'); if (b) { recent = b.dataset.r; renderFeed(); } };
  el.querySelector('#hNeeds').onclick = onNeedsClick;
  on('threads', () => { if (el.closest('.shown')) { renderNeeds(); renderFeed(); } });
  on('jobs', () => { if (el.closest('.shown')) { renderNext(); renderNeeds(); } });
  on('agents', renderAgent);
}

const autosize = (t) => { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 220) + 'px'; };

export function show() { refresh(); }
export function title() { return 'Today'; }
export function focusComposer() { el.querySelector('#hInput')?.focus(); return true; }
export function refresh() {
  if (!el) return;
  el.querySelector('#hDate').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  renderAgent(); renderNeeds(); renderViews(); renderNext(); renderFeed();
}

function renderAgent() {
  const id = draftAgent || defaultAgent();
  el.querySelector('#hAgent').innerHTML = `<span class="ui-avatar xs" style="--hue:${ui.hue(id)}">${ui.esc(agentName(id).slice(0, 1))}</span><span>${ui.esc(agentName(id))}</span>${ui.icon('chevron-down')}`;
}

async function start() {
  const input = el.querySelector('#hInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = ''; autosize(input); el.querySelector('#hSend').disabled = true;
  try {
    const t = await api.post('api/agent/threads', { agent: draftAgent || defaultAgent(), cwd: '~/home', text });
    upsertThread(t);
    ctx.go(`#/t/${t.id}`);
  } catch (e) { input.value = text; ui.toast(e.message, { icon: 'circle-alert' }); }
}

function renderNeeds() {
  const cards = [];
  for (const t of state.threads.filter((x) => x.status === 'waiting')) cards.push({ icon: 'lock', title: t.title || 'A chat', sub: `${agentName(t.agent)} is waiting for your approval`, href: `#/t/${t.id}`, action: 'Review' });
  for (const v of state.views.filter((x) => x.setupPending)) cards.push({ icon: v.icon || 'app-window', title: `Set up ${v.title}`, sub: 'An agent will walk you through it', setup: v.name, action: 'Set up' });
  for (const j of state.jobs.filter((x) => x.last?.status === 'failed')) cards.push({ icon: 'calendar-x', title: `${j.title || j.name} failed`, sub: j.last.summary || 'See the run for details', href: j.last.thread_id ? `#/t/${j.last.thread_id}` : `#/jobs/${j.name}`, action: 'Open' });
  for (const a of state.agents.filter((x) => x.installed && !x.signedIn && x.id === defaultAgent())) cards.push({ icon: 'key-round', title: `Sign in to ${a.name}`, sub: 'Needed before it can chat', href: '#/v/settings', action: 'Settings' });
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
      <span class="tile-icon" style="--hue:${ui.hue(v.name)}">${ui.icon(v.icon || 'app-window', 'lg')}</span>
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
  el.querySelectorAll('#hSeg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.r === recent));
  const list = state.threads.filter((t) => (recent === 'runs' ? t.origin?.startsWith('job:') : !t.origin?.startsWith('job:'))).slice(0, 30);
  const feed = el.querySelector('#hFeed');
  if (!list.length) {
    feed.innerHTML = `<div class="ui-empty"><div class="orbit"></div><h2>${recent === 'runs' ? 'No runs yet.' : 'Nothing yet.'}</h2><p>${recent === 'runs' ? 'Scheduled jobs land here when they run.' : 'Start a chat above. Every conversation lands here.'}</p>${recent === 'runs' ? '<a class="ui-link-action" href="#/jobs">Create a job</a>' : ''}</div>`;
    return;
  }
  let day = null, html = '';
  for (const t of list) {
    const d = new Date(t.updated).toDateString();
    if (d !== day) { day = d; html += `<div class="ui-feed-day">${ui.esc(ui.day(t.updated))}</div>`; }
    const dot = t.status === 'waiting' ? 'warn' : t.status === 'error' ? 'danger' : t.running || t.status === 'running' ? 'run' : t.unread ? 'accent' : '';
    const sub = t.status === 'waiting' ? 'Needs you: approve an action' : t.status === 'error' ? (t.error || 'Error') : t.running || t.status === 'running' ? 'Working…' : (t.preview || agentName(t.agent));
    html += `<a class="ui-feed-row" href="#/t/${t.id}"><span class="time">${ui.time(t.updated)}</span><span class="ui-dot ${dot}"></span>
      <span class="title">${ui.esc(t.title || 'New chat')}</span><span class="chev">›</span>
      <span class="sub${t.status === 'error' ? ' danger' : ''}">${ui.esc(sub.replace(/[#*`_>]/g, '').slice(0, 160))}</span></a>`;
  }
  feed.innerHTML = html;
}

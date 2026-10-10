// Home: a focus page. Usually close to empty. Three levels:
//   Needs you      blocked on the owner (approvals, questions, failures, setup); act here
//   Worth knowing  signals jobs and agents posted (`signal "…"`), dismissable
//   Your day       weather, coming-up jobs, the box: ambient, never loud
// Routine runs collapse into one line. The morning brief (a job) sits on top.
import { api, state, on, agentName, defaultAgent } from './api.js';

let el, ctx, backupInfo = null, routineOpen = false, boxTimer = null;
const perms = new Map(); // threadId -> { updated, perm } (the pending permission, fetched once per change)
const DAY = 86400000;

export function init(root, c) {
  el = root; ctx = c;
  el.innerHTML = `
    <div class="ui-page home">
      <header class="ui-heading"><div><span class="ui-eyebrow" id="hDate"></span><h1 class="ui-display">Home.</h1></div></header>
      <div class="today">
        <div class="today-main">
          <section class="today-brief" id="hBrief"></section>
          <section class="ui-section" id="hNeeds"></section>
          <section class="ui-section" id="hKnow"></section>
          <section class="ui-section today-routine" id="hRoutine"></section>
        </div>
        <aside class="today-aside" aria-label="Your day">
          <div id="hWeather"></div>
          <section id="hNext"></section>
          <section id="hBox"></section>
        </aside>
      </div>
    </div>`;
  el.addEventListener('click', onClick);
  el.addEventListener('submit', onSubmit);
  const shown = () => el.closest('.shown');
  on('threads', () => { if (shown()) { renderNeeds(); renderRoutine(); } });
  on('jobs', () => { if (shown()) { renderNeeds(); renderNext(); renderRoutine(); } });
  on('agents', () => { if (shown()) renderNeeds(); });
  on('signals', () => { if (shown()) { renderBrief(); renderNeeds(); renderKnow(); renderRoutine(); } });
  on('desk:views', () => { if (shown()) renderBox(); });
}

export function show() {
  refresh();
  clearInterval(boxTimer);
  boxTimer = setInterval(() => { if (el.closest('.shown')) renderBox(); else clearInterval(boxTimer); }, 60000);
}
export function title() { return 'Home'; }
export function refresh() {
  if (!el) return;
  el.querySelector('#hDate').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  renderBrief(); renderNeeds(); renderKnow(); renderRoutine(); renderNext(); renderWeather(); renderBox();
  api.get('api/backups').then((b) => { backupInfo = b; renderNeeds(); }).catch(() => {});
}

/* ---------- Needs you ---------- */

function needs() {
  const out = [];
  for (const t of state.threads.filter((x) => x.status === 'waiting')) out.push({ kind: 'permission', t, when: t.updated });
  for (const s of state.signals.filter((x) => x.level === 'needs')) out.push({ kind: 'signal', s, when: s.updated });
  for (const a of state.agents.filter((x) => x.installed && !x.signedIn && x.id === defaultAgent())) out.push({ kind: 'simple', icon: 'key-round', title: `Sign in to ${a.name}`, sub: 'Needed before it can chat', href: '#/v/settings', action: 'Settings' });
  for (const v of state.views.filter((x) => x.setupPending)) out.push({ kind: 'simple', icon: v.icon || 'app-window', title: `Set up ${v.title}`, sub: 'An agent will walk you through it', setup: v.name, action: 'Set up' });
  if (backupInfo && !backupInfo.hasPassphrase) out.push({ kind: 'simple', icon: 'shield', title: 'Set a backup passphrase', sub: 'So nightly backups include your keys and sign-ins', href: '#/v/settings#backups', action: 'Set up' });
  return out;
}
export const needsCount = () => needs().length;

function renderNeeds() {
  const list = needs();
  const sec = el.querySelector('#hNeeds');
  if (!list.length) {
    sec.className = 'ui-section today-clear';
    const recent = jobRuns().length, next = upcoming()[0];
    const brief = latestBrief();
    ui.morph(sec, `<p class="clear-line">Nothing needs you.</p>${brief ? '' : `<p class="clear-sub">${ui.esc([
      recent ? `${recent} job run${recent === 1 ? '' : 's'} in the last day.` : '',
      next ? `Next up: ${next.title || next.name}, ${nextLabel(next.next).replace(/^Next /, 'at ')}.` : ''].filter(Boolean).join(' '))}</p>`}`);
    return;
  }
  sec.className = 'ui-section';
  for (const n of list) if (n.kind === 'permission') loadPerm(n.t);
  ui.morph(sec, `<header><span class="ui-label">Needs you</span><span class="ui-mono ui-muted count">${list.length}</span></header>
    <div class="ui-tasks">${list.map(needRow).join('')}</div>`);
  const want = sec.querySelector('.ui-task.open [data-focus]');
  if (want && focusNext) { want.focus(); focusNext = false; }
}

// Agent first: each thing that needs you is a pointer (what, why, when) and a conversation. Ask opens
// the chat beside it about that item (its own chat when it has one); View shows the thing itself;
// Done clears it. Only what an agent can't do for you stays a direct action (approve, paste a key).
const openPanels = new Set();
let focusNext = false;
const ask = (item, primary = true) => `<button class="ui-btn sm${primary ? ' primary' : ''}" data-ask='${ui.esc(JSON.stringify(item))}'>${ui.icon('message-square', 'sm')}Ask</button>`;
const view = (href) => (href ? `<a class="ui-btn sm quiet" href="${ui.esc(href)}">View</a>` : '');
const done = (attrs) => `<button class="ui-icon-btn more" ${attrs} title="Done" aria-label="Done">${ui.icon('check')}</button>`;
const btn = (label, attrs, primary = true) => `<button class="ui-btn sm${primary ? ' primary' : ''}" ${attrs}>${label}</button>`;

function needRow(n) {
  if (n.kind === 'permission') {
    const { t } = n, perm = perms.get(t.id)?.perm, tc = perm?.toolCall || {};
    const cmd = tc.rawInput?.command || tc.rawInput?.file_path || tc.rawInput?.path || '';
    const opts = perm?.options || [], allow = opts.find((o) => o.kind === 'allow_once') || opts.find((o) => o.kind?.startsWith('allow'));
    const deny = opts.find((o) => o.kind?.startsWith('reject'));
    return task({ id: `p:${t.id}`, icon: 'lock', title: t.title || 'A chat', when: t.updated,
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
      return task({ id: `s:${s.id}`, icon: 'circle-x', danger: true, title: s.title, when: s.updated, sub: s.body || 'See the run for details',
        acts: ask(agentRun ? { thread: t.id } : { key: `job:${name}`, label: s.title,
          note: `The job "${name}" failed: ${s.body || 'no details'}. Its run is thread ${s.thread_id || '?'} (curl -s localhost:8090/threads/${s.thread_id}); the job is in ~/home/jobs/${name}/. The owner wants to talk about it: find out why, fix what you can, run it again if that makes sense.` })
          + view(s.href) + clear });
    }
    if (k.startsWith('secret:')) {
      const name = k.slice(7);
      return task({ id: `s:${s.id}`, icon: 'key-round', title: `${s.source || 'An agent'} needs ${name}`, when: s.updated, sub: s.body || '',
        acts: btn('Add key', `data-expand="s:${s.id}"`) + (s.thread_id ? ask({ thread: s.thread_id }, false) : '') + clear,
        panel: `<form data-secret="${ui.esc(name)}"><label class="ui-sr-only" for="sk${s.id}">Value for ${ui.esc(name)}</label>
          <input class="ui-input ui-mono" id="sk${s.id}" name="value" type="password" placeholder="Paste ${ui.esc(name)}" autocomplete="off" data-focus><button class="ui-btn sm primary">Save</button></form>` });
    }
    if (k.startsWith('mail:')) {
      const id = k.slice(5);
      return task({ id: `s:${s.id}`, icon: 'mail', title: s.title, when: s.updated, sub: s.body || '',
        acts: ask({ key: `mail:${id}`, label: `Email: ${s.title}`, note: `This is about the email with Mail id ${id}: "${s.title}" (${s.body || ''}). Read it with \`gmail show ${id}\`; act with \`gmail reply ${id}\` (text on stdin) or \`gmail archive ${id}\`. Do what the owner asks.` })
          + view(s.href) + clear });
    }
    return task({ id: `s:${s.id}`, icon: s.thread_id ? 'message-circle-question' : 'bell', title: s.title, when: s.updated, sub: s.body || s.source || '',
      acts: ask(s.thread_id ? { thread: s.thread_id } : { key: `signal:${s.id}`, label: s.title, note: `About this item on Home: "${s.title}"${s.body ? `: ${s.body}` : ''}${s.source ? ` (from ${s.source})` : ''}.` })
        + view(s.href) + clear });
  }
  return task({ id: `x:${n.title}`, icon: n.icon, title: n.title, sub: n.sub,
    acts: n.setup ? btn(n.action, `data-setup="${n.setup}"`) : `<a class="ui-btn sm primary" href="${n.href}">${n.action}</a>` });
}

function task({ id, icon, danger, title, when, sub, code = '', acts = '', panel = '' }) {
  const open = panel && openPanels.has(id);
  return `<div class="ui-task${open ? ' open' : ''}" data-task="${ui.esc(id)}">
    <span class="lead${danger ? ' danger' : ''}">${ui.icon(icon)}</span>
    <div class="body"><div class="head"><b>${ui.esc(title)}</b>${when ? `<span class="when">${ui.esc(ui.ago(when))}</span>` : ''}</div>
      ${sub ? `<span class="sub">${ui.esc(sub)}</span>` : ''}${code ? `<code class="code">${ui.esc(code)}</code>` : ''}</div>
    <div class="acts">${acts}</div>
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

/* ---------- Brief, worth knowing, routine runs ---------- */

const latestBrief = () => state.signals.filter((s) => s.level === 'brief').sort((a, b) => b.updated - a.updated)[0];

function renderBrief() {
  const b = latestBrief(), sec = el.querySelector('#hBrief');
  sec.style.display = b ? '' : 'none';
  if (!b) return;
  ui.morph(sec, `<p class="brief-text">${ui.esc(b.body || b.title)}</p>
    <span class="brief-by">${ui.esc(b.source || 'Morning brief')} · <span class="ui-mono">${ui.esc(ui.time(b.updated))}</span>${b.href ? ` · <a href="${ui.esc(b.href)}">Open</a>` : ''}</span>`);
}

function renderKnow() {
  const list = state.signals.filter((s) => s.level === 'notable');
  const sec = el.querySelector('#hKnow');
  sec.style.display = list.length ? '' : 'none';
  ui.morph(sec, `<header><span class="ui-label">Worth knowing</span></header>
    <div class="signal-list">${list.map((s) => `
      <div class="signal">
        <div class="signal-body">
          ${s.href ? `<a class="signal-title" href="${ui.esc(s.href)}">${ui.esc(s.title)}</a>` : `<span class="signal-title">${ui.esc(s.title)}</span>`}
          ${s.body ? `<span class="signal-text">${ui.esc(s.body)}</span>` : ''}
          <span class="signal-meta">${s.source ? `${ui.esc(s.source)} · ` : ''}<span class="ui-mono">${ui.esc(ui.ago(s.updated))}</span></span>
        </div>
        <button class="ui-icon-btn" data-dismiss="${s.id}" title="Dismiss" aria-label="Dismiss">${ui.icon('x', 'sm')}</button>
      </div>`).join('')}</div>`);
}

const jobRuns = () => state.threads.filter((t) => t.origin?.startsWith('job:') && Date.now() - t.updated < DAY);

function renderRoutine() {
  const flagged = new Set(state.signals.filter((s) => s.thread_id).map((s) => s.thread_id));
  const routine = jobRuns().filter((t) => !flagged.has(t.id) && t.status === 'idle' && !t.running);
  const sec = el.querySelector('#hRoutine');
  sec.style.display = routine.length ? '' : 'none';
  if (!routine.length) return;
  ui.morph(sec, `<button class="routine-line" data-routine aria-expanded="${routineOpen}">
      <span class="ui-dot ok"></span><span>${routine.length} routine run${routine.length === 1 ? '' : 's'} in the last day, all fine</span>
      ${ui.icon('chevron-down', 'sm')}</button>
    ${routineOpen ? `<div class="ui-feed routine-feed">${runFeed(routine)}</div><a class="ui-btn quiet muted" href="#/jobs?view=runs">All runs</a>` : ''}`);
}

/* ---------- Your day ---------- */

const upcoming = () => state.jobs.filter((j) => j.enabled && j.next).sort((a, b) => a.next - b.next);

function renderNext() {
  const list = upcoming().slice(0, 4);
  const sec = el.querySelector('#hNext');
  sec.style.display = list.length ? '' : 'none';
  ui.morph(sec, `<h2 class="ui-label"><a class="label-link" href="#/jobs">${ui.icon('calendar-clock', 'sm')}Upcoming jobs</a></h2>
    <div class="day-list">${list.map((j) => `<a class="day-row" href="#/jobs/${j.name}" title="${ui.esc(j.describe || '')}"><span class="ui-mono">${ui.esc(shortWhen(j.next))}</span><span>${ui.esc(j.title || j.name)}</span></a>`).join('')}</div>`);
}

function shortWhen(ts) {
  const d = new Date(ts), t = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${t}`;
}

async function renderWeather() {
  const box = el.querySelector('#hWeather');
  const w = await api.get('api/weather').catch(() => null);
  if (!w || (w.place && w.error && !w.temp)) {
    ui.morph(box, w?.error ? weatherForm(`Couldn't find “${w.place}”. Try a ZIP code or “City, State”.`) : '');
    return;
  }
  if (!w.place) { ui.morph(box, weatherForm('')); return; }
  ui.morph(box, `<div class="weather">${ui.icon(w.icon, 'xl')}
    <div><span class="weather-now">${w.temp}°<span>${ui.esc(w.text)}</span></span>
    <span class="weather-sub">${ui.esc(w.place)} · High ${w.high}° Low ${w.low}°${w.rain >= 30 ? ` · ${w.rain}% rain` : ''}</span></div></div>`);
}

function weatherForm(err) {
  return `<form class="weather-ask" data-weather>
    <label for="wPlace">${ui.icon('cloud-sun')}<span>Weather for your day</span></label>
    <div class="weather-ask-row"><input class="ui-input" id="wPlace" name="place" placeholder="ZIP code or city" autocomplete="postal-code"><button class="ui-btn sm">Show</button></div>
    ${err ? `<span class="weather-err">${ui.esc(err)}</span>` : ''}</form>`;
}

async function renderBox() {
  const sec = el.querySelector('#hBox');
  if (!state.views.some((v) => v.name === 'system')) { ui.morph(sec, ''); return; }
  const [now, hist] = await Promise.all([api.get('v/system/api/now').catch(() => null), api.get('v/system/api/history?hours=24').catch(() => [])]);
  const m = now?.now;
  if (!m) { ui.morph(sec, ''); return; }
  const peak = (hist || []).reduce((p, r) => (r.mem > (p?.mem ?? 0) ? r : p), null);
  // Same bar as the sidebar's Utilization: color is how full (amber from 70%, red from 90%);
  // the tick on memory is its 24-hour peak.
  const meter = (label, pct, peakAt) => {
    const t = pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : 'ok';
    return `<div class="meter"${peakAt != null ? ` title="Peak ${Math.round(peakAt.mem)}% at ${ui.time(peakAt.ts * 1000)}"` : ''}><span>${label}</span>
      <span class="usage-bar ${t}"><span class="fill" style="width:${Math.min(100, Math.max(1, pct))}%"></span>${peakAt != null ? `<span class="tick" style="left:${Math.min(100, peakAt.mem)}%"></span>` : ''}</span>
      <span class="meter-pct">${Math.round(pct)}%</span></div>`;
  };
  const chats = (now.groups?.chats || []).length;
  const icon = state.views.find((v) => v.name === 'system')?.icon || 'activity';
  ui.morph(sec, `<h2 class="ui-label"><a class="label-link" href="#/v/system">${ui.icon(icon, 'sm')}The box</a></h2>
    ${meter('Memory', m.mem.percent, peak && peak.mem > m.mem.percent + 2 ? peak : null)}${meter('Disk', m.disk.percent)}${meter('CPU', m.cpu)}
    <p class="box-note">${peak && peak.mem >= 80 ? `Memory peaked at ${Math.round(peak.mem)}% at ${ui.time(peak.ts * 1000)}. ` : ''}Up ${uptime(m.uptime)}${chats ? ` · ${chats} agent${chats === 1 ? '' : 's'} running` : ''}</p>`);
}

const uptime = (s) => (s >= DAY / 1000 ? `${Math.floor(s / 86400)} day${s >= 2 * 86400 ? 's' : ''}` : `${Math.max(1, Math.floor(s / 3600))} h`);

/* ---------- Actions ---------- */

async function onClick(e) {
  const q = e.target.closest('[data-ask]');
  if (q) { e.preventDefault(); return ctx.askAbout(JSON.parse(q.dataset.ask)); }
  const b = e.target.closest('[data-perm],[data-dismiss],[data-run],[data-setup],[data-routine],[data-fix],[data-expand]');
  if (!b) return;
  e.preventDefault();
  act(b);
}

async function act(b) {
  if (b.dataset.routine !== undefined) { routineOpen = !routineOpen; return renderRoutine(); }
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
  const w = e.target.closest('[data-weather]');
  if (w) {
    e.preventDefault();
    const place = w.elements.place.value.trim();
    if (!place) return w.elements.place.focus();
    await desk.save({ weatherLocation: place }).catch((err) => ui.toast(err.message, { icon: 'circle-alert' }));
    return renderWeather();
  }
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

// Job runs as a feed grouped by day: time · status · job · what it reported. Shared with Jobs → Runs.
export function runFeed(list) {
  if (!list.length) return `<div class="ui-empty"><div class="orbit"></div><h2>No runs yet.</h2><p>When a job runs, its report lands here.</p><a class="ui-link-action" href="#/jobs">Set up a job</a></div>`;
  let day = null, html = '';
  for (const t of list) {
    const d = new Date(t.updated).toDateString();
    if (d !== day) { day = d; html += `<div class="ui-feed-day">${ui.esc(ui.day(t.updated))}</div>`; }
    const job = state.jobs.find((j) => `job:${j.name}` === t.origin);
    const dot = t.status === 'waiting' ? 'warn' : t.status === 'error' ? 'danger' : t.running || t.status === 'running' ? 'run' : t.unread ? 'accent' : 'ok';
    const jobTitle = job?.title || t.title || 'Run';
    const title = t.title && t.title !== jobTitle ? t.title : jobTitle; // the report's title, once there is one
    const sub = t.status === 'waiting' ? 'Needs you: approve an action' : t.status === 'error' ? (t.error || 'Failed') : t.running || t.status === 'running' ? 'Running…' : (t.preview || 'Done');
    html += `<a class="ui-feed-row" href="#/${job?.report === false ? 't' : 'r'}/${t.id}"><span class="time">${ui.time(t.updated)}</span><span class="ui-dot ${dot}"></span>
      <span class="title">${ui.esc(title)}</span><span class="chev">›</span>
      <span class="sub${t.status === 'error' ? ' danger' : ''}">${title !== jobTitle ? `${ui.esc(jobTitle)} · ` : ''}${ui.esc(sub.replace(/[#*`_>]/g, '').slice(0, 160))}</span></a>`;
  }
  return html;
}

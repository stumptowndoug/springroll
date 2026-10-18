// Jobs: things that run on a schedule. Each run is a chat thread; its last message is the report.
import { api, state, on, chatAgents, agentName, defaultAgent } from './api.js';
import { nextLabel } from './timeline.js';

let el, ctx, currentName = null;

export function init(root, c) {
  el = root; ctx = c;
  on('jobs', () => { if (el.closest('.shown')) render(); });
  on('threads', () => { if (el.closest('.shown') && currentName) render(); });
  el.addEventListener('click', onClick);
  el.addEventListener('input', (e) => { if (e.target.matches('[data-jobq]')) { query = e.target.value.trim(); render(); } });
}
export function show(_el, r) { if (r.q?.view === 'runs') return ctx.go('#/'); currentName = r.name; if (r.name === 'new' || r.q?.new) { currentName = null; render(); openEditor(null, r.q); } else render(); }
export function title(r) { return r.name ? (state.jobs.find((j) => j.name === r.name)?.title || r.name) : 'Jobs'; }

function trail(j) { return `<span class="ui-trail" title="Last ${j.trail.length} runs">${j.trail.map((s) => `<i class="${s}"></i>`).join('')}${j.running ? '<i class="running"></i>' : ''}</span>`; }

const NEW_JOB = `#/new?text=${encodeURIComponent('Create a job that ')}`;
const heading = (eyebrow, title) => `<header class="ui-heading"><div><span class="ui-eyebrow">${eyebrow}</span><h1 class="ui-display">${title}</h1></div>
  <div class="actions"><a class="ui-btn primary" href="${NEW_JOB}">${ui.icon('plus', 'sm')}New job</a></div></header>`;
// What a job does, in one sentence: its description, or the first sentence of its prompt.
export const jobSummary = (j) => j.description || (j.type === 'command' ? j.command : (j.prompt || '').trim().split(/\n\s*\n/)[0].split(/(?<=[.!?])\s/)[0]);

// Jobs, grouped (job.json "group"), problems first. Their runs are on the Timeline.
let filter = 'all', query = '';
const collapsed = new Set(JSON.parse(localStorage.getItem('desk.jobs.collapsed') || '[]'));
const saveCollapsed = () => { try { localStorage.setItem('desk.jobs.collapsed', JSON.stringify([...collapsed])); } catch {} };
const failing = (j) => j.last?.status === 'failed' && !j.running;
const stateOf = (j) => (j.running ? 'running' : j.queued ? 'queued' : failing(j) ? 'failing' : !j.enabled ? 'paused' : 'ok');
const RANK = { failing: 0, running: 1, queued: 2, ok: 3, paused: 4 };

// Run and pause are round icon buttons, like the chat box's send and stop: run (or stop, or cancel a
// queued run) is the primary one; pause is a toggle for the schedule.
const runBtn = (j, size = '') => (j.running ? `<button class="ui-round ${size} stop filled" data-cancel="${j.name}" title="Stop the run" aria-label="Stop ${ui.esc(j.title || j.name)}">${ui.icon('square')}</button>`
  : j.queued ? `<button class="ui-round ${size} stop" data-cancel="${j.name}" title="Cancel the queued run" aria-label="Cancel ${ui.esc(j.title || j.name)}">${ui.icon('x')}</button>`
  : `<button class="ui-round ${size} primary filled" data-run="${j.name}" title="Run now" aria-label="Run ${ui.esc(j.title || j.name)} now">${ui.icon('play')}</button>`);
const pauseBtn = (j, size = '') => `<button class="ui-round ${size} toggle filled" data-toggle="${j.name}" aria-pressed="${!j.enabled}" title="${j.enabled ? 'Pause the schedule' : 'Paused: resume the schedule'}" aria-label="${j.enabled ? 'Pause' : 'Resume'} ${ui.esc(j.title || j.name)}">${ui.icon('pause')}</button>`;

function jobRow(j) {
  const st = stateOf(j);
  const when = st === 'running' ? ui.running(j.last?.status === 'running' ? j.last.started : null)
    : st === 'queued' ? `<span class="ui-mono">${j.queued.how === 'retry' && j.queued.at ? `Retry ${ui.esc(nextLabel(j.queued.at).replace(/^Next /, ''))}` : 'Queued'}</span>`
    : !j.enabled ? '<span class="ui-faint">Paused</span>'
    : j.next ? `<span class="ui-mono">${ui.esc(nextLabel(j.next))}</span>` : '<span class="ui-faint">Manual</span>';
  const sub = [j.describe, j.type === 'command' ? 'Command' : agentName(j.agent || defaultAgent())].filter(Boolean).join(' · ');
  return `<div class="ui-row hover job-row${j.enabled ? '' : ' off'}" data-open="${j.name}" tabindex="0">
    ${trail(j)}
    <div class="body"><span class="title">${ui.esc(j.title || j.name)}</span><span class="sub">${ui.esc(failing(j) ? (j.last.summary || 'Failed') : sub)}</span></div>
    <span class="when">${when}</span>
    <span class="meta">${j.last ? ui.esc(ui.ago(j.last.started)) : ''}</span>
    <span class="acts">${pauseBtn(j, 'sm')}${runBtn(j, 'sm')}</span>
  </div>`;
}

function jobsView() {
  const all = state.jobs;
  if (!all.length) return `<div class="ui-empty"><div class="orbit"></div><h2>No jobs yet.</h2><p>A job is work on a schedule: a morning brief, a weekly cleanup, a check every hour. Tell an agent what you want and when.</p>
    <a class="ui-btn primary" href="${NEW_JOB}">${ui.icon('plus', 'sm')}New job</a>
    <button class="ui-link-action" data-a="new">Or set it up yourself</button></div>`;
  const counts = { failing: 0, running: 0, queued: 0, paused: 0 };
  for (const j of all) { const st = stateOf(j); if (st in counts) counts[st]++; }
  const q = query.toLowerCase();
  const shown = all.filter((j) => (filter === 'all' || stateOf(j) === filter || (filter === 'running' && stateOf(j) === 'queued'))
    && (!q || `${j.title} ${j.name} ${j.group || ''} ${j.prompt || ''} ${j.command || ''}`.toLowerCase().includes(q)));
  const groups = new Map();
  for (const j of shown) { const g = j.group || 'Other'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(j); }
  const names = [...groups.keys()].sort((a, b) => (a === 'Other') - (b === 'Other') || a.localeCompare(b));
  const one = names.length === 1 && names[0] === 'Other';
  const chip = (id, label, n) => `<button class="ui-chip${filter === id ? ' on' : ''}" data-filter="${id}">${label}${n != null ? ` <span class="ui-mono">${n}</span>` : ''}</button>`;
  return `<div class="ui-pagebar">
      <label class="ui-search"><span class="ui-sr-only">Search jobs</span>${ui.icon('search', 'sm')}<input class="ui-input" data-jobq placeholder="Search jobs" value="${ui.esc(query)}" autocomplete="off"></label>
      <div class="ui-chips">${chip('all', 'All', all.length)}${counts.failing ? chip('failing', '<span class="ui-dot danger"></span>Failing', counts.failing) : ''}${counts.running + counts.queued ? chip('running', '<span class="ui-dot run"></span>Running', counts.running + counts.queued) : ''}${counts.paused ? chip('paused', 'Paused', counts.paused) : ''}</div></div>
    ${shown.length ? names.map((g) => {
      const list = groups.get(g).sort((a, b) => RANK[stateOf(a)] - RANK[stateOf(b)] || (a.next || Infinity) - (b.next || Infinity) || (a.title || a.name).localeCompare(b.title || b.name));
      const bad = list.filter(failing).length, closed = !one && collapsed.has(g) && filter === 'all' && !q;
      return `<section class="ui-section job-group">${one ? '' : `<header><button class="group-toggle" data-group="${ui.esc(g)}" aria-expanded="${!closed}">${ui.icon('chevron-down', 'sm')}<span class="ui-label">${ui.esc(g)}</span></button>
          <span class="ui-mono ui-muted count">${list.length}</span>${bad ? `<span class="ui-status"><span class="ui-dot danger"></span>${bad} failing</span>` : ''}</header>`}
        ${closed ? '' : `<div class="ui-group">${list.map(jobRow).join('')}</div>`}</section>`;
    }).join('') : `<div class="ui-empty"><h2>No jobs match.</h2><button class="ui-link-action" data-filter="all" data-clear>Show all jobs</button></div>`}`;
}

async function render() {
  if (currentName) return renderDetail(currentName);
  ui.morph(el, `<div class="ui-page jobs">${heading('Scheduled work', 'Jobs.')}${jobsView()}</div>`);
}

async function renderDetail(name) {
  let j, opts = null;
  try { j = await api.get(`api/agent/jobs/${name}`); } catch { ui.morph(el, `<div class="ui-page"><a class="ui-back" href="#/jobs">‹ Jobs</a><div class="ui-empty"><h2>No such job.</h2></div></div>`); return; }
  if (j.type !== 'command') opts = await api.get(`api/agent/agents/${j.agent || defaultAgent()}/options`).catch(() => null);
  if (currentName !== name) return;
  const runs = j.runs || [], cmd = j.type === 'command';
  const named = (list, id) => (list || []).find((x) => x.id === id)?.name || id;
  // The model by the name the agent gives it, and its id when that says something else ("6 Luna", gpt-6-luna).
  const model = (id) => { const n = named(opts?.models, id); return n.toLowerCase() === id.toLowerCase() ? ui.esc(n) : `${ui.esc(n)} <span class="ui-mono">${ui.esc(id)}</span>`; };
  const status = j.running ? ui.running(j.last?.status === 'running' ? j.last.started : null)
    : j.queued ? `<span class="ui-status"><span class="ui-dot"></span>${j.queued.how === 'retry' ? 'Retry queued' : 'Queued'}</span>` : !j.enabled ? '<span class="ui-status"><span class="ui-dot"></span>Paused</span>' : '';
  const fact = (label, value, sub = '', mono = false) => `<div><dt>${label}</dt><dd${mono ? ' class="ui-mono"' : ''}>${value}${sub ? `<small${mono ? ' class="ui-mono"' : ''}>${sub}</small>` : ''}</dd></div>`;
  const when = (ts) => new Date(ts).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const facts = [
    fact('Schedule', ui.esc(j.schedule ? j.describe : 'Manual only'), j.schedule ? `<span class="ui-mono">${ui.esc(j.schedule)}</span>` : 'Runs when you press Run'),
    fact('Next run', !j.enabled ? 'Paused' : j.next ? ui.esc(when(j.next)) : '—', !j.enabled ? 'Resume to put it back on schedule' : j.catchUp === 'once' ? 'Catches up once if missed' : 'Skips missed runs'),
    cmd ? fact('Runs', 'A shell command', 'With bash')
      : fact('Agent', ui.esc(agentName(j.agent || defaultAgent())), [j.model ? model(j.model) : 'Default model', j.effort ? `${ui.esc(named(opts?.effort?.values, j.effort))} thinking` : ''].filter(Boolean).join(' · ')),
    fact('On the Timeline', j.timeline === 'never' ? 'Never' : j.timeline === 'failures' ? 'Only failures' : 'Every run',
      j.notify === false ? 'No phone notifications' : j.notify === 'always' ? 'Each result to your phone' : cmd ? 'Phone alert if it fails' : 'Report to your phone'),
    fact('If it fails', j.retries ? `Retries ${j.retries === 1 ? 'once' : j.retries === 2 ? 'twice' : j.retries + ' times'}, ${ui.esc(j.retryDelay || '5m')} apart` : "Doesn't retry",
      j.timeout ? `Stopped after ${ui.esc(j.timeout)}` : 'No time limit'),
    fact('Works in', ui.esc(j.cwd || '~/home'), `~/home/jobs/${ui.esc(j.name)}/`, true),
  ].join('');
  // Recent runs by day, like the Timeline: what each said, and how long it took.
  let day = '';
  const runRows = runs.slice(0, 8).map((r) => {
    const d = new Date(r.started).toDateString(), head = d !== day ? `<div class="ui-feed-day">${ui.esc(ui.day(r.started))}</div>` : '';
    day = d;
    const said = (r.summary || (r.status === 'running' ? '' : r.status === 'queued' ? (r.not_before ? `Waiting to retry at ${ui.time(r.not_before)}` : 'Queued: waiting for room') : r.status === 'failed' ? 'Failed' : 'Done')).replace(/[#*`_]/g, '');
    const meta = [r.finished ? ui.duration(r.finished - r.started) : '', r.attempt > 1 ? `try ${r.attempt}` : ''].filter(Boolean).join(' · ');
    return `${head}<a class="ui-feed-row" href="${r.thread_id ? `#/${j.report === false ? 't' : 'r'}/${r.thread_id}` : '#'}">
      <span class="time">${ui.time(r.started)}</span><span class="ui-dot ${r.status === 'done' ? 'ok' : r.status === 'failed' ? 'danger' : r.status === 'running' ? 'run' : r.status === 'queued' ? '' : 'warn'}"></span>
      <span class="title${r.status === 'failed' ? ' danger' : ''}">${r.status === 'running' ? '<span class="ui-shimmer">Running</span>' : ui.esc(said)}</span><span class="meta ui-mono">${ui.esc(meta)}</span><span class="chev">›</span></a>`;
  }).join('');
  ui.morph(el, `<div class="ui-page narrow job-detail">
    <a class="ui-back" href="#/jobs">${ui.icon('chevron-left', 'sm')}Jobs</a>
    <header class="ui-heading"><div><span class="ui-eyebrow">${ui.esc(j.group || 'Job')}${status}</span>
      <h1 class="ui-display">${ui.esc((j.title || j.name).replace(/\.?$/, '.'))}</h1></div>
      <div class="actions"><button class="ui-icon-btn" data-menu-job="${j.name}" title="More">${ui.icon('ellipsis')}</button>
        <button class="ui-btn" data-edit="${j.name}">Edit</button>${pauseBtn(j)}${runBtn(j)}</div></header>
    <div class="job-prompt${(j.prompt || '').split('\n').length > 6 || (j.prompt || '').length > 480 ? ' long' : ''}">${cmd ? `<div class="text ui-mono">${ui.esc('$ ' + j.command)}</div>` : `<div class="text ui-prose">${ui.markdown(j.prompt || '')}</div>`}
      <button class="ui-link-action more" data-more-prompt>Show the whole prompt</button></div>
    <dl class="ui-facts">${facts}</dl>
    <section class="ui-section"><header><span class="ui-label">Recent runs</span>${j.trail?.length ? trail(j) : ''}<span class="ui-spacer"></span>${runs.length ? `<a class="ui-link-action" href="#/?from=job:${ui.esc(j.name)}">All on the Timeline</a>` : ''}</header>
      ${runs.length ? `<div class="ui-feed job-runs">${runRows}</div>`
      : `<p class="ui-muted" style="font-size:var(--text-sm)">No runs yet. ${j.enabled && j.next ? `The first one is ${nextLabel(j.next).replace('Next ', 'at ').toLowerCase()}.` : ''}</p>`}
    </section>
    ${!cmd ? `<section class="ui-section"><header><span class="ui-label">The agent's notes</span><span class="ui-spacer"></span><span class="ui-faint" style="font-size:var(--text-xs)">NOTES.md, kept between runs</span></header>
      <div class="ui-card pad ui-prose notes">${ui.markdown(j.notes || '_Empty._')}</div></section>` : ''}
  </div>`);
}

async function onClick(e) {
  const t = e.target;
  const run = t.closest('[data-run]');
  if (run) {
    e.stopPropagation(); run.disabled = true;
    try {
      const r = await api.post(`api/agent/jobs/${run.dataset.run}/run`);
      if (r.queued) ui.toast('Queued: it starts when an agent run finishes', { icon: 'clock' });
      else { ui.toast('Started', { icon: 'play' }); if (r.threadId && currentName) ctx.go(`#/t/${r.threadId}`); }
    } catch (err) { ui.toast(err.message, { icon: 'circle-alert' }); run.disabled = false; }
    return;
  }
  const cancel = t.closest('[data-cancel]');
  if (cancel) { e.stopPropagation(); await api.post(`api/agent/jobs/${cancel.dataset.cancel}/cancel`).catch((err) => ui.toast(err.message)); return; }
  const fl = t.closest('[data-filter]');
  if (fl) { filter = fl.dataset.filter; if (fl.dataset.clear != null) query = ''; return render(); }
  const grp = t.closest('[data-group]');
  if (grp) { const g = grp.dataset.group; if (collapsed.has(g)) collapsed.delete(g); else collapsed.add(g); saveCollapsed(); return render(); }
  const tog = t.closest('[data-toggle]');
  if (tog) { e.stopPropagation(); const j = state.jobs.find((x) => x.name === tog.dataset.toggle); await api.patch(`api/agent/jobs/${j.name}`, { enabled: !j.enabled }).catch((err) => ui.toast(err.message)); return; }
  if (t.closest('[data-a="new"]')) return openEditor(null);
  const ed = t.closest('[data-edit]');
  if (ed) { const j = await api.get(`api/agent/jobs/${ed.dataset.edit}`); return openEditor(j); }
  const mj = t.closest('[data-menu-job]');
  if (mj) {
    const m = document.createElement('div');
    m.className = 'ui-menu';
    const j = state.jobs.find((x) => x.name === mj.dataset.menuJob);
    m.innerHTML = `<button data-x="ask">${ui.icon('message-square')}Chat about changing it</button><hr><button class="danger" data-x="delete">${ui.icon('trash-2')}Delete job</button>`;
    m.onclick = async (ev) => {
      const x = ev.target.closest('[data-x]')?.dataset.x;
      ui.closePopover();
      if (x === 'toggle') await api.patch(`api/agent/jobs/${j.name}`, { enabled: !j.enabled });
      if (x === 'ask') ctx.go(`#/new?text=${encodeURIComponent(`Change the job "${j.title || j.name}" (~/home/jobs/${j.name}/job.json) so that `)}`);
      if (x === 'delete' && await ui.confirm(`Delete "${j.title || j.name}"?`, { body: 'Its runs stay on the Timeline.', ok: 'Delete', danger: true })) { await api.del(`api/agent/jobs/${j.name}`); ctx.go('#/jobs'); }
    };
    ui.popover(mj, m, { temp: true, align: 'end' });
    return;
  }
  const mp = t.closest('[data-more-prompt]');
  if (mp) { const w = mp.parentElement; w.classList.toggle('open'); mp.textContent = w.classList.contains('open') ? 'Show less' : 'Show the whole prompt'; return; }
  const card = t.closest('[data-open]');
  if (card && !t.closest('button')) ctx.go(`#/jobs/${card.dataset.open}`);
}

/* ---------- Editor ---------- */
// Time limits and retries are per job, off unless the job asks.
const TIMEOUTS = [['', 'None'], ['5m', '5 minutes'], ['15m', '15 minutes'], ['30m', '30 minutes'], ['1h', '1 hour'], ['2h', '2 hours'], ['6h', '6 hours']];
const TIMELINE = [['', 'Every run'], ['failures', 'Only failures'], ['never', 'Never']];
const RETRIES = [['0', "Don't retry"], ['1', 'Retry once'], ['2', 'Retry twice'], ['3', 'Retry 3 times']];
const DELAYS = [['1m', '1 minute'], ['5m', '5 minutes'], ['15m', '15 minutes'], ['1h', '1 hour']];
const choices = (list, value) => (list.some(([v]) => v === String(value)) || !value ? list : [...list, [String(value), String(value)]])
  .map(([v, l]) => `<option value="${ui.esc(v)}"${v === String(value) ? ' selected' : ''}>${ui.esc(l)}</option>`).join('');
const PRESETS = [
  { id: 'manual', label: 'Manual' },
  { id: 'hourly', label: 'Hourly' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekdays', label: 'Weekdays' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'custom', label: 'Custom' },
];
function presetOf(cron) {
  if (!cron) return { id: 'manual' };
  let m;
  if ((m = cron.match(/^(\d+) \* \* \* \*$/))) return { id: 'hourly', minute: +m[1] };
  if ((m = cron.match(/^(\d+) (\d+) \* \* \*$/))) return { id: 'daily', time: hm(m[2], m[1]) };
  if ((m = cron.match(/^(\d+) (\d+) \* \* 1-5$/))) return { id: 'weekdays', time: hm(m[2], m[1]) };
  if ((m = cron.match(/^(\d+) (\d+) \* \* (\d)$/))) return { id: 'weekly', time: hm(m[2], m[1]), dow: +m[3] };
  return { id: 'custom', cron };
}
const hm = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

function openEditor(job, q = {}) {
  const d = document.createElement('dialog');
  d.className = 'ui-sheet job-editor';
  const p = presetOf(job ? job.schedule || '' : (q.schedule || '0 8 * * *')); // an existing job without a schedule is manual
  const agents = chatAgents();
  d.innerHTML = `
    <div class="ui-toolbar"><span class="ui-title">${job ? 'Edit job' : 'New job'}</span><div class="ui-spacer"></div><button class="ui-icon-btn plain" data-close>${ui.icon('x')}</button></div>
    <form class="body ui-stack" style="gap:18px">
      <div class="ui-field"><label>Name</label><input name="title" required placeholder="Morning briefing" value="${ui.esc(job?.title || q.title || '')}"></div>
      <div class="ui-seg type-seg"><button type="button" data-type="agent" aria-pressed="${job?.type !== 'command'}">Ask an agent</button><button type="button" data-type="command" aria-pressed="${job?.type === 'command'}">Run a command</button></div>
      <div class="ui-field t-agent"><label>What should it do?</label><textarea name="prompt" rows="6" placeholder="Summarize my unread mail from the last day: who needs a reply, anything urgent, then the rest in one line each.">${ui.esc(job?.prompt || q.prompt || '')}</textarea>
        <span class="hint">Write it like a message to the agent. Each run can read and update its own notes, so it remembers between runs.</span></div>
      <div class="ui-field t-command"><label>Command</label><input name="command" class="ui-mono" placeholder="backup --keep 7" value="${ui.esc(job?.command || '')}"><span class="hint">Runs with bash in the folder below. You're notified if it fails.</span></div>
      <div class="ui-field"><label>When</label>
        <div class="ui-seg preset-seg" style="flex-wrap:wrap">${PRESETS.map((x) => `<button type="button" data-p="${x.id}" aria-pressed="${p.id === x.id}">${x.label}</button>`).join('')}</div>
        <div class="when-row">
          <span class="w-hourly">at minute <input type="number" name="minute" min="0" max="59" value="${p.minute ?? 0}" style="width:72px"></span>
          <span class="w-time">at <input type="time" name="time" value="${p.time || '08:00'}"></span>
          <span class="w-dow">on <select name="dow">${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((n, i) => `<option value="${i}"${(p.dow ?? 1) === i ? ' selected' : ''}>${n}</option>`).join('')}</select></span>
          <span class="w-custom"><input name="cron" class="ui-mono" placeholder="*/30 * * * *" value="${ui.esc(p.cron || job?.schedule || '')}" style="width:180px"> <span class="hint">minute hour day month weekday</span></span>
        </div>
        <span class="hint next-preview"></span></div>
      <div class="ui-grid" style="--min:180px">
        <div class="ui-field t-agent"><label>Agent</label><select name="agent">${agents.map((a) => `<option value="${a.id}"${(job?.agent || defaultAgent()) === a.id ? ' selected' : ''}${a.signedIn ? '' : ' disabled'}>${ui.esc(a.name)}${a.signedIn ? '' : ' (sign in first)'}</option>`).join('')}</select></div>
        <div class="ui-field t-agent"><label>Model</label><select name="model"><option value="">Agent's default</option></select></div>
        <div class="ui-field t-agent"><label>Thinking</label><select name="effort"><option value="">Agent's default</option></select><span class="hint">A small model with little thinking is plenty for sorting and summarizing.</span></div>
        <div class="ui-field"><label>Works in</label><select name="cwd">${state.folders.map((f) => `<option${(job?.cwd || '~/home') === f ? ' selected' : ''}>${ui.esc(f)}</option>`).join('')}</select></div>
      </div>
      <div class="ui-grid" style="--min:150px">
        <div class="ui-field"><label>Group</label><input name="group" list="jobGroups" placeholder="None" value="${ui.esc(job?.group || '')}" autocomplete="off">
          <datalist id="jobGroups">${[...new Set(state.jobs.map((j) => j.group).filter(Boolean))].map((g) => `<option value="${ui.esc(g)}">`).join('')}</datalist></div>
        <div class="ui-field"><label>Time limit</label><select name="timeout">${choices(TIMEOUTS, job?.timeout || '')}</select></div>
        <div class="ui-field"><label>If it fails</label><select name="retries">${choices(RETRIES, String(job?.retries || 0))}</select></div>
        <div class="ui-field w-retry"><label>Try again after</label><select name="retryDelay">${choices(DELAYS, job?.retryDelay || '5m')}</select></div>
        <div class="ui-field"><label>On the Timeline</label><select name="timeline">${choices(TIMELINE, job?.timeline || '')}</select><span class="hint">A report: every run. A sync or chore: only failures.</span></div>
      </div>
      <label class="ui-hstack t-agent" style="gap:10px;font-size:var(--text-sm)"><input type="checkbox" class="ui-switch" name="report" ${job?.report === false ? '' : 'checked'}> Write a report for each run<span class="ui-faint" style="font-size:var(--text-xs)">(a title, the result, charts; off: the run is just its chat)</span></label>
      <label class="ui-hstack" style="gap:10px;font-size:var(--text-sm)"><input type="checkbox" class="ui-switch" name="notify" ${job?.notify === false ? '' : 'checked'}> Send the result to my phone</label>
      <label class="ui-hstack" style="gap:10px;font-size:var(--text-sm)"><input type="checkbox" class="ui-switch" name="catchUp" ${job?.catchUp === 'once' ? 'checked' : ''}> If a run is missed (machine off), run once when it's back</label>
    </form>
    <footer>${job ? `<button class="ui-btn ghost" data-del style="margin-right:auto;color:var(--danger)">Delete</button>` : ''}<button class="ui-btn" data-close>Cancel</button><button class="ui-btn primary" data-save>${job ? 'Save' : 'Create job'}</button></footer>`;
  document.body.appendChild(d);
  const f = d.querySelector('form');
  let type = job?.type === 'command' ? 'command' : 'agent', preset = p.id;
  const cronNow = () => {
    const [h, m] = (f.time.value || '08:00').split(':').map(Number);
    return { manual: '', hourly: `${+f.minute.value || 0} * * * *`, daily: `${m} ${h} * * *`, weekdays: `${m} ${h} * * 1-5`, weekly: `${m} ${h} * * ${f.dow.value}`, custom: f.cron.value.trim() }[preset];
  };
  // Model and thinking: whatever this agent offered at its last session start (api/agent/agents/<id>/options).
  const loadOptions = async (keep) => {
    const o = await api.get(`api/agent/agents/${f.agent.value}/options`).catch(() => ({ models: [], effort: null }));
    const want = { model: keep ? job?.model || '' : '', effort: keep ? job?.effort || '' : '' };
    f.model.innerHTML = `<option value="">Agent's default</option>` + (o.models || []).map((m) => `<option value="${ui.esc(m.id)}">${ui.esc(m.name)}</option>`).join('')
      + (want.model && !(o.models || []).some((m) => m.id === want.model) ? `<option value="${ui.esc(want.model)}">${ui.esc(want.model)}</option>` : '');
    f.effort.innerHTML = `<option value="">Agent's default</option>` + (o.effort?.values || []).map((v) => `<option value="${ui.esc(v.id)}">${ui.esc(v.name)}</option>`).join('');
    f.model.value = want.model; f.effort.value = want.effort;
    f.model.disabled = !(o.models || []).length && !want.model;
    f.effort.closest('.ui-field').style.display = type === 'agent' && o.effort ? '' : 'none';
  };
  f.agent.addEventListener('change', () => loadOptions(false));
  // A new job's Timeline choice follows what it is (a report you read: every run; a command or a run
  // without a report: only failures) until you pick one yourself.
  let timelinePicked = !!job;
  f.timeline.addEventListener('change', () => { timelinePicked = true; });
  const syncTimeline = () => { if (!timelinePicked) f.timeline.value = type === 'agent' && f.report.checked ? '' : 'failures'; };
  f.report.addEventListener('change', syncTimeline);
  const syncRetry = () => { d.querySelector('.w-retry').style.display = +f.retries.value ? '' : 'none'; };
  f.retries.addEventListener('change', syncRetry); syncRetry();
  loadOptions(true);
  const sync = async () => {
    d.querySelectorAll('.t-agent').forEach((x) => (x.style.display = type === 'agent' ? '' : 'none'));
    d.querySelectorAll('.t-command').forEach((x) => (x.style.display = type === 'command' ? '' : 'none'));
    syncTimeline();
    d.querySelector('.w-hourly').style.display = preset === 'hourly' ? '' : 'none';
    d.querySelector('.w-time').style.display = ['daily', 'weekdays', 'weekly'].includes(preset) ? '' : 'none';
    d.querySelector('.w-dow').style.display = preset === 'weekly' ? '' : 'none';
    d.querySelector('.w-custom').style.display = preset === 'custom' ? '' : 'none';
    const cron = cronNow(), out = d.querySelector('.next-preview');
    if (!cron) { out.textContent = 'Runs only when you press Run now (or ask the agent).'; return; }
    try {
      const r = await api.get(`api/agent/cron?expr=${encodeURIComponent(cron)}`);
      out.innerHTML = `${ui.esc(r.describe)} · next <span class="ui-mono">${new Date(r.next).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>`;
    } catch (e) { out.innerHTML = `<span style="color:var(--danger)">${ui.esc(e.message)}</span>`; }
  };
  d.addEventListener('click', async (e) => {
    const ty = e.target.closest('[data-type]'); if (ty) { type = ty.dataset.type; sync(); }
    const pr = e.target.closest('[data-p]'); if (pr) { preset = pr.dataset.p; sync(); }
    if (e.target.closest('[data-del]')) { if (await ui.confirm('Delete this job?', { body: 'Its runs stay on the Timeline.', ok: 'Delete', danger: true })) { await api.del(`api/agent/jobs/${job.name}`); d.close(); ctx.go('#/jobs'); } }
    if (e.target.closest('[data-save]')) {
      if (!f.title.value.trim()) return f.title.focus();
      const body = { title: f.title.value.trim(), type, schedule: cronNow() || null, agent: type === 'agent' ? f.agent.value : undefined, cwd: f.cwd.value,
        prompt: type === 'agent' ? f.prompt.value.trim() : undefined, command: type === 'command' ? f.command.value.trim() : undefined,
        notify: f.notify.checked, catchUp: f.catchUp.checked ? 'once' : 'skip', report: type === 'agent' ? f.report.checked : undefined,
        model: type === 'agent' ? f.model.value : undefined, effort: type === 'agent' ? f.effort.value : undefined,
        group: f.group.value.trim(), timeline: f.timeline.value, timeout: f.timeout.value, retries: +f.retries.value, retryDelay: +f.retries.value ? f.retryDelay.value : '' };
      try {
        const r = job ? await api.patch(`api/agent/jobs/${job.name}`, body) : await api.post('api/agent/jobs', body);
        d.close();
        ui.toast(job ? 'Saved' : 'Job created');
        ctx.go(`#/jobs/${r.name}`);
      } catch (err) { ui.toast(err.message, { icon: 'circle-alert' }); }
    }
  });
  f.addEventListener('input', (e) => { if (['minute', 'time', 'dow', 'cron'].includes(e.target.name)) sync(); });
  f.addEventListener('submit', (e) => e.preventDefault());
  d.addEventListener('close', () => d.remove());
  d.showModal();
  sync();
}

// Jobs: things that run on a schedule. Each run is a chat thread; its last message is the report.
import { api, state, on, chatAgents, agentName, defaultAgent } from './api.js';
import { nextLabel, runFeed } from './home.js';

let el, ctx, currentName = null, tab = 'jobs';

export function init(root, c) {
  el = root; ctx = c;
  on('jobs', () => { if (el.closest('.shown')) render(); });
  on('threads', () => { if (el.closest('.shown') && (currentName || tab === 'runs')) render(); });
  el.addEventListener('click', onClick);
}
export function show(_el, r) { currentName = r.name; tab = r.q?.view === 'runs' ? 'runs' : 'jobs'; if (r.name === 'new' || r.q?.new) { currentName = null; render(); openEditor(null, r.q); } else render(); }
export function title(r) { return r.name ? (state.jobs.find((j) => j.name === r.name)?.title || r.name) : r.q?.view === 'runs' ? 'Runs' : 'Jobs'; }

function trail(j) { return `<span class="ui-trail" title="Last ${j.trail.length} runs">${j.trail.map((s) => `<i class="${s}"></i>`).join('')}${j.running ? '<i class="running"></i>' : ''}</span>`; }

const tabs = () => `<div class="ui-seg jobs-tabs"><a href="#/jobs" class="${tab === 'jobs' ? 'on' : ''}">Jobs</a><a href="#/jobs?view=runs" class="${tab === 'runs' ? 'on' : ''}">Runs</a></div>`;

async function render() {
  if (currentName) return renderDetail(currentName);
  if (tab === 'runs') {
    ui.morph(el, `<div class="ui-page narrow jobs">
      <header class="ui-heading"><div><span class="ui-eyebrow">What your jobs reported</span><h1 class="ui-display">Runs.</h1></div>
        <div class="actions">${tabs()}</div></header>
      <div class="ui-feed">${runFeed(state.threads.filter((t) => t.origin?.startsWith('job:')))}</div></div>`);
    return;
  }
  const jobs = state.jobs;
  ui.morph(el, `<div class="ui-page jobs">
    <header class="ui-heading"><div><span class="ui-eyebrow">Scheduled work</span><h1 class="ui-display">Jobs.</h1></div>
      <div class="actions">${tabs()}<button class="ui-btn primary" data-a="new">${ui.icon('plus', 'sm')}New job</button></div></header>
    ${jobs.length ? `<div class="ui-grid job-grid" style="--min: 340px">${jobs.map((j) => `
      <div class="ui-card hover job-card${j.enabled ? '' : ' paused'}" data-open="${j.name}" tabindex="0">
        <div class="jc-top"><span class="jc-title">${ui.esc(j.title || j.name)}</span>${trail(j)}</div>
        <p class="jc-desc">${ui.esc(j.type === 'command' ? j.command : j.prompt)}</p>
        <div class="jc-sched">${ui.icon('clock', 'sm')}<span>${ui.esc(j.enabled ? j.describe : 'Paused')}</span><span class="ui-spacer"></span>
          <span class="ui-mono">${j.running ? '<span class="ui-dot run"></span> Running' : j.enabled && j.next ? nextLabel(j.next) : ''}</span></div>
        <div class="jc-foot"><span class="ui-faint jc-agent">${j.type === 'command' ? 'Command' : ui.esc(agentName(j.agent || defaultAgent()))}${j.last ? ` · last ${ui.ago(j.last.started)}` : ''}</span><span class="ui-spacer"></span>
          <button class="ui-btn quiet" data-run="${j.name}" ${j.running ? 'disabled' : ''}>${ui.icon('play', 'xs')} Run now</button>
          <button class="ui-btn quiet muted" data-toggle="${j.name}">${j.enabled ? 'Pause' : 'Resume'}</button></div>
      </div>`).join('')}</div>`
    : `<div class="ui-empty"><div class="orbit"></div><h2>No jobs yet.</h2><p>A job is a prompt (or a command) on a schedule: a morning briefing, a weekly cleanup, a check every hour. Each run lands in Recent and pings your phone.</p>
       <button class="ui-btn primary" data-a="new">${ui.icon('plus', 'sm')}New job</button>
       <a class="ui-link-action" href="#/new?text=${encodeURIComponent('Create a job that ')}">Or describe it to the agent</a></div>`}
  </div>`);
}

async function renderDetail(name) {
  let j;
  try { j = await api.get(`api/agent/jobs/${name}`); } catch { ui.morph(el, `<div class="ui-page"><a class="ui-back" href="#/jobs">‹ Jobs</a><div class="ui-empty"><h2>No such job.</h2></div></div>`); return; }
  if (currentName !== name) return;
  const runs = j.runs || [];
  ui.morph(el, `<div class="ui-page narrow job-detail">
    <a class="ui-back" href="#/jobs">${ui.icon('chevron-left', 'sm')}Jobs</a>
    <header class="ui-heading"><div><span class="ui-eyebrow">${j.running ? '<span class="ui-pill run"><span class="ui-dot run"></span>Running</span>' : j.enabled ? ui.esc(j.describe) : 'Paused'}</span>
      <h1 class="ui-display">${ui.esc(j.title || j.name)}</h1></div>
      <div class="actions"><button class="ui-icon-btn" data-menu-job="${j.name}" title="More">${ui.icon('ellipsis')}</button>
        <button class="ui-btn" data-edit="${j.name}">Edit</button><button class="ui-btn primary" data-run="${j.name}" ${j.running ? 'disabled' : ''}>${ui.icon('play', 'xs')} Run now</button></div></header>
    <blockquote class="job-prompt">${ui.esc(j.type === 'command' ? '$ ' + j.command : j.prompt)}</blockquote>
    <dl class="ui-facts">
      <div><dt>Schedule</dt><dd>${ui.esc(j.schedule ? j.describe : 'Manual only')}<small class="ui-mono">${ui.esc(j.schedule || '')}</small></dd></div>
      <div><dt>Next run</dt><dd>${j.enabled && j.next ? ui.esc(new Date(j.next).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : j.enabled ? '—' : 'Paused'}<small>${j.catchUp === 'once' ? 'Catches up once if missed' : 'Skips missed runs'}</small></dd></div>
      <div><dt>${j.type === 'command' ? 'Runs' : 'Agent'}</dt><dd>${j.type === 'command' ? 'A shell command' : ui.esc(agentName(j.agent || defaultAgent()))}<small>${j.notify === false ? 'No notifications' : j.type === 'command' ? 'Notifies on failure' : 'Sends its report to your phone'}</small></dd></div>
      <div><dt>Works in</dt><dd class="ui-mono">${ui.esc(j.cwd || '~/home')}<small class="ui-mono">~/home/jobs/${ui.esc(j.name)}/</small></dd></div>
    </dl>
    <section class="ui-section"><header><span class="ui-label">Runs</span></header>
      ${runs.length ? `<div class="ui-feed">${runs.map((r) => `<a class="ui-feed-row" href="${r.thread_id ? `#/t/${r.thread_id}` : '#'}">
        <span class="time">${ui.time(r.started)}</span><span class="ui-dot ${r.status === 'done' ? 'ok' : r.status === 'failed' ? 'danger' : r.status === 'running' ? 'run' : 'warn'}"></span>
        <span class="title">${ui.esc(new Date(r.started).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }))}${r.finished ? ` <span class="ui-mono ui-faint">${ui.duration(r.finished - r.started)}</span>` : ''}</span><span class="chev">›</span>
        <span class="sub${r.status === 'failed' ? ' danger' : ''}">${ui.esc((r.summary || (r.status === 'running' ? 'Running…' : r.status)).replace(/[#*`_]/g, ''))}</span></a>`).join('')}</div>`
      : `<p class="ui-muted" style="font-size:var(--text-sm)">No runs yet. ${j.enabled && j.next ? `The first one is ${nextLabel(j.next).replace('Next ', 'at ').toLowerCase()}.` : ''}</p>`}
    </section>
    ${j.type !== 'command' ? `<section class="ui-section"><header><span class="ui-label">The agent's notes</span><span class="ui-faint" style="font-size:var(--text-xs)">NOTES.md, kept between runs</span></header>
      <div class="ui-card pad ui-prose notes">${ui.markdown(j.notes || '_Empty._')}</div></section>` : ''}
  </div>`);
}

async function onClick(e) {
  const t = e.target;
  const run = t.closest('[data-run]');
  if (run) { e.stopPropagation(); run.disabled = true; try { const r = await api.post(`api/agent/jobs/${run.dataset.run}/run`); ui.toast('Started', { icon: 'play' }); if (r.threadId) ctx.go(`#/t/${r.threadId}`); } catch (err) { ui.toast(err.message, { icon: 'circle-alert' }); run.disabled = false; } return; }
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
    m.innerHTML = `<button data-x="toggle">${ui.icon(j?.enabled ? 'pause' : 'play')}${j?.enabled ? 'Pause' : 'Resume'}</button><button data-x="ask">${ui.icon('sparkles')}Ask the agent to change it</button><hr><button class="danger" data-x="delete">${ui.icon('trash-2')}Delete job</button>`;
    m.onclick = async (ev) => {
      const x = ev.target.closest('[data-x]')?.dataset.x;
      ui.closePopover();
      if (x === 'toggle') await api.patch(`api/agent/jobs/${j.name}`, { enabled: !j.enabled });
      if (x === 'ask') ctx.go(`#/new?text=${encodeURIComponent(`Change the job "${j.title || j.name}" (~/home/jobs/${j.name}/job.json) so that `)}`);
      if (x === 'delete' && confirm(`Delete the job "${j.title || j.name}"? Its run history stays in Recent.`)) { await api.del(`api/agent/jobs/${j.name}`); ctx.go('#/jobs'); }
    };
    ui.popover(mj, m, { temp: true, align: 'end' });
    return;
  }
  const card = t.closest('[data-open]');
  if (card && !t.closest('button')) ctx.go(`#/jobs/${card.dataset.open}`);
}

/* ---------- Editor ---------- */
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
  const p = presetOf(job?.schedule ?? (q.schedule || '0 8 * * *'));
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
        <div class="ui-field"><label>Works in</label><select name="cwd">${state.folders.map((f) => `<option${(job?.cwd || '~/home') === f ? ' selected' : ''}>${ui.esc(f)}</option>`).join('')}</select></div>
      </div>
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
  const sync = async () => {
    d.querySelectorAll('.t-agent').forEach((x) => (x.style.display = type === 'agent' ? '' : 'none'));
    d.querySelectorAll('.t-command').forEach((x) => (x.style.display = type === 'command' ? '' : 'none'));
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
    if (e.target.closest('[data-del]')) { if (confirm('Delete this job?')) { await api.del(`api/agent/jobs/${job.name}`); d.close(); ctx.go('#/jobs'); } }
    if (e.target.closest('[data-save]')) {
      if (!f.title.value.trim()) return f.title.focus();
      const body = { title: f.title.value.trim(), type, schedule: cronNow() || null, agent: type === 'agent' ? f.agent.value : undefined, cwd: f.cwd.value,
        prompt: type === 'agent' ? f.prompt.value.trim() : undefined, command: type === 'command' ? f.command.value.trim() : undefined,
        notify: f.notify.checked, catchUp: f.catchUp.checked ? 'once' : 'skip' };
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

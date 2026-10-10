// A job run, as the owner reads it: when, the report's title, one line of links (the job, the work),
// then the report (Rollmark: Markdown plus charts). The steps live in the run's chat, a click away.
import { api, on } from './api.js';

let el, current = null, run = null, loading = null;

export function init(root) {
  el = root;
  // The report has its own node, outside what re-renders, so a redraw never blanks its charts.
  el.innerHTML = '<div class="ui-page narrow run-page"><div class="run-top"></div><article class="run-report"></article><div class="run-rest"></div></div>';
  on('agent:run', (ev) => { if (current && ev.threadId === current && el.closest('.shown')) load(current); });
  on('jobs', () => { if (current && run?.status === 'running' && el.closest('.shown')) load(current); });
}
export function show(_el, r) { load(r.id); }
export function title() { return run?.title || run?.jobTitle || 'Run'; }

async function load(id) {
  if (current !== id) { current = id; run = null; }
  const mine = (loading = api.get(`api/agent/runs/thread/${id}`).catch((e) => ({ error: e.message })));
  const r = await mine;
  if (loading !== mine || current !== id) return;
  if (r.error) { el.querySelector('.run-report').hidden = true; ui.morph(el.querySelector('.run-top'), `<a class="ui-back" href="#/jobs?view=runs">${ui.icon('chevron-left', 'sm')}Runs</a><div class="ui-empty"><h2>No such run.</h2><p>${ui.esc(r.error)}</p></div>`); ui.morph(el.querySelector('.run-rest'), ''); return; }
  run = r;
  render();
}

function render() {
  const r = run, when = new Date(r.started);
  const status = r.running || r.status === 'running' ? ['run', 'Running'] : r.status === 'failed' ? ['danger', 'Failed'] : r.status === 'cancelled' ? ['warn', 'Stopped'] : ['ok', 'Done'];
  const took = r.finished ? ui.duration(r.finished - r.started) : '';
  ui.morph(el.querySelector('.run-top'), `
    <a class="ui-back" href="#/jobs?view=runs">${ui.icon('chevron-left', 'sm')}Runs</a>
    <header class="run-head">
      <span class="ui-eyebrow">${ui.esc(when.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))} · ${ui.esc(ui.time(r.started))}</span>
      <h1 class="run-title">${ui.esc(r.title || r.jobTitle)}</h1>
      <div class="run-meta">
        <span class="ui-status"><span class="ui-dot ${status[0]}"></span>${status[1]}${took ? ` <span class="ui-mono">${took}</span>` : ''}</span>
        <a href="#/jobs/${ui.esc(r.job)}">${ui.icon('calendar-clock', 'sm')}${ui.esc(r.jobTitle)}</a>
        <a href="#/t/${ui.esc(r.thread_id)}">${ui.icon('list-tree', 'sm')}See the work</a>
      </div>
    </header>`);
  const box = el.querySelector('.run-report');
  box.hidden = !r.report;
  // The title is the page's heading: drop a leading "# heading" that repeats it.
  if (r.report) ui.report(box, r.report.replace(/^\s*#\s+(.+)\n+/, (m, h) => (h.trim() === (r.title || '').trim() ? '' : m)));
  ui.morph(el.querySelector('.run-rest'), r.report ? ''
    : r.running || r.status === 'running' ? `<p class="run-wait"><span class="ui-shimmer">Working on it.</span> The report shows here when it's ready.</p>`
    : r.status === 'failed' ? `<div class="ui-callout danger">${ui.icon('circle-alert', 'sm')}<div>${ui.esc(r.summary || 'The run failed.')}</div></div>`
    : `<p class="ui-muted">${ui.esc(r.summary || 'No report.')}</p>`);
}

// A conversation with an agent: the timeline and the composer. Used full-page
// (#/t/<id>, #/new) and in the side panel ("Chat about this").
import { api, state, on, chatAgents, agentName, defaultAgent, chatDefaults, upsertThread, loadAgents, errorLevel } from './api.js';
import { signinPanel, terminalSetup } from './signin.js';
import { promptImage, imageFiles, MAX_PROMPT_IMAGES } from './images.js';
import { mentionAt, rankFiles, folderFiles } from './mentions.js';
import { followOutput } from './follow-output.js';

let page = null, panel = null, pageCtx = null;

export function init(el, ctx) { pageCtx = ctx; page = new ThreadView(el, { ctx, mode: 'page' }); }
export function show(el, r) { page.open(r.id || null, r.q || {}); }
export function title(r) { if (!r.id) return 'New chat'; return state.threads.find((t) => t.id === r.id)?.title || 'Chat'; }
export function focusComposer() { const v = panel || page; v?.focusComposer(); return !!v; }
export function mountPanel(el, { id, context, ctx, onCreated, onClose, text }) {
  panel?.destroy();
  el.innerHTML = '';
  panel = new ThreadView(el, { ctx, mode: 'panel', context, onCreated, onClose });
  panel.open(id || null, { text }); // text: a starter prompt in a new chat's box, not sent
  setTimeout(() => panel?.focusComposer(), 50);
}
export function unmountPanel() { panel?.destroy(); panel = null; }
// The View's context changed (another file, other lines): update the chip; the next message carries it.
export function setPanelContext(context) { if (panel && panel.context) { panel.context = context; panel.renderComposerFoot(); } }
export function focusPanel() { panel?.$input?.focus(); }
// Escape stops a working chat when focus is in it (its composer). Not with focus nowhere: Escape pressed
// to dismiss something else while a job's run is on screen mustn't stop the job. In the side pane, it
// closes the pane.
export function stopOnEscape(target) {
  if (!target || target.isContentEditable) return false; // renaming
  const v = [panel, page].find((x) => x?.el.contains(target));
  if (v?.side && v.$side.contains(target)) { v.closeSide(); return true; }
  if (!v || v.menuOpen() || !v.showing() || !v.working()) return false;
  v.stop();
  return true;
}
export async function startChat({ text, agent, cwd, context }) {
  const t = await api.post('api/agent/threads', { agent: agent || defaultAgent(), cwd: cwd || '~/home', text, context });
  upsertThread(t);
  pageCtx?.go(`#/t/${t.id}`);
  return t;
}

/* ---------- Presentation of tool calls ---------- */
const KIND = {
  execute: { icon: 'square-terminal', live: 'Running', done: 'Ran' },
  read: { icon: 'file-text', live: 'Reading', done: 'Read' },
  edit: { icon: 'file-pen-line', live: 'Editing', done: 'Edited' },
  delete: { icon: 'trash-2', live: 'Deleting', done: 'Deleted' },
  move: { icon: 'folder-input', live: 'Moving', done: 'Moved' },
  search: { icon: 'search', live: 'Searching', done: 'Searched' },
  fetch: { icon: 'globe', live: 'Fetching', done: 'Fetched' },
  think: { icon: 'brain', live: 'Thinking', done: 'Thought' },
  switch_mode: { icon: 'sliders-horizontal', live: 'Switching mode', done: 'Switched mode' },
  other: { icon: 'wrench', live: 'Using', done: 'Used' },
};
const LIVE = new Set(['pending', 'in_progress']);
// A call whose command went on in the background is done; the work goes on as a background task.
const isLive = (i) => LIVE.has(i.status) && !i.backgrounded;
// A background task's state, as its agent's adapter reported it.
const TASK_STATE = {
  running: { dot: 'run', label: 'Running in the background', short: '' },
  paused: { icon: 'pause', dot: '', label: 'Paused', short: 'Paused' },
  completed: { icon: 'check', dot: 'ok', label: 'Finished', short: '' },
  failed: { icon: 'circle-alert', dot: 'danger', label: 'Failed', short: 'Failed' },
  stopped: { icon: 'square', dot: '', label: 'Stopped', short: 'Stopped' },
  killed: { icon: 'square', dot: '', label: 'Stopped', short: 'Stopped' },
  disconnected: { icon: 'square', dot: '', label: 'Stopped with the agent', short: 'Stopped with the agent' },
};
const taskState = (t) => TASK_STATE[t.state] || TASK_STATE.disconnected;
const home = (p) => String(p || '').replace(/^\/home\/[^/]+/, '~');

function toolText(item) {
  const out = [];
  for (const c of item.content || []) if (c.type === 'content' && c.content?.type === 'text') out.push(c.content.text);
  if (!out.length && item.output) out.push(item.output); // streamed a chunk at a time (Codex)
  if (!out.length && item.rawOutput != null) {
    const r = item.rawOutput;
    if (typeof r === 'string') out.push(r);
    else if (r.stdout || r.stderr) out.push([r.stdout, r.stderr].filter(Boolean).join('\n'));
    else if (r.output || r.formatted_output || r.aggregated_output) out.push(r.formatted_output || r.aggregated_output || r.output);
    else out.push(JSON.stringify(r, null, 2));
  }
  return out.join('\n').replace(/^```\w*\n?|```$/g, '').trimEnd();
}

function toolTarget(item) {
  const i = item.rawInput || {};
  const k = item.toolKind || 'other';
  const path = i.file_path || i.path || i.notebook_path || item.locations?.[0]?.path;
  if (k === 'execute') return { text: i.command || (Array.isArray(i.cmd) ? i.cmd.join(' ') : i.cmd) || stripTicks(item.title), mono: true };
  if (k === 'read' || k === 'edit' || k === 'delete' || k === 'move') return { text: fileTarget(item, path), file: true };
  if (k === 'search') return { text: i.pattern || i.query || stripTicks(item.title), mono: !!i.pattern, extra: path ? `in ${home(path)}` : '' };
  if (k === 'fetch') return { text: i.url || i.query || stripTicks(item.title) };
  return { text: stripTicks(item.title || item.tool || 'tool') };
}
const stripTicks = (s) => String(s || '').replace(/^`|`$/g, '');
// The file a file tool works on. Without a path in its input, each agent's title says it its own way:
// "Edit `/abs/a.sql`" (Cursor), "Read file '/abs/a.sql'" (Codex), "edit_file: a.sql" (Muse), or just
// "Editing files" / "Running edit_file" (Codex, Antigravity), when the file is only in its diff.
function fileTarget(item, path) {
  path ||= diffsOf(item).find((d) => d.path)?.path;
  if (path) return home(path);
  const title = String(item.title || '').trim();
  const quoted = title.match(/^(?:edit|write|create|read|view|delete)(?: file)?\s+[`'"]([^`'"]+)[`'"]$/i);
  if (quoted) return home(quoted[1]);
  const prefixed = title.match(/^[a-z][a-z0-9_]*:\s+(.+)$/);
  if (prefixed) return home(prefixed[1]);
  if (/^(?:editing files?|running [a-z_]+|run [a-z_]+\?)$/i.test(title)) return '';
  return stripTicks(title);
}

// A new chat has no session yet: offer the models and effort levels its agent offered last time.
const agentOpts = new Map(); // agent id -> options | Promise
function draftOptions(agent, rerender) {
  const o = agentOpts.get(agent);
  if (o && !(o instanceof Promise)) return o;
  if (!o) agentOpts.set(agent, api.get(`api/agent/agents/${agent}/options`).catch(() => ({ models: [], effort: null })).then((r) => { agentOpts.set(agent, r); rerender(); }));
  return null;
}
// A new chat starts on its agent's default model from Settings, else the one last picked for it (if still offered).
const draftModel = (agent, o) => [chatDefaults(agent).model, o?.preferredModel].find((id) => id && o?.models?.some((m) => m.id === id)) || o?.currentModel;
const draftEffort = (agent, o) => [chatDefaults(agent).effort].find((id) => id && o?.effort?.values?.some((v) => v.id === id)) || o?.effort?.current;
// Personas (~/home/personas): how the agent talks, picked in the composer's settings menu. A new chat starts on Settings' default.
let personas = null; // [{ id, name, icon, description }] | Promise
function personaList(rerender) {
  if (personas && !(personas instanceof Promise)) return personas;
  if (!personas) personas = api.get('api/agent/personas').catch(() => []).then((r) => { personas = Array.isArray(r) ? r : []; rerender(); });
  return [];
}
// Commands agentd handles itself (the agent never sees them), offered with the agent's own.
const OWN_COMMANDS = [{ name: 'persona', description: 'How the agent talks: /persona <name>, /persona off, or /persona to list' }];
function diffsOf(item) { return (item.content || []).filter((c) => c.type === 'diff'); }

// Line diff (LCS) with context, for edit tool calls.
function lineDiff(a = '', b = '') {
  const x = (a || '').split('\n'), y = (b || '').split('\n');
  if (!a) return y.map((l) => ['add', l]);
  if (x.length * y.length > 400000) return [...x.map((l) => ['del', l]), ...y.map((l) => ['add', l])];
  const n = x.length, m = y.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { ops.push(['same', x[i]]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push(['del', x[i++]]);
    else ops.push(['add', y[j++]]);
  }
  while (i < n) ops.push(['del', x[i++]]);
  while (j < m) ops.push(['add', y[j++]]);
  return ops;
}
function diffStats(item) {
  let add = 0, del = 0;
  for (const d of diffsOf(item).filter((x) => !x.truncated)) for (const [op] of lineDiff(d.oldText, d.newText)) { if (op === 'add') add++; if (op === 'del') del++; }
  return { add, del };
}
// The files a turn changed, in the order it first touched them, with their diffs and line counts.
// Failed edits didn't change anything.
function turnChanges(items) {
  const byPath = new Map();
  for (const i of items) {
    if (i.kind !== 'tool' || i.status === 'failed') continue;
    for (const d of diffsOf(i)) if (d.path) byPath.set(d.path, [...(byPath.get(d.path) || []), d]);
  }
  return [...byPath].map(([path, diffs]) => {
    let add = 0, del = 0;
    for (const d of diffs.filter((x) => !x.truncated)) for (const [op] of lineDiff(d.oldText, d.newText)) { if (op === 'add') add++; if (op === 'del') del++; }
    return { path, diffs, add, del };
  });
}
function renderDiff(d) {
  if (d.truncated) return `<div class="ui-diff"><div class="path"><a class="diff-file" href="#/v/files#p=${encodeURIComponent(d.path)}" title="Open in Files">${ui.esc(home(d.path))}</a><span class="stats ui-faint">Large change, not shown</span></div></div>`;
  const ops = lineDiff(d.oldText, d.newText);
  const keep = new Set();
  ops.forEach(([op], i) => { if (op !== 'same') for (let k = i - 2; k <= i + 2; k++) keep.add(k); });
  let html = '', gap = false, add = 0, del = 0;
  ops.forEach(([op, l], i) => {
    if (op === 'add') add++; if (op === 'del') del++;
    if (!keep.has(i) && d.oldText) { if (!gap) { html += '<div class="l gap">⋯</div>'; gap = true; } return; }
    gap = false;
    html += `<div class="l ${op === 'same' ? '' : op}">${op === 'add' ? '+ ' : op === 'del' ? '- ' : '  '}${ui.esc(l)}</div>`;
  });
  return `<div class="ui-diff"><div class="path"><a class="diff-file" href="#/v/files#p=${encodeURIComponent(d.path)}" title="Open in Files">${ui.esc(home(d.path))}</a><span class="stats"><span class="add-n">+${add}</span> <span class="del-n">−${del}</span></span></div><div class="lines">${html}</div></div>`;
}

const TURN_PAGE = 50;       // turns shown at first, and per "Show earlier"
const BIG_TEXT = 24000;     // a message this long streams as plain text, formatted once it's done

// The agent's text, images, links, notices and approvals stay in the conversation where they came;
// each run of thoughts, tools and plans between them folds into one work row. Delegated agents and
// background tasks are their own rows, after the last work.
function turnParts(items) {
  const segments = [], agents = [], tasks = [];
  for (const i of items) {
    if (i.worker || i.kind === 'user' || i.kind === 'turn') continue;
    if (i.kind === 'agent') agents.push(i);
    else if (i.kind === 'task') tasks.push(i);
    else if (['text', 'media', 'notice', 'permission'].includes(i.kind)) segments.push({ item: i });
    else if (segments.at(-1)?.work) segments.at(-1).work.push(i);
    else segments.push({ work: [i] });
  }
  return { segments, agents, tasks, lastWork: segments.findLastIndex((s) => s.work) };
}

// Agent text as Markdown. Images from other sites become links: loading one would tell that site
// whatever the agent put in its address (text from an email it read, say). Code blocks get a copy button.
function chatMarkdown(text) {
  return ui.markdown(text).replace(/<img alt="([^"]*)" src="(https?:[^"]*)">/g, (_, alt, src) =>
    `<a class="img-link" href="${src}" target="_blank" rel="noopener">${ui.icon('image', 'sm')}${alt || 'Image'}</a>`)
    .replace(/<pre[ >][\s\S]*?<\/pre>/g, (pre) => `<div class="code-wrap">${pre}<button class="code-copy" data-code-copy title="Copy code">${ui.icon('copy', 'sm')}</button></div>`);
}

/* ---------- The view ---------- */
class ThreadView {
  constructor(el, { ctx, mode, context, onCreated, onClose }) {
    this.el = el; this.ctx = ctx; this.mode = mode; this.context = context; this.onCreated = onCreated; this.onClose = onClose;
    this.id = null; this.thread = null; this.items = []; this.open_ = new Set(); this.shut_ = new Set(); this.turnCache = new Map();
    this.draftAgent = null; this.draftCwd = '~/home'; this.draftAccess = 'full'; this.draftModel = null; this.draftEffort = null; this.draftPersona = undefined;
    this.attached = []; // images to send with the next message: { mimeType, data, name, url }
    el.innerHTML = `
      <div class="thread-shell in-${mode}">
      <div class="thread ${mode}">
        <header class="thread-head"></header>
        <div class="thread-scroll-area">
          <div class="thread-scroll" tabindex="0" aria-label="Chat messages"><div class="thread-content"><div class="earlier"></div><div class="timeline"></div><article class="chat-report" hidden></article><div class="tail"></div></div></div>
          <button type="button" class="ui-btn sm thread-latest" hidden>${ui.icon('arrow-down', 'sm')}Latest</button>
        </div>
        <div class="dock"><div class="stack"></div><div class="bg-work"></div><div class="composer"></div></div>
      </div>
      <aside class="thread-side" hidden></aside>
      </div>`;
    this.$shell = el.querySelector('.thread-shell');
    // The side pane: one background task (its command and output) or delegated agent (its transcript).
    this.$side = el.querySelector('.thread-side');
    this.side = null; // { kind: 'task' | 'agent', id, out, outAt, final, stick }
    this.$side.addEventListener('click', (e) => this.onSideClick(e));
    this.$side.addEventListener('toggle', (e) => { const k = e.target.dataset?.key; if (k) e.target.open ? this.open_.add(k) : this.open_.delete(k); }, true);
    this.$head = el.querySelector('.thread-head');
    this.$scroll = el.querySelector('.thread-scroll');
    this.$latest = el.querySelector('.thread-latest');
    this.follow = followOutput(this.$scroll, el.querySelector('.thread-content'), (following) => { this.$latest.hidden = following; });
    this.$latest.addEventListener('click', () => { this.$scroll.focus({ preventScroll: true }); this.follow.follow(); });
    this.$timeline = el.querySelector('.timeline');
    this.$earlier = el.querySelector('.earlier');
    this.$earlier.addEventListener('click', () => this.showEarlier());
    this.$tail = el.querySelector('.tail');
    this.$report = el.querySelector('.chat-report');
    this.$stack = el.querySelector('.stack');
    this.$composer = el.querySelector('.composer');
    this.$bg = el.querySelector('.bg-work');
    this.bg = [];
    this.$bg.addEventListener('toggle', (e) => { if (e.target.matches?.('details.bg')) this.bgOpen = e.target.open; }, true);
    this.$bg.addEventListener('click', (e) => this.onBgClick(e));
    this.buildComposer();
    this.off = [
      on('agent:item', (ev) => { if (ev.item.threadId === this.id) this.upsert(ev.item); }),
      on('agent:append', (ev) => { if (ev.threadId === this.id) this.append(ev); }),
      on('agent:removed', (ev) => { if (ev.threadId === this.id) { this.items = this.items.filter((i) => i.id !== ev.id); this.turnCache.clear(); this.schedule(); } }),
      on('agent:reconnect', () => this.refresh()),
      on('agent:thread', (ev) => { if (ev.thread.id === this.id) { this.thread = ev.thread; this.schedule(); } }),
      on('agents', () => { this.renderComposerFoot(); if (!this.thread) this.renderStack(); }),
      on('agent:run', (ev) => { if (ev.threadId === this.id) this.loadReport(); }),
    ];
    this.$timeline.addEventListener('toggle', (e) => {
      const k = e.target.dataset?.key;
      if (k && !k.endsWith(':agents')) e.target.open ? this.open_.add(k) : this.open_.delete(k); // agent groups: by click only (they open by themselves)
    }, true);
    this.$timeline.addEventListener('click', (e) => this.onTimelineClick(e));
    this.$timeline.addEventListener('keydown', (e) => {
      const r = (e.key === 'Enter' || e.key === ' ') && e.target.closest?.('[data-side]');
      if (r) { e.preventDefault(); this.openSide(r.dataset.side, r.dataset.sideId); }
    });
    this.ticker = setInterval(() => this.tick(), 1000);
  }

  destroy() { this.off.forEach((f) => f()); this.follow.destroy(); cancelAnimationFrame(this.raf); clearTimeout(this.readTimer); clearInterval(this.ticker); this.sgPanel?.panel.stop(); this.el.innerHTML = ''; }
  showing() { return this.el.getClientRects().length > 0; }
  working() { const t = this.thread; return !!t && !t.stopping && (t.running || ['running', 'starting', 'waiting'].includes(t.status)); }
  stop() { if (this.id) api.post(`api/agent/threads/${this.id}/cancel`).catch(() => {}); }
  focusComposer() { this.$input?.focus(); }

  async open(id, q = {}) {
    // The bar belongs to one chat. A new chat, or a different one, must not keep the last bar.
    if (id !== this.id) { this.bg = []; this.bgAt = 0; this.renderBackground(); this.side = null; this.renderSide(); }
    this.id = id; this.follow.follow();
    this.turnLimit = TURN_PAGE; this.recall = null; this.nudge = null;
    const reset = () => { this.$earlier.innerHTML = ''; this.items = []; this.turnCache.clear(); this.$timeline.innerHTML = ''; this.thread = null; this.$report.hidden = true; this.$report.innerHTML = ''; this.reportDup = null; };
    if (!id) {
      reset();
      this.draftAgent = q.agent || this.draftAgent || defaultAgent();
      if (q.cwd) this.draftCwd = q.cwd;
      this.renderHead(); this.renderEmpty(); this.renderComposerFoot(); this.renderStack();
      this.$input.value = q.text || this.loadDraft();
      this.autosize();
      return;
    }
    // Keep what's on screen until the chat arrives (usually a few ms); a spinner only if it's slow.
    const slow = setTimeout(() => { if (this.id === id && this.thread?.id !== id) { reset(); this.$tail.innerHTML = '<div class="ui-loading" style="margin:40px auto;max-width:200px"></div>'; } }, 300);
    try {
      const r = await api.get(`api/agent/threads/${id}`);
      clearTimeout(slow);
      if (this.id !== id) return;
      if (this.thread?.id !== id) reset();
      this.thread = r.thread; this.items = r.items;
      upsertThread({ ...r.thread, unread: false });
    } catch (e) { clearTimeout(slow); reset(); this.$tail.innerHTML = `<div class="ui-empty"><span class="title">Couldn't open this chat</span><p>${ui.esc(e.message)}</p></div>`; return; }
    this.$input.value = this.loadDraft();
    this.autosize();
    this.render(true);
    this.markRead();
    this.loadReport();
    this.loadBackground();
  }

  // A job run's report, at the end of its chat: the work above, the result here.
  async loadReport() {
    const id = this.id, t = this.thread;
    if (!id || !t?.origin?.startsWith('job:')) { this.$report.hidden = true; return; }
    const r = await api.get(`api/agent/runs/thread/${id}`).catch(() => null);
    if (this.id !== id) return;
    if (!r?.report) { this.$report.hidden = true; return; }
    const same = (a, b) => String(a || '').replace(/\s+/g, ' ').trim() === String(b || '').replace(/\s+/g, ' ').trim();
    const dup = new Set(this.items.filter((i) => i.kind === 'text' && same(i.text, r.report)).map((i) => i.id));
    if ([...dup].join() !== [...(this.reportDup || [])].join()) { this.reportDup = dup; this.turnCache.clear(); this.render(); }
    if (!this.$report.querySelector('.report-body')) this.$report.innerHTML = '<header class="report-head"></header><div class="report-body"></div>';
    ui.morph(this.$report.querySelector('.report-head'), `<span class="ui-label">${ui.icon('file-text', 'sm')}Report</span><b>${ui.esc(r.title || '')}</b><a class="ui-btn quiet" href="#/r/${id}">Open</a>`);
    this.$report.hidden = false;
    await ui.report(this.$report.querySelector('.report-body'), r.report.replace(/^\s*#\s+(.+)\n+/, (m, h) => (h.trim() === (r.title || '').trim() ? '' : m)));
  }

  markRead() {
    if (!this.id || document.hidden) return;
    clearTimeout(this.readTimer);
    this.readTimer = setTimeout(() => api.patch(`api/agent/threads/${this.id}`, { read: true }).catch(() => {}), 400);
  }

  // Streamed text since the last write. Out of step (opened mid-stream, a missed event): reload.
  append({ id, from, text, updated }) {
    const it = this.items.find((x) => x.id === id);
    const have = it?.text?.length ?? -1;
    if (have === from) { it.text += text; it.updated = updated; this.schedule(); this.markRead(); }
    else if (have < from + text.length) this.refresh();
  }

  // Reload the open chat in place (after a reconnect, or when streamed text didn't line up).
  async refresh() {
    const id = this.id;
    if (!id || this.refreshing) return;
    this.refreshing = true;
    try {
      const r = await api.get(`api/agent/threads/${id}`);
      if (this.id !== id) return;
      this.thread = r.thread; this.items = r.items; this.turnCache.clear();
      this.render();
    } catch {} finally { this.refreshing = false; }
  }

  upsert(item) {
    const i = this.items.findIndex((x) => x.id === item.id);
    if (i >= 0) this.items[i] = item; else this.items.push(item);
    this.schedule();
    this.markRead();
  }

  schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => { this.raf = null; this.render(); });
  }

  /* ----- Header ----- */
  renderHead() {
    const t = this.thread;
    if (this.mode === 'panel') {
      const what = this.context?.key?.startsWith('item:') ? (this.context.label || 'Chat') : this.context?.title ? `Chat about ${this.context.title}` : 'Chat';
      ui.morph(this.$head, `<span class="ui-title">${ui.esc(t?.title || what)}</span>
        <button class="ui-icon-btn plain" data-a="new" title="New chat">${ui.icon('square-pen')}</button>
        ${t ? `<button class="ui-icon-btn plain" data-a="full" title="Open full page">${ui.icon('maximize-2')}</button>` : ''}
        <button class="ui-icon-btn plain" data-a="close" title="Close (Esc)">${ui.icon('x')}</button>`);
      this.$head.onclick = (e) => {
        const a = e.target.closest('[data-a]')?.dataset.a;
        if (a === 'close') this.onClose?.();
        if (a === 'new') { this.onCreated?.(null); this.open(null); }
        if (a === 'full' && t) this.ctx.go(`#/t/${t.id}`);
      };
      return;
    }
    if (!t) { this.$head.innerHTML = ''; return; }
    if (this.$head.querySelector('.th-title')?.isContentEditable) return; // renaming
    const job = t.origin?.startsWith('job:') ? t.origin.slice(4) : null;
    // No "Working" pill: the timeline already shows the agent at work.
    const status = t.status === 'waiting' ? '<span class="ui-pill attention"><span class="ui-dot warn"></span>Needs you</span>'
      : t.status === 'error' ? (errorLevel(t.error) === 'warn' ? '<span class="ui-status"><span class="ui-dot warn"></span>Limit reached</span>' : '<span class="ui-status"><span class="ui-dot danger"></span>Error</span>') : '';
    ui.morph(this.$head, `
      <div class="th-main">
        <h1 class="th-title" title="Click to rename">${ui.esc(t.title || 'New chat')}</h1>
        <div class="th-meta">
          ${job ? `<a class="ui-context" href="#/jobs/${job}"><span class="dot ui-dot"></span><span class="kind">Job</span><b>${ui.esc(job)}</b></a>` : ''}
          ${job ? `<a class="ui-btn quiet sm" href="#/r/${t.id}">${ui.icon('file-text', 'sm')}Report</a>` : ''}
          ${ui.agentMark(t.agent, agentName(t.agent), 'sm')}<span>${ui.esc(agentName(t.agent))}</span>
          <span class="sep">·</span><span class="ui-mono">${ui.esc(home(t.cwd))}</span>
          ${status ? `<span class="sep"></span>${status}` : ''}
        </div>
      </div>
      <button class="ui-icon-btn plain" data-a="menu" title="More">${ui.icon('ellipsis')}</button>`);
    this.$head.onclick = (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'menu') this.ctx.threadMenu(e.target.closest('[data-a]'), this.thread);
      if (e.target.closest('.th-title')) this.rename();
    };
  }

  rename() {
    const h = this.$head.querySelector('.th-title');
    if (!h || h.isContentEditable) return;
    h.contentEditable = 'true'; h.focus();
    document.getSelection().selectAllChildren(h);
    const done = async (save) => {
      h.contentEditable = 'false';
      const title = h.textContent.trim();
      if (save && title && title !== this.thread.title) await api.patch(`api/agent/threads/${this.id}`, { title });
      else h.textContent = this.thread.title || 'New chat';
    };
    h.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); done(true); } if (e.key === 'Escape') { e.preventDefault(); done(false); } };
    h.onblur = () => done(true);
  }

  renderEmpty() {
    const view = this.context?.title, key = this.context?.key || '';
    // Asked about one item (an email, a failed run).
    const item = key.startsWith('item:') ? key.slice(5) : '';
    this.$timeline.innerHTML = `
      <div class="empty-chat">
        <h1 class="ui-display">${item ? 'Chat about this.' : view ? `Chat about ${ui.esc(view)}.` : 'New chat.'}</h1>
        <p class="ui-muted">${item ? `${ui.esc(this.context.label || 'This')}. Tell the agent what you want; it can act on it.` : view ? 'The agent can see which app and page you have open, and can change it.' : 'Ask anything, or describe something to build. The agent works on this machine.'}</p>
      </div>`;
    this.$tail.innerHTML = '';
  }

  /* ----- Timeline ----- */
  render(first = false) {
    if (!this.id) return;
    this.renderHead();
    const turns = new Map();
    for (const it of this.items) { if (!turns.has(it.turn)) turns.set(it.turn, []); turns.get(it.turn).push(it); }
    // A long chat shows its last turns; earlier ones on request (a page of TURN_PAGE at a time).
    const all = [...turns.keys()].sort((a, b) => a - b);
    const keys = all.slice(-this.turnLimit);
    const hidden = all.length - keys.length;
    ui.morph(this.$earlier, hidden ? `<button class="ui-btn quiet sm">Show ${Math.min(hidden, TURN_PAGE)} earlier turn${hidden === 1 ? '' : 's'}</button>` : '');
    const live = this.thread && (this.thread.running || this.thread.status === 'running' || this.thread.status === 'starting' || this.thread.status === 'waiting');
    const waitingOnly = (its) => its.every((i) => i.kind === 'user' && (i.queued || i.unsent)); // messages queued behind the live turn
    const lastTurn = keys.findLast((k) => !waitingOnly(turns.get(k)));
    const existing = new Map([...this.$timeline.children].map((c) => [c.dataset.turn, c]));
    let prev = null;
    for (const k of keys) {
      const its = turns.get(k);
      const isLive = live && k === lastTurn && !its.some((i) => i.kind === 'turn');
      const sig = its.map((i) => `${i.id}:${i.updated}`).join(',') + (isLive ? `:live:${this.thread.status}:${!!this.thread.stopping}` : '') + [...this.open_, ...[...this.shut_].map((o) => '-' + o)].filter((o) => o.replace(/^-/, '').startsWith(`t${k}:`)).join() + (this.side ? `:side:${this.side.id}` : '');
      let node = existing.get(String(k));
      if (!node) { node = document.createElement('section'); node.className = 'turn'; node.dataset.turn = k; prev ? prev.after(node) : this.$timeline.prepend(node); }
      prev = node;
      if (this.turnCache.get(k) !== sig) { ui.morph(node, this.renderTurn(k, its, isLive)); this.turnCache.set(k, sig); if (!isLive) ui.highlight(node); }
      existing.delete(String(k));
    }
    for (const n of existing.values()) n.remove();
    const elapsed = this.$tail.querySelector('[data-elapsed]')?.textContent || '';
    const groupedWork = lastTurn != null && !turns.get(lastTurn).some((i) => i.kind === 'turn') && !!turnParts(turns.get(lastTurn)).segments.at(-1)?.work;
    ui.morph(this.$tail, live && !groupedWork ? `<div class="working"><span class="ui-shimmer">${this.liveLabel()}</span><span class="ui-mono ui-faint" data-elapsed>${elapsed}</span></div>` : '');
    this.tick();
    this.renderStack();
    this.renderComposerFoot();
    this.renderSide();
    if (first) this.follow.follow(); else this.follow.pin();
  }

  showEarlier() {
    const before = this.$scroll.scrollHeight;
    this.follow.pause(); this.turnLimit += TURN_PAGE;
    this.render();
    this.$scroll.scrollTop += this.$scroll.scrollHeight - before; // keep what was on screen in place
  }

  liveLabel() {
    if (this.thread?.stopping) return 'Stopping';
    if (this.thread?.status === 'waiting') return 'Waiting for you';
    if (this.thread?.status === 'starting') return `Starting ${agentName(this.thread.agent)}`;
    const last = [...this.items].reverse().find((i) => i.kind !== 'user' && !i.worker);
    if (last?.kind === 'tool' && isLive(last)) return `${(KIND[last.toolKind] || KIND.other).live} ${toolTarget(last).text?.slice(0, 48) || ''}`;
    if (last?.kind === 'thought') return 'Thinking';
    return 'Working';
  }

  tick() {
    for (const s of this.$timeline.querySelectorAll('[data-since]')) s.textContent = ui.duration(Date.now() - +s.dataset.since);
    for (const s of this.$bg.querySelectorAll('[data-since]')) s.textContent = ui.duration(Date.now() - +s.dataset.since);
    for (const s of this.$side.querySelectorAll('[data-since]')) s.textContent = ui.duration(Date.now() - +s.dataset.since);
    if (this.side?.kind === 'task' && !this.side.final && Date.now() - (this.side.outAt || 0) > 2000) this.loadTaskOutput();
    if (this.id && this.showing() && Date.now() - (this.bgAt || 0) > 5000) this.loadBackground();
    const el = this.$tail.querySelector('[data-elapsed]');
    if (!el) return;
    const turn = Math.max(...this.items.map((i) => i.turn), 0);
    const start = this.items.find((i) => i.turn === turn && i.kind === 'user')?.created;
    el.textContent = start ? ui.duration(Date.now() - start) : '';
  }

  renderTurn(k, its, live) {
    const users = its.filter((i) => i.kind === 'user');
    const end = its.find((i) => i.kind === 'turn');
    const { segments, agents, tasks, lastWork } = turnParts(its);
    let html = users.map((u) => this.renderUser(u)).join('');
    if (lastWork === -1) html += this.renderAgents(k, agents, its) + tasks.map((t) => this.renderTask(t)).join('');
    segments.forEach((s, n) => {
      // A closing message that is the report itself (no report was published) shows once: in the card below.
      if (s.item) html += this.reportDup?.has(s.item.id) ? '' : this.renderItem(s.item, { live, k, final: !!end && n > lastWork });
      else html += this.renderWork(k, s.work, { live: live && n === segments.length - 1, end: n === lastWork ? end : null });
      if (n === lastWork) html += this.renderAgents(k, agents, its) + tasks.map((t) => this.renderTask(t)).join('');
    });
    if (!end) return html;
    html += this.renderChanges(k, its);
    if (end.stopReason === 'cancelled') html += `<div class="turn-note">Stopped.</div>`;
    if (end.stopReason === 'interrupted') html += `<div class="turn-note">${ui.esc(end.note || 'Interrupted.')}</div>`;
    if (end.stopReason === 'error' && end.error) html += this.renderItem({ kind: 'notice', level: errorLevel(end.error), text: end.error });
    if (end.stopReason === 'max_tokens' || end.stopReason === 'max_turn_requests') html += `<div class="turn-note">Stopped early (${end.stopReason.replace(/_/g, ' ')}). Say "continue" to keep going.</div>`;
    return html;
  }

  // One run of thoughts and tools between the agent's messages, folded to a row. The newest row of a
  // running turn says what it's doing; the last row of a finished turn carries the turn's time.
  renderWork(k, work, { live, end }) {
    const tools = work.filter((i) => i.kind === 'tool');
    const edits = tools.filter((i) => i.toolKind === 'edit').length;
    const failed = tools.filter((i) => i.status === 'failed').length;
    const facts = [tools.length ? `${tools.length} step${tools.length === 1 ? '' : 's'}` : null, edits ? `${edits} edit${edits === 1 ? '' : 's'}` : null, failed ? `${failed} failed` : null].filter(Boolean).join(' · ');
    const key = `t${k}:work:${work[0].id}`;
    const last = work[work.length - 1], kind = KIND[last.toolKind] || KIND.other;
    const status = last.kind === 'tool' ? `${LIVE.has(last.status) ? kind.live : kind.done} ${toolTarget(last).text || ''}` : last.kind === 'thought' ? 'Thinking' : last.kind === 'plan' ? 'Planning' : 'Working';
    const icon = last.kind === 'tool' ? kind.icon : last.kind === 'thought' ? 'brain' : last.kind === 'plan' ? 'list-todo' : 'message-square';
    const label = live ? (this.thread?.stopping ? 'Stopping' : this.thread?.status === 'waiting' ? 'Waiting for you' : 'Working')
      : end ? `Worked for ${ui.duration(end.durationMs || 0)}` : work.every((i) => i.kind === 'thought') ? 'Thought' : 'Worked';
    return `<details class="work" data-key="${key}"${this.open_.has(key) ? ' open' : ''}>
      <summary>${ui.icon('chevron-right', 'sm')}<span class="work-label${live ? ' ui-shimmer' : ''}">${label}</span>${live ? `<span class="work-status">${ui.icon(icon, 'sm')}<span>${ui.esc(status.split('\n')[0].slice(0, 160))}</span></span>` : ''}<span class="facts">${facts}</span></summary>
      <div class="work-body">${work.map((i, n) => this.renderItem(i, { live, last: n === work.length - 1, k })).join('')}</div></details>`;
  }

  renderAgents(k, agents, its) {
    if (!agents.length) return '';
    const key = `t${k}:agents`;
    const running = agents.filter((a) => a.state === 'running').length, failed = agents.filter((a) => a.state === 'failed').length;
    const facts = [running ? `${running} running` : null, failed ? `${failed} failed` : null].filter(Boolean).join(' · ');
    // Open while an agent is at work or in the side pane, folded once they're done; the owner's click wins.
    const auto = running > 0 || (this.side?.kind === 'agent' && agents.some((a) => a.sessionId === this.side.id));
    const open = this.open_.has(key) || (auto && !this.shut_.has(key));
    return `<details class="work agents" data-key="${key}"${open ? ' open' : ''}>
      <summary>${ui.icon('chevron-right', 'sm')}<span>${agents.length} agent${agents.length === 1 ? '' : 's'}</span><span class="facts">${facts}</span></summary>
      <div class="work-body">${agents.map((a) => this.renderAgent(a, k, its)).join('')}</div></details>`;
  }

  // A delegated agent: one row (state, name, task, time; while it runs, what it's doing), opening its
  // transcript in the side pane. Nested ones are indented under the agent that started them.
  renderAgent(a, k, its) {
    const kids = its.filter((i) => i.worker === a.sessionId);
    const waiting = a.state === 'running' && this.items.some((i) => i.kind === 'permission' && !i.outcome && i.by === a.name);
    let depth = 0;
    for (let p = a.parent; p && depth < 4; p = its.find((i) => i.kind === 'agent' && i.sessionId === p)?.parent) depth++;
    const { icon, status } = this.agentState(a, waiting);
    const last = a.state === 'running' && [...kids].reverse().find((i) => i.kind === 'tool' || i.kind === 'text');
    const activity = !last ? '' : last.kind === 'tool' ? `${(KIND[last.toolKind] || KIND.other)[isLive(last) ? 'live' : 'done']} ${toolTarget(last).text || ''}` : last.text.replace(/\s+/g, ' ').slice(-140);
    const sel = this.side?.kind === 'agent' && this.side.id === a.sessionId;
    return `<div class="agent-wrap" style="--depth:${depth}"><div class="row agent ${waiting ? 'waiting' : a.state}${sel ? ' selected' : ''}" data-side="agent" data-side-id="${ui.esc(a.sessionId)}" role="button" tabindex="0">
      <span class="a-icon">${icon}</span><span class="a-name">${ui.esc(a.name)}</span>${a.task ? `<span class="extra">${ui.esc(a.task)}</span>` : ''}
      <span class="deco">${status ? `<span class="a-status">${status}</span> ` : ''}<span class="ui-mono"${a.state === 'running' ? ` data-since="${a.created}"` : ''}>${ui.duration((a.ended || Date.now()) - a.created)}</span></span></div>
      ${activity ? `<div class="a-activity"><span class="ui-shimmer">${ui.esc(activity.slice(0, 160))}</span></div>` : ''}</div>`;
  }

  agentState(a, waiting) {
    return {
      icon: waiting ? ui.icon('shield-alert', 'sm') : a.state === 'running' ? '<span class="ui-dot run"></span>'
        : ui.icon({ completed: 'check', failed: 'circle-alert', cancelled: 'square' }[a.state] || 'circle-help', 'sm'),
      status: waiting ? 'Needs you' : { failed: 'Failed', cancelled: 'Stopped', disconnected: 'Status unknown' }[a.state] || '',
    };
  }

  // Work the agent left running after its answer (a backgrounded command), as its adapter reported it:
  // one row, like a delegated agent's, opening its command and output in the side pane.
  renderTask(t) {
    const st = taskState(t);
    const icon = t.state === 'running' ? '<span class="ui-dot run"></span>' : ui.icon(st.icon, 'sm');
    const title = t.description || t.name || 'Background command';
    const cmd = t.name && t.name !== title ? t.name.split('\n')[0] : '';
    const sel = this.side?.kind === 'task' && this.side.id === t.taskId;
    return `<div class="agent-wrap"><div class="row agent task ${ui.esc(t.state)}${sel ? ' selected' : ''}" data-side="task" data-side-id="${ui.esc(t.taskId)}" role="button" tabindex="0">
      <span class="a-icon">${icon}</span><span class="a-name">${ui.esc(title)}</span>${cmd ? `<span class="extra mono">${ui.esc(cmd)}</span>` : ''}
      <span class="deco">${st.short ? `<span class="a-status">${st.short}</span> ` : t.state === 'running' ? '<span class="a-status">In background</span> ' : ''}<span class="ui-mono"${t.state === 'running' ? ` data-since="${t.created}"` : ''}>${ui.duration((t.ended || Date.now()) - t.created)}</span></span></div></div>`;
  }

  /* ----- The side pane: a background task's command and output, or a delegated agent's transcript ----- */
  openSide(kind, id) {
    if (this.side?.kind === kind && this.side.id === id) return this.closeSide();
    this.side = { kind, id, out: null, outAt: 0, final: false, stick: true };
    this.turnCache.clear();
    this.render();
    if (kind === 'task') this.loadTaskOutput();
    this.$side.querySelector('[data-side-a="close"]')?.focus({ preventScroll: true });
  }

  closeSide() {
    if (!this.side) return;
    const { id } = this.side;
    this.side = null;
    this.turnCache.clear();
    this.render();
    this.$timeline.querySelector(`[data-side-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  }

  sideItem() {
    const s = this.side;
    if (!s) return null;
    return s.kind === 'task' ? this.items.find((i) => i.kind === 'task' && i.taskId === s.id) : this.items.find((i) => i.kind === 'agent' && i.sessionId === s.id);
  }

  renderSide() {
    const item = this.sideItem();
    if (!item) this.side = null;
    this.$shell.classList.toggle('side-open', !!item);
    this.$side.hidden = !item;
    if (!item) { this.$side.innerHTML = ''; return; }
    const body = this.$side.querySelector('.side-body');
    if (body) this.side.stick = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
    ui.morph(this.$side, this.side.kind === 'task' ? this.taskSide(item) : this.agentSide(item));
    const nb = this.$side.querySelector('.side-body');
    if (nb && !nb.dataset.watched) { nb.dataset.watched = '1'; nb.addEventListener('scroll', () => { if (this.side) this.side.stick = nb.scrollHeight - nb.scrollTop - nb.clientHeight < 40; }); }
    if (nb && this.side.stick) nb.scrollTop = nb.scrollHeight;
  }

  sideHead(icon, title, meta, state = '', action = '') {
    return `<header class="side-head ${ui.esc(state)}"><span class="a-icon">${icon}</span><span class="ui-title">${ui.esc(title)}</span>
      <button type="button" class="ui-icon-btn plain" data-side-a="close" title="Close (Esc)">${ui.icon('x')}</button></header>
      <div class="side-meta">${meta.filter(Boolean).join('<span class="sep">·</span>')}${action}</div>`;
  }

  taskSide(t) {
    const st = taskState(t), s = this.side;
    const tool = this.items.find((i) => i.kind === 'tool' && i.toolCallId === t.toolCallId && (i.worker || '') === (t.worker || ''));
    const cmd = (tool && toolTarget(tool).text) || t.name || '';
    const fromFile = !!t.outputFile;
    const text = fromFile ? s.out?.text || '' : tool ? toolText(tool) : '';
    // Codex's call ends with its command; Claude's ends at the hand-off (its file ends with the command's exit).
    const exit = fromFile ? null : tool?.exitCode ?? s.out?.exitCode;
    const icon = t.state === 'running' ? '<span class="ui-dot run"></span>' : ui.icon(st.icon, 'sm');
    const meta = [
      `<span class="ui-status"><span class="ui-dot ${st.dot}"></span>${st.label}</span>`,
      `<span class="ui-mono"${t.state === 'running' ? ` data-since="${t.created}"` : ''}>${ui.duration((t.ended || Date.now()) - t.created)}</span>`,
      exit != null && t.state !== 'running' ? `<span class="ui-mono">exit ${ui.esc(String(exit))}</span>` : '',
    ];
    const stop = t.state === 'running' && t.canStop !== false ? '<button type="button" class="ui-btn quiet sm" data-side-a="stop">Stop</button>' : '';
    const empty = fromFile && !s.out ? 'Loading…' : s.out?.missing ? 'The output file is gone (cleaned up after the agent finished).' : t.state === 'running' ? 'No output yet.' : 'No output.';
    // Codex names a task by its command, which the terminal below shows already.
    return `${this.sideHead(icon, t.description || 'Background command', meta, t.state, stop)}
      <div class="side-body">
        ${t.summary ? `<p class="side-note">${ui.esc(t.summary)}</p>` : ''}
        <div class="ui-terminal${t.state === 'failed' ? ' failed' : ''}">${cmd ? `<div class="cmd">${ui.esc(cmd)}</div>` : ''}
          ${s.out?.truncated ? '<div class="more">Showing the end of the output</div>' : ''}
          <div class="out">${text ? ui.esc(text) : `<span class="ui-faint">${empty}</span>`}</div></div>
        ${fromFile && !s.out?.missing ? `<a class="ui-link-action" href="#/v/files#p=${encodeURIComponent(t.outputFile)}">Open the whole output</a>` : ''}
      </div>`;
  }

  agentSide(a) {
    const waiting = a.state === 'running' && this.items.some((i) => i.kind === 'permission' && !i.outcome && i.by === a.name);
    const { icon, status } = this.agentState(a, waiting);
    const its = this.items.filter((i) => i.turn === a.turn);
    const kids = this.items.filter((i) => i.worker === a.sessionId);
    const shown = kids.slice(-200);
    const steps = kids.filter((i) => i.kind === 'tool').length;
    const by = a.parent ? this.items.find((i) => i.kind === 'agent' && i.sessionId === a.parent)?.name : agentName(this.thread?.agent);
    const meta = [
      status ? `<span class="ui-status">${status}</span>` : a.state === 'running' ? '<span class="ui-status"><span class="ui-dot run"></span>Running</span>' : '<span class="ui-status"><span class="ui-dot ok"></span>Done</span>',
      `<span class="ui-mono"${a.state === 'running' ? ` data-since="${a.created}"` : ''}>${ui.duration((a.ended || Date.now()) - a.created)}</span>`,
      steps ? `<span>${steps} step${steps === 1 ? '' : 's'}</span>` : '',
      by ? `<span>started by ${ui.esc(by)}</span>` : '',
    ];
    const result = a.state === 'completed' && [...kids].reverse().find((i) => i.kind === 'text');
    return `${this.sideHead(icon, a.name || 'Agent', meta, a.state)}
      <div class="side-body">
        ${a.task ? `<div class="side-section"><span class="ui-label">Task</span><p class="side-note">${ui.esc(a.task)}</p></div>` : ''}
        ${a.prompt && a.prompt.trim() !== (a.task || '').trim() ? `<div class="a-prompt">${ui.esc(a.prompt)}</div>` : ''}
        ${kids.length > shown.length ? `<div class="ui-faint">${kids.length - shown.length} earlier steps</div>` : ''}
        <div class="side-transcript">${shown.map((i) => this.renderItem(i, { k: a.turn, its, live: a.state === 'running' })).join('') || (a.state === 'running' ? '' : '<div class="ui-faint">No activity reported.</div>')}</div>
        ${a.state === 'running' && !waiting ? '<div class="side-working"><span class="ui-shimmer">Working</span></div>' : ''}
      </div>
      ${result ? `<div class="side-foot"><button type="button" class="ui-btn sm" data-side-a="copy">${ui.icon('copy', 'sm')}Copy result</button></div>` : ''}`;
  }

  // A background task's output: Claude writes it to a file (read through agentd every 2s while it runs);
  // Codex streams it into the call that started it (already here).
  async loadTaskOutput() {
    const s = this.side, id = this.id;
    if (!s || s.kind !== 'task') return;
    s.outAt = Date.now();
    const t = this.sideItem();
    if (!t?.outputFile) { s.final = !t || t.state !== 'running'; return; }
    const ended = t.state !== 'running';
    let out;
    try { out = await api.get(`api/agent/threads/${id}/tasks/${encodeURIComponent(s.id)}/output`); } catch { out = { text: '', missing: true }; }
    if (this.side !== s || this.id !== id) return;
    s.out = out;
    if (ended) s.final = true;
    this.renderSide();
  }

  async onSideClick(e) {
    const a = e.target.closest('[data-side-a]')?.dataset.sideA;
    if (a === 'close') return this.closeSide();
    if (a === 'stop') return this.stopTask(this.side?.id, e.target.closest('button'));
    if (a === 'copy') {
      const r = [...this.items].reverse().find((i) => i.kind === 'text' && i.worker === this.side?.id);
      return navigator.clipboard?.writeText(r?.text || '').then(() => ui.toast('Copied'));
    }
    this.onTimelineClick(e); // a delegated agent's steps open like the chat's own
  }

  async stopTask(task, btn) {
    if (!task) return;
    if (btn) btn.disabled = true;
    try { await api.post(`api/agent/threads/${this.id}/background/stop`, { task }); ui.toast('Stopped', { icon: 'square' }); }
    catch (err) { ui.toast(err.message, { icon: 'circle-alert' }); if (btn) btn.disabled = false; }
    this.loadBackground();
  }

  // A finished turn's files, folded like its work: "Changed 3 files +40 −12"; each opens to its diffs.
  renderChanges(k, its) {
    const changes = turnChanges(its);
    if (!changes.length) return '';
    const key = `t${k}:changes`;
    const add = changes.reduce((n, c) => n + c.add, 0), del = changes.reduce((n, c) => n + c.del, 0);
    const cwd = this.thread?.cwd ? this.thread.cwd.replace(/\/$/, '') + '/' : null;
    const rel = (p) => (cwd && p.startsWith(cwd) ? p.slice(cwd.length) : home(p));
    const stats = (c) => `<span class="add-n">+${c.add}</span> <span class="del-n">−${c.del}</span>`;
    return `<details class="work changes" data-key="${key}"${this.open_.has(key) ? ' open' : ''}>
      <summary>${ui.icon('chevron-right', 'sm')}<span>Changed ${changes.length} file${changes.length === 1 ? '' : 's'}</span><span class="facts">${stats({ add, del })}</span></summary>
      <div class="work-body">${changes.map((c) => {
        const ck = `t${k}:chg:${c.path}`;
        const open = this.open_.has(ck);
        return `<details class="row change" data-key="${ui.esc(ck)}"${open ? ' open' : ''}><summary>${ui.icon('file-diff', 'sm')}<span class="target file">${ui.esc(rel(c.path))}</span><span class="deco">${c.diffs.every((d) => d.truncated) ? 'large change' : stats(c)}</span></summary>
          <div class="row-body">${open ? c.diffs.map(renderDiff).join('') : ''}</div></details>`;
      }).join('')}</div></details>`;
  }

  renderUser(u) {
    const sys = u.system;
    const ctxChip = u.context?.title ? `<div class="u-ctx"><span class="ui-context"><span class="dot ui-dot"></span><span class="kind">${ui.esc(u.context.label ? u.context.title : u.context.view ? 'App' : 'Page')}</span><b>${ui.esc(u.context.label || u.context.title || u.context.view)}</b></span></div>` : '';
    if (sys) return `<div class="msg-sys">${ui.icon('clock', 'sm')}<span>${ui.esc(u.text)}</span></div>`;
    const isJob = this.thread?.origin?.startsWith('job:') && u.turn === 1;
    // A job run starts with the job's prompt: show a pointer to the job instead, the prompt on request.
    if (isJob) {
      const name = this.thread.origin.slice(4), job = state.jobs.find((j) => j.name === name);
      const how = /This is a (\w+) run of the job/.exec(u.text)?.[1];
      return `<details class="job-start"><summary>${ui.icon('calendar-clock', 'sm')}<a href="#/jobs/${ui.esc(name)}">${ui.esc(job?.title || name)}</a>
        <span>${how === 'scheduled' ? 'Scheduled run' : 'Run'}</span><span class="show">Show prompt</span></summary>
        <div class="bubble">${ui.esc(u.text.split('\n---\n')[0])}</div></details>`;
    }
    const text = u.text;
    const tag = u.unsent ? '<span class="q" title="You stopped the agent before this was sent">Not sent</span>' : u.queued ? '<span class="q" title="Sent when the agent finishes">Queued</span>' : '';
    // Not sent yet: take it back into the composer, or drop it.
    const acts = u.queued || u.unsent ? `<span class="q-acts"><button data-unsent="edit" data-id="${u.id}">Edit</button><button data-unsent="remove" data-id="${u.id}">Remove</button></span>` : '';
    const imgs = u.images?.length ? `<div class="u-images">${u.images.map((im) => `<a href="api/agent/images/${ui.esc(im.file)}" target="_blank" rel="noopener" title="${ui.esc(im.name || 'Image')}"><img src="api/agent/images/${ui.esc(im.file)}" alt="${ui.esc(im.name || '')}" loading="lazy"></a>`).join('')}</div>` : '';
    return `<div class="msg-user${u.queued || u.unsent ? ' queued' : ''}">${ctxChip}${tag || acts ? `<div class="q-head">${acts}${tag}</div>` : ''}${imgs}${text?.trim() ? `<div class="bubble">${ui.esc(text)}</div>` : ''}</div>`;
  }

  renderItem(i, { live, last, k, final, its } = {}) {
    switch (i.kind) {
      case 'text': return `<div class="msg-agent ui-prose${final ? ' final' : ''}" data-copy="${i.id}">${live && i.text.length > BIG_TEXT ? `<div class="plain">${ui.esc(i.text)}</div>` : chatMarkdown(i.text)}${final ? `<div class="msg-actions"><button data-copy-btn="${i.id}" title="Copy">${ui.icon('copy', 'sm')}</button><span class="ui-mono">${ui.time(i.updated)}</span></div>` : ''}</div>`;
      case 'thought': {
        const key = `t${k}:th:${i.id}`;
        return `<details class="row thought" data-key="${key}"${this.open_.has(key) ? ' open' : ''}><summary>${ui.icon('brain', 'sm')}<span class="${live && last ? 'ui-shimmer' : ''}">${live && last ? 'Thinking' : 'Thought'}</span></summary><div class="row-body ui-prose">${chatMarkdown(i.text)}</div></details>`;
      }
      case 'tool': return this.renderTool(i, k);
      case 'agent': return this.renderAgent(i, k, its || this.items.filter((x) => x.turn === i.turn));
      case 'task': return this.renderTask(i);
      case 'plan': {
        const done = i.entries.filter((e) => e.status === 'completed').length;
        return `<div class="plan"><div class="plan-head">${ui.icon('list-todo', 'sm')}<span>Plan</span><span class="ui-mono ui-faint">${done}/${i.entries.length}</span></div>
          <ul>${i.entries.map((e) => `<li class="${e.status}">${ui.icon(e.status === 'completed' ? 'circle-check' : e.status === 'in_progress' ? 'circle-dot' : 'circle', 'sm')}<span>${ui.esc(e.content)}</span></li>`).join('')}</ul></div>`;
      }
      case 'permission': {
        const o = i.outcome;
        const opt = o?.optionId && i.options.find((x) => x.optionId === o.optionId);
        const label = !o ? 'Waiting for you to approve' : o.outcome === 'cancelled' ? 'Cancelled' : opt?.kind?.startsWith('reject') ? 'Denied' : 'Approved';
        return `<div class="row perm ${o ? '' : 'pending'}">${ui.icon(o && !opt?.kind?.startsWith('reject') && o.outcome !== 'cancelled' ? 'lock-open' : 'lock', 'sm')}<span>${label}:</span><span class="target">${ui.esc(stripTicks(i.toolCall?.title || 'an action'))}</span></div>`;
      }
      case 'notice': return `<div class="notice ${i.level || ''}">${ui.icon(i.level === 'danger' ? 'circle-alert' : i.level === 'warn' ? 'triangle-alert' : 'info', 'sm')}<span>${ui.esc(i.text)}</span></div>`;
      case 'media': {
        const c = i.content || {};
        if (c.type === 'image' && c.data && /^image\/[\w.+-]+$/.test(c.mimeType || '')) return `<img class="media" src="data:${c.mimeType};base64,${ui.esc(c.data)}" alt="">`;
        if (c.type === 'resource_link' && /^https?:/i.test(c.uri || '')) return `<a class="row" href="${ui.esc(c.uri)}" target="_blank" rel="noopener">${ui.icon('link', 'sm')}<span>${ui.esc(c.name || c.uri)}</span></a>`;
        return '';
      }
      default: return '';
    }
  }

  renderTool(i, k) {
    const kind = KIND[i.toolKind] || KIND.other;
    const liveNow = isLive(i);
    // A failed step is ordinary work (agents recover from most): its verb, a muted "failed", folded like the rest.
    const failed = i.status === 'failed';
    const tg = toolTarget(i);
    const verb = liveNow ? kind.live : kind.done;
    let deco = '';
    if (i.toolKind === 'edit' && diffsOf(i).some((d) => !d.truncated)) { const s = diffStats(i); deco = `<span class="deco"><span class="add-n">+${s.add}</span> <span class="del-n">−${s.del}</span></span>`; }
    if (failed) deco += '<span class="deco fail">failed</span>';
    if (i.backgrounded) deco += '<span class="deco">in background</span>';
    if (!liveNow && !i.backgrounded && i.updated - i.created > 2000) deco += `<span class="deco ui-mono">${ui.duration(i.updated - i.created)}</span>`;
    const target = tg.text ? `<span class="target${tg.mono ? ' mono' : ''}${tg.file ? ' file' : ''}">${ui.esc(String(tg.text).split('\n')[0].slice(0, 160))}</span>${tg.extra ? `<span class="extra">${ui.esc(tg.extra)}</span>` : ''}` : '';
    const key = `t${k}:tool:${i.id}`;
    const open = this.open_.has(key);
    return `<details class="row tool${liveNow ? ' live' : ''}${failed ? ' failed' : ''}" data-key="${key}"${open ? ' open' : ''}>
      <summary>${ui.icon(kind.icon, 'sm')}<span class="verb${liveNow ? ' ui-shimmer' : ''}">${verb}</span>${target}${deco}</summary>
      <div class="row-body">${open ? this.toolBody(i, key) : ''}</div></details>`;
  }

  toolBody(i, key) {
    const text = toolText(i);
    if (i.toolKind === 'execute') {
      const cmd = toolTarget(i).text || '';
      const lines = text ? text.split('\n') : [];
      const full = this.open_.has(key + ':all');
      const shown = full ? lines : lines.slice(-14);
      return `<div class="ui-terminal${i.status === 'failed' ? ' failed' : ''}"><div class="cmd">${ui.esc(cmd)}</div>
        ${lines.length > shown.length ? `<button class="more" data-all="${key}">Show ${lines.length - shown.length} earlier lines</button>` : ''}
        <div class="out">${text ? ui.esc(shown.join('\n')) : isLive(i) ? 'Running…' : i.backgrounded ? 'Running in the background: its row below has the output.' : 'No output'}</div></div>`;
    }
    const diffs = diffsOf(i);
    if (diffs.length) return diffs.map(renderDiff).join('');
    const input = i.rawInput && Object.keys(i.rawInput).length ? `<div class="args">${Object.entries(i.rawInput).filter(([, v]) => v != null && v !== '').map(([k2, v]) =>
      `<div><span class="k">${ui.esc(k2)}</span><span class="v">${ui.esc(typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 600)}</span></div>`).join('')}</div>` : '';
    const out = text ? `<div class="ui-terminal"><div class="out" style="border:0">${ui.esc(text.split('\n').slice(0, 60).join('\n'))}${text.split('\n').length > 60 ? '\n…' : ''}</div></div>` : '';
    return input + out || '<div class="ui-faint">No details.</div>';
  }

  onTimelineClick(e) {
    // Native `toggle` is delivered later. Record disclosure intent now so a
    // streaming frame between the click and that event can't close it again.
    const summary = e.target.closest('details[data-key] > summary');
    if (summary && !e.target.closest('a, button, input')) {
      e.preventDefault();
      const d = summary.parentElement;
      d.open = !d.open;
      if (d.open) { this.open_.add(d.dataset.key); this.shut_.delete(d.dataset.key); } else { this.open_.delete(d.dataset.key); this.shut_.add(d.dataset.key); }
    }
    const all = e.target.closest('[data-all]');
    if (all) { this.open_.add(all.dataset.all + ':all'); this.turnCache.clear(); this.render(); return; }
    const un = e.target.closest('[data-unsent]');
    if (un) return this.takeBack(+un.dataset.id, un.dataset.unsent === 'edit');
    const code = e.target.closest('[data-code-copy]');
    if (code) {
      navigator.clipboard?.writeText(code.parentElement.querySelector('pre code')?.textContent || '').then(() => ui.toast('Copied'));
      return;
    }
    const copy = e.target.closest('[data-copy-btn]');
    if (copy) {
      const it = this.items.find((x) => x.id === +copy.dataset.copyBtn);
      navigator.clipboard?.writeText(it?.text || '').then(() => ui.toast('Copied'));
      return;
    }
    const row = e.target.closest('[data-side]');
    if (row && this.$timeline.contains(row)) return this.openSide(row.dataset.side, row.dataset.sideId);
    const chg = e.target.closest('details.change > summary');
    if (chg) {
      const d = chg.parentElement, key = d.dataset.key;
      setTimeout(() => {
        if (d.open) {
          this.open_.add(key);
          const [, k, path] = key.match(/^t(\d+):chg:(.*)$/) || [];
          const c = turnChanges(this.items.filter((x) => String(x.turn) === k)).find((x) => x.path === path);
          if (c) d.querySelector('.row-body').innerHTML = c.diffs.map(renderDiff).join('');
        } else this.open_.delete(key);
        this.turnCache.clear();
      });
      return;
    }
    const sum = e.target.closest('details.tool > summary');
    if (sum) {
      const d = sum.parentElement, key = d.dataset.key;
      // Render the body lazily on first open.
      setTimeout(() => {
        if (d.open) { this.open_.add(key); const it = this.items.find((x) => `t${x.turn}:tool:${x.id}` === key); if (it) d.querySelector('.row-body').innerHTML = this.toolBody(it, key); }
        else this.open_.delete(key);
        this.turnCache.clear();
      });
    }
  }

  // A queued (or not sent) message, taken back: Edit puts it in the composer after anything being written there.
  async takeBack(id, edit) {
    let it;
    try { it = await api.del(`api/agent/threads/${this.id}/items/${id}`); }
    catch (err) { ui.toast(err.message, { icon: 'circle-alert' }); return; }
    if (!edit) return;
    const draft = this.$input.value;
    this.$input.value = draft.trim() ? `${draft.trimEnd()}\n${it.text}` : it.text;
    this.autosize(); this.saveDraft(); this.updateSend();
    this.$input.focus();
  }

  /* ----- Background work: commands, timers and subagents still going, as the agent reported them (like a terminal agent's task list) ----- */
  async loadBackground() {
    this.bgAt = Date.now();
    const id = this.id;
    try {
      const r = await api.get(`api/agent/threads/${id}/background`);
      if (id !== this.id) return;
      this.bg = r.items || [];
    } catch { this.bg = []; }
    this.renderBackground();
  }

  renderBackground() {
    const items = this.bg;
    if (!items.length) { ui.morph(this.$bg, ''); return; }
    const KINDS = { task: ['terminal', 'Command'], timer: ['alarm-clock', 'Timer'], agent: ['bot', 'Subagent'] };
    const counts = Object.entries(items.reduce((n, i) => ({ ...n, [i.kind]: (n[i.kind] || 0) + 1 }), {}))
      .map(([k, n]) => `${n} ${({ task: 'command', timer: 'timer', agent: 'subagent' })[k] || k}${n === 1 ? '' : 's'}`).join(' · ');
    ui.morph(this.$bg, `<details class="bg"${this.bgOpen ? ' open' : ''}>
      <summary><span class="ui-dot run"></span><span class="ui-shimmer">Working in the background</span><span class="bg-counts">${ui.esc(counts)}</span>${ui.icon('chevron-up', 'sm')}</summary>
      <div class="bg-list">${items.map((i) => {
        const [icon, what] = KINDS[i.kind] || KINDS.task;
        const meta = i.kind === 'timer' ? `<span class="ui-mono">${ui.esc(i.once ? 'once' : i.schedule)}</span>` : `<span class="ui-mono" data-since="${i.since}">${ui.duration(Date.now() - i.since)}</span>`;
        const opens = i.kind === 'task' || i.kind === 'agent';
        return `<div class="bg-row${opens ? ' opens' : ''}" title="${ui.esc(i.detail || i.label)}"${opens ? ` data-side="${i.kind}" data-side-id="${ui.esc(i.id)}" role="button" tabindex="0"` : ''}>${ui.icon(icon, 'sm')}<span class="bg-what">${what}</span><span class="bg-label">${ui.esc(i.label)}</span>${meta}
          ${i.stoppable ? `<button type="button" class="ui-btn quiet sm" data-bg-stop="${ui.esc(i.id)}">Stop</button>` : '<span></span>'}</div>`;
      }).join('')}</div></details>`);
  }

  onBgClick(e) {
    const b = e.target.closest('[data-bg-stop]');
    if (b) return this.stopTask(b.dataset.bgStop, b);
    const row = e.target.closest('[data-side]');
    if (row) this.openSide(row.dataset.side, row.dataset.sideId);
  }

  /* ----- Dock: approvals, queued messages ----- */
  renderStack() {
    const pending = this.items.filter((i) => i.kind === 'permission' && !i.outcome);
    ui.morph(this.$stack, pending.map((p) => {
      const tc = p.toolCall || {};
      const cmd = tc.rawInput?.command || (tc.content || []).map((c) => c.content?.text).filter(Boolean).join('\n');
      const opts = p.options || [];
      const rejects = opts.filter((o) => o.kind?.startsWith('reject'));
      const always = opts.filter((o) => o.kind === 'allow_always');
      const once = opts.filter((o) => o.kind === 'allow_once' || !o.kind);
      return `<div class="approval">
        <div class="ap-head">${ui.icon('lock', 'sm')}<span class="ui-label">Approval needed</span></div>
        <div class="ap-title">${ui.esc(p.by || agentName(this.thread?.agent))} wants to: <b>${ui.esc(stripTicks(tc.title || 'take an action'))}</b></div>
        ${cmd ? `<pre class="ap-cmd">${ui.esc(String(cmd).slice(0, 800))}</pre>` : ''}
        <div class="ap-actions">${rejects.map((o) => `<button class="ui-btn ghost sm" data-perm="${p.id}" data-opt="${ui.esc(o.optionId)}">${ui.esc(o.name)}</button>`).join('')}
          <div class="ui-spacer"></div>
          ${always.map((o) => `<button class="ui-btn sm" data-perm="${p.id}" data-opt="${ui.esc(o.optionId)}">${ui.esc(o.name)}</button>`).join('')}
          ${once.map((o) => `<button class="ui-btn primary sm" data-perm="${p.id}" data-opt="${ui.esc(o.optionId)}">${ui.esc(o.name)}</button>`).join('')}</div>
      </div>`;
    }).join('') + this.nudgeHtml() + this.signinHtml());
    this.mountSignin();
    this.$stack.onclick = async (e) => {
      const g = e.target.closest('[data-sgcard]')?.dataset.sgcard;
      if (g === 'close') { this.setAgent(defaultAgent()); return; }
      if (g === 'terminal') { const a = state.agents.find((x) => x.id === this.draftAgent); if (a) terminalSetup(a); return; }
      if (g === 'go') { this.sgGo = true; this.renderStack(); return; }
      if (g === 'add-chat') { const n = this.signinNeeded(); if (n) this.addChat(n.a); return; }
      const n = e.target.closest('[data-nudge]')?.dataset.nudge;
      if (n) return this.onNudge(n);
      const b = e.target.closest('[data-perm]');
      if (!b) return;
      b.disabled = true;
      try { await api.post(`api/agent/threads/${this.id}/permissions/${b.dataset.perm}`, { optionId: b.dataset.opt }); }
      catch (err) { ui.toast(err.message, { icon: 'circle-alert' }); }
    };
  }

  // A new chat with an agent that isn't ready: not installed (Install does it and signs in), not signed in, no chat
  // part (Add it), or a chat runtime that signs in on its own (Antigravity's). Fixed right here in one click; what's
  // typed waits, and is sent once it's ready if the owner already pressed Send.
  signinNeeded() {
    if (this.thread) return null;
    const a = state.agents.find((x) => x.id === (this.draftAgent || defaultAgent()));
    if (!a?.acp) return null;
    const need = !a.installed ? 'install' : !a.signedIn ? 'signin' : !a.acpInstalled ? 'chat' : !a.chatSignedIn ? 'chat-signin' : null;
    return need ? { a, need } : null;
  }
  signinHtml() {
    const n = this.signinNeeded();
    if (!n) return '';
    const { a, need } = n;
    const mb = (x) => (x >= 1000 ? `${(x / 1024).toFixed(1)} GB` : `${x} MB`);
    const builtIn = a.acp[0] === a.bin;
    const size = (a.size?.cli || 0) + (builtIn ? 0 : a.size?.chat || 0);
    const title = { install: `Install ${ui.esc(a.name)} to send this`, signin: `Sign in to ${ui.esc(a.name)} to send this`,
      chat: `Add chat to ${ui.esc(a.name)} to send this`, 'chat-signin': `Sign in to ${ui.esc(a.name)} chat to send this` }[need];
    const guided = need === 'chat-signin' || (need === 'chat' ? !!a.chatSignin : !!a.signin);
    const kept = `<span class="sg-small">${this.pendingSend ? 'Your message is sent as soon as it\'s ready.' : 'Your message is kept.'}</span>`;
    let body;
    if (guided && (need === 'install' || need === 'chat') && !this.sgGo) {
      body = `<p class="sg-small">${need === 'install' ? `Installs ${ui.esc(a.name)} with chat (about ${mb(size)}), then you sign in with ${ui.esc((a.plan || 'your account').replace(/^Your /, 'your '))}.`
        : `Downloads ${ui.esc(a.maker || a.name)}'s chat runtime (about ${mb(a.size?.chatDownload || a.size?.chat || 0)}), then you sign in once.`}</p>
        <button class="ui-btn sm primary" type="button" data-sgcard="go">${ui.icon('download', 'sm')}${need === 'install' ? `Install · ${mb(size)}` : `Add chat · ${mb(a.size?.chat || 0)}`}</button>${kept}`;
    } else if (guided) {
      body = `<div class="sg-mount" data-keep data-agent="${a.id}" data-part="${need === 'chat' || need === 'chat-signin' ? 'chat' : ''}"></div>${kept}`;
    } else if (need === 'chat') {
      const st = this.chatInstall;
      body = st?.state === 'installing' ? `<p class="ui-shimmer">Adding chat to ${ui.esc(a.name)}…</p>${st.progress ? `<p class="sg-small ui-mono">${ui.esc(st.progress)}</p>` : ''}`
        : `<p class="sg-small">${st?.state === 'failed' ? ui.esc(st.message || 'The install failed.') : `Installs ${ui.esc(a.name)}'s chat adapter (about ${mb(a.size?.chat || 0)}).`}</p>
          <button class="ui-btn sm primary" type="button" data-sgcard="add-chat">${ui.icon('download', 'sm')}${st?.state === 'failed' ? 'Try again' : `Add chat · ${mb(a.size?.chat || 0)}`}</button>${kept}`;
    } else {
      body = `<p class="sg-small">${ui.esc(a.name)} ${need === 'install' ? 'installs and signs in' : 'signs in'} in its own terminal: Springroll opens it with the steps ready.</p><button class="ui-btn sm primary" type="button" data-sgcard="terminal">${ui.icon('square-terminal', 'sm')}Open the terminal</button>`;
    }
    return `<div class="sg-card" data-sg-agent="${a.id}"><div class="head">${ui.agentMark(a.id, a.name, 'sm')}<span>${title}</span><span class="ui-spacer"></span>
      <button class="ui-icon-btn plain" type="button" data-sgcard="close" title="Use ${ui.esc(agentName(defaultAgent()))} instead">${ui.icon('x', 'sm')}</button></div>${body}</div>`;
  }
  async addChat(a) {
    this.chatInstall = { state: 'installing' }; this.renderStack();
    try {
      let st = await api.post(`api/agents/${a.id}/chat`);
      while (st.state === 'installing') {
        this.chatInstall = st; this.renderStack();
        await new Promise((r) => setTimeout(r, 1500));
        st = await api.get(`api/agents/${a.id}/chat`);
      }
      this.chatInstall = st.state === 'failed' ? st : null;
    } catch (err) { this.chatInstall = { state: 'failed', message: err.message }; }
    await loadAgents();
    this.renderStack();
    if (!this.chatInstall && !this.signinNeeded() && this.pendingSend && this.$input.value.trim()) { this.pendingSend = false; this.send(); }
  }
  mountSignin() {
    const box = this.$stack.querySelector('.sg-mount');
    if (this.sgPanel && this.sgPanel.el !== box) { this.sgPanel.panel.stop(); this.sgPanel = null; }
    if (!box || this.sgPanel) return;
    this.sgPanel = { el: box, panel: signinPanel(box, box.dataset.agent, { part: box.dataset.part || null, onDone: () => setTimeout(async () => {
      this.sgPanel = null; this.sgGo = false;
      await loadAgents();
      this.renderStack();
      if (!this.signinNeeded() && this.pendingSend && this.$input.value.trim()) { this.pendingSend = false; this.send(); }
    }, 1200) }) };
  }

  // A slash command the agent didn't list for chat (Claude's /permissions, /login: terminal-only). Sent
  // as text it would just be a message, so offer the agent's own terminal in this chat's folder instead.
  unknownCommand(text) {
    const cmds = [...OWN_COMMANDS, ...(this.thread?.commands || [])];
    const m = /^\/([^\s/]+)(?=\s|$)/.exec(text); // "/home/agent/x is broken" isn't a command
    return m && this.thread?.commands?.length && !cmds.some((c) => c.name === m[1]) ? m[1] : null;
  }
  nudgeHtml() {
    if (!this.nudge) return '';
    const name = agentName(this.thread?.agent);
    return `<div class="nudge">${ui.icon('square-terminal', 'sm')}<span>/${ui.esc(this.nudge.command)} isn't available in chat. Run it in ${ui.esc(name)} in a terminal (a new session in this folder).</span>
      <div class="acts"><button class="ui-btn ghost sm" data-nudge="send">Send anyway</button><button class="ui-btn sm" data-nudge="terminal">Open terminal</button>
      <button class="ui-icon-btn plain" data-nudge="close" title="Dismiss">${ui.icon('x', 'sm')}</button></div></div>`;
  }
  async onNudge(a) {
    const { text } = this.nudge;
    this.nudge = null; this.renderStack();
    if (a === 'send') return this.send({ text, force: true });
    if (a === 'terminal') {
      this.$input.value = ''; this.autosize(); this.saveDraft(); this.updateSend();
      try {
        const r = await api.post('api/sessions', { agent: this.thread.agent, dir: home(this.thread.cwd) });
        this.ctx.go(`#/terminal/${r.session}`);
      } catch (e) { ui.toast(e.message, { icon: 'circle-alert' }); }
    }
    if (a === 'close') this.$input.focus();
  }

  // ↑/↓ in an empty composer (or one showing a recalled prompt, unedited) step through what was sent here.
  recallStep(dir) {
    const sent = [...new Set(this.items.filter((i) => i.kind === 'user' && !i.system && i.text).map((i) => i.text).reverse())];
    if (!sent.length) return false;
    const at = this.recall ? this.recall.at + dir : dir === 1 ? 0 : -1;
    if (at < 0) { if (!this.recall) return false; this.recall = null; this.$input.value = ''; }
    else { if (at >= sent.length) return true; this.recall = { at, text: sent[at] }; this.$input.value = sent[at]; }
    this.autosize(); this.updateSend();
    this.$input.setSelectionRange(this.$input.value.length, this.$input.value.length);
    return true;
  }

  /* ----- Composer ----- */
  buildComposer() {
    this.$composer.innerHTML = `
      <div class="c-head"></div>
      <textarea rows="1" placeholder="Ask anything, or describe something to build"></textarea>
      <div class="c-foot"></div>
      <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden>`;
    this.$file = this.$composer.querySelector('input[type=file]');
    this.$file.addEventListener('change', () => { this.attach(this.$file.files); this.$file.value = ''; });
    // Images: pasted (text copied along with one still pastes as text), dropped, or picked.
    this.$composer.addEventListener('paste', (e) => {
      const files = imageFiles(e.clipboardData?.files);
      if (!files.length) return;
      if (!e.clipboardData.getData('text/plain')) e.preventDefault();
      this.attach(files);
    });
    this.$composer.addEventListener('dragover', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); this.$composer.classList.add('dropping'); } });
    this.$composer.addEventListener('dragleave', (e) => { if (!this.$composer.contains(e.relatedTarget)) this.$composer.classList.remove('dropping'); });
    this.$composer.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault(); this.$composer.classList.remove('dropping');
      const files = imageFiles(e.dataTransfer.files);
      if (files.length) this.attach(files); else ui.toast('Only images can be attached', { icon: 'info' });
    });
    this.$input = this.$composer.querySelector('textarea');
    this.$cHead = this.$composer.querySelector('.c-head');
    this.$foot = this.$composer.querySelector('.c-foot');
    this.$input.addEventListener('input', () => { this.recall = null; if (this.nudge) { this.nudge = null; this.renderStack(); } this.autosize(); this.saveDraft(); if (!this.slashMenu()) this.mentionMenu(); this.updateSend(); });
    this.$input.addEventListener('keydown', (e) => {
      // A / or @ menu open: arrows move in it, Enter or Tab picks (typing stays in the text box).
      if (this.menuOpen() && ['ArrowUp', 'ArrowDown', 'Enter', 'Tab'].includes(e.key) && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        this.menuEl.dispatchEvent(new KeyboardEvent('keydown', { key: e.key === 'Tab' ? 'Enter' : e.key }));
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !this.menuOpen()) { e.preventDefault(); this.send(); }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing && !this.menuOpen() && !ui.popoverOpen()
        && (!this.$input.value || this.$input.value === this.recall?.text) && this.recallStep(e.key === 'ArrowUp' ? 1 : -1)) e.preventDefault();
      // (Escape while it works is Stop: main.js's key handler sees it first.)
      if (e.key === 'Escape' && !this.menuOpen()) this.$input.blur();
    });
    this.$composer.addEventListener('click', (e) => { if (e.target === this.$composer) this.$input.focus(); });
    this.$foot.addEventListener('click', (e) => this.onFootClick(e));
    this.$cHead.addEventListener('click', (e) => {
      if (e.target.closest('[data-drop-ctx]')) { this.context = null; this.renderComposerFoot(); }
      const x = e.target.closest('[data-unattach]');
      if (x) { const [im] = this.attached.splice(+x.dataset.unattach, 1); if (im) URL.revokeObjectURL(im.url); this.renderComposerFoot(); this.$input.focus(); }
    });
  }

  // Add images to the next message, if this chat's agent reads them.
  async attach(files) {
    files = imageFiles(files);
    if (!files.length) return;
    const { agentId, opts } = this.settings();
    if (!opts?.images) { ui.toast(`${agentName(agentId)} can't read images in chat`, { icon: 'info' }); return; }
    const room = MAX_PROMPT_IMAGES - this.attached.length;
    if (files.length > room) ui.toast(`Up to ${MAX_PROMPT_IMAGES} images per message`, { icon: 'info' });
    for (const f of files.slice(0, Math.max(0, room))) {
      try { this.attached.push(await promptImage(f)); }
      catch (err) { ui.toast(err.message, { icon: 'circle-alert' }); }
    }
    this.renderComposerFoot();
    this.$input.focus();
  }

  autosize() { this.$input.style.height = 'auto'; this.$input.style.height = Math.min(this.$input.scrollHeight, 280) + 'px'; }
  draftKey() { return `desk.draft.${this.id || (this.mode === 'panel' ? 'panel' : 'new')}`; }
  loadDraft() { try { return localStorage.getItem(this.draftKey()) || ''; } catch { return ''; } }
  saveDraft() { try { localStorage.setItem(this.draftKey(), this.$input.value); } catch {} }

  // What the composer's pickers show and change: the chat's settings, or a new chat's draft.
  settings() {
    const t = this.thread;
    const agentId = t?.agent || this.draftAgent || defaultAgent();
    const opts = t ? t.options : draftOptions(agentId, () => this.renderComposerFoot());
    const modelId = t ? t.model || opts?.currentModel : this.draftModel || draftModel(agentId, opts);
    return { t, agentId, opts, modelId, model: opts?.models?.find((m) => m.id === modelId), effortId: t ? t.effort || opts?.effort?.current : this.draftEffort || draftEffort(agentId, opts), access: t ? (t.access || 'full') : this.draftAccess,
      persona: (t ? t.persona : this.draftPersona === undefined ? desk.settings?.persona?.default : this.draftPersona) || null };
  }

  renderComposerFoot() {
    const { t, agentId, opts, modelId, model, access, persona: personaId } = this.settings();
    const persona = personaList(() => this.renderComposerFoot()).find((p) => p.id === personaId);
    const running = t && (t.running || ['running', 'starting', 'waiting'].includes(t.status));
    const usage = t?.usage?.size ? Math.round((100 * t.usage.used) / t.usage.size) : null;
    ui.morph(this.$cHead, (this.context?.title
      ? `<span class="ui-context"><span class="dot ui-dot"></span><span class="kind">${ui.esc(this.context.label ? this.context.title : this.context.view ? 'App' : 'Page')}</span><b>${ui.esc(this.context.label || this.context.title || this.context.view)}</b><button data-drop-ctx title="Don't include">${ui.icon('x', 'xs')}</button></span>` : '')
      + (this.attached.length ? `<div class="c-images">${this.attached.map((im, n) => `<span class="c-image" title="${ui.esc(im.name || 'Image')}"><img src="${im.url}" alt=""><button data-unattach="${n}" title="Remove">${ui.icon('x', 'xs')}</button></span>`).join('')}</div>` : ''));
    this.$cHead.style.display = this.$cHead.innerHTML ? '' : 'none';
        // Agent and model, then everything else (persona included), then attach images: the row never wraps.
    const pickers = `<button class="ui-combo c-settings" data-pick="settings" ${t && !opts?.models?.length ? 'disabled ' : ''}title="${t ? 'Model' : 'Agent and model'}">${ui.agentMark(agentId, agentName(agentId), 'sm')}<span>${ui.esc(model?.name || modelId || agentName(agentId))}</span>${t && !opts?.models?.length ? '' : ui.icon('chevron-down')}</button>
      <button class="ui-combo c-more" data-pick="more" title="Settings: ${[opts?.effort && 'effort', t && opts?.extra?.length && opts.extra.map((x) => x.name).join(', '), 'access', personaList(() => {}).length && 'persona'].filter(Boolean).join(', ')}${access === 'ask' ? ' (Ask first)' : ''}${persona ? ` · ${ui.esc(persona.name)}` : ''}">${ui.icon('settings', 'sm')}${access === 'ask' ? `<i class="c-ask">${ui.icon('shield-question', 'sm')}</i>` : ''}</button>
      ${opts?.images ? `<button class="ui-icon-btn plain c-attach" data-a="attach" title="Attach images (or paste or drop them)">${ui.icon('image', 'sm')}</button>` : ''}`;
    ui.morph(this.$foot, `${pickers}
      <div class="ui-spacer"></div>
      ${usage != null ? `<span class="usage ui-mono" title="Context used">${usage}%</span>` : ''}
      ${running ? `<button class="ui-round stop filled c-stop" data-a="stop" title="Stop (Esc)">${ui.icon('square', 'sm')}</button>` : ''}
      ${running ? '' : `<button class="ui-round primary c-send" data-a="send" title="Send (Enter)">${ui.icon('arrow-up')}</button>`}`);
    this.updateSend();
  }

  updateSend() {
    const b = this.$foot.querySelector('.c-send');
    if (b) b.disabled = !this.$input.value.trim() && !this.attached.length;
  }

  // ----- Changing a setting (from the composer's two menus) -----
  // In a chat, model and effort change its session; in a new chat they're sent when it starts.
  agentOptions() {
    return state.agents.filter((a) => a.acp).map((a) => ({ value: a.id, label: a.name, lead: ui.agentMark(a.id, a.name, 'sm'), meta: a.version?.split(' ')[0],
      desc: !a.installed ? 'Not installed: one click to add' : !a.signedIn ? 'Not signed in: sign in here' : !a.acpInstalled ? 'No chat yet: one click to add' : !a.chatSignedIn ? 'Chat needs a sign-in' : undefined }));
  }
  setAgent(v) {
    if (v !== this.draftAgent) { this.draftModel = null; this.draftEffort = null; this.pendingSend = false; this.sgGo = false; this.chatInstall = null; }
    this.draftAgent = v; this.renderComposerFoot(); this.renderStack(); // not signed in: the sign-in card shows
  }
  setModel(v) { const t = this.thread; if (t) api.patch(`api/agent/threads/${t.id}`, { model: v }).catch((err) => ui.toast(err.message)); else { this.draftModel = v; this.renderComposerFoot(); } }
  setEffort(v) { const t = this.thread; if (t) api.patch(`api/agent/threads/${t.id}`, { effort: v }).catch((err) => ui.toast(err.message)); else { this.draftEffort = v; this.renderComposerFoot(); } }
  setOption(id, value) { api.patch(`api/agent/threads/${this.thread.id}`, { option: { id, value } }).catch((err) => ui.toast(err.message)); }
  setPersona(v) {
    const t = this.thread;
    if (t) api.patch(`api/agent/threads/${t.id}`, { persona: v || null }).then((r) => { this.thread = { ...this.thread, persona: r.persona }; this.renderComposerFoot(); }).catch((err) => ui.toast(err.message));
    else { this.draftPersona = v || ''; this.renderComposerFoot(); }
  }
  async setAccess(next) {
    const t = this.thread;
    if (next === (t ? t.access || 'full' : this.draftAccess)) return;
    if (t) { await api.patch(`api/agent/threads/${t.id}`, { access: next }); this.thread = { ...this.thread, access: next }; }
    else this.draftAccess = next;
    this.renderComposerFoot();
    ui.toast(next === 'full' ? 'Full access: the agent will act without asking' : 'Ask first: you\'ll approve actions', { icon: next === 'full' ? 'shield-check' : 'shield-question' });
  }

  // The composer's two menus, each setting a group with its current choice ticked. Names only, no descriptions
  // (the owner found them cluttered); an agent that can't chat yet still says why.
  // The first: Agent (new chats) and Model. The second: Effort, the agent's other settings, Access, Persona
  // (the owner's call: in the settings menu, not a chip of its own).
  // No folder picker: chats start in ~/home (where AGENTS.md is) and work on projects from there;
  // a link can still start one elsewhere (#/new?cwd=…).
  pickMenu(anchor, which) {
    const { t, agentId, opts, modelId, effortId, access, persona } = this.settings();
    const tick = (on) => (on ? ui.icon('check', 'sm') : '');
    const plist = personaList(() => {});
    const options = which === 'settings' ? [
      ...(t ? [] : this.agentOptions().map((o) => ({ ...o, value: `agent\n${o.value}`, group: 'Agent', lead: o.value === agentId ? ui.icon('check', 'sm') : o.lead }))),
      ...(opts?.models || []).map((m) => ({ value: `model\n${m.id}`, label: m.name, group: 'Model', lead: tick(m.id === modelId) })),
    ] : [
      ...(opts?.effort?.values || []).map((v) => ({ value: `effort\n${v.id}`, label: v.name, group: 'Effort', lead: tick(v.id === effortId) })),
      ...(t ? opts?.extra || [] : []).flatMap((x) => x.values.map((v) => ({ value: `option\n${x.id}\n${v.id}`, label: v.name, group: x.name, lead: tick(v.id === x.current) }))),
      { value: 'access\nfull', label: 'Full access', group: 'Access', lead: tick(access === 'full') },
      { value: 'access\nask', label: 'Ask first', group: 'Access', lead: tick(access === 'ask') },
      ...(plist.length ? [{ value: 'persona\n', label: 'None', group: 'Persona', lead: tick(!persona) },
        ...plist.map((p) => ({ value: `persona\n${p.id}`, label: p.name, group: 'Persona', lead: tick(p.id === persona) || ui.icon(p.icon, 'sm') }))] : []),
    ];
    if (!options.length) return;
    ui.combobox(anchor, {
      options, placeholder: which === 'settings' ? 'Search agents and models' : 'Search settings', width: 320,
      onSelect: (v) => {
        const [which, a, b] = v.split('\n');
        if (which === 'agent') this.setAgent(a);
        if (which === 'model') this.setModel(a);
        if (which === 'effort') this.setEffort(a);
        if (which === 'option') this.setOption(a, b);
        if (which === 'access') this.setAccess(a);
        if (which === 'persona') this.setPersona(a);
      },
    });
  }

  onFootClick(e) {
    const b = e.target.closest('[data-pick], [data-a]');
    if (!b) return;
    if (b.dataset.a === 'send') return this.send();
    if (b.dataset.a === 'stop') return this.stop();
    if (b.dataset.a === 'attach') return this.$file.click();
    if (b.dataset.pick) this.pickMenu(b, b.dataset.pick);
  }

  // The composer's / and @ menus: a list above it while the text box keeps the keys.
  menuOpen() { if (this.menu && !ui.popoverOpen()) this.menu = null; return !!this.menu; }
  closeMenu(kind) { if (this.menu === kind) { ui.closePopover(); this.menu = null; } }
  openMenu(kind, options, onSelect) {
    this.menu = kind;
    this.menuEl = ui.combobox(this.$composer, {
      options, search: false, width: 420,
      onSelect: (v) => { this.menu = null; onSelect(v); this.autosize(); this.saveDraft(); this.$input.focus(); this.updateSend(); },
    });
    setTimeout(() => this.$input.focus());
  }

  // "/" at the start: the agent's commands. True while the text is a command being typed.
  slashMenu() {
    const v = this.$input.value;
    const cmds = [...OWN_COMMANDS, ...(this.thread?.commands || [])];
    if (!/^\/\S*$/.test(v) || !cmds.length) { this.closeMenu('slash'); return false; }
    const q = v.slice(1).toLowerCase();
    const opts = cmds.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 30).map((c) => ({ value: c.name, label: '/' + c.name, desc: c.description }));
    if (!opts.length) { this.closeMenu('slash'); return true; }
    this.openMenu('slash', opts, (name) => { this.$input.value = `/${name} `; });
    return true;
  }

  // "@" and a name: files in the chat's folder. The agent gets a mentioned file as a link to it.
  async mentionMenu() {
    const m = mentionAt(this.$input.value, this.$input.selectionStart);
    if (!m) { this.closeMenu('mention'); return; }
    const files = await folderFiles(this.thread?.cwd || (this.mode === 'panel' ? '~/home' : this.draftCwd));
    const now = mentionAt(this.$input.value, this.$input.selectionStart);
    if (!now || now.start !== m.start || now.query !== m.query) return; // typed on meanwhile
    const hits = rankFiles(files, m.query);
    if (!hits.length) { this.closeMenu('mention'); return; }
    this.openMenu('mention', hits.map((f) => ({ value: f, label: f.slice(f.lastIndexOf('/') + 1), desc: f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : undefined, icon: 'file-text' })), (f) => {
      const v = this.$input.value, end = m.start + 1 + m.query.length;
      this.$input.value = `${v.slice(0, m.start)}@${f} ${v.slice(end).replace(/^ /, '')}`;
      const caret = m.start + f.length + 2;
      this.$input.setSelectionRange(caret, caret);
    });
  }

  async send({ text = this.$input.value.trim(), force = false } = {}) {
    const attached = this.attached;
    if (!text && !attached.length) return;
    if (!force && this.unknownCommand(text)) { this.nudge = { text, command: this.unknownCommand(text) }; this.renderStack(); return; }
    if (this.signinNeeded()) { this.pendingSend = true; this.renderStack(); return; } // sent once signed in
    this.nudge = null; this.recall = null;
    this.$input.value = ''; this.attached = []; this.autosize(); this.saveDraft(); this.renderComposerFoot();
    const images = attached.length ? attached.map(({ mimeType, data, name }) => ({ mimeType, data, name })) : undefined;
    try {
      if (!this.id) {
        const t = await api.post('api/agent/threads', { agent: this.draftAgent || defaultAgent(), cwd: this.mode === 'panel' ? '~/home' : this.draftCwd, text, images, context: this.context || undefined, access: this.draftAccess, model: this.draftModel || undefined, effort: this.draftEffort || undefined, persona: this.draftPersona, origin: this.context?.view ? `view:${this.context.view}` : 'chat' });
        try { localStorage.removeItem(this.draftKey()); } catch {}
        upsertThread(t);
        if (this.mode === 'page') this.ctx.go(`#/t/${t.id}`);
        else { this.onCreated?.(t.id); this.open(t.id); }
        return;
      }
      await api.post(`api/agent/threads/${this.id}/messages`, { text, images, context: this.mode === 'panel' && this.context ? this.ctx.viewContext() || this.context : undefined });
      this.follow.follow();
      attached.forEach((im) => URL.revokeObjectURL(im.url));
    } catch (e) {
      this.$input.value = text; this.attached = attached; this.autosize(); this.renderComposerFoot();
      ui.toast(e.message, { icon: 'circle-alert' });
    }
  }
}

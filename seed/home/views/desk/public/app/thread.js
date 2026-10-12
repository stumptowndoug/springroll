// A conversation with an agent: the timeline and the composer. Used full-page
// (#/t/<id>, #/new) and in the side panel ("Chat about this").
import { api, state, on, chatAgents, agentName, defaultAgent, upsertThread } from './api.js';

let page = null, panel = null, pageCtx = null;

export function init(el, ctx) { pageCtx = ctx; page = new ThreadView(el, { ctx, mode: 'page' }); }
export function show(el, r) { page.open(r.id || null, r.q || {}); }
export function title(r) { if (!r.id) return 'New chat'; return state.threads.find((t) => t.id === r.id)?.title || 'Chat'; }
export function focusComposer() { const v = panel || page; v?.focusComposer(); return !!v; }
export function mountPanel(el, { id, context, ctx, onCreated, onClose }) {
  panel?.destroy();
  el.innerHTML = '';
  panel = new ThreadView(el, { ctx, mode: 'panel', context, onCreated, onClose });
  panel.open(id || null, {});
  setTimeout(() => panel?.focusComposer(), 50);
}
export function unmountPanel() { panel?.destroy(); panel = null; }
// The View's context changed (another file, other lines): update the chip; the next message carries it.
export function setPanelContext(context) { if (panel && panel.context) { panel.context = context; panel.renderComposerFoot(); } }
export function focusPanel() { panel?.$input?.focus(); }
// Escape stops a working chat when focus is in it (its composer). Not with focus nowhere: Escape pressed
// to dismiss something else while a job's run is on screen mustn't stop the job.
export function stopOnEscape(target) {
  if (!target || target.isContentEditable) return false; // renaming
  const v = [panel, page].find((x) => x?.el.contains(target));
  if (!v || v.slashOpen || !v.showing() || !v.working()) return false;
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
  execute: { icon: 'square-terminal', live: 'Running', done: 'Ran', fail: 'Command failed:' },
  read: { icon: 'file-text', live: 'Reading', done: 'Read', fail: "Couldn't read" },
  edit: { icon: 'file-pen-line', live: 'Editing', done: 'Edited', fail: 'Edit failed:' },
  delete: { icon: 'trash-2', live: 'Deleting', done: 'Deleted', fail: "Couldn't delete" },
  move: { icon: 'folder-input', live: 'Moving', done: 'Moved', fail: "Couldn't move" },
  search: { icon: 'search', live: 'Searching', done: 'Searched', fail: 'Search failed:' },
  fetch: { icon: 'globe', live: 'Fetching', done: 'Fetched', fail: "Couldn't fetch" },
  think: { icon: 'brain', live: 'Thinking', done: 'Thought', fail: 'Thinking failed' },
  switch_mode: { icon: 'sliders-horizontal', live: 'Switching mode', done: 'Switched mode', fail: "Couldn't switch mode" },
  other: { icon: 'wrench', live: 'Using', done: 'Used', fail: 'Failed:' },
};
const LIVE = new Set(['pending', 'in_progress']);
const home = (p) => String(p || '').replace(/^\/home\/[^/]+/, '~');

function toolText(item) {
  const out = [];
  for (const c of item.content || []) if (c.type === 'content' && c.content?.type === 'text') out.push(c.content.text);
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
  if (k === 'read' || k === 'edit' || k === 'delete' || k === 'move') return { text: path ? home(path) : stripTicks(item.title), file: true };
  if (k === 'search') return { text: i.pattern || i.query || stripTicks(item.title), mono: !!i.pattern, extra: path ? `in ${home(path)}` : '' };
  if (k === 'fetch') return { text: i.url || i.query || stripTicks(item.title) };
  return { text: stripTicks(item.title || item.tool || 'tool') };
}
const stripTicks = (s) => String(s || '').replace(/^`|`$/g, '');

// "High effort", or the adapter's own word for its default.
function effortName(e, chosen) {
  const id = chosen || e.current;
  const name = e.values.find((v) => v.id === id)?.name || id;
  return /^default$/i.test(name) ? 'Default effort' : `${name} effort`;
}

// A new chat has no session yet: offer the models and effort levels its agent offered last time.
const agentOpts = new Map(); // agent id -> options | Promise
function draftOptions(agent, rerender) {
  const o = agentOpts.get(agent);
  if (o && !(o instanceof Promise)) return o;
  if (!o) agentOpts.set(agent, api.get(`api/agent/agents/${agent}/options`).catch(() => ({ models: [], effort: null })).then((r) => { agentOpts.set(agent, r); rerender(); }));
  return null;
}
// A new chat starts on the model last picked for its agent, if the agent still offers it.
const draftModel = (o) => (o?.preferredModel && o.models?.some((m) => m.id === o.preferredModel) ? o.preferredModel : o?.currentModel);
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

// Agent text as Markdown. Images from other sites become links: loading one would tell that site
// whatever the agent put in its address (text from an email it read, say).
function chatMarkdown(text) {
  return ui.markdown(text).replace(/<img alt="([^"]*)" src="(https?:[^"]*)">/g, (_, alt, src) =>
    `<a class="img-link" href="${src}" target="_blank" rel="noopener">${ui.icon('image', 'sm')}${alt || 'Image'}</a>`);
}

/* ---------- The view ---------- */
class ThreadView {
  constructor(el, { ctx, mode, context, onCreated, onClose }) {
    this.el = el; this.ctx = ctx; this.mode = mode; this.context = context; this.onCreated = onCreated; this.onClose = onClose;
    this.id = null; this.thread = null; this.items = []; this.open_ = new Set(); this.turnCache = new Map();
    this.draftAgent = null; this.draftCwd = '~/home'; this.draftAccess = 'full'; this.draftModel = null; this.draftEffort = null;
    el.innerHTML = `
      <div class="thread ${mode}">
        <header class="thread-head"></header>
        <div class="thread-scroll"><div class="earlier"></div><div class="timeline"></div><article class="chat-report" hidden></article><div class="tail"></div></div>
        <div class="dock"><div class="stack"></div><div class="composer"></div></div>
      </div>`;
    this.$head = el.querySelector('.thread-head');
    this.$scroll = el.querySelector('.thread-scroll');
    this.$timeline = el.querySelector('.timeline');
    this.$earlier = el.querySelector('.earlier');
    this.$earlier.addEventListener('click', () => this.showEarlier());
    this.$tail = el.querySelector('.tail');
    this.$report = el.querySelector('.chat-report');
    this.$stack = el.querySelector('.stack');
    this.$composer = el.querySelector('.composer');
    this.buildComposer();
    this.off = [
      on('agent:item', (ev) => { if (ev.item.threadId === this.id) this.upsert(ev.item); }),
      on('agent:append', (ev) => { if (ev.threadId === this.id) this.append(ev); }),
      on('agent:reconnect', () => this.refresh()),
      on('agent:thread', (ev) => { if (ev.thread.id === this.id) { this.thread = ev.thread; this.schedule(); } }),
      on('agents', () => this.renderComposerFoot()),
      on('agent:run', (ev) => { if (ev.threadId === this.id) this.loadReport(); }),
    ];
    this.$timeline.addEventListener('toggle', (e) => {
      const k = e.target.dataset?.key;
      if (k) e.target.open ? this.open_.add(k) : this.open_.delete(k);
    }, true);
    this.$timeline.addEventListener('click', (e) => this.onTimelineClick(e));
    this.$scroll.addEventListener('scroll', () => { this.stick = this.$scroll.scrollHeight - this.$scroll.scrollTop - this.$scroll.clientHeight < 80; });
    this.ticker = setInterval(() => this.tick(), 1000);
  }

  destroy() { this.off.forEach((f) => f()); clearInterval(this.ticker); this.el.innerHTML = ''; }
  showing() { return this.el.getClientRects().length > 0; }
  working() { const t = this.thread; return !!t && !t.stopping && (t.running || ['running', 'starting', 'waiting'].includes(t.status)); }
  stop() { if (this.id) api.post(`api/agent/threads/${this.id}/cancel`).catch(() => {}); }
  focusComposer() { this.$input?.focus(); }

  async open(id, q = {}) {
    this.id = id; this.stick = true;
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
    const status = t.status === 'waiting' ? '<span class="ui-pill attention"><span class="ui-dot warn"></span>Needs you</span>'
      : t.running || t.status === 'running' || t.status === 'starting' ? '<span class="ui-pill run"><span class="ui-dot run"></span>Working</span>'
      : t.status === 'error' ? '<span class="ui-status"><span class="ui-dot danger"></span>Error</span>' : '';
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
    // Asked about one item (an email, a failed run): offer to act on it, agent first.
    const item = key.startsWith('item:') ? key.slice(5) : '';
    const suggestions = /(^|:)(email|mail):/.test(item) ? ['Reply for me', 'Archive it', 'What does it say?', 'File it as paper trail']
      : /(^|:)job:/.test(item) ? ['Why did it fail?', 'Fix it and run it again']
      : item ? ['What is this?', 'Take care of it']
      : view ? [`What can you tell me about ${view}?`, `Make ${view} denser and easier to scan`, `Add a feature to ${view}`]
      : ['Build me an app that tracks…', 'What is using memory on this machine?', 'Every morning, summarize my unread mail', 'Clone a repo into ~/projects and get it running'];
    this.$timeline.innerHTML = `
      <div class="empty-chat">
        <h1 class="ui-display">${item ? 'Chat about this.' : view ? `Chat about ${ui.esc(view)}.` : 'New chat.'}</h1>
        <p class="ui-muted">${item ? `${ui.esc(this.context.label || 'This')}. Tell the agent what you want; it can act on it.` : view ? 'The agent can see which app and page you have open, and can change it.' : 'Ask anything, or describe something to build. The agent works on this machine.'}</p>
        <div class="suggest">${suggestions.map((s) => `<button class="ui-chip" data-suggest="${ui.esc(s)}">${ui.esc(s)}</button>`).join('')}</div>
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
      const sig = its.map((i) => `${i.id}:${i.updated}`).join(',') + (isLive ? ':live' : '') + [...this.open_].filter((o) => o.startsWith(`t${k}:`)).join();
      let node = existing.get(String(k));
      if (!node) { node = document.createElement('section'); node.className = 'turn'; node.dataset.turn = k; prev ? prev.after(node) : this.$timeline.prepend(node); }
      prev = node;
      if (this.turnCache.get(k) !== sig) { ui.morph(node, this.renderTurn(k, its, isLive)); this.turnCache.set(k, sig); if (!isLive) ui.highlight(node); }
      existing.delete(String(k));
    }
    for (const n of existing.values()) n.remove();
    const elapsed = this.$tail.querySelector('[data-elapsed]')?.textContent || '';
    ui.morph(this.$tail, live ? `<div class="working"><span class="ui-shimmer">${this.liveLabel()}</span><span class="ui-mono ui-faint" data-elapsed>${elapsed}</span></div>` : '');
    this.tick();
    this.renderStack();
    this.renderComposerFoot();
    if (first || this.stick) this.$scroll.scrollTop = this.$scroll.scrollHeight;
  }

  showEarlier() {
    const before = this.$scroll.scrollHeight;
    this.turnLimit += TURN_PAGE; this.stick = false;
    this.render();
    this.$scroll.scrollTop += this.$scroll.scrollHeight - before; // keep what was on screen in place
  }

  liveLabel() {
    if (this.thread?.stopping) return 'Stopping';
    if (this.thread?.status === 'waiting') return 'Waiting for you';
    if (this.thread?.status === 'starting') return `Starting ${agentName(this.thread.agent)}`;
    const last = [...this.items].reverse().find((i) => i.kind !== 'user');
    if (last?.kind === 'tool' && LIVE.has(last.status)) return `${(KIND[last.toolKind] || KIND.other).live} ${toolTarget(last).text?.slice(0, 48) || ''}`;
    if (last?.kind === 'thought') return 'Thinking';
    return 'Working';
  }

  tick() {
    const el = this.$tail.querySelector('[data-elapsed]');
    if (!el) return;
    const turn = Math.max(...this.items.map((i) => i.turn), 0);
    const start = this.items.find((i) => i.turn === turn && i.kind === 'user')?.created;
    el.textContent = start ? ui.duration(Date.now() - start) : '';
  }

  renderTurn(k, its, live) {
    const users = its.filter((i) => i.kind === 'user');
    const end = its.find((i) => i.kind === 'turn');
    const agent = its.filter((i) => i.kind !== 'user' && i.kind !== 'turn');
    let html = users.map((u) => this.renderUser(u)).join('');
    if (!agent.length && !end) return html;
    if (live || !end) return html + agent.map((i, n) => this.renderItem(i, { live, last: n === agent.length - 1, k })).join('');
    // Completed: fold the work, keep the answer.
    let s = agent.length;
    while (s > 0 && agent[s - 1].kind === 'text') s--;
    let final = agent.slice(s), work = agent.slice(0, s);
    if (!final.length) { const t = work.findLastIndex((i) => i.kind === 'text'); if (t >= 0) { final = [work[t]]; work = work.filter((_, n) => n !== t); } }
    const hasWork = work.some((i) => i.kind !== 'text');
    const danger = work.filter((i) => i.kind === 'notice' && i.level === 'danger');
    if (hasWork) {
      const tools = work.filter((i) => i.kind === 'tool');
      const edits = tools.filter((i) => i.toolKind === 'edit').length;
      const failed = tools.filter((i) => i.status === 'failed').length;
      const facts = [tools.length ? `${tools.length} step${tools.length === 1 ? '' : 's'}` : null, edits ? `${edits} edit${edits === 1 ? '' : 's'}` : null, failed ? `<span class="danger-text">${failed} failed</span>` : null].filter(Boolean).join(' · ');
      const key = `t${k}:work`;
      html += `<details class="work" data-key="${key}"${this.open_.has(key) ? ' open' : ''}>
        <summary>${ui.icon('chevron-right', 'sm')}<span>Worked for ${ui.duration(end.durationMs || 0)}</span><span class="facts">${facts}</span></summary>
        <div class="work-body">${work.map((i) => this.renderItem(i, { k })).join('')}</div></details>`;
    } else html += work.map((i) => this.renderItem(i, { k })).join('');
    html += danger.map((i) => this.renderItem(i, { k })).join('');
    // A closing message that is the report itself (no report was published) shows once: in the card below.
    html += final.filter((i) => !this.reportDup?.has(i.id)).map((i) => this.renderItem(i, { k, final: true })).join('');
    if (end.stopReason === 'cancelled') html += `<div class="turn-note">Stopped.</div>`;
    if (end.stopReason === 'interrupted') html += `<div class="turn-note">${ui.esc(end.note || 'Interrupted.')}</div>`;
    if (end.stopReason === 'error' && end.error) html += `<div class="notice danger">${ui.icon('circle-alert', 'sm')}<span>${ui.esc(end.error)}</span></div>`;
    if (end.stopReason === 'max_tokens' || end.stopReason === 'max_turn_requests') html += `<div class="turn-note">Stopped early (${end.stopReason.replace(/_/g, ' ')}). Say "continue" to keep going.</div>`;
    return html;
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
    const tag = u.unsent ? '<span class="q" title="You stopped the agent before this was sent">Not sent</span>' : u.queued ? '<span class="q">Queued</span>' : '';
    return `<div class="msg-user${u.queued || u.unsent ? ' queued' : ''}">${ctxChip}${tag}<div class="bubble">${ui.esc(text)}</div></div>`;
  }

  renderItem(i, { live, last, k, final } = {}) {
    switch (i.kind) {
      case 'text': return `<div class="msg-agent ui-prose${final ? ' final' : ''}" data-copy="${i.id}">${live && i.text.length > BIG_TEXT ? `<div class="plain">${ui.esc(i.text)}</div>` : chatMarkdown(i.text)}${final ? `<div class="msg-actions"><button data-copy-btn="${i.id}" title="Copy">${ui.icon('copy', 'sm')}</button><span class="ui-mono">${ui.time(i.updated)}</span></div>` : ''}</div>`;
      case 'thought': {
        const key = `t${k}:th:${i.id}`;
        return `<details class="row thought" data-key="${key}"${this.open_.has(key) ? ' open' : ''}><summary>${ui.icon('brain', 'sm')}<span class="${live && last ? 'ui-shimmer' : ''}">${live && last ? 'Thinking' : 'Thought'}</span></summary><div class="row-body ui-prose">${chatMarkdown(i.text)}</div></details>`;
      }
      case 'tool': return this.renderTool(i, k);
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
      case 'notice': return `<div class="notice ${i.level || ''}">${ui.icon(i.level === 'danger' ? 'circle-alert' : 'info', 'sm')}<span>${ui.esc(i.text)}</span></div>`;
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
    const liveNow = LIVE.has(i.status);
    const failed = i.status === 'failed';
    const tg = toolTarget(i);
    const verb = failed ? kind.fail : liveNow ? kind.live : kind.done;
    let deco = '';
    if (i.toolKind === 'edit' && diffsOf(i).some((d) => !d.truncated)) { const s = diffStats(i); deco = `<span class="deco"><span class="add-n">+${s.add}</span> <span class="del-n">−${s.del}</span></span>`; }
    if (!liveNow && i.updated - i.created > 2000) deco += `<span class="deco ui-mono">${ui.duration(i.updated - i.created)}</span>`;
    const target = tg.text ? `<span class="target${tg.mono ? ' mono' : ''}${tg.file ? ' file' : ''}">${ui.esc(String(tg.text).split('\n')[0].slice(0, 160))}</span>${tg.extra ? `<span class="extra">${ui.esc(tg.extra)}</span>` : ''}` : '';
    const key = `t${k}:tool:${i.id}`;
    const open = this.open_.has(key) || (failed && !this.open_.has(key + ':closed'));
    return `<details class="row tool${liveNow ? ' live' : ''}${failed ? ' failed' : ''}" data-key="${key}"${open ? ' open' : ''}>
      <summary>${ui.icon(failed ? 'circle-x' : kind.icon, 'sm')}<span class="verb${liveNow ? ' ui-shimmer' : ''}">${verb}</span>${target}${deco}</summary>
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
        <div class="out">${text ? ui.esc(shown.join('\n')) : LIVE.has(i.status) ? 'Running…' : 'No output'}</div></div>`;
    }
    const diffs = diffsOf(i);
    if (diffs.length) return diffs.map(renderDiff).join('');
    const input = i.rawInput && Object.keys(i.rawInput).length ? `<div class="args">${Object.entries(i.rawInput).filter(([, v]) => v != null && v !== '').map(([k2, v]) =>
      `<div><span class="k">${ui.esc(k2)}</span><span class="v">${ui.esc(typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 600)}</span></div>`).join('')}</div>` : '';
    const out = text ? `<div class="ui-terminal"><div class="out" style="border:0">${ui.esc(text.split('\n').slice(0, 60).join('\n'))}${text.split('\n').length > 60 ? '\n…' : ''}</div></div>` : '';
    return input + out || '<div class="ui-faint">No details.</div>';
  }

  onTimelineClick(e) {
    const all = e.target.closest('[data-all]');
    if (all) { this.open_.add(all.dataset.all + ':all'); this.turnCache.clear(); this.render(); return; }
    const copy = e.target.closest('[data-copy-btn]');
    if (copy) {
      const it = this.items.find((x) => x.id === +copy.dataset.copyBtn);
      navigator.clipboard?.writeText(it?.text || '').then(() => ui.toast('Copied'));
      return;
    }
    const sug = e.target.closest('[data-suggest]');
    if (sug) { this.$input.value = sug.dataset.suggest.replace(/…$/, ' '); this.autosize(); this.$input.focus(); return; }
    const sum = e.target.closest('details.tool > summary');
    if (sum) {
      const d = sum.parentElement, key = d.dataset.key;
      // Render the body lazily on first open.
      setTimeout(() => {
        if (d.open) { this.open_.add(key); this.open_.delete(key + ':closed'); const it = this.items.find((x) => `t${x.turn}:tool:${x.id}` === key); if (it) d.querySelector('.row-body').innerHTML = this.toolBody(it, key); }
        else { this.open_.delete(key); this.open_.add(key + ':closed'); }
        this.turnCache.clear();
      });
    }
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
        <div class="ap-title">${ui.esc(agentName(this.thread?.agent))} wants to: <b>${ui.esc(stripTicks(tc.title || 'take an action'))}</b></div>
        ${cmd ? `<pre class="ap-cmd">${ui.esc(String(cmd).slice(0, 800))}</pre>` : ''}
        <div class="ap-actions">${rejects.map((o) => `<button class="ui-btn ghost sm" data-perm="${p.id}" data-opt="${ui.esc(o.optionId)}">${ui.esc(o.name)}</button>`).join('')}
          <div class="ui-spacer"></div>
          ${always.map((o) => `<button class="ui-btn sm" data-perm="${p.id}" data-opt="${ui.esc(o.optionId)}">${ui.esc(o.name)}</button>`).join('')}
          ${once.map((o) => `<button class="ui-btn primary sm" data-perm="${p.id}" data-opt="${ui.esc(o.optionId)}">${ui.esc(o.name)}</button>`).join('')}</div>
      </div>`;
    }).join('') + this.nudgeHtml());
    this.$stack.onclick = async (e) => {
      const n = e.target.closest('[data-nudge]')?.dataset.nudge;
      if (n) return this.onNudge(n);
      const b = e.target.closest('[data-perm]');
      if (!b) return;
      b.disabled = true;
      try { await api.post(`api/agent/threads/${this.id}/permissions/${b.dataset.perm}`, { optionId: b.dataset.opt }); }
      catch (err) { ui.toast(err.message, { icon: 'circle-alert' }); }
    };
  }

  // A slash command the agent didn't list for chat (Claude's /permissions, /login: terminal-only). Sent
  // as text it would just be a message, so offer the agent's own terminal in this chat's folder instead.
  unknownCommand(text) {
    const cmds = this.thread?.commands || [];
    const m = /^\/([^\s/]+)(?=\s|$)/.exec(text); // "/home/agent/x is broken" isn't a command
    return m && cmds.length && !cmds.some((c) => c.name === m[1]) ? m[1] : null;
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
      <div class="c-foot"></div>`;
    this.$input = this.$composer.querySelector('textarea');
    this.$cHead = this.$composer.querySelector('.c-head');
    this.$foot = this.$composer.querySelector('.c-foot');
    this.$input.addEventListener('input', () => { this.recall = null; if (this.nudge) { this.nudge = null; this.renderStack(); } this.autosize(); this.saveDraft(); this.slashMenu(); this.updateSend(); });
    this.$input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !this.slashOpen) { e.preventDefault(); this.send(); }
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !e.isComposing && !this.slashOpen && !ui.popoverOpen()
        && (!this.$input.value || this.$input.value === this.recall?.text) && this.recallStep(e.key === 'ArrowUp' ? 1 : -1)) e.preventDefault();
      // (Escape while it works is Stop: main.js's key handler sees it first.)
      if (e.key === 'Escape' && !this.slashOpen) this.$input.blur();
    });
    this.$composer.addEventListener('click', (e) => { if (e.target === this.$composer) this.$input.focus(); });
    this.$foot.addEventListener('click', (e) => this.onFootClick(e));
    this.$cHead.addEventListener('click', (e) => { if (e.target.closest('[data-drop-ctx]')) { this.context = null; this.renderComposerFoot(); } });
  }

  autosize() { this.$input.style.height = 'auto'; this.$input.style.height = Math.min(this.$input.scrollHeight, 240) + 'px'; }
  draftKey() { return `desk.draft.${this.id || (this.mode === 'panel' ? 'panel' : 'new')}`; }
  loadDraft() { try { return localStorage.getItem(this.draftKey()) || ''; } catch { return ''; } }
  saveDraft() { try { localStorage.setItem(this.draftKey(), this.$input.value); } catch {} }

  renderComposerFoot() {
    const t = this.thread;
    const running = t && (t.running || ['running', 'starting', 'waiting'].includes(t.status));
    const agentId = t?.agent || this.draftAgent || defaultAgent();
    const opts = t ? t.options : draftOptions(agentId, () => this.renderComposerFoot());
    const modelId = t ? t.model || opts?.currentModel : this.draftModel || draftModel(opts);
    const model = opts?.models?.find((m) => m.id === modelId);
    const effortId = t ? t.effort : this.draftEffort;
    const access = t ? (t.access || 'full') : this.draftAccess;
    const usage = t?.usage?.size ? Math.round((100 * t.usage.used) / t.usage.size) : null;
    ui.morph(this.$cHead, this.context?.title
      ? `<span class="ui-context"><span class="dot ui-dot"></span><span class="kind">${ui.esc(this.context.label ? this.context.title : this.context.view ? 'App' : 'Page')}</span><b>${ui.esc(this.context.label || this.context.title || this.context.view)}</b><button data-drop-ctx title="Don't include">${ui.icon('x', 'xs')}</button></span>` : '');
    this.$cHead.style.display = this.$cHead.innerHTML ? '' : 'none';
    ui.morph(this.$foot, `
      <button class="ui-combo" data-pick="agent" ${t ? 'disabled title="Agent for this chat"' : 'title="Agent"'}>${ui.agentMark(agentId, agentName(agentId), 'sm')}<span>${ui.esc(agentName(agentId))}</span>${t ? '' : ui.icon('chevron-down')}</button>
      ${opts?.models?.length ? `<button class="ui-combo" data-pick="model" title="Model"><span>${ui.esc(model?.name || modelId || 'Default model')}</span>${ui.icon('chevron-down')}</button>` : ''}
      ${opts?.effort ? `<button class="ui-combo" data-pick="effort" title="Effort: how long the model thinks"><span>${ui.esc(effortName(opts.effort, effortId))}</span>${ui.icon('chevron-down')}</button>` : ''}
      ${t && opts?.extra?.length ? `<button class="ui-combo" data-pick="more" title="More settings: ${ui.esc(opts.extra.map((x) => x.name).join(', '))}">${ui.icon('sliders-horizontal', 'sm')}</button>` : ''}
      ${!t && this.mode === 'page' ? `<button class="ui-combo" data-pick="cwd" title="Folder">${ui.icon('folder', 'sm')}<span>${ui.esc(this.draftCwd)}</span>${ui.icon('chevron-down')}</button>` : ''}
      <button class="ui-combo" data-pick="access" title="${access === 'full' ? 'Full access: the agent acts without asking (this machine is its sandbox)' : 'Ask first: you approve actions'}">${ui.icon(access === 'full' ? 'shield-check' : 'shield-question', 'sm')}<span>${access === 'full' ? 'Full access' : 'Ask first'}</span></button>
      <div class="ui-spacer"></div>
      ${usage != null ? `<span class="usage ui-mono" title="Context used">${usage}%</span>` : ''}
      ${running ? `<button class="ui-round stop filled c-stop" data-a="stop" title="Stop (Esc)">${ui.icon('square', 'sm')}</button>` : ''}
      <button class="ui-round primary c-send" data-a="send" title="${running ? 'Queue (Enter)' : 'Send (Enter)'}">${ui.icon(running ? 'list-plus' : 'arrow-up')}</button>`);
    this.updateSend();
  }

  updateSend() {
    const b = this.$foot.querySelector('.c-send');
    if (b) b.disabled = !this.$input.value.trim();
  }

  async onFootClick(e) {
    const b = e.target.closest('[data-pick], [data-a]');
    if (!b) return;
    const t = this.thread;
    if (b.dataset.a === 'send') return this.send();
    if (b.dataset.a === 'stop') return this.stop();
    if (b.dataset.pick === 'agent' && !t) {
      ui.combobox(b, {
        options: state.agents.filter((a) => a.installed).map((a) => ({ value: a.id, label: a.name, lead: ui.agentMark(a.id, a.name, 'sm'), desc: !a.acpInstalled ? 'Chat adapter not installed: open Settings' : a.signedIn ? a.maker : 'Not signed in: open Settings', meta: a.version?.split(' ')[0] })),
        value: this.draftAgent,
        onSelect: (v) => {
          const a = state.agents.find((x) => x.id === v);
          if (a && (!a.signedIn || !a.acpInstalled)) { this.ctx.go('#/v/settings'); return; }
          if (v !== this.draftAgent) { this.draftModel = null; this.draftEffort = null; }
          this.draftAgent = v; this.renderComposerFoot();
        },
      });
    }
    // In a chat, model and effort change its session; in a new chat they're sent when it starts.
    const opts = t ? t.options : agentOpts.get(this.draftAgent || defaultAgent());
    if (b.dataset.pick === 'effort' && opts?.effort) {
      const e = opts.effort;
      ui.combobox(b, {
        options: e.values.map((v) => ({ value: v.id, label: v.name })),
        value: (t ? t.effort : this.draftEffort) || e.current, search: false,
        onSelect: (v) => t ? api.patch(`api/agent/threads/${t.id}`, { effort: v }).catch((err) => ui.toast(err.message)) : (this.draftEffort = v, this.renderComposerFoot()),
      });
    }
    if (b.dataset.pick === 'model' && opts?.models?.length) {
      ui.combobox(b, {
        options: opts.models.map((m) => ({ value: m.id, label: m.name, desc: m.description })),
        value: (t ? t.model : this.draftModel) || (t ? opts.currentModel : draftModel(opts)),
        onSelect: (v) => t ? api.patch(`api/agent/threads/${t.id}`, { model: v }).catch((err) => ui.toast(err.message)) : (this.draftModel = v, this.renderComposerFoot()),
      });
    }
    if (b.dataset.pick === 'more' && t && opts?.extra?.length) {
      ui.combobox(b, {
        options: opts.extra.flatMap((x) => x.values.map((v) => ({ value: `${x.id}\n${v.id}`, label: v.name, desc: v.description, group: x.name, lead: v.id === x.current ? ui.icon('check', 'sm') : '' }))),
        search: false,
        onSelect: (v) => { const [id, value] = v.split('\n'); api.patch(`api/agent/threads/${t.id}`, { option: { id, value } }).catch((err) => ui.toast(err.message)); },
      });
    }
    if (b.dataset.pick === 'cwd') {
      ui.combobox(b, { options: state.folders.map((f) => ({ value: f, label: f, icon: 'folder' })), value: this.draftCwd, onSelect: (v) => { this.draftCwd = v; this.renderComposerFoot(); } });
    }
    if (b.dataset.pick === 'access') {
      const next = (t ? t.access || 'full' : this.draftAccess) === 'full' ? 'ask' : 'full';
      if (t) { await api.patch(`api/agent/threads/${t.id}`, { access: next }); this.thread = { ...t, access: next }; }
      else this.draftAccess = next;
      this.renderComposerFoot();
      ui.toast(next === 'full' ? 'Full access: the agent will act without asking' : 'Ask first: you\'ll approve actions', { icon: next === 'full' ? 'shield-check' : 'shield-question' });
    }
  }

  slashMenu() {
    const v = this.$input.value;
    const cmds = this.thread?.commands || [];
    if (!/^\/\S*$/.test(v) || !cmds.length) { if (this.slashOpen) { ui.closePopover(); this.slashOpen = false; } return; }
    const q = v.slice(1).toLowerCase();
    const opts = cmds.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 30).map((c) => ({ value: c.name, label: '/' + c.name, desc: c.description }));
    if (!opts.length) return;
    this.slashOpen = true;
    ui.combobox(this.$composer, {
      options: opts, search: false, width: 420,
      onSelect: (name) => { this.slashOpen = false; this.$input.value = `/${name} `; this.$input.focus(); this.updateSend(); },
    });
    setTimeout(() => this.$input.focus());
  }

  async send({ text = this.$input.value.trim(), force = false } = {}) {
    if (!text) return;
    if (!force && this.unknownCommand(text)) { this.nudge = { text, command: this.unknownCommand(text) }; this.renderStack(); return; }
    this.nudge = null; this.recall = null;
    this.$input.value = ''; this.autosize(); this.saveDraft(); this.updateSend();
    try {
      if (!this.id) {
        const t = await api.post('api/agent/threads', { agent: this.draftAgent || defaultAgent(), cwd: this.mode === 'panel' ? '~/home' : this.draftCwd, text, context: this.context || undefined, access: this.draftAccess, model: this.draftModel || undefined, effort: this.draftEffort || undefined, origin: this.context?.view ? `view:${this.context.view}` : 'chat' });
        try { localStorage.removeItem(this.draftKey()); } catch {}
        upsertThread(t);
        if (this.mode === 'page') this.ctx.go(`#/t/${t.id}`);
        else { this.onCreated?.(t.id); this.open(t.id); }
        return;
      }
      await api.post(`api/agent/threads/${this.id}/messages`, { text, context: this.mode === 'panel' && this.context ? this.ctx.viewContext() || this.context : undefined });
      this.stick = true;
    } catch (e) {
      this.$input.value = text; this.autosize();
      ui.toast(e.message, { icon: 'circle-alert' });
    }
  }
}

// A conversation with an agent: the timeline and the composer. Used full-page
// (#/t/<id>, #/new) and in the side panel ("Ask about this").
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
function effortName(t) {
  const e = t.options.effort;
  const id = t.effort || e.current;
  const name = e.values.find((v) => v.id === id)?.name || id;
  return /^default$/i.test(name) ? 'Default effort' : `${name} effort`;
}
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
  for (const d of diffsOf(item)) for (const [op] of lineDiff(d.oldText, d.newText)) { if (op === 'add') add++; if (op === 'del') del++; }
  return { add, del };
}
function renderDiff(d) {
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

/* ---------- The view ---------- */
class ThreadView {
  constructor(el, { ctx, mode, context, onCreated, onClose }) {
    this.el = el; this.ctx = ctx; this.mode = mode; this.context = context; this.onCreated = onCreated; this.onClose = onClose;
    this.id = null; this.thread = null; this.items = []; this.open_ = new Set(); this.turnCache = new Map();
    this.draftAgent = null; this.draftCwd = '~/home'; this.draftAccess = 'full';
    el.innerHTML = `
      <div class="thread ${mode}">
        <header class="thread-head"></header>
        <div class="thread-scroll"><div class="timeline"></div><div class="tail"></div></div>
        <div class="dock"><div class="stack"></div><div class="composer"></div></div>
      </div>`;
    this.$head = el.querySelector('.thread-head');
    this.$scroll = el.querySelector('.thread-scroll');
    this.$timeline = el.querySelector('.timeline');
    this.$tail = el.querySelector('.tail');
    this.$stack = el.querySelector('.stack');
    this.$composer = el.querySelector('.composer');
    this.buildComposer();
    this.off = [
      on('agent:item', (ev) => { if (ev.item.threadId === this.id) this.upsert(ev.item); }),
      on('agent:thread', (ev) => { if (ev.thread.id === this.id) { this.thread = ev.thread; this.schedule(); } }),
      on('agents', () => this.renderComposerFoot()),
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
  focusComposer() { this.$input?.focus(); }

  async open(id, q = {}) {
    this.id = id; this.items = []; this.turnCache.clear(); this.$timeline.innerHTML = ''; this.thread = null; this.stick = true;
    if (!id) {
      this.draftAgent = q.agent || this.draftAgent || defaultAgent();
      if (q.cwd) this.draftCwd = q.cwd;
      this.renderHead(); this.renderEmpty(); this.renderComposerFoot(); this.renderStack();
      this.$input.value = q.text || this.loadDraft();
      this.autosize();
      return;
    }
    this.$tail.innerHTML = '<div class="ui-loading" style="margin:40px auto;max-width:200px"></div>';
    try {
      const r = await api.get(`api/agent/threads/${id}`);
      if (this.id !== id) return;
      this.thread = r.thread; this.items = r.items;
      upsertThread({ ...r.thread, unread: false });
    } catch (e) { this.$tail.innerHTML = `<div class="ui-empty"><span class="title">Couldn't open this chat</span><p>${ui.esc(e.message)}</p></div>`; return; }
    this.$input.value = this.loadDraft();
    this.autosize();
    this.render(true);
    this.markRead();
  }

  markRead() {
    if (!this.id || document.hidden) return;
    clearTimeout(this.readTimer);
    this.readTimer = setTimeout(() => api.patch(`api/agent/threads/${this.id}`, { read: true }).catch(() => {}), 400);
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
      const what = this.context?.title ? `Ask about ${this.context.title}` : 'Ask';
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
    const view = this.context?.title;
    const suggestions = view
      ? [`What can you tell me about ${view}?`, `Make ${view} denser and easier to scan`, `Add a feature to ${view}`]
      : ['Build me a View that tracks…', 'What is using memory on this machine?', 'Every morning, summarize my unread mail', 'Clone a repo into ~/projects and get it running'];
    this.$timeline.innerHTML = `
      <div class="empty-chat">
        <h1 class="ui-display">${view ? `Ask about ${ui.esc(view)}.` : 'New chat.'}</h1>
        <p class="ui-muted">${view ? 'The agent can see which View and page you have open, and can change it.' : 'Ask anything, or describe something to build. The agent works on this machine.'}</p>
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
    const keys = [...turns.keys()].sort((a, b) => a - b);
    const live = this.thread && (this.thread.running || this.thread.status === 'running' || this.thread.status === 'starting' || this.thread.status === 'waiting');
    const lastTurn = keys[keys.length - 1];
    const existing = new Map([...this.$timeline.children].map((c) => [c.dataset.turn, c]));
    for (const k of keys) {
      const its = turns.get(k);
      const isLive = live && k === lastTurn && !its.some((i) => i.kind === 'turn');
      const sig = its.map((i) => `${i.id}:${i.updated}`).join(',') + (isLive ? ':live' : '') + [...this.open_].filter((o) => o.startsWith(`t${k}:`)).join();
      let node = existing.get(String(k));
      if (!node) { node = document.createElement('section'); node.className = 'turn'; node.dataset.turn = k; this.$timeline.appendChild(node); }
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

  liveLabel() {
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
    html += final.map((i) => this.renderItem(i, { k, final: true })).join('');
    if (end.stopReason === 'cancelled') html += `<div class="turn-note">Stopped.</div>`;
    if (end.stopReason === 'interrupted') html += `<div class="turn-note">${ui.esc(end.note || 'Interrupted.')}</div>`;
    if (end.stopReason === 'error' && end.error) html += `<div class="notice danger">${ui.icon('circle-alert', 'sm')}<span>${ui.esc(end.error)}</span></div>`;
    if (end.stopReason === 'max_tokens' || end.stopReason === 'max_turn_requests') html += `<div class="turn-note">Stopped early (${end.stopReason.replace(/_/g, ' ')}). Say "continue" to keep going.</div>`;
    return html;
  }

  renderUser(u) {
    const sys = u.system;
    const ctxChip = u.context?.view ? `<div class="u-ctx"><span class="ui-context"><span class="dot ui-dot"></span><span class="kind">${ui.esc(u.context.label ? u.context.title : 'View')}</span><b>${ui.esc(u.context.label || u.context.title || u.context.view)}</b></span></div>` : '';
    if (sys) return `<div class="msg-sys">${ui.icon('clock', 'sm')}<span>${ui.esc(u.text)}</span></div>`;
    const isJob = this.thread?.origin?.startsWith('job:') && u.turn === 1;
    const text = isJob ? u.text.split('\n---\n')[0] : u.text;
    return `<div class="msg-user${u.queued ? ' queued' : ''}">${ctxChip}${u.queued ? '<span class="q">Queued</span>' : ''}<div class="bubble">${ui.esc(text)}</div></div>`;
  }

  renderItem(i, { live, last, k, final } = {}) {
    switch (i.kind) {
      case 'text': return `<div class="msg-agent ui-prose${final ? ' final' : ''}" data-copy="${i.id}">${ui.markdown(i.text)}${final ? `<div class="msg-actions"><button data-copy-btn="${i.id}" title="Copy">${ui.icon('copy', 'sm')}</button><span class="ui-mono">${ui.time(i.updated)}</span></div>` : ''}</div>`;
      case 'thought': {
        const key = `t${k}:th:${i.id}`;
        return `<details class="row thought" data-key="${key}"${this.open_.has(key) ? ' open' : ''}><summary>${ui.icon('brain', 'sm')}<span class="${live && last ? 'ui-shimmer' : ''}">${live && last ? 'Thinking' : 'Thought'}</span></summary><div class="row-body ui-prose">${ui.markdown(i.text)}</div></details>`;
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
        if (c.type === 'image' && c.data) return `<img class="media" src="data:${c.mimeType};base64,${c.data}" alt="">`;
        if (c.type === 'resource_link') return `<a class="row" href="${ui.esc(c.uri)}" target="_blank">${ui.icon('link', 'sm')}<span>${ui.esc(c.name || c.uri)}</span></a>`;
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
    if (i.toolKind === 'edit' && diffsOf(i).length) { const s = diffStats(i); deco = `<span class="deco"><span class="add-n">+${s.add}</span> <span class="del-n">−${s.del}</span></span>`; }
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
    }).join(''));
    this.$stack.onclick = async (e) => {
      const b = e.target.closest('[data-perm]');
      if (!b) return;
      b.disabled = true;
      try { await api.post(`api/agent/threads/${this.id}/permissions/${b.dataset.perm}`, { optionId: b.dataset.opt }); }
      catch (err) { ui.toast(err.message, { icon: 'circle-alert' }); }
    };
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
    this.$input.addEventListener('input', () => { this.autosize(); this.saveDraft(); this.slashMenu(); this.updateSend(); });
    this.$input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !this.slashOpen) { e.preventDefault(); this.send(); }
      if (e.key === 'Escape') this.$input.blur();
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
    const model = t?.options?.models?.find((m) => m.id === (t.model || t.options.currentModel));
    const access = t ? (t.access || 'full') : this.draftAccess;
    const usage = t?.usage?.size ? Math.round((100 * t.usage.used) / t.usage.size) : null;
    ui.morph(this.$cHead, this.context?.view
      ? `<span class="ui-context"><span class="dot ui-dot"></span><span class="kind">${ui.esc(this.context.label ? this.context.title : 'View')}</span><b>${ui.esc(this.context.label || this.context.title || this.context.view)}</b><button data-drop-ctx title="Don't include">${ui.icon('x', 'xs')}</button></span>` : '');
    this.$cHead.style.display = this.$cHead.innerHTML ? '' : 'none';
    ui.morph(this.$foot, `
      <button class="ui-combo" data-pick="agent" ${t ? 'disabled title="Agent for this chat"' : 'title="Agent"'}>${ui.agentMark(agentId, agentName(agentId), 'sm')}<span>${ui.esc(agentName(agentId))}</span>${t ? '' : ui.icon('chevron-down')}</button>
      ${t?.options?.models?.length ? `<button class="ui-combo" data-pick="model" title="Model"><span>${ui.esc(model?.name || t.model || 'Default model')}</span>${ui.icon('chevron-down')}</button>` : ''}
      ${t?.options?.effort ? `<button class="ui-combo" data-pick="effort" title="Effort: how long the model thinks"><span>${ui.esc(effortName(t))}</span>${ui.icon('chevron-down')}</button>` : ''}
      ${!t && this.mode === 'page' ? `<button class="ui-combo" data-pick="cwd" title="Folder">${ui.icon('folder', 'sm')}<span>${ui.esc(this.draftCwd)}</span>${ui.icon('chevron-down')}</button>` : ''}
      <button class="ui-combo" data-pick="access" title="${access === 'full' ? 'Full access: the agent acts without asking (this machine is its sandbox)' : 'Ask first: you approve actions'}">${ui.icon(access === 'full' ? 'shield-check' : 'shield-question', 'sm')}<span>${access === 'full' ? 'Full access' : 'Ask first'}</span></button>
      <div class="ui-spacer"></div>
      ${usage != null ? `<span class="usage ui-mono" title="Context used">${usage}%</span>` : ''}
      ${running ? `<button class="c-stop" data-a="stop" title="Stop">${ui.icon('square', 'sm')}</button>` : ''}
      <button class="c-send" data-a="send" title="${running ? 'Queue (Enter)' : 'Send (Enter)'}">${ui.icon(running ? 'list-plus' : 'arrow-up')}</button>`);
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
    if (b.dataset.a === 'stop') return api.post(`api/agent/threads/${this.id}/cancel`).catch(() => {});
    if (b.dataset.pick === 'agent' && !t) {
      ui.combobox(b, {
        options: state.agents.filter((a) => a.installed).map((a) => ({ value: a.id, label: a.name, lead: ui.agentMark(a.id, a.name, 'sm'), desc: !a.acpInstalled ? 'Chat adapter not installed: open Settings' : a.signedIn ? a.maker : 'Not signed in: open Settings', meta: a.version?.split(' ')[0] })),
        value: this.draftAgent,
        onSelect: (v) => {
          const a = state.agents.find((x) => x.id === v);
          if (a && (!a.signedIn || !a.acpInstalled)) { this.ctx.go('#/v/settings'); return; }
          this.draftAgent = v; this.renderComposerFoot();
        },
      });
    }
    if (b.dataset.pick === 'effort' && t) {
      const e = t.options.effort;
      ui.combobox(b, {
        options: e.values.map((v) => ({ value: v.id, label: v.name })),
        value: t.effort || e.current, search: false,
        onSelect: (v) => api.patch(`api/agent/threads/${t.id}`, { effort: v }).catch((err) => ui.toast(err.message)),
      });
    }
    if (b.dataset.pick === 'model' && t) {
      ui.combobox(b, {
        options: t.options.models.map((m) => ({ value: m.id, label: m.name, desc: m.description })),
        value: t.model || t.options.currentModel,
        onSelect: (v) => api.patch(`api/agent/threads/${t.id}`, { model: v }).catch((err) => ui.toast(err.message)),
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

  async send() {
    const text = this.$input.value.trim();
    if (!text) return;
    this.$input.value = ''; this.autosize(); this.saveDraft(); this.updateSend();
    try {
      if (!this.id) {
        const t = await api.post('api/agent/threads', { agent: this.draftAgent || defaultAgent(), cwd: this.mode === 'panel' ? '~/home' : this.draftCwd, text, context: this.context || undefined, access: this.draftAccess, origin: this.context?.view ? `view:${this.context.view}` : 'chat' });
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

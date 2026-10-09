// All chats: every conversation with an agent (job runs live under Jobs), newest first, grouped by
// day, with search and an Archived view. The sidebar shows only the latest few.
import { api, state, on, agentName } from './api.js';
import { isChat } from './main.js';

let el, ctx, view = 'current', query = '', archived = [], results = null, timer = null;

export function init(root, c) {
  el = root; ctx = c;
  el.innerHTML = `<div class="ui-page chats">
    <header class="ui-heading"><div><span class="ui-eyebrow">Conversations</span><h1 class="ui-display">Chats.</h1></div>
      <div class="actions"><a class="ui-btn primary" href="#/new">${ui.icon('square-pen', 'sm')}New chat</a></div></header>
    <div class="chats-bar">
      <label class="ui-search"><span class="ui-sr-only">Search chats</span>${ui.icon('search', 'sm')}<input class="ui-input" id="chatQ" placeholder="Search chats" autocomplete="off"></label>
      <div class="ui-seg" id="chatView"><button data-v="current" aria-pressed="true">Current</button><button data-v="archived" aria-pressed="false">Archived</button></div>
    </div>
    <div id="chatsList"></div></div>`;
  el.querySelector('#chatQ').addEventListener('input', (e) => {
    query = e.target.value.trim();
    clearTimeout(timer);
    timer = setTimeout(search, 200);
  });
  el.querySelector('#chatView').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b || b.dataset.v === view) return;
    view = b.dataset.v;
    el.querySelectorAll('#chatView button').forEach((x) => x.setAttribute('aria-pressed', x.dataset.v === view));
    load();
  });
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-thread-menu]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    const t = [...state.threads, ...archived, ...(results || [])].find((x) => x.id === b.dataset.threadMenu);
    if (t) ctx.threadMenu(b, t, { onDeleted: load });
  });
  on('threads', () => { if (el.closest('.shown')) load(); });
}

export function show() { load(); el.querySelector('#chatQ').focus({ preventScroll: true }); }
export function title() { return 'Chats'; }

async function load() {
  if (query) return search();
  if (view === 'archived') archived = (await api.get('api/agent/threads?archived=1').catch(() => [])).filter(isChat);
  render(view === 'archived' ? archived : state.threads.filter(isChat));
}

async function search() {
  if (!query) { results = null; return load(); }
  results = (await api.get(`api/agent/threads?q=${encodeURIComponent(query)}`).catch(() => [])).filter((t) => isChat(t) && t.archived === (view === 'archived'));
  render(results);
}

function render(list) {
  const box = el.querySelector('#chatsList');
  if (!list.length) {
    box.innerHTML = `<div class="ui-empty"><div class="orbit"></div><h2>${query ? 'No chats match.' : view === 'archived' ? 'Nothing archived.' : 'No chats yet.'}</h2>
      ${query || view === 'archived' ? '' : '<p>Ask an agent anything, or have it build you an app.</p><a class="ui-link-action" href="#/new">Start a chat</a>'}</div>`;
    return;
  }
  let day = null, html = '';
  for (const t of list) {
    const d = new Date(t.updated).toDateString();
    if (d !== day) { html += `${day ? '</div>' : ''}<div class="ui-feed-day">${ui.esc(ui.day(t.updated))}</div><div class="ui-group">`; day = d; }
    html += `<a class="ui-row chat-row${t.unread ? ' unread' : ''}" href="#/t/${t.id}">
      <span class="lead">${ui.agentMark(t.agent, agentName(t.agent))}</span>
      <div class="body"><span class="title">${t.pinned ? ui.icon('pin', 'xs') + ' ' : ''}${ui.esc(t.title || 'New chat')}</span>
        <span class="sub">${ui.esc((t.preview || '').replace(/[#*`_>]/g, '').slice(0, 160) || agentName(t.agent))}</span></div>
      <span class="glyph">${ctx.threadGlyph(t)}</span>
      <span class="meta">${ui.esc(ui.time(t.updated))}</span>
      <button class="ui-icon-btn more" data-thread-menu="${t.id}" title="More" aria-label="More for ${ui.esc(t.title || 'this chat')}">${ui.icon('ellipsis', 'sm')}</button></a>`;
  }
  box.innerHTML = html + '</div>';
}

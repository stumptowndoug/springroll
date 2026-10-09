// Connections: keys and sign-ins agents can use. Values stay on this machine.
import { api } from './api.js';

let el, ctx, list = [];

export function init(root, c) {
  el = root; ctx = c;
  el.addEventListener('click', onClick);
}
export async function show(_el, r) {
  await load();
  if (r.name) { const c = list.find((x) => x.id === r.name); if (c) openSheet(c); }
}
export function title() { return 'Connections'; }

async function load() {
  try { list = await api.get('api/connections'); } catch (e) { list = []; }
  render();
}

function card(c) {
  const status = c.connected
    ? `<span class="ui-status"><span class="ui-dot ${c.lastTest && !c.lastTest.ok ? 'danger' : 'ok'}"></span>${c.lastTest && !c.lastTest.ok ? 'Failing' : 'Connected'}</span>`
    : '<span class="ui-faint" style="font-size:var(--text-sm)">Not connected</span>';
  return `<button class="ui-card hover conn" data-id="${c.id}">
    <span class="conn-icon">${ui.icon(c.icon || 'plug', 'lg')}</span>
    <span class="conn-name">${ui.esc(c.name)}</span>
    <span class="conn-desc">${ui.esc(c.description)}</span>
    <span class="conn-foot">${status}${c.mcpEnabled ? '<span class="ui-badge">MCP</span>' : ''}</span></button>`;
}

function render() {
  const connected = list.filter((c) => c.connected);
  const cats = [...new Set(list.filter((c) => !c.connected).map((c) => c.category))];
  el.innerHTML = `<div class="ui-page connections">
    <header class="ui-heading"><div><span class="ui-eyebrow">Services agents can use</span><h1 class="ui-display">Connections.</h1></div></header>
    <p class="ui-muted lede">Keys and sign-ins live on this machine (<span class="ui-mono">~/.config/agentos/secrets.env</span>), never in git. Every agent session and job gets them as environment variables, so agents use them like any API.</p>
    ${connected.length ? `<section class="ui-section"><header><span class="ui-label">Connected</span></header><div class="ui-grid" style="--min:250px">${connected.map(card).join('')}</div></section>` : ''}
    ${cats.map((cat) => `<section class="ui-section"><header><span class="ui-label">${ui.esc(cat)}</span></header>
      <div class="ui-grid" style="--min:250px">${list.filter((c) => !c.connected && c.category === cat).map(card).join('')}</div></section>`).join('')}
    <section class="ui-section"><div class="ui-card pad other-conn">
      <span class="conn-icon">${ui.icon('plus', 'lg')}</span>
      <div><b>Something else?</b><p class="ui-muted">Any service with an API works. Ask the agent to connect it: it will tell you which key to create, save it, and add it to this list.</p></div>
      <a class="ui-btn" href="#/new?text=${encodeURIComponent('Help me connect ')}">Ask the agent</a></div></section>
  </div>`;
}

function onClick(e) {
  const b = e.target.closest('[data-id]');
  if (b) { const c = list.find((x) => x.id === b.dataset.id); if (c) openSheet(c); }
}

function openSheet(c) {
  const d = document.createElement('dialog');
  d.className = 'ui-sheet conn-sheet';
  d.innerHTML = `
    <div class="ui-toolbar"><span class="conn-icon sm">${ui.icon(c.icon || 'plug')}</span><span class="ui-title">${ui.esc(c.name)}</span><div class="ui-spacer"></div><button class="ui-icon-btn plain" data-close>${ui.icon('x')}</button></div>
    <form class="body ui-stack" style="gap:18px">
      <p class="ui-muted">${ui.esc(c.description)}</p>
      <div class="ui-callout">${ui.icon('info', 'sm')}<div class="ui-prose" style="font-size:var(--text-sm)">${ui.markdown(c.help || '')}</div></div>
      ${(c.fields || []).map((f) => `<div class="ui-field"><label>${ui.esc(f.label)}</label>
        <input name="${f.key}" ${f.secret ? 'type="password" autocomplete="off"' : ''} placeholder="${ui.esc(f.placeholder || '')}" value="${ui.esc(c.values?.[f.key] || '')}" class="${f.secret ? 'ui-mono' : ''}">
        <span class="hint ui-mono">$${f.key}</span></div>`).join('')}
      <div class="result"></div>
      ${c.mcp ? `<label class="ui-hstack mcp-row" style="gap:10px;font-size:var(--text-sm);align-items:flex-start"><input type="checkbox" class="ui-switch" name="mcp" ${c.mcpEnabled ? 'checked' : ''} ${c.connected ? '' : 'disabled'}>
        <span>Give agents its MCP tools<span class="ui-muted" style="display:block;font-size:var(--text-xs)">${ui.esc(c.mcp.note || '')} New chats pick this up.</span></span></label>` : ''}
    </form>
    <footer>${c.connected ? `<button class="ui-btn ghost" data-x="disconnect" style="margin-right:auto;color:var(--danger)">Disconnect</button><button class="ui-btn" data-x="test">Test</button>` : ''}
      <button class="ui-btn primary" data-x="save">${c.connected ? 'Save' : 'Test and connect'}</button></footer>`;
  document.body.appendChild(d);
  const f = d.querySelector('form');
  const result = d.querySelector('.result');
  const show = (r) => { result.innerHTML = `<div class="ui-callout ${r.ok ? '' : 'danger'}">${ui.icon(r.ok ? 'circle-check' : 'circle-alert', 'sm')}<div class="ui-mono" style="font-size:var(--text-xs);white-space:pre-wrap">${ui.esc(r.output || (r.ok ? 'OK' : 'Failed'))}</div></div>`; };
  d.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (!x) return;
    const btn = e.target.closest('button');
    btn.disabled = true;
    try {
      if (x === 'save') {
        const values = Object.fromEntries((c.fields || []).map((fl) => [fl.key, f[fl.key].value]));
        result.innerHTML = '<div class="ui-loading"></div>';
        const r = await api.post(`api/connections/${c.id}`, { values });
        show(r);
        if (r.ok) { ui.toast(`${c.name} connected`); await load(); setTimeout(() => d.close(), 900); }
      }
      if (x === 'test') { result.innerHTML = '<div class="ui-loading"></div>'; show(await api.post(`api/connections/${c.id}/test`)); load(); }
      if (x === 'disconnect' && confirm(`Disconnect ${c.name}? Its keys are removed from this machine.`)) { await api.del(`api/connections/${c.id}`); ui.toast(`${c.name} disconnected`); await load(); d.close(); }
    } catch (err) { show({ ok: false, output: err.message }); }
    btn.disabled = false;
  });
  f.mcp?.addEventListener('change', async () => { await api.post(`api/connections/${c.id}/mcp`, { enabled: f.mcp.checked }).catch((err) => ui.toast(err.message)); load(); });
  f.addEventListener('submit', (e) => { e.preventDefault(); d.querySelector('[data-x="save"]').click(); });
  d.addEventListener('close', () => { d.remove(); if (location.hash.startsWith('#/connections/')) history.replaceState(null, '', '#/connections'); });
  d.showModal();
}

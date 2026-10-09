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
    <p class="ui-muted lede">Keys and sign-ins stay on this machine, never in git. Keys (<span class="ui-mono">~/.config/agentos/secrets.env</span>) reach every agent session and job as environment variables; sign-ins live with the service's own tool (like <span class="ui-mono">gh</span>), which agents use directly.</p>
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
      ${c.signin ? `<div class="signin" id="signin"></div>` : ''}
      ${c.signin ? `<details class="token-way"${c.method === 'token' ? ' open' : ''}><summary>${c.method === 'token' ? 'Connected with a token' : 'Use a token instead'}</summary><div class="ui-stack" style="gap:18px; margin-top: 14px">` : ''}
      <div class="ui-callout">${ui.icon('info', 'sm')}<div class="ui-prose" style="font-size:var(--text-sm)">${ui.markdown(c.help || '')}</div></div>
      ${(c.fields || []).map((f) => `<div class="ui-field"><label>${ui.esc(f.label)}</label>
        <input name="${f.key}" ${f.secret ? 'type="password" autocomplete="off"' : ''} placeholder="${ui.esc(f.placeholder || '')}" value="${ui.esc(c.values?.[f.key] || '')}" class="${f.secret ? 'ui-mono' : ''}">
        <span class="hint ui-mono">$${f.key}</span></div>`).join('')}
      ${c.signin ? `<div><button class="ui-btn" type="button" data-x="save">${c.method === 'token' ? 'Save token' : 'Test and connect'}</button></div></div></details>` : ''}
      <div class="result"></div>
      ${c.mcp ? `<label class="ui-hstack mcp-row" style="gap:10px;font-size:var(--text-sm);align-items:flex-start"><input type="checkbox" class="ui-switch" name="mcp" ${c.mcpEnabled ? 'checked' : ''} ${c.connected ? '' : 'disabled'}>
        <span>Give agents its MCP tools<span class="ui-muted" style="display:block;font-size:var(--text-xs)">${ui.esc(c.mcp.note || '')} New chats pick this up.</span></span></label>` : ''}
    </form>
    <footer>${c.connected ? `<button class="ui-btn ghost" data-x="disconnect" style="margin-right:auto;color:var(--danger)">Disconnect</button><button class="ui-btn" data-x="test">Test</button>` : ''}
      ${c.signin ? '' : `<button class="ui-btn primary" data-x="save">${c.connected ? 'Save' : 'Test and connect'}</button>`}</footer>`;
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
      if (x === 'disconnect' && confirm(`Disconnect ${c.name}? ${c.method === 'signin' ? 'This signs the machine out.' : 'Its keys are removed from this machine.'}`)) { await api.del(`api/connections/${c.id}`); ui.toast(`${c.name} disconnected`); await load(); d.close(); }
    } catch (err) { show({ ok: false, output: err.message }); }
    btn.disabled = false;
  });
  f.mcp?.addEventListener('change', async () => { await api.post(`api/connections/${c.id}/mcp`, { enabled: f.mcp.checked }).catch((err) => ui.toast(err.message)); load(); });
  f.addEventListener('submit', (e) => { e.preventDefault(); d.querySelector('[data-x="save"]').click(); });
  if (c.signin) renderSignin(d, c, show);
  d.addEventListener('close', () => { d.remove(); clearTimeout(d._poll); if (location.hash.startsWith('#/connections/')) history.replaceState(null, '', '#/connections'); });
  d.showModal();
}

/* ---------- Sign-in (device code): start, show the code, wait for approval ---------- */
function renderSignin(d, c, show) {
  const box = d.querySelector('#signin');
  const paint = (st) => {
    if (c.method === 'signin' && (!st || st.state === 'idle' || st.state === 'done')) {
      box.innerHTML = `<div class="ui-card pad signin-done">${ui.icon('circle-check')}<div><b>${ui.esc(c.lastTest?.output || 'Signed in')}</b><span class="ui-muted">With the ${ui.esc(c.name)} sign-in on this machine. Agents and jobs use it.</span></div></div>`;
      return;
    }
    if (!st || st.state === 'idle' || st.state === 'failed' || st.state === 'cancelled') {
      box.innerHTML = `<div class="ui-card pad signin-start"><div><b>${ui.esc(c.signin.label)}</b><p class="ui-muted">${ui.esc(c.signin.note || '')}</p></div>
        <button class="ui-btn primary" type="button" data-s="start">${ui.icon(c.icon || 'log-in', 'sm')}${ui.esc(c.signin.label)}</button></div>`;
      if (st?.state === 'failed') show({ ok: false, output: st.output });
      return;
    }
    if (st.state === 'starting') { box.innerHTML = `<div class="ui-card pad"><span class="ui-shimmer">${ui.esc(st.step || 'Starting the sign-in')}</span></div>`; return; }
    box.innerHTML = `<div class="ui-card pad signin-code">
      <span class="ui-label">Your code</span>
      <div class="code-row"><span class="code ui-mono">${ui.esc(st.code)}</span><button class="ui-icon-btn plain" type="button" data-s="copy" title="Copy">${ui.icon('copy')}</button></div>
      <a class="ui-btn primary" href="${ui.esc(st.url)}" target="_blank" rel="noopener">${ui.icon('external-link', 'sm')}Open ${ui.esc(st.url.replace(/^https:\/\//, ''))}</a>
      <p class="ui-muted">Enter the code there and approve. <span class="ui-shimmer">Waiting for you</span></p>
      <button class="ui-link-action" type="button" data-s="cancel">Cancel</button></div>`;
  };
  const poll = async () => {
    const st = await api.get(`api/connections/${c.id}/signin`).catch(() => null);
    if (st?.state === 'done') { ui.toast(`${c.name} connected`); await load(); d.close(); return; }
    paint(st);
    if (st && (st.state === 'starting' || st.state === 'waiting')) d._poll = setTimeout(poll, 2000);
  };
  box.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-s]')?.dataset.s;
    if (a === 'start') { paint({ state: 'starting' }); paint(await api.post(`api/connections/${c.id}/signin`).catch((err) => ({ state: 'failed', output: err.message }))); clearTimeout(d._poll); d._poll = setTimeout(poll, 2000); }
    if (a === 'copy') navigator.clipboard?.writeText(box.querySelector('.code').textContent).then(() => ui.toast('Code copied'));
    if (a === 'cancel') { clearTimeout(d._poll); await api.del(`api/connections/${c.id}/signin`).catch(() => {}); paint({ state: 'idle' }); }
  });
  api.get(`api/connections/${c.id}/signin`).then((st) => { paint(st); if (st.state === 'starting' || st.state === 'waiting') d._poll = setTimeout(poll, 2000); }).catch(() => paint(null));
}

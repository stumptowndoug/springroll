// Connections: what agents can reach. Services (sign-ins and service keys from the catalog) and
// Keys (every NAME=value secret, including ones agents asked for). Values stay on this machine.
import { api, on } from './api.js';

let el, ctx, list = [], tab = 'services', keys = { keys: [], managed: [], requests: [] }, revealed = {}, editing = null, adding = false;

export function init(root, c) {
  el = root; ctx = c;
  el.addEventListener('click', onClick);
  el.addEventListener('submit', onKeySubmit);
  on('signals', () => { if (el.closest('.shown') && tab === 'keys') loadKeys(); });
  on('desk:connections', () => { if (el.closest('.shown') && !document.querySelector('dialog[open]') && !el.contains(document.activeElement?.closest('form'))) load(); });
}
export async function show(_el, r) {
  tab = r.q?.tab === 'keys' ? 'keys' : 'services';
  revealed = {}; editing = null; adding = !!r.q?.add;
  await load();
  if (r.name) { const c = list.find((x) => x.id === r.name); if (c) openSheet(c); }
}
export function title() { return 'Connections'; }

async function load() {
  try { list = await api.get('api/connections'); } catch (e) { list = []; }
  if (tab === 'keys') await loadKeys(false);
  render();
}
async function loadKeys(paint = true) {
  keys = await api.get('api/secrets').catch(() => keys);
  if (paint) render();
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
  const head = `<header class="ui-heading"><div><span class="ui-eyebrow">What your agents can reach</span><h1 class="ui-display">Connections.</h1></div>
      <div class="actions">${tab === 'keys' ? `<button class="ui-btn primary" data-k="add">${ui.icon('plus', 'sm')}Add a key</button>` : ''}</div></header>
    <div class="ui-seg conn-tabs" role="tablist"><a href="#/connections" class="${tab === 'services' ? 'on' : ''}" role="tab">Services</a><a href="#/connections?tab=keys" class="${tab === 'keys' ? 'on' : ''}" role="tab">Keys${keys.requests.length ? ' <span class="ui-dot warn"></span>' : ''}</a></div>`;
  if (tab === 'keys') { ui.morph(el, `<div class="ui-page connections">${head}${keysView()}</div>`); el.querySelector('[data-focus]')?.focus(); return; }
  ui.morph(el, `<div class="ui-page connections">${head}
    <p class="ui-muted lede">Keys and sign-ins stay on this machine, never in git. Keys reach every new agent session and job as environment variables; sign-ins live with the service's own tool (like <span class="ui-mono">gh</span>), which agents use directly.</p>
    ${connected.length ? `<section class="ui-section"><header><span class="ui-label">Connected</span></header><div class="ui-grid" style="--min:250px">${connected.map(card).join('')}</div></section>` : ''}
    ${cats.map((cat) => `<section class="ui-section"><header><span class="ui-label">${ui.esc(cat)}</span></header>
      <div class="ui-grid" style="--min:250px">${list.filter((c) => !c.connected && c.category === cat).map(card).join('')}</div></section>`).join('')}
    <section class="ui-section"><div class="ui-card pad other-conn">
      <span class="conn-icon">${ui.icon('plus', 'lg')}</span>
      <div><b>Something else?</b><p class="ui-muted">Any service with an API works. Ask the agent to connect it: it will tell you which key to create, save it, and add it to this list.</p></div>
      <a class="ui-btn" href="#/new?text=${encodeURIComponent('Help me connect ')}">Ask the agent</a></div></section>
  </div>`);
}

function onClick(e) {
  const k = e.target.closest('[data-k]');
  if (k) return onKeyClick(k);
  const b = e.target.closest('[data-id]');
  if (b) { const c = list.find((x) => x.id === b.dataset.id); if (c) openSheet(c); }
}

/* ---------- Keys ---------- */
function keysView() {
  const { keys: list, managed, requests } = keys;
  const open = requests.filter((q) => !q.have);
  const keyForm = (name, focus) => `<form class="key-form" data-key-form="${name || ''}">
      ${name ? '' : `<label><span>Name</span><input class="ui-input ui-mono" name="name" placeholder="OPENAI_API_KEY" autocomplete="off" spellcheck="false" ${focus ? 'data-focus' : ''}></label>`}
      <label><span>Value</span><input class="ui-input ui-mono" name="value" type="password" placeholder="Paste the key" autocomplete="off" ${name && focus ? 'data-focus' : ''}></label>
      ${name ? '' : '<label><span>Note</span><input class="ui-input" name="note" placeholder="What it is for (optional)" autocomplete="off"></label>'}
      <div class="key-form-actions"><button class="ui-btn sm primary">Save</button><button class="ui-btn quiet muted" type="button" data-k="cancel">Cancel</button></div></form>`;
  return `<p class="ui-muted lede">Every key is an environment variable (<span class="ui-mono">$NAME</span>) in new agent sessions and jobs, stored only on this machine
      and masked in chat timelines. Agents ask for one with <span class="ui-mono">secret request</span> instead of having you paste it into a chat.</p>
    ${open.length ? `<section class="ui-section"><header><span class="ui-label">Asked for by agents</span></header><div class="need-list">${open.map((q) => `
      <article class="ui-card need-card"><span class="need-icon">${ui.icon('key-round')}</span><div class="need-main">
        <div class="need-head"><b class="ui-mono">${ui.esc(q.name)}</b><span class="ui-mono need-when">${ui.esc(ui.ago(q.at))}</span></div>
        <span class="need-sub">${ui.esc(q.why || '')}${q.from ? ` · ${ui.esc(q.from)}` : ''}</span>
        <div class="need-actions"><form class="need-reply" data-key-form="${q.name}"><label class="ui-sr-only" for="kr-${q.name}">Value for ${q.name}</label>
          <input class="ui-input ui-mono" id="kr-${q.name}" name="value" type="password" placeholder="Paste ${ui.esc(q.name)}" autocomplete="off"><button class="ui-btn sm primary">Save</button></form>
          ${q.thread ? `<a class="ui-btn quiet" href="#/t/${q.thread}">Open chat</a>` : ''}</div>
      </div></article>`).join('')}</div></section>` : ''}
    ${adding ? `<section class="ui-section"><div class="ui-card pad">${keyForm(null, true)}</div></section>` : ''}
    <section class="ui-section"><header><span class="ui-label">Keys</span><span class="ui-mono ui-muted count">${list.length}</span></header>
      ${list.length ? `<div class="ui-group">${list.map((k) => `
        <div class="ui-row key-row">
          <div class="body"><span class="title ui-mono">${ui.esc(k.name)}</span>
            <span class="sub">${[k.connectionName ? `${ui.esc(k.connectionName)} connection` : ui.esc(k.note), k.usedBy.length ? `used by ${ui.esc(k.usedBy.join(', '))}` : ''].filter(Boolean).join(' · ') || '<span class="ui-faint">No note</span>'}</span>
            ${editing === k.name ? keyForm(k.name, true) : ''}</div>
          <span class="key-value ui-mono">${revealed[k.name] != null ? ui.esc(revealed[k.name]) : ui.esc(k.hint)}</span>
          <span class="meta">${k.updated ? ui.esc(ui.ago(k.updated)) : ''}</span>
          <div class="key-actions">
            <button class="ui-btn quiet muted" data-k="reveal" data-name="${k.name}">${revealed[k.name] != null ? 'Hide' : 'Reveal'}</button>
            <button class="ui-btn quiet muted" data-k="edit" data-name="${k.name}">Replace</button>
            ${k.connection ? '' : `<button class="ui-btn quiet muted danger-text" data-k="delete" data-name="${k.name}">Delete</button>`}
          </div></div>`).join('')}</div>`
      : `<div class="ui-empty"><h2>No keys yet.</h2><p>Add one, or connect a service. Agents can also ask you for one.</p></div>`}</section>
    ${managed.length ? `<section class="ui-section"><header><span class="ui-label">Sign-ins Springroll keeps</span></header><div class="ui-group">${managed.map((m) => `
      <div class="ui-row"><span class="lead">${ui.icon('lock', 'sm')}</span><div class="body"><span class="title">${ui.esc(m.name)}</span><span class="sub">${ui.esc(m.note)}</span></div>
        <span class="meta">${ui.esc(ui.ago(m.updated))}</span></div>`).join('')}</div></section>` : ''}`;
}

async function onKeyClick(b) {
  const a = b.dataset.k, name = b.dataset.name;
  try {
    if (a === 'add') { adding = true; editing = null; return render(); }
    if (a === 'cancel') { adding = false; editing = null; return render(); }
    if (a === 'edit') { editing = editing === name ? null : name; adding = false; return render(); }
    if (a === 'reveal') {
      if (revealed[name] != null) delete revealed[name];
      else revealed[name] = (await api.post(`api/secrets/${name}/reveal`)).value;
      return render();
    }
    if (a === 'delete' && confirm(`Delete ${name}? Apps and jobs that use it stop working until it's added again.`)) {
      await api.del(`api/secrets/${name}`); ui.toast(`Deleted ${name}`); await loadKeys();
    }
  } catch (err) { ui.toast(err.message, { icon: 'circle-alert' }); }
}

async function onKeySubmit(e) {
  const f = e.target.closest('[data-key-form]');
  if (!f) return;
  e.preventDefault();
  const name = f.dataset.keyForm || f.elements.name.value.trim().toUpperCase();
  const value = f.elements.value.value;
  if (!value) return f.elements.value.focus();
  f.querySelectorAll('button,input').forEach((x) => (x.disabled = true));
  try {
    await api.post('api/secrets', { name, value, note: f.elements.note?.value });
    ui.toast(`Saved ${name}`, { icon: 'check' });
    adding = false; editing = null; delete revealed[name];
    await loadKeys();
  } catch (err) { f.querySelectorAll('button,input').forEach((x) => (x.disabled = false)); ui.toast(err.message, { icon: 'circle-alert' }); }
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

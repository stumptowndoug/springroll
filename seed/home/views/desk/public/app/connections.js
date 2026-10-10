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
  // Back from "Sign in with Google" (google.mjs's callback): say how it went.
  if (r.q?.signed) ui.toast(r.q.warn ? `Signed in as ${r.q.signed}, but Gmail didn't open: ${r.q.warn}` : `Added ${r.q.signed}`, { icon: r.q.warn ? 'circle-alert' : 'check' });
  if (r.q?.error) ui.toast(r.q.error, { icon: 'circle-alert' });
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
    ? `<span class="ui-status"><span class="ui-dot ${c.lastTest && !c.lastTest.ok ? 'danger' : 'ok'}"></span>${c.lastTest && !c.lastTest.ok ? 'Failing' : c.accountCount ? `${c.accountCount} account${c.accountCount === 1 ? '' : 's'}` : 'Connected'}</span>`
    : `<span class="ui-faint">${ui.esc(c.category || 'Not connected')}</span>`;
  return `<button class="ui-tile" data-id="${c.id}">
    <span class="lead">${ui.icon(c.icon || 'plug', 'lg')}</span>
    <span class="title">${ui.esc(c.name)}</span>
    <span class="desc">${ui.esc(c.description)}</span>
    <span class="foot">${status}${c.mcpEnabled ? '<span class="acts"><span class="ui-badge">MCP</span></span>' : ''}</span></button>`;
}

const NEW_CONN = `#/new?text=${encodeURIComponent('Connect Springroll to ')}`;

function render() {
  const connected = list.filter((c) => c.connected), available = list.filter((c) => !c.connected);
  const head = `<header class="ui-heading"><div><span class="ui-eyebrow">What your agents can reach</span><h1 class="ui-display">Connections.</h1></div>
      <div class="actions">${tab === 'keys' ? `<button class="ui-btn primary" data-k="add">${ui.icon('plus', 'sm')}Add a key</button>` : `<a class="ui-btn primary" href="${NEW_CONN}">${ui.icon('plus', 'sm')}New connection</a>`}</div></header>
    <p class="ui-lede">Services your agents can use, and the keys they use them with. Everything stays on this machine, never in git.</p>
    <div class="ui-pagebar"><div class="ui-seg" role="tablist"><a href="#/connections" class="${tab === 'services' ? 'on' : ''}" role="tab">Services</a><a href="#/connections?tab=keys" class="${tab === 'keys' ? 'on' : ''}" role="tab">Keys${keys.requests.length ? '<span class="ui-dot warn"></span>' : ''}</a></div></div>`;
  if (tab === 'keys') { ui.morph(el, `<div class="ui-page connections">${head}${keysView()}</div>`); el.querySelector('[data-focus]')?.focus(); return; }
  ui.morph(el, `<div class="ui-page connections">${head}
    ${connected.length ? `<section class="ui-section"><header><span class="ui-label">Connected</span><span class="ui-mono ui-muted count">${connected.length}</span></header><div class="ui-tiles">${connected.map(card).join('')}</div></section>` : ''}
    ${available.length ? `<section class="ui-section"><header><span class="ui-label">Available</span></header><div class="ui-tiles">${available.map(card).join('')}</div>
      <p class="ui-note">Any service with an API works: <a href="${NEW_CONN}">chat with an agent</a> to connect it. It tells you which key to create, saves it, and adds the service here.</p></section>` : ''}
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
  return `    ${open.length ? `<section class="ui-section"><header><span class="ui-label">Asked for by agents</span></header><div class="ui-tasks">${open.map((q) => `
      <div class="ui-task open"><span class="lead">${ui.icon('key-round')}</span>
        <div class="body"><div class="head"><b class="ui-mono">${ui.esc(q.name)}</b><span class="when">${ui.esc(ui.ago(q.at))}</span></div>
          <span class="sub">${ui.esc(q.why || '')}${q.from ? ` · ${ui.esc(q.from)}` : ''}</span></div>
        <div class="acts">${q.thread ? `<a class="ui-btn sm" href="#/t/${q.thread}">${ui.icon('message-square', 'sm')}Chat</a>` : ''}</div>
        <div class="drawer"><form data-key-form="${q.name}"><label class="ui-sr-only" for="kr-${q.name}">Value for ${q.name}</label>
          <input class="ui-input ui-mono" id="kr-${q.name}" name="value" type="password" placeholder="Paste ${ui.esc(q.name)}" autocomplete="off"><button class="ui-btn sm primary">Save</button></form></div>
      </div>`).join('')}</div></section>` : ''}
    ${adding ? `<section class="ui-section"><div class="ui-card pad">${keyForm(null, true)}</div></section>` : ''}
    <section class="ui-section"><header><span class="ui-label">Keys</span><span class="ui-mono ui-muted count">${list.length}</span></header>
      ${list.length ? `<div class="ui-group">${list.map((k) => `
        <div class="ui-row key-row">
          <div class="body"><span class="title ui-mono">${ui.esc(k.name)}</span>
            <span class="sub">${[k.connectionName ? `${ui.esc(k.connectionName)} connection` : ui.esc(k.note), k.usedBy.length ? `used by ${ui.esc(k.usedBy.join(', '))}` : ''].filter(Boolean).join(' · ') || '<span class="ui-faint">No note</span>'}</span>
            ${revealed[k.name] != null ? `<span class="key-revealed ui-mono">${ui.esc(revealed[k.name])}</span>` : ''}
            ${editing === k.name ? keyForm(k.name, true) : ''}</div>
          <span class="key-value ui-mono">${ui.esc(k.hint)}</span>
          <span class="meta">${k.updated ? ui.esc(ui.ago(k.updated)) : ''}</span>
          <div class="key-actions">
            <button class="ui-btn quiet muted" data-k="reveal" data-name="${k.name}">${revealed[k.name] != null ? 'Hide' : 'Reveal'}</button>
            <button class="ui-btn quiet muted" data-k="edit" data-name="${k.name}">Replace</button>
            <button class="ui-icon-btn plain" data-k="more" data-name="${k.name}" title="More" aria-label="More for ${ui.esc(k.name)}">${ui.icon('ellipsis', 'sm')}</button>
          </div></div>`).join('')}</div>`
      : `<div class="ui-empty"><div class="orbit"></div><h2>No keys yet.</h2><p>Add one, or connect a service. Agents can also ask you for one.</p></div>`}
      <p class="ui-note">Every key is an environment variable (<span class="ui-mono">$NAME</span>) in new agent sessions and jobs, stored only on this machine
        and masked in chat timelines. Agents ask for one with <span class="ui-mono">secret request</span> instead of having you paste it into a chat.</p></section>
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
    if (a === 'more') {
      const k = keys.keys.find((x) => x.name === name);
      const m = document.createElement('div');
      m.className = 'ui-menu';
      m.innerHTML = `<button data-x="copy">${ui.icon('copy')}Copy name</button>${k?.connection ? '' : `<hr><button class="danger" data-x="delete">${ui.icon('trash-2')}Delete key</button>`}`;
      m.onclick = (ev) => { const x = ev.target.closest('[data-x]')?.dataset.x; ui.closePopover(); if (x === 'copy') { navigator.clipboard?.writeText(name); ui.toast('Copied'); } if (x === 'delete') onKeyClick({ dataset: { k: 'delete', name } }); };
      ui.popover(b, m, { temp: true, align: 'end' });
      return;
    }
    if (a === 'delete' && await ui.confirm(`Delete ${name}?`, { body: "Apps and jobs that use it stop working until it's added again.", ok: 'Delete', danger: true })) {
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
  if (c.accounts) return accountsSheet(c);
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
      if (x === 'disconnect' && await ui.confirm(`Disconnect ${c.name}?`, { body: c.method === 'signin' ? 'This signs the machine out.' : 'Its keys are removed from this machine.', ok: 'Disconnect', danger: true })) { await api.del(`api/connections/${c.id}`); ui.toast(`${c.name} disconnected`); await load(); d.close(); }
    } catch (err) { show({ ok: false, output: err.message }); }
    btn.disabled = false;
  });
  f.mcp?.addEventListener('change', async () => { await api.post(`api/connections/${c.id}/mcp`, { enabled: f.mcp.checked }).catch((err) => ui.toast(err.message)); load(); });
  f.addEventListener('submit', (e) => { e.preventDefault(); d.querySelector('[data-x="save"]').click(); });
  if (c.signin) renderSignin(d, c, show);
  d.addEventListener('close', () => { d.remove(); clearTimeout(d._poll); if (location.hash.startsWith('#/connections/')) history.replaceState(null, '', '#/connections'); });
  d.showModal();
}

/* ---------- Gmail: accounts (app passwords by default, Sign in with Google as the fallback) ---------- */
function accountsSheet(c) {
  const d = document.createElement('dialog');
  d.className = 'ui-sheet conn-sheet';
  const redirect = `${location.origin}/api/google/callback`;
  let g = { accounts: [], client: null }, busy = false;
  const paint = () => {
    d.innerHTML = `
      <div class="ui-toolbar"><span class="conn-icon sm">${ui.icon(c.icon || 'mail')}</span><span class="ui-title">${ui.esc(c.name)}</span><div class="ui-spacer"></div><button class="ui-icon-btn plain" data-close aria-label="Close">${ui.icon('x')}</button></div>
      <div class="body ui-stack" style="gap:20px">
        <p class="ui-muted">Add each Gmail account you want Mail and agents to read. Passwords and sign-ins stay on this machine.</p>
        ${g.accounts.length ? `<div class="ui-group">${g.accounts.map((a) => `
          <div class="ui-row acct-row"><span class="lead">${ui.icon(a.method === 'google' ? 'log-in' : 'key-round', 'sm')}</span>
            <div class="body"><span class="title">${ui.esc(a.email)}</span>
              <span class="sub">${a.method === 'google' ? 'Signed in with Google' : 'App password'}${a.lastTest ? ` · <span class="ui-dot ${a.lastTest.ok ? 'ok' : 'danger'}"></span> ${ui.esc(a.lastTest.ok ? 'Working' : a.lastTest.output || 'Failing')}` : ''}</span></div>
            <button class="ui-btn quiet muted" data-g="test" data-email="${ui.esc(a.email)}">Test</button>
            <button class="ui-btn quiet danger" data-g="remove" data-email="${ui.esc(a.email)}">Remove</button></div>`).join('')}</div>` : ''}
        ${g.accounts.length ? `<div class="ui-card pad" style="display:flex;align-items:center;gap:14px">
          <div style="flex:1"><b style="font-weight:600">When an agent sends email</b><p class="ui-muted" style="font-size:var(--text-sm);margin-top:2px">${g.policy?.send === 'ask' ? 'It shows you the email in the chat and sends only after you say yes.' : 'Agents reply, send and archive for you. Replies land in Gmail\'s Sent as usual.'}</p></div>
          <div class="ui-seg"><button type="button" data-g="policy-auto" aria-pressed="${g.policy?.send !== 'ask'}">Send right away</button><button type="button" data-g="policy-ask" aria-pressed="${g.policy?.send === 'ask'}">Ask me first</button></div></div>` : ''}
        <form class="ui-stack acct-add" data-g-form="add" style="gap:12px">
          <span class="ui-label">${g.accounts.length ? 'Add another account' : 'Add an account'}</span>
          <div class="ui-field"><label for="ga-email">Gmail address</label><input id="ga-email" name="email" type="email" placeholder="you@gmail.com" autocomplete="off"></div>
          <div class="ui-field"><label for="ga-pass">App password</label><input id="ga-pass" name="password" type="password" class="ui-mono" placeholder="abcd efgh ijkl mnop" autocomplete="off">
            <span class="hint">Make one at <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">myaccount.google.com/apppasswords</a> (needs 2-Step Verification). Use any name, like "Springroll".</span></div>
          <div><button class="ui-btn primary" ${busy ? 'disabled' : ''}>${busy ? 'Checking…' : 'Test and add'}</button></div>
          <div class="result"></div>
        </form>
        <details class="token-way"${g.client ? ' open' : ''}><summary>Can't make app passwords for an account? Sign in with Google instead</summary>
          <div class="ui-stack" style="gap:14px; margin-top: 14px">
            ${g.client ? `<p class="ui-muted" style="font-size:var(--text-sm)">Your Google sign-in client is set up. Sign in with each account that needs it.</p>
              <div class="ui-hstack" style="gap:8px"><button class="ui-btn primary" type="button" data-g="google">${ui.icon('log-in', 'sm')}Sign in with Google</button><button class="ui-btn quiet muted" type="button" data-g="client-edit">Change client</button></div>` : ''}
            <form class="ui-stack" data-g-form="client" style="gap:12px${g.client ? ';display:none' : ''}">
              <div class="ui-callout">${ui.icon('info', 'sm')}<div class="ui-prose" style="font-size:var(--text-sm)">
                <p>This needs your own Google sign-in client, once (about 10 minutes). Or <a href="#/new?text=${encodeURIComponent('Walk me through creating a Google OAuth client so Springroll can sign in to Gmail (Connections → Gmail → Sign in with Google).')}">ask an agent to walk you through it</a>.</p>
                <ol><li>At <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">console.cloud.google.com</a>, create a project and enable the <b>Gmail API</b>.</li>
                  <li>OAuth consent screen: <b>External</b>; add yourself as a user; then <b>Publish app</b> (otherwise Google signs you out every 7 days).</li>
                  <li>Credentials → Create OAuth client ID → <b>Web application</b>. Authorized redirect URI:<br><code class="redirect">${ui.esc(redirect)}</code> <button class="ui-btn quiet" type="button" data-g="copy">Copy</button></li>
                  <li>Paste the client ID and secret below. Google will say the app is unverified: it's yours, so continue.</li></ol></div></div>
              <div class="ui-field"><label for="gc-id">Client ID</label><input id="gc-id" name="id" class="ui-mono" placeholder="….apps.googleusercontent.com" autocomplete="off"></div>
              <div class="ui-field"><label for="gc-secret">Client secret</label><input id="gc-secret" name="secret" type="password" class="ui-mono" autocomplete="off"></div>
              <div><button class="ui-btn">Save client</button></div>
            </form>
          </div></details>
      </div>`;
  };
  const loadG = async () => { g = await api.get('api/google').catch(() => g); paint(); };
  d.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) return d.close();
    const b = e.target.closest('[data-g]');
    if (!b) return;
    const a = b.dataset.g, email = b.dataset.email;
    try {
      if (a === 'copy') { await navigator.clipboard?.writeText(redirect); ui.toast('Copied'); }
      if (a === 'policy-auto' || a === 'policy-ask') { await api.post('api/google/policy', { send: a === 'policy-ask' ? 'ask' : 'auto' }); await loadG(); }
      if (a === 'client-edit') { d.querySelector('[data-g-form="client"]').style.display = ''; }
      if (a === 'test') { b.disabled = true; const r = await api.post(`api/google/accounts/${encodeURIComponent(email)}/test`); ui.toast(r.ok ? r.output : r.output || 'Failing', { icon: r.ok ? 'check' : 'circle-alert' }); await loadG(); }
      if (a === 'remove' && await ui.confirm(`Remove ${email}?`, { body: 'Mail stops reading it; its downloaded mail is cleared at the next sync.', ok: 'Remove', danger: true })) { await api.del(`api/google/accounts/${encodeURIComponent(email)}`); await loadG(); }
      if (a === 'google') { const r = await api.post('api/google/start', { origin: location.origin }); location.href = r.url; }
    } catch (err) { b.disabled = false; ui.toast(err.message, { icon: 'circle-alert' }); }
  });
  d.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, kind = f.dataset.gForm;
    try {
      if (kind === 'add') {
        busy = true; const email = f.email.value, password = f.password.value; paint();
        const r = await api.post('api/google/accounts', { email, password });
        busy = false;
        if (r.ok) { ui.toast(`Added ${email}`); await loadG(); }
        else { paint(); const nf = d.querySelector('[data-g-form="add"]'); nf.email.value = email; nf.querySelector('.result').innerHTML = `<div class="ui-callout danger">${ui.icon('circle-alert', 'sm')}<div>${ui.esc(r.output || 'That didn\'t work')}</div></div>`; }
      }
      if (kind === 'client') { await api.post('api/google/client', { id: f.id.value, secret: f.secret.value }); ui.toast('Saved. Now sign in with Google.'); await loadG(); }
    } catch (err) { busy = false; paint(); ui.toast(err.message, { icon: 'circle-alert' }); }
  });
  d.addEventListener('close', () => { d.remove(); if (location.hash.startsWith('#/connections/')) history.replaceState(null, '', '#/connections'); load(); });
  document.body.appendChild(d);
  paint();
  d.showModal();
  loadG();
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

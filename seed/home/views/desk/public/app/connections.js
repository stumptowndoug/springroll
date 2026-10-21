// Connections: what agents can reach. Coding agents, and services (sign-ins and service keys from the
// catalog). Every NAME=value key, including ones agents asked for, is in Keys (keys.js).
import { api, on, state, agentName, defaultAgent, loadAgents } from './api.js';
import { openSignin, terminalSetup } from './signin.js';

let el, ctx, list = [];

export function init(root, c) {
  el = root; ctx = c;
  el.addEventListener('click', onClick);
  on('agents', () => { if (el.closest('.shown') && !document.querySelector('dialog[open]')) render(); });
  on('desk:connections', () => { if (el.closest('.shown') && !document.querySelector('dialog[open]') && !el.contains(document.activeElement?.closest('form'))) { loadAgents(); load(); } });
}
export async function show(_el, r) {
  await load();
  // Back from "Sign in with Google" (google.mjs's callback): say how it went.
  if (r.q?.signed) ui.toast(r.q.warn ? `Signed in as ${r.q.signed}, but Gmail didn't open: ${r.q.warn}` : `Added ${r.q.signed}`, { icon: r.q.warn ? 'circle-alert' : 'check' });
  if (r.q?.error) ui.toast(r.q.error, { icon: 'circle-alert' });
  if (r.name) { const c = list.find((x) => x.id === r.name), a = state.agents.find((x) => x.id === r.name); if (c) openSheet(c); else if (a) agentSheet(a); }
}
export function title() { return 'Connections'; }

async function load() {
  try { list = await api.get('api/connections'); } catch (e) { list = []; }
  render();
}

function card(c) {
  // The status trails the title, so a service is as compact as an app: a dot when it's simply connected, a word
  // when there's more to say (accounts, failing), nothing when it isn't connected yet.
  const failing = c.lastTest && !c.lastTest.ok;
  const status = !c.connected ? ''
    : failing ? '<span class="ui-status"><span class="ui-dot danger"></span>Failing</span>'
    : c.accountCount ? `<span class="ui-status"><span class="ui-dot ok"></span>${c.accountCount} account${c.accountCount === 1 ? '' : 's'}</span>`
    : '<span class="ui-dot ok" title="Connected" aria-label="Connected"></span>';
  return `<button class="ui-tile" data-id="${c.id}">
    <span class="top"><span class="lead">${ui.icon(c.icon || 'plug', 'lg')}</span><span class="title">${ui.esc(c.name)}</span>
      <span class="trail">${c.mcpEnabled ? '<span class="ui-badge">MCP</span>' : ''}${status}</span></span>
    <span class="desc">${ui.esc(c.description)}</span></button>`;
}

// A coding agent: the plan it signs in with, what it can do here, and the one thing it needs next. None are
// required: Install does the CLI and chat and signs in, in one go; Add chat adds a missing chat part (sizes are in
// agents.json and the API, not shown). Click it for who it's signed in as, Sign in again and Remove chat.
const mb = (n) => (n == null ? '' : n >= 1000 ? `${(n / 1024).toFixed(1)} GB` : `${n} MB`);
const chatInstalls = new Map(); // agent id -> { state, progress, message } while its chat part installs
function agentTile(a) {
  const inst = chatInstalls.get(a.id);
  const chatOk = a.acp && a.acpInstalled;
  const btn = (act, label, why) => `<button class="ui-btn sm primary" data-agent="${a.id}" data-act="${act}" title="${why}">${label}</button>`;
  // In the title's trail: a dot when it's ready, otherwise the one thing it needs next.
  const next = !a.installed ? btn(a.signin ? 'signin' : 'setup', 'Install', 'Not installed')
    : !a.signedIn ? btn(a.signin ? 'signin' : 'setup', 'Sign in', 'Needs sign-in')
    : inst?.state === 'installing' ? '<span class="ui-shimmer">Adding chat…</span>'
    : a.acp && !chatOk ? btn('add-chat', inst?.state === 'failed' ? 'Retry chat' : 'Add chat', inst?.state === 'failed' ? "Chat didn't install" : 'Terminal and jobs only')
    : chatOk && !a.chatSignedIn ? btn('chat-signin', 'Sign in', 'Chat needs sign-in')
    : '<span class="ui-dot ok" title="Ready" aria-label="Ready"></span>';
  const uses = chatOk ? 'Chat, terminal and jobs.' : 'Terminal and jobs.';
  return `<div class="ui-tile hover agent-tile" data-agent-sheet="${a.id}">
    <span class="top"><span class="lead">${ui.agentMark(a.id, a.name, 'lg')}</span><span class="title">${ui.esc(a.name)}</span><span class="trail">${next}</span></span>
    <span class="desc">${ui.esc(a.plan ? `${a.plan}. ${uses}` : uses)}</span></div>`;
}

async function addChat(a) {
  if (a.chatSignin) return openSignin(a.id, { part: 'chat', onDone: render }); // installs the runtime, then signs it in
  chatInstalls.set(a.id, { state: 'installing' }); render();
  try {
    let st = await api.post(`api/agents/${a.id}/chat`);
    while (st.state === 'installing') {
      chatInstalls.set(a.id, st); render();
      await new Promise((r) => setTimeout(r, 1500));
      st = await api.get(`api/agents/${a.id}/chat`);
    }
    if (st.state === 'failed') throw new Error(st.message || 'The install failed');
    chatInstalls.delete(a.id);
    ui.toast(`${a.name} can chat now`, { icon: 'check' });
  } catch (err) { chatInstalls.set(a.id, { state: 'failed', message: err.message }); ui.toast(err.message, { icon: 'circle-alert' }); }
  await loadAgents(); render();
}

// The chat part's version (bin/updates keeps it current; the daily Updates job), and one held back.
function chatLine(a) {
  const c = a.chat;
  if (!c) return '';
  const checked = c.checked ? ` · checked ${new Date(c.checked).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : '';
  const held = c.held ? `<br>${ui.esc(c.held.version)} held back: ${ui.esc(c.held.why)}` : '';
  return `<p class="ui-muted" style="font-size:var(--text-sm);margin:0">Chat adapter ${ui.esc(c.version)}${checked}${held}</p>`;
}

// A coding agent's sheet: who it's signed in as (GET api/agents/<id>/account, from agents.json "account"), and how.
const PLANS = { max: 'Max', pro: 'Pro', prolite: 'Pro Lite', plus: 'Plus', team: 'Team', business: 'Business', enterprise: 'Enterprise', free: 'Free' };
function agentSheet(a) {
  const d = document.createElement('dialog');
  d.className = 'ui-sheet conn-sheet';
  const removable = a.acp && a.acpInstalled && a.acpRemove;
  const paint = (acct) => {
    const who = !a.installed ? `<div class="ui-card pad signin-start"><div><b>Not installed</b><p class="ui-muted">Install adds it and signs it in, in one go.</p></div>
        <button class="ui-btn primary" type="button" data-x="signin">Install</button></div>`
      : !a.signedIn ? `<div class="ui-card pad signin-start"><div><b>Not signed in</b><p class="ui-muted">${ui.esc(a.plan || 'Sign in to use it')}.</p></div>
        <button class="ui-btn primary" type="button" data-x="signin">Sign in</button></div>`
      : `<div class="ui-card pad signin-done">${ui.icon('circle-check')}<div>${acct === undefined ? '<span class="ui-shimmer">Checking the sign-in</span>'
        : acct.account ? `<b>Signed in as ${ui.esc(acct.account)}</b>
          <span class="ui-muted">${[acct.plan && `${PLANS[acct.plan] || acct.plan} plan`, acct.method].filter(Boolean).map(ui.esc).join(' · ')}</span>`
        : `<b>${ui.esc(acct.method || 'Signed in')}</b><span class="ui-muted">${ui.esc(a.plan || '')}</span>`}</div></div>`;
    const chat = a.chatSignin && a.acpInstalled ? `<div class="ui-hstack" style="gap:8px;font-size:var(--text-sm)"><span class="ui-dot ${a.chatSignedIn ? 'ok' : 'warn'}"></span>
        <span style="flex:1">${a.chatSignedIn ? 'Chat is signed in too' : 'Chat needs its own sign-in'}</span><button class="ui-btn quiet" type="button" data-x="chat-signin">${a.chatSignedIn ? 'Sign in again' : 'Sign in'}</button></div>` : '';
    d.innerHTML = `
      <div class="ui-toolbar"><span class="conn-icon sm">${ui.agentMark(a.id, a.name)}</span><span class="ui-title">${ui.esc(a.name)}</span><div class="ui-spacer"></div><button class="ui-icon-btn plain" data-x="close" aria-label="Close">${ui.icon('x')}</button></div>
      <div class="body ui-stack" style="gap:18px">${who}${chat}${chatLine(a)}
        ${acct?.account ? '<p class="ui-note">To use a different account or subscription, sign in again with it. It replaces this one.</p>' : ''}</div>
      ${a.installed ? `<footer>${removable ? `<button class="ui-btn ghost" data-x="remove-chat" style="margin-right:auto;color:var(--danger)">Remove chat</button>` : ''}
        ${a.signedIn ? '<button class="ui-btn" data-x="signin">Sign in again</button>' : ''}</footer>` : ''}`;
  };
  d.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (!x) return;
    d.close();
    if (x === 'signin') a.signin ? openSignin(a.id, { onDone: render }) : terminalSetup(a);
    if (x === 'chat-signin') openSignin(a.id, { part: 'chat', onDone: render });
    if (x === 'remove-chat' && await ui.confirm(`Remove ${a.name}'s chat?`, { body: `Frees about ${mb(a.disk?.chat || a.size?.chat)}. ${a.name} still works in the terminal and jobs, and chat is one click to add back.`, ok: 'Remove', danger: true })) {
      try { await api.del(`api/agents/${a.id}/chat`); ui.toast(`Removed ${a.name}'s chat`); } catch (err) { ui.toast(err.message, { icon: 'circle-alert' }); }
      await loadAgents(); render();
    }
  });
  d.addEventListener('close', () => { d.remove(); if (location.hash.startsWith('#/connections/')) history.replaceState(null, '', '#/connections'); });
  document.body.appendChild(d);
  paint();
  d.showModal();
  if (a.signedIn) api.get(`api/agents/${a.id}/account`).then(paint, () => paint({}));
}

const NEW_CONN = `#/new?text=${encodeURIComponent('Connect Springroll to ')}`;

function render() {
  const connected = list.filter((c) => c.connected), available = list.filter((c) => !c.connected);
  const head = `<header class="ui-heading"><div><span class="ui-eyebrow">What your agents can reach</span><h1 class="ui-display">Connections.</h1></div>
      <div class="actions"><a class="ui-btn primary" href="${NEW_CONN}">${ui.icon('plus', 'sm')}New connection</a></div></header>
    <p class="ui-lede">Everything this machine signs in to: your coding agents' plans and the services agents can use. Their keys are in <a href="#/keys">Keys</a>.</p>`;
  const agents = state.agents;
  ui.morph(el, `<div class="ui-page connections">${head}
    ${agents.length ? `<section class="ui-section"><header><span class="ui-label">Coding agents</span><span class="ui-mono ui-muted count">${agents.length}</span><span class="ui-spacer"></span>
      <a class="agents-default" href="#/v/settings">Default for chat: <b>${ui.esc(agentName(defaultAgent()))}</b></a></header>
      <div class="ui-tiles">${agents.map(agentTile).join('')}</div></section>` : ''}
    ${connected.length ? `<section class="ui-section"><header><span class="ui-label">Connected</span><span class="ui-mono ui-muted count">${connected.length}</span></header><div class="ui-tiles">${connected.map(card).join('')}</div></section>` : ''}
    ${available.length ? `<section class="ui-section"><header><span class="ui-label">Available</span></header><div class="ui-tiles">${available.map(card).join('')}</div>
      <p class="ui-note">Any service with an API works: <a href="${NEW_CONN}">chat with an agent</a> to connect it. It tells you which key to create, saves it, and adds the service here.</p></section>` : ''}
  </div>`);
}

function onClick(e) {
  const ag = e.target.closest('[data-agent]');
  if (ag) {
    const a = state.agents.find((x) => x.id === ag.dataset.agent);
    const act = ag.dataset.act;
    if (!a) return;
    if (act === 'setup') terminalSetup(a);
    else if (act === 'add-chat') addChat(a);
    else if (act === 'chat-signin') openSignin(a.id, { part: 'chat', onDone: render });
    else openSignin(a.id, { onDone: render });
    return;
  }
  const sh = e.target.closest('[data-agent-sheet]');
  if (sh) { const a = state.agents.find((x) => x.id === sh.dataset.agentSheet); if (a) agentSheet(a); return; }
  const b = e.target.closest('[data-id]');
  if (b) { const c = list.find((x) => x.id === b.dataset.id); if (c) openSheet(c); }
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
          <div style="flex:1"><b style="font-weight:600">When an agent sends email</b><p class="ui-muted" style="font-size:var(--text-sm);margin-top:2px">${g.policy?.send !== 'auto' ? 'It shows you the email in the chat and sends only after you say yes.' : 'Agents reply, send and archive for you. Replies land in Gmail\'s Sent as usual.'}</p></div>
          <div class="ui-seg"><button type="button" data-g="policy-auto" aria-pressed="${g.policy?.send === 'auto'}">Send right away</button><button type="button" data-g="policy-ask" aria-pressed="${g.policy?.send !== 'auto'}">Ask me first</button></div></div>` : ''}
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

// Keys: every key (NAME=value) agents, apps and jobs use, keys agents asked for, and the sign-ins
// Springroll keeps. Values stay on this machine (~/.config/springroll/secrets.env), never in git.
import { api, on } from './api.js';

let el, keys = { keys: [], managed: [], requests: [], reveal: true }, revealed = {}, editing = null, adding = false, hideTimer = null;
const HIDE_AFTER = 60000; // a shown value goes back to masked after a minute

export function init(root) {
  el = root;
  el.addEventListener('click', (e) => { const k = e.target.closest('[data-k]'); if (k) onKeyClick(k); });
  el.addEventListener('submit', onKeySubmit);
  on('signals', () => { if (el.closest('.shown') && !el.contains(document.activeElement?.closest('form'))) load(); });
}
export async function show(_el, r) {
  hideAll(); editing = null; adding = !!r.q?.add;
  render();
  await load();
}
export function title() { return 'Keys'; }

async function load() {
  keys = await api.get('api/secrets').catch(() => keys);
  if (!keys.reveal) revealed = {};
  render();
}
function hideAll() { revealed = {}; clearTimeout(hideTimer); }

function render() {
  ui.morph(el, `<div class="ui-page keys">
    <header class="ui-heading"><div><span class="ui-eyebrow">Secrets and sign-ins</span><h1 class="ui-display">Keys.</h1></div>
      <div class="actions"><button class="ui-btn primary" data-k="add">${ui.icon('plus', 'sm')}Add a key</button></div></header>
    <p class="ui-lede">The keys your agents, apps and jobs use, and the sign-ins Springroll keeps. Everything here stays on this machine, never in git.</p>
    ${keysView()}</div>`);
  el.querySelector('[data-focus]')?.focus();
}

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
      ${list.length ? `<div class="ui-group">${list.map((k) => keyRow(k, keyForm)).join('')}</div>`
      : `<div class="ui-empty"><div class="orbit"></div><h2>No keys yet.</h2><p>Add one, or connect a service. Agents can also ask you for one.</p></div>`}
      <p class="ui-note">Every key is an environment variable (<span class="ui-mono">$NAME</span>) in new agent sessions and jobs, stored only on this machine
        and masked in chat timelines. Agents ask for one with <span class="ui-mono">secret request</span> instead of having you paste it into a chat.
        ${keys.reveal ? '' : 'Showing values is off (<a href="#/v/settings#keyvalues">Settings → Keys</a>).'}</p></section>
    ${managed.length ? `<section class="ui-section"><header><span class="ui-label">Sign-ins Springroll keeps</span></header><div class="ui-group">${managed.map((m) => `
      <div class="ui-row key-row"><div class="body"><span class="title">${ui.esc(m.name)}</span><span class="sub">${ui.esc(m.note)}</span></div>
        <span class="key-value ui-mono">••••</span>
        <span class="meta">${ui.esc(ui.ago(m.updated))}</span>
        <div class="key-actions">${m.reveal && keys.reveal ? showBtn(`signin:${m.file}`) : `<a class="ui-btn quiet muted" href="${m.href}">Manage</a>`}<span class="spacer"></span></div>
        ${revealedBlock(`signin:${m.file}`)}</div>`).join('')}</div>
      <p class="ui-note">Coding agents' sign-ins and services you sign in to are in <a href="#/connections">Connections</a>.</p></section>` : ''}`;
}

const showBtn = (id) => `<button class="ui-btn quiet muted" data-k="reveal" data-name="${ui.esc(id)}">${revealed[id] != null ? 'Hide' : 'Show'}</button>`;
const revealedBlock = (id) => revealed[id] == null ? '' : `<div class="key-revealed"><code class="ui-mono">${ui.esc(revealed[id])}</code>
  <button class="ui-icon-btn plain" data-k="copy" data-name="${ui.esc(id)}" title="Copy" aria-label="Copy the value">${ui.icon('copy', 'sm')}</button></div>`;

// What a key is for, then where it's used: "Browserbase connection · used by Browser, Mail triage".
function keySub(k) {
  const what = k.note ? ui.esc(k.note) : k.connectionName ? `<a href="#/connections">${ui.esc(k.connectionName)} connection</a>` : '';
  const used = k.usedBy.length ? `${what ? 'used' : 'Used'} by ${k.usedBy.map((u) => `<a href="${u.href}">${ui.esc(u.title)}</a>`).join(', ')}` : '';
  return [what, used].filter(Boolean).join(' · ') || '<span class="ui-faint">Not used by an app or job yet</span>';
}

function keyRow(k, keyForm) {
  return `<div class="ui-row key-row">
    <div class="body"><span class="title ui-mono">${ui.esc(k.name)}</span><span class="sub">${keySub(k)}</span></div>
    <span class="key-value ui-mono" title="${ui.esc(k.hint)}">${ui.esc(k.hint)}</span>
    <span class="meta">${k.updated ? ui.esc(ui.ago(k.updated)) : ''}</span>
    <div class="key-actions">${keys.reveal ? showBtn(k.name) : ''}
      <button class="ui-icon-btn plain" data-k="more" data-name="${k.name}" title="More" aria-label="More for ${ui.esc(k.name)}">${ui.icon('ellipsis', 'sm')}</button></div>
    ${revealedBlock(k.name)}
    ${editing === k.name ? keyForm(k.name, true) : ''}</div>`;
}

async function onKeyClick(b) {
  const a = b.dataset.k, name = b.dataset.name;
  try {
    if (a === 'add') { adding = true; editing = null; return render(); }
    if (a === 'cancel') { adding = false; editing = null; return render(); }
    if (a === 'edit') { editing = editing === name ? null : name; adding = false; return render(); }
    if (a === 'reveal') {
      if (revealed[name] != null) delete revealed[name];
      else {
        revealed[name] = (await api.post(name.startsWith('signin:') ? `api/secrets/signin/${name.slice(7)}/reveal` : `api/secrets/${name}/reveal`)).value;
        clearTimeout(hideTimer); hideTimer = setTimeout(() => { hideAll(); render(); }, HIDE_AFTER);
      }
      return render();
    }
    if (a === 'copy') { await navigator.clipboard?.writeText(revealed[name] ?? ''); return ui.toast('Copied', { icon: 'check' }); }
    if (a === 'more') {
      const k = keys.keys.find((x) => x.name === name);
      const m = document.createElement('div');
      m.className = 'ui-menu';
      m.innerHTML = `<button data-x="edit">${ui.icon('replace')}Replace value</button><button data-x="note">${ui.icon('pencil')}Edit note</button>
        ${keys.reveal ? `<button data-x="copyv">${ui.icon('copy')}Copy value</button>` : ''}<button data-x="copy">${ui.icon('clipboard')}Copy name</button>
        ${k?.connection ? '' : `<hr><button class="danger" data-x="delete">${ui.icon('trash-2')}Delete key</button>`}`;
      m.onclick = async (ev) => {
        const x = ev.target.closest('[data-x]')?.dataset.x; ui.closePopover();
        try {
          if (x === 'copy') { navigator.clipboard?.writeText(name); ui.toast('Copied the name', { icon: 'check' }); }
          if (x === 'copyv') { await navigator.clipboard?.writeText((await api.post(`api/secrets/${name}/reveal`)).value); ui.toast('Copied the value', { icon: 'check' }); }
          if (x === 'edit' || x === 'delete') onKeyClick({ dataset: { k: x, name } });
          if (x === 'note') {
            const note = await ui.prompt(`What is ${name} for?`, k?.note || '');
            if (note != null) { await api.post('api/secrets', { name, note }); await load(); }
          }
        } catch (err) { ui.toast(err.message, { icon: 'circle-alert' }); }
      };
      ui.popover(b, m, { temp: true, align: 'end' });
      return;
    }
    if (a === 'delete' && await ui.confirm(`Delete ${name}?`, { body: "Apps and jobs that use it stop working until it's added again.", ok: 'Delete', danger: true })) {
      await api.del(`api/secrets/${name}`); ui.toast(`Deleted ${name}`); await load();
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
    await load();
  } catch (err) { f.querySelectorAll('button,input').forEach((x) => (x.disabled = false)); ui.toast(err.message, { icon: 'circle-alert' }); }
}

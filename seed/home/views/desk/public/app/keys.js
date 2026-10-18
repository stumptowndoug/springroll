// Keys: every key (NAME=value) agents, apps and jobs use, keys agents asked for, and the sign-ins
// Springroll keeps. Values stay on this machine (~/.config/springroll/secrets.env), never in git.
import { api, on } from './api.js';

let el, keys = { keys: [], managed: [], requests: [], reveal: true }, revealed = {}, editing = null, adding = false, addName = '', addFor = '', addVar = '', filter = '', hideTimer = null;
const HIDE_AFTER = 60000; // a shown value goes back to masked after a minute

export function init(root) {
  el = root;
  el.addEventListener('click', (e) => { const k = e.target.closest('[data-k]'); if (k) onKeyClick(k); });
  el.addEventListener('submit', onKeySubmit);
  el.addEventListener('input', (e) => {
    if (e.target.matches('[data-k-filter]')) { filter = e.target.value; render(); }
    if (e.target.closest('.key-form') && e.target.name === 'name') syncVar(e.target.form);
    if (e.target.closest('.key-form') && e.target.name === 'variable') addVar = e.target.value;
  });
  el.addEventListener('change', (e) => {
    if (e.target.closest('.key-form') && e.target.name === 'project') { addFor = e.target.value; syncVar(e.target.form); }
  });
  on('signals', () => { if (el.closest('.shown') && !el.contains(document.activeElement?.closest('form'))) load(); });
}
export async function show(_el, r) {
  hideAll(); editing = null; adding = !!r.q?.add;
  // #/keys?add=NAME (the Dev app's Add) opens the form with the name filled in.
  addName = /^[A-Z_][A-Z0-9_]{0,63}$/.test(r.q?.add || '') ? r.q.add : '';
  // …&for=<project>&var=<VARIABLE>: the key is for one of the owner's projects (the Dev app's Add).
  addFor = r.q?.for || ''; addVar = /^[A-Z_][A-Z0-9_]{0,63}$/.test(r.q?.var || '') ? r.q.var : '';
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
    <p class="ui-lede">API keys and passwords for everything your agents work with. Add one here, or paste it into the card when an agent asks for one on the Timeline.${keys.reveal ? '' : ' Showing values is off (<a href="#/v/settings#keyvalues">Settings</a>).'}</p>
    ${keys.keys.length ? `<div class="ui-pagebar"><label class="ui-search"><span class="ui-sr-only">Search keys</span>${ui.icon('search', 'sm')}<input class="ui-input" type="search" data-k-filter placeholder="Search keys" value="${ui.esc(filter)}" autocomplete="off" spellcheck="false"></label></div>` : ''}
    ${keysView()}</div>`);
  el.querySelector('[data-focus]')?.focus();
}

function keysView() {
  const { keys: list, managed, requests } = keys;
  const open = requests.filter((q) => !q.have);
  const keyForm = (name, focus) => `<form class="key-form" data-key-form="${name || ''}">
      ${name ? '' : `<label><span>Name</span><input class="ui-input ui-mono" name="name" placeholder="OPENAI_API_KEY" autocomplete="off" spellcheck="false" value="${ui.esc(addName)}" ${focus && !addName ? 'data-focus' : ''}></label>`}
      <label><span>Value</span><input class="ui-input ui-mono" name="value" type="password" placeholder="Paste the key" autocomplete="off" ${(name || addName) && focus ? 'data-focus' : ''}></label>
      ${name ? '' : '<label><span>Note</span><input class="ui-input" name="note" placeholder="What it is for (optional)" autocomplete="off"></label>'}
      ${name || !(keys.projects || []).length ? '' : `<label><span>Used by</span><select class="ui-select" name="project">
          <option value="">Nothing yet</option>${keys.projects.map((p) => `<option value="${ui.esc(p.name)}" ${p.name === addFor ? 'selected' : ''}>${ui.esc(p.title)}</option>`).join('')}</select></label>
        <label class="key-var" ${addFor ? '' : 'hidden'}><span>As variable</span><input class="ui-input ui-mono" name="variable" placeholder="${ui.esc(defaultVar(addName))}" value="${ui.esc(addVar)}" autocomplete="off" spellcheck="false"></label>`}
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
    ${list.length ? groupedKeys(list, keyForm)
      : `<section class="ui-section"><div class="ui-empty"><div class="orbit"></div><h2>No keys yet.</h2><p>Add one, or connect a service. Agents can also ask you for one.</p></div></section>`}
    ${managed.length && !filter ? `<section class="ui-section"><header><span class="ui-label">Sign-ins</span></header><div class="ui-group">${managed.map((m) => `
      <div class="ui-row key-row"><div class="body"><span class="title">${ui.esc(m.name)}</span><span class="sub">${ui.esc(m.note)}</span></div>
        <span class="key-value ui-mono">••••</span>
        <div class="key-actions">${m.reveal && keys.reveal ? showBtn(`signin:${m.file}`) : `<a class="ui-btn quiet muted" href="${m.href}">Manage</a>`}<span class="spacer"></span></div>
        ${revealedBlock(`signin:${m.file}`)}</div>`).join('')}</div></section>` : ''}`;
}

// Keys in sections by what uses them, worked out on the server (secrets.mjs listSecrets: section):
// connections, the owner's apps/jobs/commands, projects (one group per project, from the Dev app's
// recipes), and nothing found. The search box sits in the page bar (render).
const SECTIONS = [['connections', 'Connections'], ['apps', 'Apps and jobs'], ['projects', 'Projects'], ['unused', 'Not used by anything here']];
function matches(k, q) {
  const hay = [k.name, k.note, k.connectionName, ...k.usedBy.flatMap((u) => [u.title, ...(u.vars || [])])].join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}
function groupedKeys(all, keyForm) {
  const list = filter ? all.filter((k) => matches(k, filter)) : all;
  if (!list.length) return `<section class="ui-section"><p class="ui-muted">No key matches “${ui.esc(filter)}”.</p></section>`;
  const rows = (ks) => `<div class="ui-group">${ks.map((k) => keyRow(k, keyForm)).join('')}</div>`;
  return SECTIONS.map(([id, label]) => {
    const ks = list.filter((k) => (k.section || 'apps') === id);
    if (!ks.length) return '';
    const body = id !== 'projects' ? rows(ks) : (keys.projectGroups || []).map((g) => {
      const gk = ks.filter((k) => k.project === g.id);
      if (!gk.length) return '';
      return `<div class="keys-project">${ui.esc(g.title)}</div>${rows(gk)}`;
    }).join('');
    return `<section class="ui-section"><header><span class="ui-label">${label}</span></header>${body}</section>`;
  }).join('');
}

const showBtn = (id) => `<button class="ui-btn quiet muted" data-k="reveal" data-name="${ui.esc(id)}">${revealed[id] != null ? 'Hide' : 'Show'}</button>`;
const revealedBlock = (id) => revealed[id] == null ? '' : `<div class="key-revealed"><code class="ui-mono">${ui.esc(revealed[id])}</code>
  <button class="ui-icon-btn plain" data-k="copy" data-name="${ui.esc(id)}" title="Copy" aria-label="Copy the value">${ui.icon('copy', 'sm')}</button></div>`;

// One short fact under a key's name (its service, the variable a project reads, or what uses it);
// the whole story on hover.
const short = (t) => t.replace(/ command$/, '');
function keyFacts(k) {
  const uses = k.usedBy.map((u) => (u.vars ? `${u.vars.join(', ')} in ${u.title}` : u.title));
  const full = [k.note, k.connectionName && `${k.connectionName} connection`, uses.length && `Used by ${uses.join(', ')}`].filter(Boolean).join(' · ');
  const list = (xs) => xs.slice(0, 2).join(', ') + (xs.length > 2 ? ` +${xs.length - 2}` : '');
  let line = '';
  if (k.section === 'connections') line = k.connectionName || '';
  else if (k.section === 'projects') {
    const group = (keys.projectGroups || []).find((g) => g.id === k.project)?.title || '';
    const inGroup = (t) => t.replace(group, '').trim() || t;
    line = list(k.usedBy.map((u) => (u.vars ? `${u.vars.join(', ')} · ${inGroup(u.title)}` : inGroup(short(u.title)))));
  } else line = k.usedBy.length ? list(k.usedBy.map((u) => short(u.title))) : k.note;
  return { line, full };
}

function keyRow(k, keyForm) {
  const f = keyFacts(k);
  return `<div class="ui-row key-row" title="${ui.esc(f.full)}">
    <div class="body"><span class="title ui-mono">${ui.esc(k.name)}</span>${f.line ? `<span class="sub">${ui.esc(f.line)}</span>` : ''}</div>
    <span class="key-value ui-mono">${ui.esc(k.hint)}</span>
    <div class="key-actions">${keys.reveal ? showBtn(k.name) : ''}
      <button class="ui-icon-btn plain" data-k="more" data-name="${k.name}" title="More" aria-label="More for ${ui.esc(k.name)}">${ui.icon('ellipsis', 'sm')}</button></div>
    ${revealedBlock(k.name)}
    ${editing === k.name ? keyForm(k.name, true) : ''}</div>`;
}

async function onKeyClick(b) {
  const a = b.dataset.k, name = b.dataset.name;
  try {
    if (a === 'add') { adding = true; addName = ''; addFor = ''; addVar = ''; editing = null; return render(); }
    if (a === 'cancel') { adding = false; addName = ''; addFor = ''; addVar = ''; editing = null; return render(); }
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

// The variable a project reads a key as: its name without the project's <PREFIX>_DEV_, unless typed.
function defaultVar(name) {
  const p = (keys.projects || []).find((x) => x.name === addFor);
  const n = (name || '').trim().toUpperCase();
  return p && n.startsWith(p.prefix) ? n.slice(p.prefix.length) : n || 'STRIPE_SECRET_KEY';
}
function syncVar(form) {
  const row = form.querySelector('.key-var');
  if (!row) return;
  row.hidden = !addFor;
  row.querySelector('input').placeholder = defaultVar(form.elements.name?.value);
}

async function onKeySubmit(e) {
  const f = e.target.closest('[data-key-form]');
  if (!f) return;
  e.preventDefault();
  const name = f.dataset.keyForm || f.elements.name.value.trim().toUpperCase();
  const value = f.elements.value.value;
  if (!value) return f.elements.value.focus();
  f.querySelectorAll('button,input,select').forEach((x) => (x.disabled = true));
  try {
    const project = f.elements.project?.value || '';
    const variable = project ? (f.elements.variable.value.trim().toUpperCase() || defaultVar(name)) : '';
    const r = await api.post('api/secrets', { name, value, note: f.elements.note?.value, ...(project ? { project, variable } : {}) });
    const title = (keys.projects || []).find((p) => p.name === project)?.title;
    if (r?.warning) ui.toast(r.warning, { icon: 'circle-alert' });
    else ui.toast(r?.used ? `Saved ${name}. ${title} reads it as $${r.used.var}` : `Saved ${name}`, { icon: 'check' });
    adding = false; addName = ''; addFor = ''; addVar = ''; editing = null; delete revealed[name];
    await load();
  } catch (err) { f.querySelectorAll('button,input,select').forEach((x) => (x.disabled = false)); ui.toast(err.message, { icon: 'circle-alert' }); }
}

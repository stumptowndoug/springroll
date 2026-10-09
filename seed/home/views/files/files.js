// Files: a finder and viewer for the machine. Folder on the left, the file on
// the right: code highlighted, Markdown rendered, changes since the last commit,
// small edits. State lives in the hash: #p=<path>&l=<from>-<to>.
const $ = (id) => document.getElementById(id);
const esc = (s) => ui.esc(s);
const api = async (path, opts) => {
  const r = await fetch('/api/files/' + path, opts);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || r.statusText), { status: r.status, data });
  return data;
};
const enc = encodeURIComponent;
const store = {
  get: (k, d) => { try { const v = localStorage.getItem('files.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem('files.' + k, JSON.stringify(v)); } catch {} },
};

const S = {
  user: 'agent', home: '', places: [],
  dir: null,          // the listing shown on the left
  file: null,         // the open file (from /read), or null when looking at a folder
  mode: null,         // preview | code | changes | table
  lines: null,        // [from, to] selected
  editor: null, dirty: false,
  hidden: store.get('hidden', false), changedOnly: false, sort: store.get('sort', 'name'), wrap: store.get('wrap', false),
};

/* ---------- Helpers ---------- */
const size = (n) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const tilde = (p) => (S.home && (p === S.home || p.startsWith(S.home + '/')) ? '~' + p.slice(S.home.length) : p);
const dirname = (p) => p.replace(/\/[^/]*$/, '') || '/';
const basename = (p) => p.split('/').filter(Boolean).pop() || '/';
const isMarkdown = (name) => /\.(md|markdown|mdx)$/i.test(name);
const CODE_EXT = /\.(m?[jt]sx?|cjs|py|sh|bash|zsh|go|rs|c|h|cpp|hpp|cs|java|kt|swift|rb|php|lua|sql|css|scss|html?|vue|svelte|astro|toml|ya?ml|ini|conf|service|timer|nix|tf|proto|zig|ex|exs|hs|ml|clj|dart|r|jl|pl)$/i;

function iconFor(e) {
  if (e.type === 'dir') return e.link ? 'folder-symlink' : 'folder';
  const n = e.name.toLowerCase();
  if (e.link) return 'file-symlink';
  if (/\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/.test(n)) return 'file-image';
  if (/\.(mp3|m4a|wav|ogg|flac)$/.test(n)) return 'file-audio';
  if (/\.(mp4|webm|mov|mkv)$/.test(n)) return 'file-video';
  if (/\.(db|sqlite3?)$/.test(n)) return 'database';
  if (/\.(zip|tar|gz|tgz|bz2|xz|zst|7z|bundle)$/.test(n)) return 'file-archive';
  if (/\.(json|jsonl|webmanifest)$/.test(n)) return 'file-json';
  if (/(^|\.)(env|pem|key|crt)$|secrets|passphrase/.test(n)) return 'file-key';
  if (/\.(md|markdown|txt|rst|log)$/.test(n) || /^(readme|license|changelog|notes)/.test(n)) return 'file-text';
  if (/\.(sh|bash|zsh)$/.test(n) || /^(makefile|dockerfile|procfile)$/.test(n)) return 'file-terminal';
  if (/\.(pdf)$/.test(n)) return 'file-type';
  if (/\.(csv|tsv|xlsx?)$/.test(n)) return 'file-spreadsheet';
  if (CODE_EXT.test(n)) return 'file-code';
  return 'file';
}

function gitDot(status) {
  if (status === 'new') return '<span class="ui-dot ok" title="New, not committed yet"></span>';
  if (status === 'deleted') return '<span class="ui-dot danger" title="Deleted"></span>';
  if (status === 'modified') return '<span class="ui-dot warn" title="Changed since the last commit"></span>';
  return '';
}
const gitWord = { new: 'New', modified: 'Changed', deleted: 'Deleted' };

/* ---------- Routing: #p=<path>&l=12-20 ---------- */
function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const l = (h.get('l') || '').match(/^(\d+)(?:-(\d+))?$/);
  return { path: h.get('p'), lines: l ? [+l[1], +(l[2] || l[1])] : null, search: h.has('search') };
}
function hashFor(path, lines) {
  return '#p=' + enc(path) + (lines ? `&l=${lines[0]}${lines[1] !== lines[0] ? '-' + lines[1] : ''}` : '');
}
async function go(path, lines) {
  if (!(await leaveEditor())) return;
  const h = hashFor(path, lines);
  if (location.hash === h) route(); else location.hash = h;
}

let routing = 0;
async function route() {
  const h = readHash();
  if (h.search) { history.replaceState(null, '', S.file ? hashFor(S.file.path) : S.dir ? hashFor(S.dir.path) : '#'); openSearch(); if (S.dir) return; }
  const target = h.path || S.places[0]?.path || S.home + '/home';
  const mine = ++routing;
  let info;
  try { info = await api('read?path=' + enc(target)); }
  catch (e) {
    if (mine !== routing) return;
    if (!S.dir) await openDir(S.places[0]?.path || S.home);
    showError(e.status === 404 ? `Nothing at ${tilde(target)}.` : e.message);
    return;
  }
  if (mine !== routing) return;
  if (info.kind === 'dir') {
    await openDir(info.path);
    if (mine !== routing) return;
    S.file = null; S.lines = null;
    renderList();
    await showFolder();
  } else {
    if (!S.dir || S.dir.path !== dirname(info.path)) await openDir(dirname(info.path));
    if (mine !== routing) return;
    const same = S.file?.path === info.path && S.file?.mtime === info.mtime;
    S.file = info;
    S.lines = h.lines;
    renderList();
    if (!same || !S.mode) S.mode = defaultMode(info);
    await showFile();
    if (h.lines) revealLine(h.lines[0]);
  }
  $('split').classList.toggle('show-detail', !!S.file);
  updateContext();
}

/* ---------- Places and crumbs ---------- */
function placeFor(p) {
  return [...S.places].sort((a, b) => b.path.length - a.path.length).find((pl) => p === pl.path || p.startsWith(pl.path === '/' ? '/' : pl.path + '/'));
}

function renderCrumbs() {
  const p = S.dir.path;
  const pl = placeFor(p) || S.places.at(-1);
  $('place').innerHTML = `${ui.icon(pl.icon)}<span>${esc(pl.label)}</span>${ui.icon('chevron-down')}`;
  const rest = p === pl.path ? [] : p.slice(pl.path === '/' ? 1 : pl.path.length + 1).split('/');
  let acc = pl.path;
  const parts = [`<button data-go="${esc(pl.path)}">${esc(pl.path === '/' ? '/' : basename(pl.path))}</button>`];
  for (const seg of rest) {
    acc = acc === '/' ? '/' + seg : acc + '/' + seg;
    parts.push(`<span class="sep">${ui.icon('chevron-right')}</span><button data-go="${esc(acc)}">${esc(seg)}</button>`);
  }
  $('crumbs').innerHTML = parts.join('');
  $('crumbs').scrollLeft = 1e6;
}

$('crumbs').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (b) go(b.dataset.go); });
$('place').addEventListener('click', () => {
  ui.combobox($('place'), {
    options: [...S.places.map((p) => ({ value: p.path, label: p.label, desc: p.display, icon: p.icon })), { value: '#recent', label: 'Recently changed', icon: 'history', group: ' ' }],
    value: placeFor(S.dir?.path || '')?.path, search: false, width: 260,
    onSelect: (v) => (v === '#recent' ? openSearch() : go(v)),
  });
});

/* ---------- The folder ---------- */
async function openDir(path) {
  S.dir = await api('list?path=' + enc(path));
  renderCrumbs();
}

function visibleEntries() {
  let list = S.dir.entries.filter((e) => (S.hidden || !e.hidden) && (!S.changedOnly || e.git));
  if (S.sort === 'modified') list = [...list].sort((a, b) => (a.type === b.type ? b.mtime - a.mtime : a.type === 'dir' ? -1 : 1));
  return list;
}

function renderList() {
  const d = S.dir;
  const list = visibleEntries();
  const hiddenCount = d.entries.filter((e) => e.hidden).length;
  const git = d.git ? `<div class="f-git">${ui.icon('git-branch')}<span>${esc(d.git.branch || 'detached')}</span>${d.git.changed ? `<span>·</span><button class="ui-link-action" id="changedToggle">${d.git.changed} changed${S.changedOnly ? ' · show all' : ''}</button>` : ''}</div>` : '';
  const rows = list.map((e) => {
    const sel = S.file ? S.file.path === e.path : false;
    const meta = e.type === 'dir' ? '' : ui.ago(e.mtime);
    return `<button class="ui-row f-row${sel ? ' selected' : ''}${e.hidden ? ' hidden-file' : ''}" data-path="${esc(e.path)}" data-type="${e.type}" title="${esc(e.name)}${e.size != null ? ' · ' + size(e.size) : ''}">
      <span class="lead">${ui.icon(iconFor(e), 'sm')}</span><span class="name">${esc(e.name)}</span>${gitDot(e.git)}<span class="meta">${meta}</span></button>`;
  }).join('');
  const empty = !list.length ? `<div class="ui-empty" style="padding: 48px 16px"><p>${S.changedOnly ? 'Nothing changed here.' : d.entries.length ? `Only hidden files here.` : 'Empty folder.'}</p>${!S.hidden && hiddenCount ? `<button class="ui-link-action" id="showHidden">Show ${hiddenCount} hidden →</button>` : ''}</div>` : '';
  $('listPane').innerHTML = `${git}<div class="ui-list f-list" id="list" role="listbox">${rows}</div>${empty}`;
  $('changedToggle')?.addEventListener('click', () => { S.changedOnly = !S.changedOnly; renderList(); });
  $('showHidden')?.addEventListener('click', () => { S.hidden = true; store.set('hidden', true); renderList(); updateFilterDot(); });
  $('listPane').querySelector('.f-row.selected')?.scrollIntoView({ block: 'nearest' });
}

$('listPane').addEventListener('click', (e) => {
  const row = e.target.closest('.f-row');
  if (row) go(row.dataset.path);
});

// Arrow keys move through the folder; Enter opens; Backspace goes up.
$('listPane').addEventListener('keydown', (e) => {
  const rows = [...$('listPane').querySelectorAll('.f-row')];
  const i = rows.indexOf(document.activeElement);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
    next?.focus();
    if (next?.dataset.type === 'file') go(next.dataset.path);
  } else if (e.key === 'Backspace' || (e.key === 'ArrowLeft' && e.altKey)) {
    e.preventDefault();
    if (S.dir.parent) go(S.dir.parent);
  }
});

function updateFilterDot() {
  const on = S.hidden || S.sort !== 'name';
  if (on) $('filterBtn').dataset.dot = ''; else delete $('filterBtn').dataset.dot;
}
$('filterBtn').addEventListener('click', () => {
  const el = document.createElement('div');
  el.className = 'ui-popover';
  el.style.padding = '14px';
  el.innerHTML = `<span class="ui-label" style="padding: 0 0 8px">Show</span>
    <div style="display:flex; gap:6px; flex-wrap:wrap"><button class="ui-chip" data-k="hidden" aria-pressed="${S.hidden}">Hidden files</button><button class="ui-chip" data-k="changed" aria-pressed="${S.changedOnly}">Changed only</button></div>
    <span class="ui-label" style="padding: 14px 0 8px">Sort by</span>
    <div class="ui-seg"><button data-sort="name" aria-pressed="${S.sort === 'name'}">Name</button><button data-sort="modified" aria-pressed="${S.sort === 'modified'}">Modified</button></div>`;
  el.addEventListener('click', (e) => {
    const c = e.target.closest('[data-k]');
    if (c) {
      const on = c.getAttribute('aria-pressed') !== 'true';
      c.setAttribute('aria-pressed', on);
      if (c.dataset.k === 'hidden') { S.hidden = on; store.set('hidden', on); } else S.changedOnly = on;
    }
    const s = e.target.closest('[data-sort]');
    if (s) { S.sort = s.dataset.sort; store.set('sort', S.sort); for (const b of s.parentElement.children) b.setAttribute('aria-pressed', b === s); }
    if (c || s) { renderList(); updateFilterDot(); }
  });
  ui.popover($('filterBtn'), el, { align: 'end', temp: true });
});

/* ---------- The detail pane ---------- */
const detail = $('detail');

function head({ title, sub = '', actions = '' }) {
  return `<header class="f-head" id="fhead">
    <button class="ui-icon-btn plain f-back" data-a="back" title="Back to the folder">${ui.icon('chevron-left')}</button>
    <div class="f-title"><h2>${title}</h2><div class="sub">${sub}</div></div>${actions}</header>`;
}

function showError(text) {
  detail.innerHTML = head({ title: 'Can’t open that' }) + `<div class="ui-empty"><span data-icon="file-x"></span><p>${esc(text)}</p></div>`;
}

async function showFolder() {
  const d = S.dir;
  const files = d.entries.filter((e) => e.type === 'file').length, dirs = d.entries.length - files;
  const sub = [`<button class="path" data-a="copy-path" title="Copy path"><bdi>${esc(d.display)}</bdi></button>`,
    `<span>${[dirs && `${dirs} folder${dirs > 1 ? 's' : ''}`, files && `${files} file${files > 1 ? 's' : ''}`].filter(Boolean).join(', ') || 'Empty'}</span>`];
  if (d.readme) {
    const r = await api('read?path=' + enc(d.readme)).catch(() => null);
    if (r?.text != null) {
      S.file = null;
      detail.innerHTML = head({ title: esc(basename(d.path)), sub: sub.join('<span>·</span>'), actions: `<button class="ui-btn quiet" data-open="${esc(r.path)}">${ui.icon('file-text', 'sm')}${esc(r.name)}</button>` })
        + `<div class="f-body"><article class="f-doc f-pad"><div class="ui-prose lg">${isMarkdown(r.name) ? await ui.document(r.text, { resolve: resolver(r.path) }) : `<pre>${esc(r.text)}</pre>`}</div></article></div>`;
      wireDoc();
      return;
    }
  }
  const recent = await api('recent').catch(() => []);
  const inHere = recent.filter((f) => f.path.startsWith(d.path === '/' ? '/' : d.path + '/')).slice(0, 12);
  const rows = (inHere.length ? inHere : recent.slice(0, 12)).map((f) =>
    `<a class="ui-row f-recent" href="${hashFor(f.path)}"><span class="lead">${ui.icon(iconFor({ type: 'file', name: f.name }), 'sm')}</span><span class="body"><span class="title">${esc(f.name)}</span><span class="sub"><bdi>${esc(tilde(dirname(f.path)))}</bdi></span></span><span class="meta">${ui.ago(f.mtime)}</span></a>`).join('');
  detail.innerHTML = head({ title: esc(basename(d.path)), sub: sub.join('<span>·</span>') })
    + `<div class="f-body f-pad">${rows ? `<section class="ui-section" style="margin-top: 14px"><span class="ui-label">${inHere.length ? 'Recently changed in here' : 'Recently changed'}</span><div class="ui-list inset f-recents">${rows}</div></section>` : '<div class="ui-empty"><div class="orbit"></div><p>Pick a file to read it here.</p></div>'}</div>`;
}

function defaultMode(f) {
  if (f.kind === 'sqlite') return 'table';
  if (f.kind !== 'text') return 'preview';
  if (isMarkdown(f.name)) return 'preview';
  return 'code';
}

function modes(f) {
  const out = [];
  if (f.kind === 'text' && isMarkdown(f.name)) out.push(['preview', 'Preview'], ['code', 'Source']);
  if (f.git?.status === 'modified') { if (!out.length) out.push(['code', 'File']); out.push(['changes', 'Changes']); }
  return out;
}

function fileHead() {
  const f = S.file;
  const sub = [`<button class="path" data-a="copy-path" title="Copy path"><bdi>${esc(tilde(dirname(f.path)))}/</bdi></button>`, `<span class="ui-mono">${size(f.size)}</span>`, `<span>${ui.ago(f.mtime)}</span>`];
  if (f.git?.status) sub.push(`<span class="ui-status">${gitDot(f.git.status)}${gitWord[f.git.status]}</span>`);
  const m = modes(f);
  const seg = m.length > 1 ? `<div class="ui-seg" id="modeSeg">${m.map(([k, label]) => `<button data-mode="${k}" aria-pressed="${S.mode === k}">${label}</button>`).join('')}</div>` : '';
  const editable = f.kind === 'text' && !f.truncated && f.writable;
  const actions = S.editor
    ? `<span class="ui-status" id="dirty">${S.dirty ? '<span class="ui-dot warn"></span>Unsaved' : 'Editing'}</span><button class="ui-btn ghost sm" data-a="cancel">${S.dirty ? 'Cancel' : 'Done'}</button><button class="ui-btn primary sm" data-a="save" ${S.dirty ? '' : 'disabled'}>Save <kbd style="background:none;box-shadow:none;color:inherit;opacity:.7">${navigator.platform.includes('Mac') ? '⌘' : 'Ctrl '}S</kbd></button>`
    : `${seg}${editable ? `<button class="ui-btn quiet" data-a="edit">${ui.icon('pencil', 'sm')}Edit</button>` : ''}
       <button class="ui-icon-btn plain" data-a="ask" title="Ask about this file (Ctrl .)">${ui.icon('sparkles')}</button>
       <button class="ui-icon-btn plain" data-a="more" title="More">${ui.icon('ellipsis')}</button>`;
  return head({ title: esc(f.name), sub: sub.join('<span>·</span>'), actions });
}

async function showFile() {
  const f = S.file;
  detail.innerHTML = fileHead() + `<div class="f-body" id="fbody"><div class="ui-loading" style="margin: 16px 22px"></div></div><div class="f-selbar" id="selbar" hidden></div>`;
  const body = $('fbody');
  const mine = f;
  let html = '';
  if (S.mode === 'changes') {
    const d = await api('diff?path=' + enc(f.path)).catch((e) => ({ error: e.message }));
    html = renderChanges(d);
  } else if (f.kind === 'text' && S.mode === 'preview' && isMarkdown(f.name)) {
    html = `<article class="f-doc f-pad"><div class="ui-prose lg">${await ui.document(f.text, { resolve: resolver(f.path) })}</div></article>`;
  } else if (f.kind === 'text') {
    html = (f.truncated ? `<div class="ui-callout attention" style="margin: 0 22px 10px">${ui.icon('triangle-alert', 'sm')}<span>Showing the first 2 MB of ${size(f.size)}.</span></div>` : '')
      + await ui.codeBlock(f.text, { file: f.name, lineNumbers: true, wordWrap: S.wrap, addLineClass: (n) => (S.lines && n >= S.lines[0] && n <= S.lines[1] ? 'sel' : null) });
  } else if (f.kind === 'image') {
    html = `<div class="f-media"><img src="${rawUrl(f.path)}" alt="${esc(f.name)}"></div>`;
  } else if (f.kind === 'audio') {
    html = `<div class="f-media"><audio controls src="${rawUrl(f.path)}"></audio></div>`;
  } else if (f.kind === 'video') {
    html = `<div class="f-media"><video controls src="${rawUrl(f.path)}"></video></div>`;
  } else if (f.kind === 'pdf') {
    html = `<div class="f-media"><div class="ui-empty"><span data-icon="file-type"></span><p>${esc(f.name)} · ${size(f.size)}</p><a class="ui-btn" href="${rawUrl(f.path)}" target="_blank" rel="noopener">${ui.icon('external-link', 'sm')}Open</a></div></div>`;
  } else if (f.kind === 'sqlite') {
    html = `<div class="f-pad" id="sqlite"><div class="ui-loading"></div></div>`;
  } else {
    html = `<div class="f-pad"><dl class="ui-facts" style="margin-top: 12px"><div><dt>Kind</dt><dd>Binary file</dd></div><div><dt>Size</dt><dd class="ui-mono">${size(f.size)}</dd></div><div><dt>Modified</dt><dd>${new Date(f.mtime).toLocaleString()}</dd></div></dl>
      <a class="ui-btn" style="margin-top: 18px" href="${rawUrl(f.path, true)}">${ui.icon('download', 'sm')}Download</a></div>`;
  }
  if (S.file !== mine) return;
  body.innerHTML = html;
  if (S.mode === 'preview' && isMarkdown(f.name)) wireDoc();
  if (f.kind === 'sqlite') showTable();
  renderSelbar();
  detail.onscroll = () => $('fhead')?.classList.toggle('lined', detail.scrollTop > 4);
}

const rawUrl = (p, download) => `/api/files/raw?path=${enc(p)}${download ? '&download=1' : ''}`;

// Relative links in a document open in Files; relative images load from disk.
function resolver(docPath) {
  const base = dirname(docPath);
  return (url, kind) => {
    const [p] = url.split(/[?#]/);
    if (!p) return null;
    const abs = p.startsWith('/') ? p : normalize(base + '/' + p);
    return kind === 'image' ? rawUrl(abs) : hashFor(abs);
  };
}
function normalize(p) {
  const out = [];
  for (const seg of p.split('/')) { if (seg === '..') out.pop(); else if (seg && seg !== '.') out.push(seg); }
  return '/' + out.join('/');
}

// In-document anchors (#install) scroll instead of routing.
function wireDoc() {
  detail.querySelectorAll('.f-doc a[href^="#"]:not([href^="#p="])').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    detail.querySelector(`[id="${CSS.escape(decodeURIComponent(a.getAttribute('href').slice(1)))}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

function renderChanges(d) {
  if (d.error) return `<div class="ui-empty"><p>${esc(d.error)}</p></div>`;
  if (!d.diff) return `<div class="ui-empty"><div class="orbit"></div><p>No changes since the last commit.</p></div>`;
  let add = 0, del = 0, o = 0, n = 0;
  const rows = [];
  for (const line of d.diff.split('\n')) {
    if (/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode)/.test(line)) continue;
    const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
    if (h) { o = +h[1]; n = +h[2]; rows.push(`<div class="l gap">${esc(line.replace(/^@@.*?@@/, '').trim() || `Line ${n}`)}</div>`); continue; }
    if (line.startsWith('\\')) continue;
    const t = line.slice(1);
    if (line[0] === '+') { add++; rows.push(`<div class="l add"><span class="n"></span><span class="n">${n++}</span><span class="t">${esc(t)}</span></div>`); }
    else if (line[0] === '-') { del++; rows.push(`<div class="l del"><span class="n">${o++}</span><span class="n"></span><span class="t">${esc(t)}</span></div>`); }
    else if (line[0] === ' ') rows.push(`<div class="l"><span class="n">${o++}</span><span class="n">${n++}</span><span class="t">${esc(t)}</span></div>`);
  }
  const since = d.lastCommit ? `<div class="f-since">${ui.icon('git-commit-horizontal', 'sm')}<span>Since <span class="ui-mono">${esc(d.lastCommit.hash)}</span> · ${esc(d.lastCommit.subject)} · ${ui.ago(d.lastCommit.at)}</span></div>` : '';
  return `${since}<div class="ui-diff f-diff"><div class="path"><span>${esc(S.file.name)}</span><span class="stats"><span class="add-n">+${add}</span> <span class="del-n">−${del}</span></span></div><div class="lines">${rows.join('')}</div></div>`;
}

async function showTable(table, offset = 0) {
  const f = S.file;
  const box = $('sqlite');
  try {
    const meta = await api(`sqlite?path=${enc(f.path)}`);
    table ??= meta.tables[0]?.name;
    if (!table) { box.innerHTML = '<div class="ui-empty"><p>No tables.</p></div>'; return; }
    const d = await api(`sqlite?path=${enc(f.path)}&table=${enc(table)}&offset=${offset}`);
    if (S.file !== f) return;
    const t = d.tables.find((x) => x.name === table);
    box.innerHTML = `<div class="ui-hstack" style="margin: 6px 0 14px; gap: 8px">
        <button class="ui-combo" id="tablePick" style="font-size: var(--text-sm); color: var(--fg)">${ui.icon('table', 'sm')}<span>${esc(table)}</span>${ui.icon('chevron-down')}</button>
        <span class="ui-muted ui-mono" style="font-size: var(--text-xs)">${(t.rows ?? 0).toLocaleString()} rows · ${d.tables.length} table${d.tables.length > 1 ? 's' : ''}</span></div>
      <div class="f-table-wrap"><table class="ui-table"><thead><tr>${d.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${d.rows.map((r) => `<tr>${r.map((v) => (v == null ? '<td class="null">null</td>' : `<td title="${esc(String(v))}">${esc(String(v))}</td>`)).join('')}</tr>`).join('')}</tbody></table></div>
      ${t.rows > 100 ? `<div class="f-pager"><button class="ui-btn sm" data-off="${Math.max(0, offset - 100)}" ${offset ? '' : 'disabled'}>Previous</button><button class="ui-btn sm" data-off="${offset + 100}" ${offset + 100 >= t.rows ? 'disabled' : ''}>Next</button><span class="ui-mono">${offset + 1}–${Math.min(offset + 100, t.rows)} of ${t.rows.toLocaleString()}</span></div>` : ''}`;
    $('tablePick').onclick = () => ui.combobox($('tablePick'), { options: d.tables.map((x) => ({ value: x.name, label: x.name, meta: x.rows != null ? x.rows.toLocaleString() : '', icon: x.type === 'view' ? 'eye' : 'table' })), value: table, onSelect: (v) => showTable(v) });
    box.querySelectorAll('[data-off]').forEach((b) => (b.onclick = () => showTable(table, +b.dataset.off)));
  } catch (e) { box.innerHTML = `<div class="ui-empty"><p>${esc(e.message)}</p></div>`; }
}

/* ---------- Selecting lines (click the line numbers; shift-click extends) ---------- */
const codeLines = () => detail.querySelectorAll('#fbody > .ui-code .pce-line');

detail.addEventListener('click', (e) => {
  const line = e.target.closest('#fbody > .ui-code .pce-line');
  if (!line || S.editor) return;
  const gutter = parseFloat(getComputedStyle(line, '::before').width) || 48;
  if (e.clientX - line.getBoundingClientRect().left > gutter) return;
  const n = [...codeLines()].indexOf(line) + 1;
  if (e.shiftKey && S.lines) S.lines = [Math.min(S.lines[0], n), Math.max(S.lines[1], n)];
  else S.lines = S.lines && S.lines[0] === n && S.lines[1] === n ? null : [n, n];
  markLines();
});

function markLines() {
  codeLines().forEach((l, i) => l.classList.toggle('sel', !!S.lines && i + 1 >= S.lines[0] && i + 1 <= S.lines[1]));
  history.replaceState(null, '', hashFor(S.file.path, S.lines));
  renderSelbar();
  updateContext();
}

function renderSelbar() {
  const bar = $('selbar');
  if (!bar) return;
  if (!S.lines || S.editor || S.mode !== 'code') { bar.hidden = true; return; }
  const [a, b] = S.lines;
  bar.hidden = false;
  bar.innerHTML = `<b>${a === b ? `Line ${a}` : `Lines ${a}–${b}`}</b>
    <button class="ui-btn sm ghost" data-a="ask">${ui.icon('sparkles', 'sm')}Ask about ${a === b ? 'it' : 'these'}</button>
    <button class="ui-btn sm ghost" data-a="copy-lines">${ui.icon('copy', 'sm')}Copy</button>
    <button class="ui-icon-btn plain" data-a="clear-lines" title="Clear">${ui.icon('x', 'sm')}</button>`;
}

function revealLine(n) {
  requestAnimationFrame(() => {
    const line = codeLines()[n - 1];
    if (!line) return;
    line.scrollIntoView({ block: 'center' });
    line.classList.add('flash');
  });
}

/* ---------- What the agent sees ("this" in the Ask panel) ---------- */
function updateContext() {
  if (!window.desk?.context) return;
  if (!S.file) { desk.context({ label: tilde(S.dir?.path || ''), note: S.dir ? `They're in the folder ${S.dir.path} in Files.` : '' }); return; }
  const l = S.lines;
  const range = l ? (l[0] === l[1] ? `:${l[0]}` : `:${l[0]}-${l[1]}`) : '';
  desk.context({
    label: S.file.name + range,
    note: `They have ${S.file.path} open in Files${l ? `, lines ${l[0]}–${l[1]} selected` : ''}${S.mode === 'changes' ? ', looking at its uncommitted changes' : ''}.`,
  });
}

/* ---------- Actions ---------- */
detail.addEventListener('click', async (e) => {
  const open = e.target.closest('[data-open]');
  if (open) return go(open.dataset.open);
  const m = e.target.closest('[data-mode]');
  if (m) { S.mode = m.dataset.mode; await showFile(); updateContext(); return; }
  const b = e.target.closest('[data-a]');
  if (!b) return;
  const f = S.file;
  switch (b.dataset.a) {
    case 'back': if (await leaveEditor()) { $('split').classList.remove('show-detail'); go(S.dir.path); } break;
    case 'copy-path': copy(f ? f.path : S.dir.path, 'Path copied'); break;
    case 'edit': startEdit(); break;
    case 'cancel': if (await leaveEditor()) showFile(); break;
    case 'save': save(); break;
    case 'ask': window.desk?.discuss ? desk.discuss() : desk.ask(`About ${f.path}`); break;
    case 'more': moreMenu(b); break;
    case 'copy-lines': {
      const text = f.text.split('\n').slice(S.lines[0] - 1, S.lines[1]).join('\n');
      copy(text, S.lines[0] === S.lines[1] ? 'Line copied' : 'Lines copied');
      break;
    }
    case 'clear-lines': S.lines = null; markLines(); break;
  }
});

function copy(text, msg) {
  navigator.clipboard?.writeText(text).then(() => ui.toast(msg), () => ui.toast('Couldn’t copy', { icon: 'x' }));
}

function editorLinks(p, line) {
  const host = location.hostname;
  if (!host || /^(localhost|127\.|\[?::1)/.test(host)) return [];
  const target = `${S.user}@${host}`;
  const at = line ? `:${line}` : '';
  return [
    ['VS Code', `vscode://vscode-remote/ssh-remote+${target}${p}${at}`],
    ['Cursor', `cursor://vscode-remote/ssh-remote+${target}${p}${at}`],
    ['Zed', `zed://ssh/${target}${p}${line ? ':' + line : ''}`],
  ];
}

function moreMenu(anchor) {
  const f = S.file;
  const el = document.createElement('div');
  el.className = 'ui-menu';
  const links = editorLinks(f.path, S.lines?.[0]);
  el.innerHTML = `
    <button data-m="copy-path">${ui.icon('copy')}Copy path</button>
    <button data-m="copy-link">${ui.icon('link')}Copy link</button>
    ${f.kind === 'text' ? `<button data-m="wrap">${ui.icon('wrap-text')}${S.wrap ? 'Don’t wrap lines' : 'Wrap lines'}</button>` : ''}
    <a href="${rawUrl(f.path, true)}">${ui.icon('download')}Download</a>
    ${links.length ? `<hr><span class="ui-label">Open in your editor</span>${links.map(([n, u]) => `<a href="${esc(u)}">${ui.icon('external-link')}${n}</a>`).join('')}` : ''}`;
  el.addEventListener('click', (e) => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (m === 'copy-path') copy(f.path, 'Path copied');
    if (m === 'copy-link') copy(`${location.origin}/#/v/files#${hashFor(f.path, S.lines).slice(1)}`, 'Link copied');
    if (m === 'wrap') { S.wrap = !S.wrap; store.set('wrap', S.wrap); showFile(); }
    if (m) ui.closePopover();
  });
  ui.popover(anchor, el, { align: 'end', temp: true });
}

/* ---------- Editing ---------- */
async function startEdit() {
  const f = S.file;
  S.mode = 'code';
  S.dirty = false;
  const body = $('fbody');
  detail.classList.add('editing');
  body.innerHTML = '<div class="f-editor" id="editorBox"></div>';
  S.editor = await ui.editor($('editorBox'), {
    value: f.text, file: f.name, wordWrap: S.wrap,
    onUpdate: (v) => { const d = v !== f.text; if (d !== S.dirty) { S.dirty = d; refreshHead(); } },
  });
  refreshHead();
  $('selbar').hidden = true;
  S.editor.textarea.focus();
  if (S.lines) {
    const pos = f.text.split('\n').slice(0, S.lines[0] - 1).join('\n').length + (S.lines[0] > 1 ? 1 : 0);
    S.editor.textarea.setSelectionRange(pos, pos);
    S.editor.lines[S.lines[0]]?.scrollIntoView({ block: 'center' });
  }
}

function refreshHead() {
  const old = $('fhead');
  if (!old) return;
  const t = document.createElement('template');
  t.innerHTML = fileHead();
  old.replaceWith(t.content.firstElementChild);
}

async function save(force = false) {
  if (!S.editor || !S.dirty) return;
  const f = S.file;
  const text = S.editor.value;
  try {
    const r = await api('write', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: f.path, text, mtime: force ? undefined : f.mtime }) });
    Object.assign(f, { text, mtime: r.mtime, size: r.size });
    S.dirty = false;
    refreshHead();
    ui.toast('Saved');
    openDir(S.dir.path).then(renderList);
    api('read?path=' + enc(f.path)).then((x) => { if (S.file === f) { f.git = x.git; refreshHead(); } }).catch(() => {});
  } catch (e) {
    if (e.status === 409) {
      const choice = await confirmDialog('This file changed on disk', 'Something else saved it while you were editing (maybe an agent). Keep your version and overwrite theirs, or load theirs and drop your edits?', [['keep', 'Keep editing', 'ghost'], ['reload', 'Load theirs', ''], ['overwrite', 'Overwrite', 'danger primary']]);
      if (choice === 'overwrite') save(true);
      if (choice === 'reload') { S.dirty = false; await leaveEditor(); S.file = null; route(); }
    } else ui.toast(e.message, { icon: 'x' });
  }
}

// Resolves true when it's fine to leave the editor (nothing unsaved, or the owner said so).
async function leaveEditor() {
  if (!S.editor) return true;
  if (S.dirty) {
    const c = await confirmDialog('Discard your changes?', `${S.file.name} has unsaved changes.`, [['stay', 'Keep editing', 'ghost'], ['discard', 'Discard', 'danger primary']]);
    if (c !== 'discard') return false;
  }
  S.editor.remove();
  S.editor = null;
  detail.classList.remove('editing');
  S.dirty = false;
  return true;
}

function confirmDialog(title, body, buttons) {
  return new Promise((resolve) => {
    const d = $('confirm');
    $('cTitle').textContent = title;
    $('cBody').textContent = body;
    $('cFoot').innerHTML = buttons.map(([v, label, cls]) => `<button class="ui-btn ${cls}" value="${v}">${label}</button>`).join('');
    $('cFoot').onclick = (e) => { const b = e.target.closest('button'); if (b) { d.close(); resolve(b.value); } };
    d.onclose = () => resolve(null);
    d.showModal();
  });
}

addEventListener('beforeunload', (e) => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- Find a file ---------- */
let searchTimer = null, results = [], active = 0;
function openSearch() {
  const d = $('search');
  if (!d.open) d.showModal();
  $('sq').value = '';
  $('sq').focus();
  runSearch();
}
async function runSearch() {
  const q = $('sq').value.trim();
  const mine = q;
  const list = q ? await api('search?q=' + enc(q)).catch(() => []) : await api('recent').catch(() => []);
  if ($('sq').value.trim() !== mine) return;
  results = list;
  active = 0;
  renderResults(q);
}
function mark(name, q) {
  const lower = name.toLowerCase();
  let qi = 0, out = '';
  for (let i = 0; i < name.length; i++) {
    if (qi < q.length && lower[i] === q[qi]) { out += `<mark>${esc(name[i])}</mark>`; qi++; } else out += esc(name[i]);
  }
  return out;
}
function renderResults(q) {
  const ql = q.toLowerCase().replace(/\s+/g, '');
  $('sres').innerHTML = (q ? '' : '<span class="ui-label">Recently changed</span>') + (results.map((r, i) =>
    `<button class="ui-option${i === active ? ' active' : ''}" data-i="${i}"><span class="tick" style="color: var(--muted)">${ui.icon(iconFor({ type: 'file', name: r.name }), 'sm')}</span>
      <span><span>${q ? mark(r.name, ql) : esc(r.name)}</span><span class="desc"><bdi>${esc(tilde(dirname(r.path)))}</bdi></span></span>${r.mtime ? `<span class="meta">${ui.ago(r.mtime)}</span>` : ''}</button>`).join('')
    || `<div class="ui-option ui-faint">${q ? 'No files match.' : 'Nothing yet.'}</div>`);
  $('sres').querySelector('.active')?.scrollIntoView({ block: 'nearest' });
}
$('sq').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 70); });
$('sq').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, Math.min(results.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1))); renderResults($('sq').value.trim()); }
  if (e.key === 'Enter' && results[active]) { e.preventDefault(); $('search').close(); go(results[active].path); }
});
$('sres').addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) { $('search').close(); go(results[+b.dataset.i].path); } });
$('sres').addEventListener('mousemove', (e) => { const b = e.target.closest('[data-i]'); if (b && +b.dataset.i !== active) { active = +b.dataset.i; for (const x of $('sres').children) x.classList.toggle('active', x === b); } });
$('search').addEventListener('click', (e) => { if (e.target === $('search')) $('search').close(); });
$('searchBtn').addEventListener('click', openSearch);

/* ---------- Keys ---------- */
addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 's' && S.editor) { e.preventDefault(); e.stopImmediatePropagation(); save(); return; }
  if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); e.stopImmediatePropagation(); openSearch(); return; }
  if (e.target.closest('input, textarea, [contenteditable], dialog')) return;
  if (e.key === 'e' && !mod && S.file && !S.editor && detail.querySelector('[data-a="edit"]')) { e.preventDefault(); startEdit(); }
  if (e.key === 'Escape' && S.lines) { S.lines = null; markLines(); }
  if (e.key === 'Backspace' && !mod && S.dir?.parent && !S.editor) { e.preventDefault(); go(S.file ? S.dir.path : S.dir.parent); }
}, true);

/* ---------- Start ---------- */
addEventListener('hashchange', route);
(async () => {
  try {
    const p = await api('places');
    Object.assign(S, { user: p.user, home: p.home, places: p.places });
  } catch {}
  updateFilterDot();
  route();
})();

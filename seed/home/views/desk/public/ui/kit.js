// Springroll kit behaviors, loaded by desk.js. Exposes window.ui:
//   ui.icon('mail', 'sm')            '<svg class="ui-icon sm">…</svg>' (any Lucide name: lucide.dev/icons)
//   ui.agentMark('claude', 'Claude Code')  a coding agent's logo (ui/logos.svg), or its initial
//   ui.toast('Saved', {icon})        transient message, bottom right
//   ui.popover(anchor, el, {align})  open any element as a popover (one shell for all floating UI)
//   ui.combobox(anchor, {options, value, search, onSelect, escape})
//                                     searchable picker; options: [{value, label, desc, meta, group, icon | lead (HTML)}]
//   ui.markdown(text)                safe HTML for agent text and reports (use inside .ui-prose); quick, built in
//   await ui.report(el, source)      draw a Rollmark report (Markdown + ```chart / ```mermaid) into el, theme-colored
//   await ui.document(text, {resolve}) full GitHub-flavored markdown for files (READMEs, docs), sanitized
//   await ui.codeBlock(text, {lang|file, lineNumbers, wordWrap})  highlighted code as HTML (.ui-code)
//   await ui.highlight(el)           highlight every <pre data-lang><code> inside el (after ui.markdown)
//   await ui.editor(el, {value, lang|file, onUpdate})  a code editor (prism-code-editor) in el
//   await ui.langFor('server.mjs')   'javascript' (the language for a file name or fence tag)
//   ui.morph(el, html)               set el's content, changing only what differs (live lists, streams)
//   ui.ago(date) '3m'  ui.duration(ms) '1m 12s'  ui.tokens(n) '3.2k'  ui.esc(s)
//   ui.initials('Ada Lovelace') 'AL'  ui.hue('key') a theme color var for avatars
// Declarative, no JS needed in the View:
//   <button data-menu="m1">…</button>  <div class="ui-menu" id="m1">…</div>
//   <button data-dialog="d1">…</button> <dialog class="ui-dialog" id="d1">… <button data-close>…</button></dialog>
//   .ui-seg buttons toggle aria-pressed; .ui-tabs buttons toggle aria-selected; .ui-chip[data-toggle] toggles aria-pressed
(() => {
  const ui = (window.ui = window.ui || {});

  ui.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Icons draw from symbols copied into this document, not from <use href="/ui/icons.svg#x">:
  // a browser paints an external <use> a frame late, so every re-render or menu would blink.
  // The sprites load once; each symbol is copied in (into <head>, out of a page's way) the
  // first time it's drawn. Until they've loaded, icons point at the files and are switched over.
  const SVGNS = 'http://www.w3.org/2000/svg';
  const sprites = { icons: null, logos: null };
  let holder = null;
  function href(kind, name) {
    const map = sprites[kind], sym = map?.get(name);
    if (!sym) return `/ui/${kind}.svg#${name}`;
    const id = `ui-${kind}-${name}`;
    if (!document.getElementById(id)) {
      if (!holder?.isConnected) {
        holder = document.createElementNS(SVGNS, 'svg');
        holder.setAttribute('aria-hidden', 'true');
        holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
        document.head.appendChild(holder);
      }
      const copy = document.importNode(sym, true);
      copy.id = id;
      holder.appendChild(copy);
    }
    return `#${id}`;
  }
  for (const kind of Object.keys(sprites)) {
    fetch(`/ui/${kind}.svg`).then((r) => r.text()).then((text) => {
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      sprites[kind] = new Map([...doc.querySelectorAll('symbol')].map((x) => [x.id, x]));
      for (const u of document.querySelectorAll(`use[href^="/ui/${kind}.svg#"]`)) u.setAttribute('href', href(kind, u.getAttribute('href').split('#')[1]));
    }).catch(() => {});
  }

  ui.icon = (name, size = '') =>
    `<svg class="ui-icon ${size}" viewBox="0 0 24 24" aria-hidden="true"><use href="${href('icons', name)}"/></svg>`;
  // A coding agent's mark (from /ui/logos.svg); an agent without one gets its initial.
  const LOGOS = new Set(['claude', 'codex', 'opencode', 'pi', 'gemini', 'grok', 'cursor']);
  ui.agentMark = (id, name = id, size = '') => LOGOS.has(id)
    ? `<svg class="ui-icon ui-logo ${size}" viewBox="0 0 24 24" role="img" aria-label="${ui.esc(name)}"><use href="${href('logos', id)}"/></svg>`
    : `<span class="ui-logo letter ${size}" aria-hidden="true">${ui.esc(String(name || '?').slice(0, 1).toUpperCase())}</span>`;

  function hydrateIcons(rootEl = document) {
    for (const el of rootEl.querySelectorAll('[data-icon]:not([data-icon-done])')) {
      el.insertAdjacentHTML('afterbegin', ui.icon(el.dataset.icon, el.dataset.iconSize || ''));
      el.dataset.iconDone = '';
    }
  }
  ui.hydrate = hydrateIcons;

  ui.toast = (text, { icon = 'check' } = {}) => {
    let box = document.querySelector('.ui-toasts');
    if (!box) { box = document.createElement('div'); box.className = 'ui-toasts'; document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'ui-toast';
    t.innerHTML = icon ? ui.icon(icon) : '';
    t.append(text);
    box.appendChild(t);
    setTimeout(() => t.remove(), 4500);
  };

  ui.ago = (d) => {
    const t = d instanceof Date ? d : new Date(typeof d === 'number' && d < 1e12 ? d * 1000 : d);
    const s = (Date.now() - t) / 1000;
    if (s < 45) return 'now';
    if (s < 3600) return Math.round(s / 60) + 'm';
    if (s < 86400) return Math.round(s / 3600) + 'h';
    if (s < 6 * 86400) return t.toLocaleDateString(undefined, { weekday: 'short' });
    return t.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: s > 300 * 86400 ? 'numeric' : undefined });
  };
  ui.time = (d) => new Date(d).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  ui.duration = (ms) => {
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  };
  ui.tokens = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? (n / 1000).toFixed(n >= 1e4 ? 0 : 1) + 'k' : String(n));
  ui.day = (d) => {
    const t = new Date(d), today = new Date();
    const diff = Math.round((new Date(today.toDateString()) - new Date(t.toDateString())) / 86400000);
    const full = t.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    return diff === 0 ? `Today · ${full}` : diff === 1 ? `Yesterday · ${full}` : full;
  };

  ui.initials = (name = '') => name.replace(/[^\p{L}\s]/gu, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  const HUES = ['--accent', '--run', '--ok', '--warn', '--danger'];
  ui.hue = (key = '') => `var(${HUES[[...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % HUES.length]})`;

  // ---------- Morph: update an element to new HTML, touching only what changed ----------
  // For anything re-rendered while live (a streaming chat, a status list): unchanged
  // nodes stay put, so icons don't blink and animations (shimmer, spinners) don't restart.
  ui.morph = (el, html) => {
    const t = document.createElement('template');
    t.innerHTML = html;
    morphChildren(el, t.content);
    return el;
  };
  function morphChildren(cur, next) {
    const a = [...cur.childNodes], b = [...next.childNodes];
    for (let i = 0; i < b.length; i++) {
      const x = a[i], y = b[i];
      if (!x) { cur.appendChild(y); continue; }
      if (x.nodeType !== y.nodeType || x.nodeName !== y.nodeName) { cur.replaceChild(y, x); continue; }
      if (x.nodeType === 3 || x.nodeType === 8) { if (x.nodeValue !== y.nodeValue) x.nodeValue = y.nodeValue; continue; }
      if (x.nodeType !== 1) continue;
      if (x.isEqualNode(y)) continue;
      for (const { name } of [...x.attributes]) if (!y.hasAttribute(name)) x.removeAttribute(name);
      for (const { name, value } of [...y.attributes]) if (x.getAttribute(name) !== value) x.setAttribute(name, value);
      if (x.tagName === 'INPUT' || x.tagName === 'TEXTAREA') continue; // never clobber what's being typed
      morphChildren(x, y);
    }
    for (let i = a.length - 1; i >= b.length; i--) a[i].remove();
  }

  // ---------- Popovers: one shell for menus, pickers, filter panels ----------
  let openPop = null;
  function place(el, anchor, align) {
    const r = anchor.getBoundingClientRect();
    el.style.left = '0px'; el.style.top = '0px';
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = align === 'end' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, innerWidth - w - 8));
    const below = r.bottom + 8, above = r.top - h - 8;
    el.style.left = left + 'px';
    el.style.top = (below + h > innerHeight - 8 && above > 8 ? above : Math.min(below, innerHeight - h - 8)) + 'px';
  }
  ui.popoverOpen = () => !!openPop;
  ui.closePopover = () => {
    if (!openPop) return;
    const { el, anchor, onClose, temp } = openPop;
    openPop = null;
    el.classList.remove('open');
    anchor?.setAttribute('aria-expanded', 'false');
    if (temp) el.remove();
    onClose?.();
  };
  ui.popover = (anchor, el, { align = 'start', onClose, temp = false } = {}) => {
    if (openPop?.el === el) return ui.closePopover();
    ui.closePopover();
    const host = anchor.closest('dialog[open]') || document.body; // inside a modal sheet, float above it
    if (el.parentElement !== host) host.appendChild(el);
    el.classList.add('open');
    anchor.setAttribute('aria-expanded', 'true');
    place(el, anchor, align);
    openPop = { el, anchor, onClose, temp };
    return el;
  };
  ui.openMenu = (menu, anchor) => ui.popover(anchor, menu);

  // ---------- Combobox ----------
  ui.combobox = (anchor, { options, value, search = options.length > 7, placeholder = 'Search', onSelect, escape, align = 'start', width } = {}) => {
    const el = document.createElement('div');
    el.className = 'ui-popover';
    el.tabIndex = -1; // without a search field the list itself takes the keys
    if (width) el.style.width = width + 'px';
    el.innerHTML = (search ? `<div class="search">${ui.icon('search', 'sm')}<input placeholder="${ui.esc(placeholder)}"></div>` : '') + '<div class="list"></div>';
    const list = el.querySelector('.list');
    const input = el.querySelector('input');
    let active = Math.max(0, options.findIndex((o) => o.value === value) + (escape ? 1 : 0)), shown = [];
    const render = () => {
      const q = (input?.value || '').toLowerCase().trim();
      shown = [...(escape ? [{ ...escape, escape: true }] : []), ...options.filter((o) => !q || `${o.label} ${o.desc || ''} ${o.group || ''}`.toLowerCase().includes(q))];
      active = Math.min(active, Math.max(0, shown.length - 1));
      let group = null, html = '';
      shown.forEach((o, i) => {
        if (o.group && o.group !== group) { group = o.group; html += `<span class="ui-label">${ui.esc(group)}</span>`; }
        html += `<button class="ui-option${o.value === value ? ' selected' : ''}${i === active ? ' active' : ''}${o.disabled ? ' disabled' : ''}" data-i="${i}"${o.disabled ? ' aria-disabled="true"' : ''}>
          <span class="tick">${o.value === value ? ui.icon('check', 'sm') : o.lead || (o.icon ? ui.icon(o.icon, 'sm') : '')}</span>
          <span style="min-width:0">${ui.esc(o.label)}${o.desc ? `<span class="desc">${ui.esc(o.desc)}</span>` : ''}</span>
          ${o.meta ? `<span class="meta">${ui.esc(o.meta)}</span>` : ''}</button>${o.escape ? '<hr>' : ''}`;
      });
      list.innerHTML = html || '<div class="ui-option ui-faint">No matches</div>';
      list.querySelector('.ui-option.active')?.scrollIntoView({ block: 'nearest' });
    };
    const pick = (i) => { const o = shown[i]; if (!o || o.disabled) return; ui.closePopover(); onSelect?.(o.value, o); };
    list.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) pick(+b.dataset.i); });
    list.addEventListener('mousemove', (e) => { const b = e.target.closest('[data-i]'); if (b && +b.dataset.i !== active) { active = +b.dataset.i; render(); } });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { active = Math.min(active + 1, shown.length - 1); render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); render(); e.preventDefault(); }
      else if (e.key === 'Enter') { pick(active); e.preventDefault(); }
    });
    input?.addEventListener('input', () => { active = 0; render(); });
    render();
    ui.popover(anchor, el, { align, temp: true });
    (input || el).focus();
    return el;
  };

  // ---------- Selects: a native <select> keeps its value, form and change events; opening it shows
  // the kit's list instead of the browser's. Phones (coarse pointers) keep the OS picker.
  // <select data-native> opts out.
  const fine = matchMedia('(pointer: fine)');
  const canEnhance = (s) => s && s.tagName === 'SELECT' && !s.multiple && !s.disabled && !s.hasAttribute('data-native') && fine.matches;
  ui.openSelect = (s) => {
    if (openPop?.anchor === s) return ui.closePopover();
    const options = [...s.options].filter((o) => !o.hidden).map((o) => ({
      value: o.value, label: o.textContent.trim(), disabled: o.disabled,
      group: o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : undefined,
    }));
    const pop = ui.combobox(s, {
      options, value: s.value, width: Math.max(s.offsetWidth, 180),
      onSelect: (v) => {
        if (v !== s.value) { s.value = v; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); }
        s.focus();
      },
    });
    return pop;
  };
  document.addEventListener('mousedown', (e) => {
    const s = e.target.closest?.('select');
    if (e.button !== 0 || !canEnhance(s)) return;
    e.preventDefault(); s.focus(); ui.openSelect(s);
  }, true);
  document.addEventListener('keydown', (e) => {
    const s = e.target;
    if (!canEnhance(s) || openPop?.anchor === s) return;
    if ([' ', 'Enter', 'ArrowDown', 'ArrowUp'].includes(e.key) && !e.metaKey && !e.ctrlKey) { e.preventDefault(); ui.openSelect(s); }
  }, true);

  // ---------- Confirm and prompt: the kit's dialog, never the browser's ----------
  // await ui.confirm('Delete Morning brief?', { body: 'Its runs stay.', ok: 'Delete', danger: true }) → true/false
  // await ui.prompt('Rename chat', current) → the text, or null
  function dialog({ title, body, ok, danger, input }) {
    return new Promise((resolve) => {
      const d = document.createElement('dialog');
      d.className = 'ui-dialog';
      d.innerHTML = `<header>${ui.esc(title)}</header>
        ${body || input != null ? `<div class="content">${body ? `<p>${ui.esc(body)}</p>` : ''}${input != null ? `<input class="ui-input" autocomplete="off" style="width:100%;margin-top:${body ? 12 : 4}px">` : ''}</div>` : ''}
        <footer><button class="ui-btn" data-v="cancel">Cancel</button><button class="ui-btn ${danger ? 'danger primary' : 'primary'}" data-v="ok">${ui.esc(ok || 'OK')}</button></footer>`;
      (document.querySelector('dialog[open]') || document.body).appendChild(d);
      const field = d.querySelector('input');
      if (field) { field.value = input; field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); d.close('ok'); } }); }
      d.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) d.close(b.dataset.v); else if (e.target === d) d.close('cancel'); });
      d.addEventListener('close', () => {
        const yes = d.returnValue === 'ok';
        resolve(input != null ? (yes ? field.value : null) : yes);
        d.remove();
      });
      d.showModal();
      if (field) { field.focus(); field.select(); } else d.querySelector('[data-v="ok"]').focus();
    });
  }
  ui.confirm = (title, { body, ok = 'OK', danger = false } = {}) => dialog({ title, body, ok, danger });
  ui.prompt = (title, value = '', { body, ok = 'Save' } = {}) => dialog({ title, body, ok, input: value });

  // ---------- Markdown (safe: everything is escaped first) ----------
  // Springroll's own routes (#/t/…, /#/v/files…) open in place: in Springroll itself, or from a View
  // (an iframe) in the window around it. A View's #anchor stays in the View. Anything else: a new tab.
  const framed = window.top !== window;
  const linkTarget = (href) => (href.startsWith('#') ? '' : href.startsWith('/#') ? (framed ? ' target="_top"' : '') : ' target="_blank" rel="noopener"');
  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`\n]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
    s = ui.esc(s);
    s = s.replace(/!\[([^\]]*)\]\(((?:https?:\/\/|\/)[^\s)]+)\)/g, '<img alt="$1" src="$2">');
    s = s.replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/|#|mailto:)[^\s)]+)\)/g, (_, t, href) => `<a href="${href}"${linkTarget(href)}>${t}</a>`);
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?'"])/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${ui.esc(codes[+i])}</code>`);
  }
  ui.markdown = (src = '') => {
    const lines = String(src).replace(/\r/g, '').split('\n');
    let html = '', i = 0;
    const isTable = (l, n) => /^\s*\|.*\|\s*$/.test(l) && /^\s*\|?\s*:?-{2,}/.test(n || '');
    while (i < lines.length) {
      const l = lines[i];
      const fence = l.match(/^\s*(```|~~~)\s*([\w+-]*)/);
      if (fence) {
        const body = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
        i++;
        html += `<pre${fence[2] ? ` data-lang="${ui.esc(fence[2])}"` : ''}><code>${ui.esc(body.join('\n'))}</code></pre>`;
        continue;
      }
      if (!l.trim()) { i++; continue; }
      const h = l.match(/^(#{1,6})\s+(.*)/);
      if (h) { const n = Math.min(h[1].length, 3); html += `<h${n}>${inline(h[2])}</h${n}>`; i++; continue; }
      if (/^\s*([-*_])\s*\1\s*\1[\s\1]*$/.test(l)) { html += '<hr>'; i++; continue; }
      if (isTable(l, lines[i + 1])) {
        const row = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const head = row(l);
        i += 2;
        let body = '';
        while (i < lines.length && /^\s*\|/.test(lines[i])) body += `<tr>${row(lines[i++]).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`;
        html += `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>`;
        continue;
      }
      if (/^\s*>/.test(l)) {
        const body = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
        html += `<blockquote>${ui.markdown(body.join('\n'))}</blockquote>`;
        continue;
      }
      const li = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)/);
      if (li) {
        const ordered = /\d/.test(li[2]);
        const base = li[1].length;
        let items = [], cur = null;
        while (i < lines.length) {
          const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)/);
          if (m && m[1].length <= base + 1) { cur = [m[3]]; items.push(cur); i++; continue; }
          if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && cur) { cur.push(lines[i].replace(/^\s{2,4}/, '')); i++; continue; }
          break;
        }
        const tag = ordered ? 'ol' : 'ul';
        html += `<${tag}>${items.map((it) => {
          const [first, ...rest] = it;
          const task = first.match(/^\[([ xX])\]\s+(.*)/);
          const head = task ? `<input type="checkbox" disabled${task[1] !== ' ' ? ' checked' : ''}> ${inline(task[2])}` : inline(first);
          return `<li>${head}${rest.length ? ui.markdown(rest.join('\n')) : ''}</li>`;
        }).join('')}</${tag}>`;
        continue;
      }
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(\s*(```|~~~|#{1,6}\s|>|[-*+]\s|\d+[.)]\s))/.test(lines[i]) && !isTable(lines[i], lines[i + 1])) para.push(lines[i++]);
      if (!para.length) { para.push(lines[i++]); }
      html += `<p>${para.map(inline).join('<br>')}</p>`;
    }
    return html;
  };

  // ---------- Code and documents (loaded on first use from /ui/vendor) ----------
  let codeMod = null, mdMod = null;
  const loadCode = () => {
    if (!document.getElementById('ui-code-css')) {
      const l = document.createElement('link');
      l.id = 'ui-code-css'; l.rel = 'stylesheet'; l.href = '/ui/vendor/code.css';
      document.head.prepend(l);
    }
    return (codeMod ??= import('/ui/vendor/code.js'));
  };
  ui.langFor = async (name) => (await loadCode()).langFor(name);
  ui.codeBlock = async (text, { lang, file, ...opts } = {}) => {
    const m = await loadCode();
    return m.render(String(text ?? ''), lang ? m.langFor(lang) || lang : m.langFor(file), opts);
  };
  ui.highlight = async (el) => {
    const blocks = [...el.querySelectorAll('pre[data-lang] > code:not([data-hl])')];
    if (!blocks.length) return;
    const m = await loadCode();
    await Promise.all(blocks.map(async (code) => {
      code.dataset.hl = '';
      const lang = m.langFor(code.parentElement.dataset.lang);
      if (lang) code.innerHTML = await m.highlight(code.textContent, lang);
    }));
  };
  ui.editor = async (el, { lang, file, ...opts } = {}) => {
    const m = await loadCode();
    return m.edit(el, { ...opts, lang: lang ? m.langFor(lang) || lang : m.langFor(file) });
  };
  // Reports: Rollmark (Markdown plus ```chart and ```mermaid blocks), what job runs publish.
  // ui.report(el, source) draws one; charts take their colors from the theme and redraw with it.
  let rmMod = null;
  const reports = new Map(); // el -> { source, mounted }
  const hex = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '').trim()); return m ? m[1] : null; };
  const mix = (a, t, b) => { // a toward b by (1 - t), like color-mix(a t%, b)
    const x = hex(a), y = hex(b);
    if (!x || !y) return a;
    return '#' + [0, 2, 4].map((i) => Math.round(parseInt(x.slice(i, i + 2), 16) * t + parseInt(y.slice(i, i + 2), 16) * (1 - t)).toString(16).padStart(2, '0')).join('');
  };
  function reportColors() {
    let t = null; try { t = window.desk?.settings ? window.desk.resolve() : null; } catch {}
    if (!t) return { theme: 'auto' };
    const c = t.colors;
    return { theme: t.appearance === 'dark' ? 'dark' : 'light', colors: {
      series: [c.accent, c.run, c.ok, c.warn, c.danger, mix(c.accent, 0.62, c.fg), mix(c.run, 0.62, c.fg), mix(c.ok, 0.62, c.fg)],
      text: c.fg, muted: mix(c.fg, 0.55, c.bg), grid: mix(c.fg, 0.1, c.bg), axis: mix(c.fg, 0.24, c.bg),
    } };
  }
  async function drawReport(el) {
    const r = reports.get(el);
    if (!r) return;
    const m = await (rmMod ??= import('/ui/vendor/rollmark.js'));
    r.mounted?.dispose();
    el.replaceChildren();
    r.mounted = await m.mount(el, r.source, reportColors()).catch(() => { el.textContent = r.source; return null; });
  }
  let themed = false;
  ui.report = async (el, source) => {
    const r = reports.get(el);
    if (r && r.source === source) return;
    reports.set(el, { source: String(source ?? ''), mounted: r?.mounted });
    el.classList.add('ui-report');
    if (!themed && window.desk?.onTheme) { themed = true; let first = true; desk.onTheme(() => { if (first) { first = false; return; } for (const [e] of reports) if (e.isConnected) drawReport(e); else reports.delete(e); }); }
    await drawReport(el);
  };

  ui.document = async (text, opts) => {
    loadCode();
    return (await (mdMod ??= import('/ui/vendor/markdown.js'))).render(text, opts);
  };

  // ---------- Declarative behaviors ----------
  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-menu]');
    if (trigger) {
      const m = document.getElementById(trigger.dataset.menu);
      if (m) { e.preventDefault(); e.stopPropagation(); ui.popover(trigger, m, { align: trigger.dataset.align || 'start' }); }
      return;
    }
    if (openPop) {
      if (e.target.closest('.ui-menu > button, .ui-menu > a')) ui.closePopover();
      else if (!openPop.el.contains(e.target) && !openPop.anchor?.contains(e.target)) ui.closePopover();
    }
    const d = e.target.closest('[data-dialog]');
    if (d) { document.getElementById(d.dataset.dialog)?.showModal(); return; }
    if (e.target.closest('[data-close]')) { e.target.closest('dialog')?.close(); return; }
    if (e.target.tagName === 'DIALOG') e.target.close();

    const seg = e.target.closest('.ui-seg > button');
    if (seg) for (const b of seg.parentElement.children) b.setAttribute('aria-pressed', b === seg);
    const tab = e.target.closest('.ui-tabs > button');
    if (tab) for (const b of tab.parentElement.children) b.setAttribute('aria-selected', b === tab);
    const chip = e.target.closest('.ui-chip[data-toggle]');
    if (chip) chip.setAttribute('aria-pressed', chip.getAttribute('aria-pressed') !== 'true');
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openPop) { ui.closePopover(); e.stopPropagation(); } }, true);
  addEventListener('resize', () => ui.closePopover());
  document.addEventListener('scroll', (e) => { if (openPop && !openPop.el.contains(e.target)) ui.closePopover(); }, true);

  const start = () => {
    hydrateIcons();
    new MutationObserver(() => hydrateIcons()).observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();

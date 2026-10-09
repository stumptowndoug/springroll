// AgentOS kit behaviors, loaded by desk.js. Exposes window.ui:
//   ui.icon('mail', 'sm')         -> '<svg class="ui-icon sm">…</svg>' (any Lucide name: lucide.dev/icons)
//   ui.toast('Saved')             -> transient message, bottom right
//   ui.ago(date)                  -> '3m', '2h', 'Oct 8'
//   ui.initials('Ada Lovelace')   -> 'AL';  ui.hue('name') -> a theme color var for avatars
// Declarative, no JS needed in the View:
//   <button data-menu="m1">…</button>  <div class="ui-menu" id="m1">…</div>
//   <button data-dialog="d1">…</button> <dialog class="ui-dialog" id="d1">… <button data-close>…</button></dialog>
//   <div class="ui-seg"> buttons toggle aria-pressed;  <div class="ui-tabs"> buttons toggle aria-selected
(() => {
  const ui = (window.ui = window.ui || {});

  ui.icon = (name, size = '') =>
    `<svg class="ui-icon ${size}" viewBox="0 0 24 24" aria-hidden="true"><use href="/ui/icons.svg#${name}"/></svg>`;

  // <i data-icon="mail"></i> placeholders become icons.
  function hydrateIcons(rootEl = document) {
    for (const el of rootEl.querySelectorAll('[data-icon]:not([data-icon-done])')) {
      el.insertAdjacentHTML('afterbegin', ui.icon(el.dataset.icon, el.dataset.iconSize || ''));
      el.dataset.iconDone = '';
    }
  }
  ui.hydrate = hydrateIcons;

  ui.toast = (text, { icon } = {}) => {
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
    if (s < 60) return 'now';
    if (s < 3600) return Math.floor(s / 60) + 'm';
    if (s < 86400) return Math.floor(s / 3600) + 'h';
    if (s < 6 * 86400) return t.toLocaleDateString(undefined, { weekday: 'short' });
    return t.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: s > 300 * 86400 ? 'numeric' : undefined });
  };

  ui.initials = (name = '') => name.replace(/[^\p{L}\s]/gu, '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  const HUES = ['--accent', '--run', '--ok', '--warn', '--danger'];
  ui.hue = (key = '') => `var(${HUES[[...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % HUES.length]})`;

  // Menus
  function closeMenus(except) {
    for (const m of document.querySelectorAll('.ui-menu.open')) if (m !== except) m.classList.remove('open');
  }
  ui.openMenu = (menu, anchor) => {
    closeMenus(menu);
    const r = anchor.getBoundingClientRect();
    menu.classList.add('open');
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
    menu.style.top = (r.bottom + 4 + h > innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4) + 'px';
  };

  document.addEventListener('click', (e) => {
    const trigger = e.target.closest('[data-menu]');
    if (trigger) {
      const m = document.getElementById(trigger.dataset.menu);
      if (m) { e.preventDefault(); m.classList.contains('open') ? m.classList.remove('open') : ui.openMenu(m, trigger); }
      return;
    }
    if (e.target.closest('.ui-menu > button, .ui-menu > a')) return closeMenus();
    if (!e.target.closest('.ui-menu')) closeMenus();

    const d = e.target.closest('[data-dialog]');
    if (d) { document.getElementById(d.dataset.dialog)?.showModal(); return; }
    if (e.target.closest('[data-close]')) { e.target.closest('dialog')?.close(); return; }
    if (e.target.tagName === 'DIALOG') e.target.close(); // click on backdrop

    const seg = e.target.closest('.ui-seg > button');
    if (seg) for (const b of seg.parentElement.children) b.setAttribute('aria-pressed', b === seg);
    const tab = e.target.closest('.ui-tabs > button');
    if (tab) for (const b of tab.parentElement.children) b.setAttribute('aria-selected', b === tab);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenus(); });

  const start = () => {
    hydrateIcons();
    new MutationObserver(() => hydrateIcons()).observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
})();

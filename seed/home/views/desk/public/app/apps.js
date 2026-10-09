// All apps: everything agents have built on this machine (folders in ~/home/views/), plus Files and
// Terminal. Each one can be kept in the sidebar or not; the sidebar shows only the ones kept there.
import { on } from './api.js';
import { allApps, inSidebar, setInSidebar } from './main.js';

let el;

export function init(root) {
  el = root;
  el.addEventListener('change', (e) => {
    const sw = e.target.closest('[data-pin]');
    if (sw) setInSidebar(sw.dataset.pin, sw.checked);
  });
  on('desk:views', () => { if (el.closest('.shown')) render(); });
  desk.onTheme(() => { if (el.closest('.shown')) render(); });
}
export function show() { render(); }
export function title() { return 'Apps'; }

function render() {
  const list = allApps();
  el.innerHTML = `<div class="ui-page apps">
    <header class="ui-heading"><div><span class="ui-eyebrow">On this machine</span><h1 class="ui-display">Apps.</h1></div>
      <div class="actions"><a class="ui-btn" href="#/v/settings#views">Templates</a><a class="ui-btn primary" href="#/new?text=${encodeURIComponent('Build me an app that ')}">${ui.icon('plus', 'sm')}Build an app</a></div></header>
    <p class="apps-lede ui-muted">Agents build these and keep them working. Choose which ones sit in the sidebar; the rest stay here.</p>
    <div class="ui-grid apps-grid">${list.map((v) => `
      <div class="ui-card app-tile">
        <a class="app-open" href="${v.hash}">
          <span class="app-icon">${ui.icon(v.icon || 'app-window', 'lg')}</span>
          <span class="app-title">${ui.esc(v.title)}${v.setupPending ? ' <span class="ui-dot warn" title="Needs setup"></span>' : ''}</span>
          <span class="app-desc">${ui.esc(v.placeholder ? 'Not built yet. Open it to have an agent build it.' : v.description || '')}</span>
        </a>
        <label class="app-pin"><input type="checkbox" class="ui-switch" data-pin="${v.name}" ${inSidebar(v) ? 'checked' : ''}><span>In sidebar</span></label>
      </div>`).join('')}
      <a class="app-new" href="#/new?text=${encodeURIComponent('Build me an app that ')}">${ui.icon('plus')}<span>Build a new app</span><span class="ui-faint">Describe it and an agent builds it</span></a>
    </div></div>`;
}

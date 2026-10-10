// All apps: everything agents have built on this machine (folders in ~/home/views/), plus Files and
// Terminal. Each one can be kept in the sidebar or not; the sidebar shows only the ones kept there.
import { api, on } from './api.js';
import { allApps, inSidebar, setInSidebar } from './main.js';

let el, templates = [];

export function init(root) {
  el = root;
  el.addEventListener('click', async (e) => {
    const tile = e.target.closest('[data-href]');
    if (tile && !e.target.closest('a, label, input, button')) return desk.go(tile.dataset.href); // the whole tile opens the app
    const b = e.target.closest('[data-add]');
    if (!b) return;
    b.disabled = true;
    try {
      const r = await api.post(`api/templates/${b.dataset.add}/add`);
      ui.toast(r.note || 'Added', { icon: 'check' });
      if (r.threadId) desk.go(`#/t/${r.threadId}`); else desk.go(`#/v/${b.dataset.add}`);
    } catch (err) { b.disabled = false; ui.toast(err.message, { icon: 'circle-alert' }); }
  });
  el.addEventListener('change', (e) => {
    const sw = e.target.closest('[data-pin]');
    if (sw) setInSidebar(sw.dataset.pin, sw.checked);
  });
  on('desk:views', () => { if (el.closest('.shown')) render(); });
  desk.onTheme(() => { if (el.closest('.shown')) render(); });
}
export async function show() {
  render();
  templates = await api.get('api/templates').catch(() => templates);
  render();
}
export function title() { return 'Apps'; }

const NEW_APP = `#/new?text=${encodeURIComponent('Build me an app that ')}`;

function render() {
  const list = allApps();
  ui.morph(el, `<div class="ui-page apps">
    <header class="ui-heading"><div><span class="ui-eyebrow">On this machine</span><h1 class="ui-display">Apps.</h1></div>
      <div class="actions"><a class="ui-btn primary" href="${NEW_APP}">${ui.icon('plus', 'sm')}New app</a></div></header>
    <p class="ui-lede">Agents build these and keep them working. Choose which ones sit in the sidebar; the rest stay here.</p>
    <div class="ui-tiles">${list.map((v) => `
      <div class="ui-tile hover" data-href="${v.hash}">
        <span class="lead">${ui.icon(v.icon || 'app-window', 'lg')}</span>
        <a class="title" href="${v.hash}">${ui.esc(v.title)}${v.setupPending ? '<span class="ui-dot warn" title="Needs setup"></span>' : ''}</a>
        <span class="desc">${ui.esc(v.placeholder ? 'Not built yet. Open it to have an agent build it.' : v.description || '')}</span>
        <span class="foot"><label><input type="checkbox" class="ui-switch" data-pin="${v.name}" ${inSidebar(v) ? 'checked' : ''}>In sidebar</label></span>
      </div>`).join('')}
    </div>
    ${templates.some((t) => !t.installed) ? `<section class="ui-section"><header><span class="ui-label">Ready to add</span></header>
      <div class="ui-tiles">${templates.filter((t) => !t.installed).map((t) => `
        <div class="ui-tile">
          <span class="lead">${ui.icon(t.icon || 'app-window', 'lg')}</span>
          <span class="title">${ui.esc(t.title)}</span><span class="desc">${ui.esc(t.description || '')}</span>
          <span class="foot"><span class="acts"><button class="ui-btn quiet" data-add="${ui.esc(t.name)}">${ui.icon('plus', 'sm')}${t.needsSetup ? 'Add and set up' : 'Add'}</button></span></span>
        </div>`).join('')}</div></section>` : ''}
  </div>`);
}

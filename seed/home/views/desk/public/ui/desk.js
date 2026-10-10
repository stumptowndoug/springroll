// Springroll bridge for Views. Load it in every View, next to the theme:
//   <link rel="stylesheet" href="/ui/theme.css"><script src="/ui/desk.js"></script>
// (These are the one exception to "use relative URLs": they live at the
// Springroll's root.) It applies the owner's appearance settings and keeps them in
// sync, loads the kit's behaviors (/ui/kit.js -> window.ui) and the owner's
// /ui/custom.css, and exposes window.desk:
//   desk.ask(text)     send a message to the agent, tagged with this View
//   desk.notify(text)  show a notification in Springroll
//   desk.open(name)    open another View
//   desk.go(hash)      navigate Springroll: '#/t/<thread>', '#/jobs', '#/new?text=…'
//   desk.context({label, note})  what the owner is looking at inside this View
//                      (a file, a message); the Ask panel shows label, the agent gets note
//   desk.discuss()     open the Ask panel beside this View
//   desk.askAbout({key, label, note})  open the chat about one item (an email, a row): agent first
//   desk.onTheme(fn)   call fn(theme) now and whenever appearance changes
(() => {
  const root = document.documentElement;
  const inDesk = window.parent !== window;
  const view = (location.pathname.match(/^\/v\/([^/]+)/) || [])[1] || null;
  const listeners = [];
  let settings = null;
  let fonts = null;

  // Kit behaviors (window.ui), loaded synchronously so a View's inline
  // scripts can use them; then the owner's overrides last.
  // custom.css goes in now too (not at DOMContentLoaded), so it never restyles a painted page.
  if (document.readyState === 'loading') document.write('<script src="/ui/kit.js"><\/script><link rel="stylesheet" href="/ui/custom.css">');
  else {
    const kit = document.createElement('script'); kit.src = '/ui/kit.js'; document.head.appendChild(kit);
    const custom = document.createElement('link'); custom.rel = 'stylesheet'; custom.href = '/ui/custom.css'; document.head.appendChild(custom);
  }

  function luminance(hex) {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  // Resolve "system" against this device's light/dark preference, and apply
  // the owner's accent override.
  function resolve(s) {
    const t = s.theme;
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const base = t.appearance === 'system'
      ? { ...t, appearance: dark ? 'dark' : 'light', colors: { ...(dark ? t.dark : t.light) } }
      : { ...t, colors: { ...t.colors } };
    if (s.accent) base.colors.accent = s.accent;
    return base;
  }

  function loadFont(entry) {
    if (!entry?.google) return;
    const id = 'font-' + entry.id;
    if (document.getElementById(id)) return;
    const l = document.createElement('link');
    l.id = id;
    l.rel = 'stylesheet';
    l.href = `https://fonts.googleapis.com/css2?family=${entry.google}&display=swap`;
    document.head.appendChild(l);
  }

  function applyFonts(s) {
    if (!fonts) return;
    const sans = fonts.sans.find((f) => f.id === s.font) || fonts.sans[0];
    const mono = fonts.mono.find((f) => f.id === s.monoFont) || fonts.mono[0];
    loadFont(sans); loadFont(mono);
    root.style.setProperty('--font-sans', sans.stack);
    root.style.setProperty('--font-mono', mono.stack);
  }

  function setAttr(name, value, fallback) {
    if (value && value !== fallback) root.dataset[name] = value; else delete root.dataset[name];
  }

  // The last appearance, kept per browser so a page or app paints in the owner's theme at once
  // instead of flashing the default until /api/settings answers.
  const CACHE = 'springroll:appearance';
  function apply(s) {
    settings = s;
    try { localStorage.setItem(CACHE, JSON.stringify({ settings: s, fonts })); } catch {}
    const t = resolve(s);
    for (const [k, v] of Object.entries(t.colors)) root.style.setProperty(`--${k}`, v);
    // White button text unless the accent is too light for it.
    const L = luminance(t.colors.accent);
    root.style.setProperty('--button-fg', 1.05 / (L + 0.05) >= 3.2 ? '#ffffff' : '#000000');
    root.style.colorScheme = t.appearance;
    root.dataset.appearance = t.appearance;
    root.dataset.theme = t.id;
    if (t.glass) root.dataset.glass = ''; else delete root.dataset.glass;
    setAttr('fontSize', s.fontSize, 'medium');
    setAttr('density', s.density, 'comfortable');
    setAttr('radius', s.radius, 'soft');
    applyFonts(s);
    for (const fn of listeners) fn(t);
  }

  async function load() {
    try {
      const [s, f] = await Promise.all([fetch('/api/settings').then((r) => r.json()), fetch('/ui/fonts.json').then((r) => r.json())]);
      fonts = f;
      apply(s);
    } catch {}
  }

  // Inside Springroll, Springroll pushes changes; standalone, listen ourselves.
  addEventListener('message', (e) => {
    if (e.source === window.parent && e.data?.type === 'desk:settings') apply(e.data.settings);
  });
  if (!inDesk) {
    try { new EventSource('/api/events').addEventListener('settings', (e) => apply(JSON.parse(e.data))); } catch {}
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => settings && apply(settings));
  try { const c = JSON.parse(localStorage.getItem(CACHE)); if (c?.settings?.theme) { fonts = c.fonts; apply(c.settings); } } catch {}
  load();

  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  window.desk = {
    view,
    get settings() { return settings; },
    get fonts() { return fonts; },
    resolve: (s) => resolve(s || settings),
    ask: (text) => post('/api/ask', { text, view }),
    notify: (text) => post('/api/notify', { text }),
    open: (name) => (inDesk ? window.parent.postMessage({ type: 'desk:open', name }, '*') : (location.href = `/v/${name}/`)),
    // Navigate Springroll itself, e.g. desk.go('#/t/<thread>') or desk.go('#/jobs').
    go: (hash) => (inDesk ? window.parent.postMessage({ type: 'desk:go', hash }, '*') : (location.href = '/' + hash)),
    save: (patch) => post('/api/settings', patch),
    context: ({ label = '', note = '' } = {}) => inDesk && window.parent.postMessage({ type: 'desk:context', label, note }, '*'),
    discuss: () => inDesk && window.parent.postMessage({ type: 'desk:discuss' }, '*'),
    // Agent first: open the chat about one thing in this View (an email, a row): {key, label, note, thread?}
    askAbout: (item) => inDesk && window.parent.postMessage({ type: 'desk:ask-about', ...item }, '*'),
    onTheme(fn) { listeners.push(fn); if (settings) fn(resolve(settings)); },
  };
})();

// AgentOS bridge for Views. Load it in every View, next to the theme:
//   <link rel="stylesheet" href="/ui/theme.css"><script src="/ui/desk.js"></script>
// (These two are the one exception to "use relative URLs": they live at the
// Desk's root.) It applies the owner's theme, keeps it in sync, and exposes
// window.desk:
//   desk.ask(text)     send a message to the agent, tagged with this View
//   desk.notify(text)  show a notification in the Desk
//   desk.open(name)    open another View
//   desk.onTheme(fn)   call fn(theme) now and whenever the theme changes
(() => {
  const root = document.documentElement;
  const inDesk = window.parent !== window;
  const view = (location.pathname.match(/^\/v\/([^/]+)/) || [])[1] || null;
  const listeners = [];
  let settings = null;

  function luminance(hex) {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  // Resolve "system" against this device's light/dark preference.
  function resolve(s) {
    const t = s.theme;
    if (t.appearance !== 'system') return { ...t, appearance: t.appearance };
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    return { ...t, appearance: dark ? 'dark' : 'light', colors: dark ? t.dark : t.light };
  }

  function apply(s) {
    settings = s;
    const t = resolve(s);
    for (const [k, v] of Object.entries(t.colors)) root.style.setProperty(`--${k}`, v);
    // White button text unless the accent is too light for it.
    const L = luminance(t.colors.accent);
    root.style.setProperty('--button-fg', (1.05 / (L + 0.05)) >= 3.5 ? '#ffffff' : '#000000');
    root.style.colorScheme = t.appearance;
    root.dataset.appearance = t.appearance;
    root.dataset.theme = t.id;
    if (t.glass) root.dataset.glass = ''; else delete root.dataset.glass;
    if (s.fontSize && s.fontSize !== 'medium') root.dataset.fontSize = s.fontSize; else delete root.dataset.fontSize;
    for (const fn of listeners) fn(t);
  }

  async function load() {
    try { apply(await (await fetch('/api/settings')).json()); } catch {}
  }

  // Inside the Desk, the Desk pushes changes; standalone, listen ourselves.
  addEventListener('message', (e) => {
    if (e.source === window.parent && e.data?.type === 'desk:settings') apply(e.data.settings);
  });
  if (!inDesk) {
    try { new EventSource('/api/events').addEventListener('settings', (e) => apply(JSON.parse(e.data))); } catch {}
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => settings && apply(settings));
  load();

  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  window.desk = {
    view,
    get settings() { return settings; },
    ask: (text) => post('/api/ask', { text, view }),
    notify: (text) => post('/api/notify', { text }),
    open: (name) => (inDesk ? window.parent.postMessage({ type: 'desk:open', name }, '*') : (location.href = `/v/${name}/`)),
    onTheme(fn) { listeners.push(fn); if (settings) fn(resolve(settings)); },
  };
})();

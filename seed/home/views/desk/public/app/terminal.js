// Terminal: tmux sessions (shells, sign-ins, any harness's own interface), each in a ttyd frame.
import { api, state, chatAgents, agentName } from './api.js';

let el, ctx, sessions = [], active = null, theme = null;
const frames = new Map();

export function init(root, c) {
  el = root; ctx = c;
  el.innerHTML = `<div class="term-page">
    <div class="term-bar"><div class="term-tabs" id="tTabs"></div><button class="ui-icon-btn plain" id="tNew" title="New session">${ui.icon('plus')}</button></div>
    <div class="term-frames" id="tFrames"></div></div>`;
  el.querySelector('#tNew').onclick = (e) => newMenu(e.currentTarget);
  el.querySelector('#tTabs').onclick = onTabClick;
  setInterval(() => { if (el.closest('.shown')) refresh(); }, 3000);
}
export async function show(_el, r) {
  await refresh();
  const want = r.session || active || sessions[0]?.name;
  if (want) open(want);
  else el.querySelector('#tFrames').innerHTML = `<div class="ui-empty"><div class="orbit"></div><h2>No sessions.</h2><p>A terminal on this machine: a shell, or any agent's own interface.</p><button class="ui-btn primary" id="tStart">${ui.icon('plus', 'sm')}New shell</button></div>`;
  el.querySelector('#tStart')?.addEventListener('click', () => create({ agent: 'shell' }));
}
export function title() { return 'Terminal'; }

async function refresh() {
  try { const r = await api.get('api/sessions'); sessions = r.sessions; state.folders = r.folders; } catch {}
  renderTabs();
}

function label(s) {
  if (s.name.startsWith('setup-')) return `Set up ${agentName(s.agent)}`;
  return s.agent ? agentName(s.agent) + s.name.slice(s.agent.length).replace('-', ' ') : s.name;
}

function renderTabs() {
  const list = sessions.find((s) => s.name === active) || !active ? sessions : [...sessions, { name: active }];
  el.querySelector('#tTabs').innerHTML = list.map((s) => `<button class="term-tab${s.name === active ? ' on' : ''}" data-s="${s.name}" title="${ui.esc(s.cwd || '')}">
    <span class="ui-dot ${s.attention ? 'warn' : s.busy ? 'run' : ''}"></span><span>${ui.esc(label(s))}</span><span class="x" data-kill="${s.name}" title="End session">${ui.icon('x', 'xs')}</span></button>`).join('');
}

function frame(name) {
  let f = frames.get(name);
  if (!f) {
    f = document.createElement('iframe');
    f.src = `term/?arg=${encodeURIComponent(name)}`;
    f.title = `Terminal ${name}`;
    f.onload = () => {
      let n = 0;
      const wait = setInterval(() => { if (!f.contentWindow?.term && ++n < 40) return; clearInterval(wait); applyTheme(f); f.contentWindow?.term?.focus(); }, 100);
    };
    el.querySelector('#tFrames').querySelector('.ui-empty')?.remove();
    el.querySelector('#tFrames').appendChild(f);
    frames.set(name, f);
  }
  return f;
}

function open(name) {
  active = name;
  for (const [n, f] of frames) f.classList.toggle('shown', n === name);
  const f = frame(name);
  f.classList.add('shown');
  setTimeout(() => { try { f.contentWindow.term?.focus(); } catch {} }, 60);
  renderTabs();
  if (location.hash !== `#/terminal/${name}`) history.replaceState(null, '', `#/terminal/${name}`);
}

async function onTabClick(e) {
  const k = e.target.closest('[data-kill]');
  if (k) {
    e.stopPropagation();
    if (!confirm(`End the session "${k.dataset.kill}"? Anything running in it stops.`)) return;
    await api.del(`api/sessions/${k.dataset.kill}`);
    frames.get(k.dataset.kill)?.remove(); frames.delete(k.dataset.kill);
    if (active === k.dataset.kill) active = null;
    await refresh();
    if (sessions[0]) open(sessions[0].name); else show(el, {});
    return;
  }
  const t = e.target.closest('[data-s]');
  if (t) open(t.dataset.s);
}

function newMenu(anchor) {
  const opts = [{ value: 'shell', label: 'Shell', desc: 'bash in ~/home', icon: 'square-terminal' },
    ...state.agents.filter((a) => a.installed).map((a) => ({ value: a.id, label: a.name, desc: a.signedIn ? 'Its own terminal interface' : 'Sign in', icon: 'bot' }))];
  ui.combobox(anchor, { options: opts, align: 'end', onSelect: (v) => create({ agent: v }) });
}

async function create(body) {
  try { const r = await api.post('api/sessions', body); await refresh(); open(r.session); }
  catch (e) { ui.toast(e.message, { icon: 'circle-alert' }); }
}

/* Terminal colors follow the theme */
function mix(a, b, share) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return '#' + x.map((v, i) => Math.round(v * share + y[i] * (1 - share)).toString(16).padStart(2, '0')).join('');
}
function termTheme(t) {
  const c = t.colors, dark = t.appearance === 'dark';
  const magenta = mix(c.accent, c.danger, 0.5), cyan = mix(c.accent, c.ok, 0.5);
  return { background: c.bg, foreground: c.fg, cursor: c.accent, cursorAccent: c.bg, selectionBackground: mix(c.accent, c.bg, 0.3),
    black: dark ? mix(c.fg, c.bg, 0.18) : c.fg, brightBlack: mix(c.fg, c.bg, dark ? 0.45 : 0.6), red: c.danger, brightRed: c.danger, green: c.ok, brightGreen: c.ok,
    yellow: c.warn, brightYellow: c.warn, blue: c.accent, brightBlue: c.accent, magenta, brightMagenta: magenta, cyan, brightCyan: cyan,
    white: dark ? mix(c.fg, c.bg, 0.8) : mix(c.fg, c.bg, 0.25), brightWhite: dark ? c.fg : mix(c.fg, c.bg, 0.1) };
}
function applyTheme(f) {
  if (!theme) return;
  try {
    const term = f.contentWindow.term;
    if (!term) return;
    term.options.theme = termTheme(theme);
    f.contentDocument.body.style.background = theme.colors.bg;
    const mono = desk.fonts?.mono.find((m) => m.id === desk.settings?.monoFont);
    if (mono) {
      if (mono.google && !f.contentDocument.getElementById('font-' + mono.id)) {
        const l = f.contentDocument.createElement('link');
        l.id = 'font-' + mono.id; l.rel = 'stylesheet'; l.href = `https://fonts.googleapis.com/css2?family=${mono.google}&display=swap`;
        f.contentDocument.head.appendChild(l);
        f.contentDocument.fonts?.ready.then(() => { term.options.fontFamily = mono.stack; });
      }
      term.options.fontFamily = mono.stack;
    }
  } catch {}
}
export function onTheme(t) { theme = t; for (const f of frames.values()) applyTheme(f); }

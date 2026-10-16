// Signing in to a coding agent, wherever the owner meets it: Connections, a "Needs you" item on the Timeline,
// a new chat with an agent that isn't signed in. Springroll runs the agent's own login (installing it
// first if needed), on this machine or a Sprite, and shows what it needs: the sign-in page, a code to
// enter there ("device"), or a box to paste the page's code back into ("paste"). part "chat": the chat
// runtime's own sign-in (Antigravity's), installing it first. Server side: views/desk/server.mjs, "Guided sign-in".
import { api, loadAgents, state, agentName } from './api.js';

const POLL_MS = 1500;
const path = (id, sprite, sub = '', part = null) => `api/agents/${id}/signin${sub}${sprite ? `?sprite=${encodeURIComponent(sprite)}` : part ? `?part=${part}` : ''}`;

// Mount the sign-in steps in el and start the sign-in. Returns { stop } (cancels it if not done).
// onDone runs once it's signed in; onState gets every state ({state: installing|waiting|done|failed}).
export function signinPanel(el, agentId, { sprite = null, part = null, onDone, onState } = {}) {
  const a = state.agents.find((x) => x.id === agentId) || { id: agentId, name: agentName(agentId) };
  let st = null, timer = null, pasted = 0, painted = '', stopped = false;
  el.classList.add('sg');
  const step = (n, html) => `<div class="sg-step"><span class="n">${n}</span><div>${html}</div></div>`;
  const target = sprite ? `<span class="sg-target">${ui.icon('cloud', 'xs')}On the <b>${ui.esc(sprite)}</b> Sprite</span>` : '';
  const paint = () => {
    const sig = JSON.stringify([st?.state, st?.url, st?.code, st?.progress, st?.message, !!pasted]);
    if (sig === painted) return;
    painted = sig;
    let body;
    if (!st || st.state === 'installing' || (st.state === 'waiting' && !st.url)) {
      body = `<p class="ui-shimmer">${st?.state === 'installing' ? `Installing ${ui.esc(a.name)}${part ? "'s chat" : ''}…` : sprite ? `Connecting to ${ui.esc(sprite)}…` : 'Getting the sign-in page…'}</p>${st?.progress ? `<p class="sg-small ui-mono">${ui.esc(st.progress)}</p>` : ''}`;
    } else if (st.state === 'done') {
      body = `<p class="sg-done">${ui.icon('circle-check')}<span><b>Signed in.</b> ${ui.esc(a.name)} ${part ? 'chats are' : 'is'} ready${sprite ? ` on ${ui.esc(sprite)}` : ''}.</span></p>`;
    } else if (st.state === 'failed') {
      body = `<p>${ui.esc(st.message || "The sign-in didn't finish.")}</p><div class="sg-acts"><button class="ui-btn sm primary" type="button" data-sg="retry">Try again</button>${st.session ? '<button class="ui-btn sm quiet" type="button" data-sg="term">Show the terminal</button>' : ''}</div>`;
    } else {
      const then = st.kind === 'device'
        ? `Enter this code on that page:<div class="sg-code-row"><span class="sg-code ui-mono">${ui.esc(st.code || '…')}</span><button class="ui-icon-btn plain" type="button" data-sg="copy" title="Copy">${ui.icon('copy')}</button></div><span class="sg-small ui-shimmer">Waiting for you to approve</span>`
        : st.kind === 'paste'
          ? `${ui.esc(st.paste || 'Paste the code the page shows you')}:<form class="sg-paste"><input class="ui-input ui-mono" name="code" autocomplete="off" spellcheck="false" placeholder="${st.paste ? 'Paste the address' : 'Paste the code'}"${pasted ? ' disabled' : ''}><button class="ui-btn sm primary"${pasted ? ' disabled' : ''}>Continue</button></form>${pasted ? '<span class="sg-small ui-shimmer">Checking the code</span>' : ''}`
          : `Approve the sign-in there. This finishes by itself.<span class="sg-small ui-shimmer">Waiting for you to approve</span>`;
      body = step(1, `<a class="ui-btn sm primary" href="${ui.esc(st.url)}" target="_blank" rel="noopener">${ui.icon('external-link', 'sm')}Open the sign-in page</a><span class="sg-small">Sign in with the account that has your ${ui.esc(a.name)} plan${part ? ' (chat signs in once, separately)' : ''}.</span>`)
        + step(2, then)
        + `<button class="ui-link-action sg-term" type="button" data-sg="term">Show the terminal</button>`;
    }
    el.innerHTML = target + body;
  };
  const poll = async () => {
    clearTimeout(timer);
    if (stopped) return;
    st = await api.get(path(a.id, sprite, '', part)).catch(() => st);
    if (stopped) return;
    if (pasted && Date.now() - pasted > 15000 && st?.state === 'waiting') pasted = 0; // not taken: try again
    paint();
    onState?.(st);
    if (st?.state === 'done') { stopped = true; loadAgents(); onDone?.(); return; }
    if (st?.state !== 'failed') timer = setTimeout(poll, POLL_MS);
  };
  const start = async () => {
    st = null; pasted = 0; paint();
    st = await api.post(path(a.id, sprite, '', part)).catch((e) => ({ state: 'failed', message: e.message }));
    paint(); onState?.(st);
    timer = setTimeout(poll, POLL_MS);
  };
  el.onsubmit = async (e) => {
    e.preventDefault();
    const code = e.target.code?.value.trim();
    if (!code) return;
    pasted = Date.now(); paint();
    await api.post(path(a.id, sprite, '/code', part), { code }).catch((err) => ui.toast(err.message, { icon: 'circle-alert' }));
  };
  el.onclick = (e) => {
    const x = e.target.closest('[data-sg]')?.dataset.sg;
    if (x === 'retry') { stopped = false; start(); }
    if (x === 'copy') navigator.clipboard?.writeText(st?.code || '').then(() => ui.toast('Code copied'));
    if (x === 'term' && st?.session) { stopped = true; clearTimeout(timer); location.hash = `#/terminal/${st.session}`; }
  };
  start();
  return {
    stop() {
      if (stopped && st?.state === 'done') return;
      const term = stopped; // left for the terminal: keep it running there
      stopped = true; clearTimeout(timer);
      if (!term && st?.state !== 'done') api.del(path(a.id, sprite, '', part)).catch(() => {});
    },
  };
}

// The sign-in panel as a dialog (from Connections, Settings, a Terminal menu). An agent whose chat runtime signs in
// separately (Antigravity) goes straight on to that once the agent itself is signed in.
export function openSignin(agentId, { sprite = null, part = null, onDone } = {}) {
  const a = state.agents.find((x) => x.id === agentId);
  if (a && !part && !a.signin) return terminalSetup(a);
  const d = document.createElement('dialog');
  d.className = 'ui-dialog sg-dialog';
  const head = (p) => `${ui.agentMark(agentId, a?.name || agentId)}<span>Sign in to ${ui.esc(a?.name || agentId)}${p ? ' chat' : ''}</span>`;
  d.innerHTML = `<header>${head(part)}</header><div class="content"></div><footer><button class="ui-btn" type="button" data-x="close">Cancel</button></footer>`;
  document.body.appendChild(d);
  let panel;
  const mount = (p) => {
    d.querySelector('header').innerHTML = head(p);
    panel = signinPanel(d.querySelector('.content'), agentId, {
      sprite, part: p,
      onState: (st) => { d.querySelector('[data-x=close]').textContent = st?.state === 'done' ? 'Done' : 'Cancel'; },
      onDone: async () => {
        await loadAgents();
        const next = state.agents.find((x) => x.id === agentId);
        if (!p && !sprite && next?.chatSignin && next.acpInstalled !== false && !next.chatSignedIn) return setTimeout(() => d.open && mount('chat'), 1400);
        onDone?.(); setTimeout(() => d.open && d.close(), 1400);
      },
    });
  };
  mount(part);
  d.addEventListener('click', (e) => { if (e.target.closest('[data-x=close]') || e.target === d) d.close(); if (e.target.closest('[data-sg=term]')) d.close(); });
  d.addEventListener('close', () => { panel.stop(); d.remove(); });
  d.showModal();
}

// Agents whose sign-in is a menu (OpenCode, Pi): their own terminal, with install and login queued.
export async function terminalSetup(a) {
  try { const r = await api.post(`api/agents/${a.id}/setup`); if (r.session) location.hash = `#/terminal/${r.session}`; }
  catch (e) { ui.toast(e.message, { icon: 'circle-alert' }); }
}

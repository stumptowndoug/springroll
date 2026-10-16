// Needs you, read by a model. The Timeline's Needs you section shows what this returns: the things
// waiting on the owner, merged into stories and ranked, each with one line on why it matters.
//
// gather() collects the last 36 hours (Needs-you and worth-knowing signals, failed and recent job runs
// with their reports, triaged mail, job health, the machine) with a ref per item: signal:<id>,
// run:<thread>, mail:<uid>, job:<name>, system. A coding agent returns items citing refs: any agent,
// model and reasoning the owner picks in Settings → Needs you (Claude Sonnet until then), run as a
// short agentd session (origin "needs", like a job run but never listed) that's deleted once read. Approvals, sign-ins and key requests aren't read: the Timeline keeps their
// own rows and buttons, and any Needs-you signal no item covers still shows as its own row, so nothing
// gets lost when a read is behind or wrong.
//
// The owner's 👍/👎 votes, Done items and preferences (in their words) go into every read.
// Data: ~/data/desk/needs/ (read.json, state.json, preferences.md,
// config.json {agent, model, effort, cadence: live | hourly | manual, starter, owner}).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const HOME = os.homedir();
const DIR = path.join(HOME, 'data', 'desk', 'needs');
const WORK = path.join(DIR, 'work'); // the agent runs here: no AGENTS.md, nothing to act on
fs.mkdirSync(WORK, { recursive: true });
const F = { read: path.join(DIR, 'read.json'), state: path.join(DIR, 'state.json'), prefs: path.join(DIR, 'preferences.md'), config: path.join(DIR, 'config.json') };
const AGENTD = 'http://127.0.0.1:8090', MAIL = 'http://127.0.0.1:8101', SYSTEM = 'http://127.0.0.1:8102';
const WINDOW = 36 * 3600e3;
const MIN_GAP = 10 * 60e3, URGENT_GAP = 2 * 60e3, IDLE_GAP = 60 * 60e3;
const DEFAULT_PREFS = `- Lead with what's waiting on me: emails to answer or decide, approvals, failures only I can fix.
- Merge related things into one item. Fewer is better; nothing is fine.
- Routine runs that went fine never belong here.
`;

const load = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const save = (f, v) => { fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 1)); fs.renameSync(f + '.tmp', f); };
const get = async (u) => { const r = await fetch(u, { signal: AbortSignal.timeout(10000) }); if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); };
const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const at = (ms) => new Date(ms).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const CADENCES = ['live', 'hourly', 'manual'];
const config = () => ({ agent: 'claude', model: 'sonnet', effort: null, cadence: 'live', starter: true, ...load(F.config, {}) });
const prefs = () => { try { return fs.readFileSync(F.prefs, 'utf8'); } catch { return DEFAULT_PREFS; } };
const HARD = /^(secret|signin):/; // keys whose rows keep their own buttons

let status = { generating: false, error: null, lastTry: 0 };
let notify = () => {};
export function init({ broadcast }) {
  notify = broadcast;
  // Migrate Pulse's settings (the app this grew out of), once.
  const old = path.join(HOME, 'data', 'pulse');
  if (!fs.existsSync(F.config) && fs.existsSync(path.join(old, 'config.json'))) fs.copyFileSync(path.join(old, 'config.json'), F.config);
  if (!fs.existsSync(F.prefs) && fs.existsSync(path.join(old, 'preferences.md'))) fs.copyFileSync(path.join(old, 'preferences.md'), F.prefs);
  setTimeout(() => maybe('background'), 20e3);
  setInterval(() => maybe('background'), 5 * 60e3);
  watchSignals();
}

// A new signal or run is worth a look within a minute (maybe() decides whether to read).
function watchSignals() {
  let timer = null, buf = '';
  const later = () => { clearTimeout(timer); timer = setTimeout(() => maybe('change'), 45e3); };
  fetch(`${AGENTD}/events`).then(async (r) => {
    for await (const chunk of r.body) {
      buf += Buffer.from(chunk).toString();
      const parts = buf.split('\n\n'); buf = parts.pop();
      for (const p of parts) if (/"type":"(signals|jobs)"/.test(p)) later();
    }
  }).catch(() => {}).finally(() => setTimeout(watchSignals, 10e3));
}

/* ---------- What happened ---------- */

async function gather({ light = false } = {}) {
  const now = Date.now(), since = now - WINDOW;
  const [jobs, signals, runs] = await Promise.all([get(`${AGENTD}/jobs`), get(`${AGENTD}/signals`), get(`${AGENTD}/threads?origin=job&limit=400`)]);
  const titles = Object.fromEntries(jobs.map((j) => [j.name, j.title || j.name]));
  const out = { now: new Date().toString(), needs_you: [], worth_knowing: [], failed_runs: [], recent_reports: [], mail: [], jobs: [], machine: null };
  const sources = {}; // ref -> {label, src (the Timeline's source key), href, icon, when, signal?, needs?}

  for (const s of signals) {
    if (!['needs', 'notable'].includes(s.level) || HARD.test(s.key || '')) continue;
    const ref = `signal:${s.id}`, job = (s.key || '').startsWith('job:');
    sources[ref] = { label: job ? titles[s.key.slice(4)] || s.source || 'Job' : s.source || 'Signal', src: job ? s.key : s.source ? `src:${s.source}` : '', href: s.href || '', icon: s.icon || ((s.key || '').startsWith('mail:') ? 'mail' : job ? 'circle-x' : 'circle-alert'), when: s.updated, signal: s.id, needs: s.level === 'needs', key: s.key || null };
    const item = { ref, title: clip(s.title, 160), body: clip(s.body, 300), from: s.source || undefined, at: at(s.updated) };
    if (s.note) item.how_to_act = clip(s.note, 300);
    out[s.level === 'needs' ? 'needs_you' : 'worth_knowing'].push(item);
  }

  for (const j of jobs) {
    sources[`job:${j.name}`] = { label: titles[j.name], src: `job:${j.name}`, href: `#/jobs/${j.name}`, icon: 'calendar-clock' };
    out.jobs.push({ ref: `job:${j.name}`, title: titles[j.name], schedule: j.describe, enabled: j.enabled, last_runs_newest_first: [...(j.trail || [])].reverse().map((x) => (x === 'done' ? '✓' : x === 'failed' ? '✗' : '·')).join('') });
  }

  // Failures, and each job's newest report: that's where "something only you can fix" shows up.
  const newest = new Set();
  for (const t of runs.filter((t) => t.origin?.startsWith('job:') && t.updated >= since)) {
    const name = t.origin.slice(4), ref = `run:${t.id}`;
    sources[ref] = { label: titles[name] || name, src: t.origin, href: `#/r/${t.id}`, icon: t.status === 'error' ? 'circle-x' : 'calendar-clock', when: t.updated };
    const first = !newest.has(name); newest.add(name);
    if (t.status !== 'error' && !first) continue;
    const run = { ref, job: titles[name] || name, title: clip(t.title, 120), at: at(t.updated) };
    if (t.status === 'error') run.error = clip(t.error || t.preview, 300);
    if (!light) { try { const r = await get(`${AGENTD}/runs/thread/${t.id}`); if (r.report) run.report = clip(r.report, 600); } catch {} }
    out[t.status === 'error' ? 'failed_runs' : 'recent_reports'].push(run);
  }

  try {
    for (const m of (await get(`${MAIL}/api/today`)).items || []) {
      if ((m.date || 0) * 1000 < since || out.mail.length >= 70) continue;
      const ref = `mail:${m.uid}`;
      sources[ref] = { label: 'Mail', src: 'src:Mail', href: `#/v/mail#${m.uid}`, icon: 'mail', when: m.date * 1000 };
      out.mail.push({ ref, from: m.from_name || m.from_addr, subject: clip(m.subject, 140), triage: m.category, why: clip(m.reason, 160), at: at(m.date * 1000), ...(m.done ? { handled: true } : {}) });
    }
    out.owner_mail_accounts = ((await get(`${MAIL}/api/status`)).accounts || []).map((a) => a.email);
  } catch { out.mail = "Mail isn't answering"; }
  if (config().owner) out.owner_name = config().owner;

  try {
    const n = (await get(`${SYSTEM}/api/now`)).now;
    out.machine = { memory_pct: Math.round(n.mem.percent), disk_pct: Math.round(n.disk.percent) };
    sources.system = { label: 'System', src: '', href: '#/v/system', icon: 'activity' };
  } catch {}
  return { data: out, sources };
}

const fingerprint = (d) => crypto.createHash('sha1').update(JSON.stringify([...d.needs_you, ...d.worth_knowing, ...d.failed_runs, ...d.recent_reports, ...(Array.isArray(d.mail) ? d.mail : [])].map((x) => x.ref))).digest('hex');

/* ---------- The read ---------- */

const INSTRUCTIONS = `You decide what goes in "Needs you" on the owner's Springroll Timeline (their personal server, where agents and scheduled jobs work for them).
Below, as JSON, is what's waiting and what happened in the last 36 hours. Pick out what genuinely waits on the owner, merge what belongs together, rank it, and say in one line why each matters.

Answer with ONE JSON object and nothing else (no prose, no code fence):
{"items": [{
  "id": "short-stable-slug (reuse the id from previous_items for the same story)",
  "kind": "act" (a decision, reply, approval or fix only the owner can make) or "watch" (at risk or drifting and worth their attention soon: repeated failures, disk filling, a deadline coming),
  "priority": 1-5 (5 = most pressing),
  "title": "specific, at most 70 characters",
  "insight": "one or two sentences: why it matters, what's at stake or by when. Add what the title doesn't say. No filler.",
  "refs": ["refs from the input; the first is what View opens"],
  "action": {"label": "two or three words, a verb first", "ask": "a starter prompt: what the owner would type to an agent to get this done, in their own voice (first person, 'me'), one or two short sentences, with the ids it needs (e.g. 'Draft a reply to Kim (mail 1058) explaining how to claim the senior exemption. Don't send it.')"} or null
}]}

How to choose:
- Every needs_you entry must appear in some item's refs (merged or alone), unless done says it's handled. They were flagged for the owner; you decide how to word and rank them.
- Also surface what was never flagged but clearly waits on the owner: mail triaged as needing a reply or decision, deadlines in mail or reports, failed runs that need a human. Worth-knowing entries belong only if they are really a deadline or a decision.
- Merge everything about one story into one item (an email, the run that sorted it and its signal are one item).
- Usually zero to six items. Never more than eight. Nothing is a fine answer. Routine success never belongs.
- Follow the owner's preferences and votes (👍 more like this, 👎 less like this). Items in done stay out unless something new happened in that story (a new ref).
- Mail from owner_mail_accounts or from owner_name (any address) is the owner writing: a note to self, not someone waiting on them. Call the owner "you".
- Every item cites at least one ref from happened. A previous item none of whose refs is still there is over: drop it.
- Use only facts in the input. Times are local. Write like a sharp assistant: concrete, calm, no hype, no emoji.
`;

function prompt(data) {
  const st = load(F.state, { done: [], votes: [] }), prev = load(F.read, null);
  return `${INSTRUCTIONS}\nINPUT:\n${JSON.stringify({
    owner_preferences: prefs(),
    votes: (st.votes || []).slice(-30).map(({ vote, title, about }) => ({ vote, title, about })),
    done: (st.done || []).slice(-40).map(({ id, title, refs }) => ({ id, title, refs })),
    previous_items: prev?.items?.map((i) => ({ id: i.id, title: i.title, refs: i.refs })) || [],
    happened: data,
  })}`;
}

// One turn with the chosen agent, through agentd like a job run: the same agents, models and reasoning
// as everywhere else, each in its own scope. The session is deleted once its answer is read.
const call = async (method, p, body) => {
  const r = await fetch(`${AGENTD}${p}`, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30e3) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error || `agentd ${r.status}`);
  return out;
};
async function run(text) {
  const c = config();
  const t = await call('POST', '/threads', { agent: c.agent, cwd: WORK, origin: 'needs', title: 'Needs you: a read', ...(c.model ? { model: c.model } : {}), ...(c.effort ? { effort: c.effort } : {}) });
  try {
    await call('POST', `/threads/${t.id}/messages`, { text });
    const until = Date.now() + 5 * 60e3;
    await new Promise((r) => setTimeout(r, 3000));
    while (Date.now() < until) {
      const { thread, items } = await call('GET', `/threads/${t.id}`);
      if (!['running', 'starting'].includes(thread.status) && !thread.running) {
        if (thread.status === 'error') throw new Error(thread.error || 'the agent stopped with an error');
        const turn = Math.max(0, ...items.map((i) => i.turn));
        const answer = items.filter((i) => i.turn === turn && i.kind === 'text').map((i) => i.text || '').join('\n');
        if (!answer.trim()) throw new Error(thread.error || 'the agent gave no answer');
        return answer;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error('the read took more than 5 minutes');
  } finally { call('DELETE', `/threads/${t.id}`).catch(() => {}); }
}

function parse(text, sources) {
  const t = String(text).replace(/^\s*```(?:json)?|```\s*$/g, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < 0) throw new Error("the model didn't answer with JSON");
  const items = [], seen = new Set();
  for (const i of JSON.parse(t.slice(a, b + 1)).items || []) {
    if (!i?.title) continue;
    const id = String(i.id || i.title).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || `item-${items.length}`;
    if (seen.has(id)) continue; seen.add(id);
    const refs = (i.refs || []).filter((r) => typeof r === 'string' && sources[r]).slice(0, 8);
    if (!refs.length) continue; // nothing in the input behind it (e.g. carried over from previous_items after its signal cleared)
    const act = i.action?.label && i.action?.ask ? { label: clip(i.action.label, 32), ask: clip(i.action.ask, 600) } : null;
    const pr = Math.max(1, Math.min(5, parseInt(i.priority, 10) || 3));
    items.push({ id, kind: i.kind === 'watch' ? 'watch' : 'act', priority: pr, title: clip(i.title, 90), insight: clip(i.insight, 400), refs, action: act,
      sources: refs.map((r) => ({ ref: r, ...sources[r] })), when: Math.max(0, ...refs.map((r) => sources[r].when || 0)) || null });
  }
  return items.sort((x, y) => y.priority - x.priority).slice(0, 8);
}

async function read(reason) {
  if (status.generating) return;
  status = { ...status, generating: true, error: null, lastTry: Date.now() };
  notify('needs', { generating: true });
  const started = Date.now();
  try {
    const { data, sources } = await gather();
    let items = parse(await run(prompt(data)), sources);
    const done = Object.fromEntries((load(F.state, { done: [] }).done || []).map((d) => [d.id, d]));
    items = items.filter((i) => !done[i.id] || i.refs.some((r) => !done[i.id].refs.includes(r)));
    const c = config();
    save(F.read, { items, generated: Date.now(), took: Math.round((Date.now() - started) / 100) / 10, agent: c.agent, model: c.model || null, effort: c.effort || null, reason, fingerprint: fingerprint(data) });
  } catch (e) { status.error = clip(e.message, 300); }
  status.generating = false;
  notify('needs', { generating: false });
}

// Read again when something changed (Settings → Needs you → How often): "live" within minutes for
// anything new waiting on the owner (a Needs-you signal or a failed run no item covers yet) and at most
// hourly for the rest; "hourly"; "manual" only on Read again (or a change to the settings).
export async function maybe(reason, force = false) {
  if (status.generating) return false;
  const cadence = config().cadence;
  if (!force && cadence === 'manual') return false;
  const cur = load(F.read, null);
  const since = Date.now() - Math.max(status.lastTry, cur?.generated || 0);
  if (!force && cur) {
    if (since < URGENT_GAP) return false;
    let data;
    try { ({ data } = await gather({ light: true })); } catch { return false; }
    if (fingerprint(data) === cur.fingerprint) return false;
    const known = new Set(cur.items.flatMap((i) => i.refs));
    const urgent = [...data.needs_you, ...data.failed_runs].some((x) => !known.has(x.ref));
    if (cadence === 'hourly' ? since < IDLE_GAP : !urgent && since < (reason === 'opened' ? MIN_GAP : IDLE_GAP)) return false;
  }
  read(reason);
  return true;
}

/* ---------- API (server.mjs: /api/needs…) ---------- */

export function current() {
  const r = load(F.read, null), votes = Object.fromEntries((load(F.state, { votes: [] }).votes || []).map((v) => [v.id, v.vote === '👍' ? 'up' : 'down']));
  return { ...(r || { items: [] }), starter: config().starter !== false, items: (r?.items || []).map((i) => ({ ...i, vote: votes[i.id] || null })), generating: status.generating, error: status.error };
}

export async function act(id, what) {
  const r = load(F.read, null), item = r?.items.find((i) => i.id === id);
  if (!item) throw new Error('no such item');
  const st = load(F.state, { done: [], votes: [] });
  if (what === 'done') {
    st.done = [...(st.done || []).filter((d) => d.id !== id), { id, title: item.title, refs: item.refs, at: Date.now() }].slice(-200);
    r.items = r.items.filter((i) => i.id !== id);
    save(F.read, r);
    // Done here is done for what it covers: its Needs-you signals come off too.
    for (const s of item.sources) if (s.needs && s.signal) await fetch(`${AGENTD}/signals/${s.signal}/dismiss`, { method: 'POST' }).catch(() => {});
  } else {
    const vote = what === 'up' ? '👍' : '👎';
    const had = (st.votes || []).find((v) => v.id === id);
    st.votes = (st.votes || []).filter((v) => v.id !== id);
    if (!(had && had.vote === vote)) st.votes.push({ id, vote, title: item.title, about: [...new Set(item.sources.map((s) => s.label))] }); // same vote again takes it back
    st.votes = st.votes.slice(-100);
  }
  save(F.state, st);
  notify('needs', {});
  return { ok: true };
}

export const preferences = () => ({ text: prefs(), path: F.prefs, custom: fs.existsSync(F.prefs) });

// Settings → Needs you: which agent reads (any that can chat), its model and reasoning ('' = what a new
// chat with it gets), and how often. A change reads again right away.
export function getConfig() { const { agent, model, effort, cadence, starter } = config(); return { agent, model: model || '', effort: effort || '', cadence, starter: starter !== false }; }
export function setConfig(patch) {
  const c = load(F.config, {});
  if (typeof patch.agent === 'string' && /^[a-z0-9-]{1,40}$/.test(patch.agent) && patch.agent !== c.agent) { c.agent = patch.agent; c.model = null; c.effort = null; }
  for (const k of ['model', 'effort']) if (k in patch) c[k] = typeof patch[k] === 'string' && patch[k] ? patch[k].slice(0, 120) : null;
  if (CADENCES.includes(patch.cadence)) c.cadence = patch.cadence;
  if (typeof patch.starter === 'boolean') c.starter = patch.starter; // Chat starts with the suggested step typed in
  save(F.config, c);
  if (['agent', 'model', 'effort'].some((k) => k in patch)) maybe('settings', true);
  notify('needs', {});
  return getConfig();
}
// Empty text goes back to the default instructions.
export function setPreferences(text) {
  text = String(text || '').trim();
  if (text) fs.writeFileSync(F.prefs, text + '\n'); else fs.rmSync(F.prefs, { force: true });
  maybe('preferences', true);
  return preferences();
}

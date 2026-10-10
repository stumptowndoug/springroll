// Coding-agent quota: how much of each plan window is used and when it resets, from each
// provider's own usage endpoint with the sign-in its CLI already stored on this machine.
// Cached; honors Retry-After. No dependencies.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';

const HOME = os.homedir();
const TTL = 5 * 60000;
// Kept on disk: a provider that says "retry after N" (Anthropic's usage endpoint does) must not be
// called again when Springroll restarts, or the lockout starts over. Last good numbers survive too.
const STATE = path.join(HOME, '.desk', 'usage.json');
const cache = new Map(Object.entries(readJson(STATE) || {})); // id -> { at, data, dataAt, error, retryAt, fails }
const save = () => { try { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(Object.fromEntries(cache))); } catch {} };

function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
const envVar = (name) => new Promise((resolve) => execFile('bash', ['-c', `. "${HOME}/.config/springroll/env" 2>/dev/null; printf %s "\${${name}:-}"`], { timeout: 5000 }, (e, out) => resolve(e ? '' : out.trim())));

const PROVIDERS = {
  claude: {
    name: 'Claude',
    async token() {
      return readJson(path.join(HOME, '.claude', '.credentials.json'))?.claudeAiOauth?.accessToken || process.env.CLAUDE_CODE_OAUTH_TOKEN || await envVar('CLAUDE_CODE_OAUTH_TOKEN');
    },
    request: (token) => ['https://api.anthropic.com/api/oauth/usage', { headers: { authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' } }],
    parse(j) {
      const w = (key, label, hours) => j[key] && j[key].utilization != null
        ? { key, label, used: Math.round(j[key].utilization), resetsAt: j[key].resets_at ? Date.parse(j[key].resets_at) : null, windowMs: hours * 3600000 } : null;
      return { windows: [w('five_hour', '5-hour', 5), w('seven_day', 'Weekly', 168), w('seven_day_sonnet', 'Weekly, Sonnet', 168), w('seven_day_opus', 'Weekly, Opus', 168)].filter(Boolean) };
    },
  },
  codex: {
    name: 'Codex',
    async token() {
      const a = readJson(path.join(HOME, '.codex', 'auth.json'));
      return a?.tokens?.access_token || a?.access_token || null;
    },
    request: (token) => ['https://chatgpt.com/backend-api/wham/usage', { headers: { authorization: `Bearer ${token}` } }],
    parse(j) {
      const w = (x) => {
        if (!x || x.used_percent == null) return null;
        const secs = x.limit_window_seconds || 0;
        if (secs > 8 * 86400) return null;
        return { key: secs <= 6 * 3600 ? '5h' : '7d', label: secs <= 6 * 3600 ? '5-hour' : 'Weekly', used: Math.round(x.used_percent), resetsAt: x.reset_at ? x.reset_at * 1000 : null, windowMs: secs * 1000 };
      };
      return { plan: j.plan_type || null, windows: [w(j.rate_limit?.primary_window), w(j.rate_limit?.secondary_window)].filter(Boolean) };
    },
  },
};

async function refresh(id) {
  const p = PROVIDERS[id], c = cache.get(id) || { fails: 0 };
  const token = await p.token();
  if (!token) { cache.set(id, { ...c, at: Date.now(), data: null, error: 'Not signed in', retryAt: Date.now() + TTL }); return; }
  try {
    const [url, opts] = p.request(token);
    const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(10000) });
    if (!r.ok) {
      const after = Number(r.headers.get('retry-after')) || 0;
      const fails = (c.fails || 0) + 1;
      // 429: at least what it asks (plus a little), and longer each time in a row (to 6 hours).
      const wait = r.status === 429 ? Math.min(Math.max(after * 1000 * 1.1, 15 * 60000) * 2 ** Math.min(fails - 1, 3), 6 * 3600000) : Math.min(30000 * 2 ** (fails - 1), TTL);
      const error = r.status === 401 || r.status === 403 ? 'Sign in again to see usage' : r.status === 429 ? 'Anthropic is limiting usage checks for this account right now (every app that checks counts, Shep included)' : `Usage service error ${r.status}`;
      cache.set(id, { ...c, at: Date.now(), error, retryAt: Date.now() + wait, fails });
      return save();
    }
    cache.set(id, { at: Date.now(), dataAt: Date.now(), data: p.parse(await r.json()), error: null, retryAt: Date.now() + TTL, fails: 0 });
    save();
  } catch (e) {
    const fails = (c.fails || 0) + 1;
    cache.set(id, { ...c, at: Date.now(), error: `Couldn't reach the usage service`, retryAt: Date.now() + Math.min(30000 * 2 ** (fails - 1), TTL), fails });
    save();
  }
}

const inflight = new Map();
// agents: which coding agents are installed and signed in (from agents.json status).
export async function usage(agents) {
  const ids = agents.filter((a) => PROVIDERS[a.id] && a.installed && a.signedIn).map((a) => a.id);
  await Promise.all(ids.map((id) => {
    const c = cache.get(id);
    if (c && Date.now() < (c.retryAt || 0)) return null;
    if (!inflight.has(id)) inflight.set(id, refresh(id).finally(() => inflight.delete(id)));
    return inflight.get(id);
  }));
  return ids.map((id) => {
    const c = cache.get(id) || {}, data = c.data; // the last good numbers stay while a provider asks us to wait
    return { id, name: PROVIDERS[id].name, plan: data?.plan || null, windows: data?.windows || [], error: c.error || null, updated: c.dataAt || null, nextCheck: c.error ? c.retryAt || null : null };
  });
}

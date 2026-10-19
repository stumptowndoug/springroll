// Cursor's plan usage for the billing cycle, following Shep's usage/providers.rs: the dashboard
// service's GetCurrentPeriodUsage (Connect over JSON) with the token `cursor-agent login` stores.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export class CursorUsageError extends Error {}

export const CURSOR_USAGE_URL = 'https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage';

// CURSOR_AUTH_TOKEN / CURSOR_API_KEY (from Keys), else the CLI's own sign-in file.
export function cursorToken(env = process.env, home = os.homedir()) {
  for (const k of ['CURSOR_AUTH_TOKEN', 'CURSOR_API_KEY']) if (env[k]?.trim()) return env[k].trim();
  for (const f of ['.config/cursor/auth.json', '.cursor/auth.json']) {
    let a;
    try { a = JSON.parse(fs.readFileSync(path.join(home, f), 'utf8')); } catch { continue; }
    for (const k of ['accessToken', 'access_token', 'apiKey', 'api_key', 'token']) if (typeof a?.[k] === 'string' && a[k]) return a[k];
  }
  return null;
}

export const cursorRequest = (token) => [CURSOR_USAGE_URL, {
  method: 'POST', body: '{}',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'connect-protocol-version': '1', 'x-cursor-client-type': 'cli', 'x-cursor-client-version': 'cli-springroll' },
}];

const num = (v) => { const n = typeof v === 'string' ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) ? n : null; };
// A pool's percent used: given outright, or spend over limit.
function percent(plan, field, spend, limit) {
  const p = num(plan[field]);
  if (p != null) return p;
  const s = num(plan[spend]), l = num(plan[limit]);
  return s != null && l > 0 ? (s / l) * 100 : null;
}

export function parseCursorUsage(j) {
  if (j?.code) throw new CursorUsageError(`Cursor said ${j.message || j.code}; sign in to Cursor again`);
  if (j?.enabled === false) throw new CursorUsageError("Cursor doesn't report plan usage for this account");
  const plan = j?.planUsage || j?.plan_usage;
  const total = plan && percent(plan, 'totalPercentUsed', 'totalSpend', 'limit');
  if (total == null) throw new CursorUsageError("Cursor's usage report has no plan usage");
  const start = num(j.billingCycleStart ?? j.billing_cycle_start), end = num(j.billingCycleEnd ?? j.billing_cycle_end);
  const windowMs = start && end && end > start ? end - start : 30 * 86400000;
  const w = (key, label, used) => used == null ? null : { key, label, used: Math.round(used), resetsAt: end || null, windowMs };
  return { windows: [
    w('billing', 'Monthly', total),
    w('billing-auto', 'Monthly, Auto', percent(plan, 'autoPercentUsed', 'autoSpend', 'autoLimit')),
    w('billing-api', 'Monthly, API', percent(plan, 'apiPercentUsed', 'apiSpend', 'apiLimit')),
  ].filter(Boolean) };
}

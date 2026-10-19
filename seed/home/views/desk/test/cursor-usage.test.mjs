import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseCursorUsage, cursorToken, CursorUsageError } from '../cursor-usage.mjs';
import { visibleUsage } from '../public/app/usage-settings.mjs';

test('billing-cycle percentages, reset and window length (Shep\'s sample)', () => {
  const r = parseCursorUsage({ billingCycleStart: '1785542400000', billingCycleEnd: '1788220800000', enabled: true,
    planUsage: { totalPercentUsed: 42.5, autoPercentUsed: 25, apiPercentUsed: 10 } });
  assert.deepEqual(r.windows.map(w => [w.key, w.label, w.used]), [['billing', 'Monthly', 43], ['billing-auto', 'Monthly, Auto', 25], ['billing-api', 'Monthly, API', 10]]);
  assert.equal(r.windows[0].resetsAt, 1788220800000);
  assert.equal(r.windows[0].windowMs, 1788220800000 - 1785542400000);
});

test('spend over limit when no percent is given; missing pools are left out', () => {
  const r = parseCursorUsage({ planUsage: { totalSpend: '500', limit: 2000 } });
  assert.deepEqual(r.windows.map(w => [w.key, w.used, w.resetsAt]), [['billing', 25, null]]);
  assert.equal(r.windows[0].windowMs, 30 * 86400000);
});

test('Connect errors, disabled accounts and empty reports say what happened', () => {
  assert.throws(() => parseCursorUsage({ code: 'unauthenticated', message: 'not logged in' }), (e) => e instanceof CursorUsageError && /sign in/.test(e.message));
  assert.throws(() => parseCursorUsage({ enabled: false }), CursorUsageError);
  assert.throws(() => parseCursorUsage({}), CursorUsageError);
});

test('token from Keys first, then the CLI sign-in file', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-home-'));
  assert.equal(cursorToken({}, home), null);
  fs.mkdirSync(path.join(home, '.config/cursor'), { recursive: true });
  fs.writeFileSync(path.join(home, '.config/cursor/auth.json'), JSON.stringify({ accessToken: 'file-token' }));
  assert.equal(cursorToken({}, home), 'file-token');
  assert.equal(cursorToken({ CURSOR_API_KEY: ' key ' }, home), 'key');
  fs.rmSync(home, { recursive: true });
});

test('Cursor shows its monthly total; Auto/API pools only when switched on', () => {
  const data = [{ id: 'cursor', windows: [{ key: 'billing' }, { key: 'billing-auto' }, { key: 'billing-api' }] }];
  assert.deepEqual(visibleUsage(data)[0].windows.map(w => w.key), ['billing']);
  assert.deepEqual(visibleUsage(data, { cursorPools: true })[0].windows.map(w => w.key), ['billing', 'billing-auto', 'billing-api']);
  assert.deepEqual(visibleUsage(data, { cursor: false, cursorPools: true })[0].windows.map(w => w.key), ['billing-auto', 'billing-api']);
  assert.deepEqual(visibleUsage(data, { cursor: false }), []);
  const unavailable = [{ id: 'cursor', windows: [], error: 'Not signed in' }];
  assert.deepEqual(visibleUsage(unavailable), unavailable);
});

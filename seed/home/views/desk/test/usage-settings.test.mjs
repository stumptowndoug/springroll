import assert from 'node:assert/strict';
import { test } from 'node:test';
import { usageSettings, patchUsageSettings, visibleUsage } from '../public/app/usage-settings.mjs';

const defaults = { claude: true, codex: true, antigravityGemini: true, antigravityThirdParty: false };
const data = [
  { id: 'claude', windows: [{ key: 'five_hour' }] },
  { id: 'codex', windows: [{ key: '7d' }] },
  { id: 'antigravity', windows: ['gemini-weekly', 'gemini-5h', '3p-weekly', '3p-5h'].map(key => ({ key })) },
];

test('existing installs retain Claude, Codex and Gemini; third-party Antigravity is off by default', () => {
  assert.deepEqual(usageSettings(), defaults);
  assert.deepEqual(usageSettings(null), defaults);
  assert.deepEqual(visibleUsage(data).map(a => [a.id, a.windows.map(w => w.key)]), [
    ['claude', ['five_hour']], ['codex', ['7d']], ['antigravity', ['gemini-weekly', 'gemini-5h']],
  ]);
  assert.equal(data[2].windows.length, 4); // Display filters preserve the collected quotas.
});

test('partial boolean patches persist independent choices and reject unknown or invalid fields', () => {
  const current = { ...defaults, codex: false };
  const patched = patchUsageSettings(current, { antigravityThirdParty: true, claude: 'false', future: true });
  assert.deepEqual(patched, { ...current, antigravityThirdParty: true });
  assert.deepEqual(current, { ...defaults, codex: false });
  assert.deepEqual(usageSettings({ claude: null, codex: 0, antigravityThirdParty: 'true' }), defaults);
});

test('provider switches can hide everything or select only Antigravity third-party quotas', () => {
  assert.deepEqual(visibleUsage(data, { claude: false, codex: false, antigravityGemini: false }), []);
  assert.deepEqual(visibleUsage(data, { claude: false, codex: false, antigravityGemini: false, antigravityThirdParty: true }), [
    { id: 'antigravity', windows: [{ key: '3p-weekly' }, { key: '3p-5h' }] },
  ]);
  assert.equal(visibleUsage(data, { antigravityThirdParty: true })[2].windows.length, 4);
});

test('hidden quota pools do not create empty placeholder rows; selected unavailable providers still show status', () => {
  assert.deepEqual(visibleUsage([{ id: 'antigravity', windows: [{ key: '3p-weekly' }] }]), []);
  const unavailable = [{ id: 'antigravity', windows: [], error: 'Not signed in' }];
  assert.deepEqual(visibleUsage(unavailable), unavailable);
  assert.deepEqual(visibleUsage(unavailable, { antigravityGemini: false }), []);
  assert.deepEqual(visibleUsage(unavailable, { antigravityGemini: false, antigravityThirdParty: true }), unavailable);
});

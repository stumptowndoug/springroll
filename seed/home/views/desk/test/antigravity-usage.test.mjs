import assert from 'node:assert/strict';
import { test, mock } from 'node:test';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fetchAntigravityUsage, parseAntigravityUsage, supportsUsageReport, AntigravityUsageError } from '../antigravity-usage.mjs';

// Schema from Shep's fixture and the installed agy's read-only /usage report.
const report = () => ({ status: 'SUCCESS', num_turns: 0, command: { name: 'usage', data: { groups: [
  { name: 'Gemini Models', buckets: [
    { id: 'gemini-weekly', remaining_fraction: 0.61, reset_time: '2026-10-15T15:09:56Z' },
    { id: 'gemini-5h', remaining_fraction: 0.9947057962417603, reset_time: 'invalid' },
  ] },
  { name: 'Claude and GPT models', buckets: [
    { id: '3p-weekly', remaining_fraction: 1 }, { id: '3p-5h', remaining_fraction: 0 },
  ] },
] } } });

async function cli(t, { version = '1.3.5', command = `process.stdout.write(${JSON.stringify(JSON.stringify(report()))})` } = {}) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'springroll-agy-test-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const binary = path.join(directory, 'agy'), log = path.join(directory, 'calls.jsonl');
  const write = async (body = command) => fsp.writeFile(binary, `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({args:process.argv.slice(2), cwd:process.cwd()}) + '\\n');
if (process.argv.includes('--version')) process.stdout.write(${JSON.stringify(version)});
else { ${body} }
`, { mode: 0o700 });
  await write();
  return { binary, directory, write, calls: async () => (await fsp.readFile(log, 'utf8')).trim().split('\n').map(JSON.parse) };
}

test('version gate refuses older and unknown CLIs before /usage can become a prompt', () => {
  for (const v of ['1.1.11', '1.2.3\n', '1.3.5', '2.0.0']) assert.ok(supportsUsageReport(v), v);
  for (const v of ['1.1.10', '0.9.99', '', 'unknown', '1.1', '1.1.11-beta', '1.1.11.0']) assert.equal(supportsUsageReport(v), false, v);
});

test('maps quota pools to used percentages, reset times and actual window lengths', () => {
  const { windows } = parseAntigravityUsage(JSON.stringify(report()));
  assert.deepEqual(windows.map(w => [w.key, w.used, w.windowMs]), [
    ['gemini-weekly', 39, 168 * 3600000], ['gemini-5h', 1, 5 * 3600000],
    ['3p-weekly', 0, 168 * 3600000], ['3p-5h', 100, 5 * 3600000],
  ]);
  assert.equal(windows[0].resetsAt, Date.parse('2026-10-15T15:09:56Z'));
  assert.equal(windows[1].resetsAt, null);
  assert.equal(windows[2].resetsAt, null);
});

test('unavailable or invalid quotas are omitted rather than shown as zero', () => {
  const data = report();
  data.command.data.groups[0].buckets = [
    { id: 'gemini-weekly' }, { id: 'gemini-5h', remaining_fraction: null },
    { id: 'future-pool', remaining_fraction: 0.5 }, { id: 'gemini-5h', remaining_fraction: '0.5' },
    { id: 'gemini-5h', remaining_fraction: 0.5, disabled: true },
    { id: 'gemini-weekly', remaining_fraction: 0.5, enabled: false },
    { id: 'gemini-weekly', remaining_fraction: -0.1 }, { id: 'gemini-5h', remaining_fraction: 1.1 },
    { id: '__proto__', remaining_fraction: 0.5 }, null,
  ];
  assert.equal(parseAntigravityUsage(JSON.stringify(data)).windows.length, 2);
  for (const flag of [{ disabled: true }, { enabled: false }]) {
    Object.assign(data.command.data.groups[1], flag);
    assert.throws(() => parseAntigravityUsage(JSON.stringify(data)), /no supported quota/);
  }
});

test('rejects command failures, model responses, duplicates and malformed reports', () => {
  for (const patch of [{ status: 'ERROR' }, { command: { name: 'prompt' } }, { num_turns: 1 }]) {
    assert.throws(() => parseAntigravityUsage(JSON.stringify({ ...report(), ...patch })), AntigravityUsageError);
  }
  for (const body of ['not json', '{}', 'null', '{"status":"SUCCESS","command":{"name":"usage"}}'])
    assert.throws(() => parseAntigravityUsage(body), AntigravityUsageError);
  const data = report();
  data.command.data.groups[0].buckets[1].id = 'gemini-weekly';
  assert.throws(() => parseAntigravityUsage(JSON.stringify(data)), /duplicate quota/);
});

test('runs only the read-only command, in a temporary workspace that is cleaned up', async t => {
  const stub = await cli(t);
  const result = await fetchAntigravityUsage({ binary: stub.binary });
  assert.equal(result.windows.length, 4);
  const calls = await stub.calls();
  assert.deepEqual(calls.map(c => c.args), [
    ['--version'], ['-p', '/usage', '--output-format', 'json', '--print-timeout', '30s'],
  ]);
  assert.equal(calls[0].cwd, calls[1].cwd);
  assert.notEqual(calls[0].cwd, process.cwd());
  await assert.rejects(fsp.access(calls[0].cwd));
});

test('never runs a usage prompt on an old CLI and removes the workspace on failure', async t => {
  const stub = await cli(t, { version: '1.1.10' });
  await assert.rejects(fetchAntigravityUsage({ binary: stub.binary }), /1\.1\.11 or newer/);
  const calls = await stub.calls();
  assert.equal(calls.length, 1);
  await assert.rejects(fsp.access(calls[0].cwd));
});

test('bounds output and timeouts and keeps CLI stderr out of public errors', async t => {
  const stub = await cli(t);
  await stub.write("process.stderr.write('private-auth-details'); process.exit(1)");
  await assert.rejects(fetchAntigravityUsage({ binary: stub.binary }), e => e instanceof AntigravityUsageError && !e.message.includes('private-auth-details'));
  await stub.write("process.stdout.write('x'.repeat(1024 * 1024 + 1))");
  await assert.rejects(fetchAntigravityUsage({ binary: stub.binary }), /size limit/);
  await stub.write('setInterval(() => {}, 1000)');
  const started = Date.now();
  await assert.rejects(fetchAntigravityUsage({ binary: stub.binary, timeout: 300 }), /timed out/);
  assert.ok(Date.now() - started < 2500);
  for (const call of await stub.calls()) await assert.rejects(fsp.access(call.cwd));
  await assert.rejects(fetchAntigravityUsage({ binary: path.join(stub.directory, 'missing') }), /Unable to start/);
});

test('utilization caches and deduplicates probes, preserves stale values and migrates provider backoffs', async t => {
  const stub = await cli(t);
  const originalPath = process.env.PATH;
  process.env.PATH = `${stub.directory}:${originalPath}`;
  t.after(() => { process.env.PATH = originalPath; mock.restoreAll(); });
  const state = path.join(os.homedir(), 'data', 'desk', 'usage.json');
  const legacy = path.join(os.homedir(), '.desk', 'usage.json');
  let saved = null, pending = null, now = Date.now();
  const old = { codex: { retryAt: now + 3600000, data: { windows: [] } } };
  const read = fs.readFileSync, exists = fs.existsSync, mkdir = fs.mkdirSync, write = fs.writeFileSync, rename = fs.renameSync;
  // Intercept only the usage cache, so the test never reads credentials or writes owner data.
  mock.method(fs, 'readFileSync', (file, ...args) => {
    if (file === state) { if (saved == null) throw new Error('No cache'); return saved; }
    if (file === legacy) return JSON.stringify(old);
    return read(file, ...args);
  });
  mock.method(fs, 'existsSync', file => file === state ? saved != null : exists(file));
  mock.method(fs, 'mkdirSync', (file, ...args) => file === path.dirname(state) ? undefined : mkdir(file, ...args));
  mock.method(fs, 'writeFileSync', (file, data, ...args) => {
    if (file === `${state}.${process.pid}.tmp`) { pending = data; return; }
    return write(file, data, ...args);
  });
  mock.method(fs, 'renameSync', (from, to) => { if (to === state) { saved = pending; return; } return rename(from, to); });
  mock.method(Date, 'now', () => now);
  const { usage } = await import(`../usage.mjs?test=${process.pid}`);
  assert.deepEqual(JSON.parse(saved), old);
  assert.deepEqual(await usage([{ id: 'antigravity', installed: false, signedIn: true }, { id: 'antigravity', installed: true, signedIn: false }]), []);
  const agents = [{ id: 'antigravity', installed: true, signedIn: true }];
  const [first, concurrent] = await Promise.all([usage(agents), usage(agents)]);
  assert.deepEqual(first, concurrent);
  assert.equal(first[0].id, 'antigravity');
  assert.equal(first[0].windows[0].used, 39);
  assert.equal(first[0].error, null);
  assert.equal((await stub.calls()).length, 2);
  assert.deepEqual(await usage(agents), first);
  assert.equal((await stub.calls()).length, 2);
  now += 5 * 60000 + 1;
  await stub.write("process.stderr.write('private-auth-details'); process.exit(1)");
  const failed = await usage(agents);
  assert.deepEqual(failed[0].windows, first[0].windows);
  assert.equal(failed[0].updated, first[0].updated);
  assert.equal(failed[0].nextCheck, now + 30000);
  assert.match(failed[0].error, /check that agy is signed in/);
  assert.deepEqual(await usage(agents), failed);
  assert.equal((await stub.calls()).length, 4);
  now += 30001;
  assert.equal((await usage(agents))[0].nextCheck, now + 60000);
  await stub.write();
  now += 60001;
  const recovered = await usage(agents);
  assert.equal(recovered[0].error, null);
  assert.equal(recovered[0].updated, now);
  assert.deepEqual(JSON.parse(saved).codex, old.codex);
});

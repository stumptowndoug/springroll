// A run's report remembers the chat turn that published it, so the chat can show it there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../store.mjs';

test('report_turn is the turn that published it; publishing again marks it revised', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentd-report-'));
  try {
    const store = openStore(dir);
    const t = store.createThread({ agent: 'fake', cwd: dir, origin: 'job:x' });
    const run = store.startRun('x', t.id);
    store.addItem(t.id, 1, 'user', { text: 'go' });
    store.setReport(run, 'first', 'First', 'first', store.maxTurn(t.id));
    let r = store.run(run);
    assert.equal(r.report_turn, 1);
    assert.equal(r.report_revised, 0);
    store.addItem(t.id, 2, 'user', { text: 'a follow-up question' });
    r = store.run(run);
    assert.equal(r.report_turn, 1, 'a follow-up alone doesn\'t move it');
    store.setReport(run, 'second', 'Second', 'second', store.maxTurn(t.id));
    r = store.run(run);
    assert.equal(r.report_turn, 2);
    assert.equal(r.report_revised, 1);
    assert.equal(r.report, 'second');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// The chat runtime against a fake ACP agent: streaming, Stop, permissions, size limits.
//   node --test agentd/test/chat.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../store.mjs';
import { ThreadManager } from '../threads.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let dir, store, tm, events;
const ends = new Map();

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentd-test-'));
  store = openStore(dir);
  events = [];
  tm = new ThreadManager({ store, emit: (e) => events.push(e), notify() {}, mcpServers: () => [], cancelMs: 1500,
    agents: () => [{ id: 'fake', name: 'Fake', acp: [process.execPath, path.join(here, 'fake-agent.mjs')] }] });
  tm.onTurnEnd = (t, r) => { ends.set(t.id, [...(ends.get(t.id) || []), r]); };
});
after(() => { tm.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });

const until = async (f, ms = 10000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)); } };
async function chat(text) {
  const t = store.createThread({ agent: 'fake', cwd: os.tmpdir() });
  await tm.prompt(t.id, { text });
  return t.id;
}
const turnsEnded = (id, n = 1) => until(() => (ends.get(id) || []).length >= n);

test('streamed text: one item per message, batched, in order, replayable from events', async () => {
  const id = await chat('stream');
  await turnsEnded(id);
  const items = store.items(id);
  const texts = items.filter((i) => i.kind === 'text');
  assert.equal(texts.length, 2, 'a usage update mid-message must not split it');
  assert.equal(texts[0].text, Array.from({ length: 300 }, (_, i) => `w${i} `).join(''));
  const tool = items.findIndex((i) => i.kind === 'tool');
  assert.ok(items.indexOf(texts[0]) < tool && tool < items.indexOf(texts[1]), 'the tool call sits between the two messages');
  assert.equal(texts[1].text, '```py\nos.Path()\n```\nDone.\n\nNext part.', 'no paragraph break inside code; one between sentences');
  const mine = events.filter((e) => (e.item?.threadId ?? e.threadId) === id);
  assert.ok(mine.filter((e) => e.type === 'append').length < 30, 'appends are batched, not one per chunk');
  const client = new Map();
  for (const e of mine) {
    if (e.type === 'item') client.set(e.item.id, { ...e.item });
    if (e.type === 'append') { const it = client.get(e.id); assert.equal(it.text.length, e.from); it.text += e.text; }
  }
  for (const t of texts) assert.equal(client.get(t.id).text, t.text);
  assert.ok(ends.get(id)[0].text.endsWith('Next part.'), 'the final message reaches onTurnEnd');
});

test('Stop: the turn ends cancelled and messages queued behind it are not sent', async () => {
  const id = await chat('slow');
  await until(() => store.items(id).some((i) => i.kind === 'text'));
  await tm.prompt(id, { text: 'queued' });
  tm.cancel(id);
  await turnsEnded(id);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(ends.get(id)[0].stopReason, 'cancelled');
  const q = store.items(id).find((i) => i.text === 'queued');
  assert.ok(q.unsent && !q.queued);
  assert.equal(tm.running.has(id), false);
});

test('Stop: an agent that ignores it is closed', async () => {
  const id = await chat('hang');
  await until(() => store.items(id).some((i) => i.kind === 'text'));
  tm.cancel(id);
  await turnsEnded(id);
  assert.equal(ends.get(id)[0].stopReason, 'cancelled');
  assert.equal(tm.live.has(id), false);
  assert.match(store.items(id).find((i) => i.kind === 'notice').text, /didn't stop/);
});

test('Ask first: a request waits; switching to Full access answers it with allow once', async () => {
  const t = store.createThread({ agent: 'fake', cwd: os.tmpdir() });
  await tm.setAccess(t.id, 'ask');
  await tm.prompt(t.id, { text: 'ask' });
  await until(() => store.thread(t.id).status === 'waiting');
  await tm.setAccess(t.id, 'full');
  await turnsEnded(t.id);
  assert.equal(store.items(t.id).find((i) => i.kind === 'permission').outcome.optionId, 'once');
  assert.equal(ends.get(t.id)[0].text, 'got once');
});

test('size limits: large diffs are kept as a path, at most 8 per call; big images are dropped', async () => {
  const id = await chat('bigdiff');
  await turnsEnded(id);
  const diffs = store.items(id).find((i) => i.kind === 'tool').content;
  assert.equal(diffs.length, 8);
  assert.deepEqual(diffs[0], { type: 'diff', path: '/tmp/big.txt', truncated: true });
  const img = await chat('bigimage');
  await turnsEnded(img);
  assert.equal(store.items(img).some((i) => i.kind === 'media'), false);
  assert.match(store.items(img).find((i) => i.kind === 'notice').text, /too large/);
});

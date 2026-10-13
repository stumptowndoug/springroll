// The chat runtime against a fake ACP agent: streaming, Stop, permissions, size limits.
//   node --test agentd/test/chat.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../store.mjs';
import { ThreadManager, usableModels, mentionBlocks, listFiles } from '../threads.mjs';

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

test('a new agent\'s models are read from a short session and remembered', async () => {
  const o = await tm.probeOptions('fake');
  assert.deepEqual(o.models.map((m) => m.id), ['small', 'big']);
  assert.equal(o.currentModel, 'small');
  assert.deepEqual(store.agentOptions('fake').models.map((m) => m.id), ['small', 'big']);
});


test('models of providers without a key are hidden, and a usable one is picked to start on', () => {
  const auth = path.join(dir, 'auth.json');
  fs.writeFileSync(auth, JSON.stringify({ openrouter: { type: 'api' } }));
  const def = { providerAuth: { auth: [auth] }, preferModels: ['claude-sonnet', 'gpt-5'] };
  const ids = ['zen/big-pickle', 'openrouter/aion/aion-3', 'openrouter/anthropic/claude-sonnet-4-5-20250929', 'openrouter/anthropic/claude-sonnet-5', 'openai/gpt-5.2-pro', 'openai/gpt-5.2'];
  const o = { models: ids.map((id) => ({ id, name: id })), currentModel: 'zen/big-pickle' };
  const r = usableModels(o, def, {});
  assert.deepEqual(r.models.map((m) => m.id), ids.slice(1, 4));
  assert.equal(r.fallbackModel, 'openrouter/anthropic/claude-sonnet-5');
  const env = usableModels(o, { ...def, preferModels: ['gpt-5'] }, { OPENAI_API_KEY: 'x' });
  assert.equal(env.fallbackModel, 'openai/gpt-5.2', 'a key in the environment counts; the plain model over -pro');
  assert.equal(usableModels({ ...o, currentModel: 'openrouter/aion/aion-3' }, def, {}).fallbackModel, undefined, 'a usable current model stays');
  assert.equal(usableModels(o, { providerAuth: { auth: [path.join(dir, 'none.json')] } }, {}).models.length, ids.length, 'no keys at all: nothing hidden');
  assert.equal(usableModels(o, {}, {}), o, 'agents without providerAuth are left alone');
});

test('a queued message can be taken back; one already sent cannot', async () => {
  const id = await chat('slow');
  await until(() => store.items(id).some((i) => i.kind === 'text'));
  await tm.prompt(id, { text: 'never mind' });
  const q = store.items(id).find((i) => i.text === 'never mind');
  assert.equal(tm.removeUnsent(id, q.id).text, 'never mind');
  assert.equal(store.item(q.id), undefined);
  assert.ok(events.some((e) => e.type === 'removed' && e.id === q.id));
  const first = store.items(id).find((i) => i.kind === 'user');
  assert.throws(() => tm.removeUnsent(id, first.id), /already sent/);
  tm.cancel(id);
  await turnsEnded(id);
  assert.equal(store.items(id).filter((i) => i.kind === 'user').length, 1, 'nothing queued was sent');
});

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
test('attached images are kept as files and sent before the text, queued ones too', async () => {
  const t = store.createThread({ agent: 'fake', cwd: os.tmpdir() });
  await tm.prompt(t.id, { text: 'look', images: [{ mimeType: 'image/png', data: PNG, name: 'dot.png' }] });
  await turnsEnded(t.id);
  const u = store.items(t.id).find((i) => i.kind === 'user');
  assert.equal(u.images.length, 1);
  assert.equal(u.images[0].name, 'dot.png');
  assert.equal(fs.readFileSync(tm.imagePath(u.images[0].file)).toString('base64'), PNG);
  assert.equal(ends.get(t.id)[0].text, 'saw 1 images, first');
  assert.equal(store.thread(t.id).options.images, true, 'the agent said it reads images');
  const slow = await chat('slow');
  await until(() => store.items(slow).some((i) => i.kind === 'text'));
  await tm.prompt(slow, { text: '', images: [{ mimeType: 'image/png', data: PNG }, { mimeType: 'image/png', data: PNG }] });
  tm.cancel(slow);
  await turnsEnded(slow);
  assert.equal(store.items(slow).find((i) => i.unsent).images.length, 2, 'a message not sent keeps its images');
  await assert.rejects(tm.prompt(slow, { text: 'x', images: [{ mimeType: 'text/html', data: 'PGI+' }] }), /PNG, JPEG/);
  await assert.rejects(tm.prompt(slow, { text: '   ' }), /empty/);
});

test('@ mentions of files in the chat\'s folder become resource links in place; other @words stay text', () => {
  const cwd = fs.mkdtempSync(path.join(dir, 'proj-'));
  fs.mkdirSync(path.join(cwd, 'src'));
  fs.writeFileSync(path.join(cwd, 'src', 'a.js'), '');
  fs.mkdirSync(path.join(cwd, 'node_modules'));
  fs.writeFileSync(path.join(cwd, 'node_modules', 'x.js'), '');
  const b = mentionBlocks('look at @src/a.js. and @bob, not @../etc/passwd', cwd);
  assert.deepEqual(b.map((x) => x.type), ['text', 'resource_link', 'text']);
  assert.equal(b[0].text, 'look at ');
  assert.equal(b[1].uri, `file://${path.join(cwd, 'src', 'a.js')}`);
  assert.equal(b[2].text, '. and @bob, not @../etc/passwd');
  assert.deepEqual(mentionBlocks('plain', cwd), [{ type: 'text', text: 'plain' }]);
  assert.deepEqual(listFiles(cwd), ['src/a.js'], 'outside git: dependencies are skipped');
});

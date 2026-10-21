// The chat runtime against a fake ACP agent: streaming, Stop, permissions, size limits.
//   node --test agentd/test/chat.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '../store.mjs';
import { ThreadManager, usableModels, mentionBlocks, listFiles, memoryText } from '../threads.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let dir, store, tm, events, personas;
const ends = new Map();

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentd-test-'));
  store = openStore(dir);
  events = [];
  personas = path.join(dir, 'personas');
  fs.mkdirSync(personas);
  fs.writeFileSync(path.join(personas, 'pirate.md'), '---\nname: Pirate\nicon: anchor\n---\nTalk like a pirate.\n');
  tm = new ThreadManager({ store, emit: (e) => events.push(e), notify() {}, mcpServers: () => [], cancelMs: 1500, memoryFile: null, personasDir: personas,
    agents: () => ['fake', 'pi'].map((id) => ({ id, name: id, acp: [process.execPath, path.join(here, 'fake-agent.mjs')] })) });
  tm.onTurnEnd = (t, r) => { ends.set(t.id, [...(ends.get(t.id) || []), r]); };
});
after(() => { tm.shutdown(); fs.rmSync(dir, { recursive: true, force: true }); });

const until = async (f, ms = 10000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 20)); } };
async function chat(text, agent = 'fake') {
  const t = store.createThread({ agent, cwd: os.tmpdir() });
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

test('the handshake: Springroll says its real version; the adapter\'s name and version are kept on the chat', async () => {
  const id = await chat('whoami');
  await turnsEnded(id);
  const sent = JSON.parse(store.items(id).find((i) => i.kind === 'text').text);
  assert.equal(sent.name, 'springroll');
  assert.notEqual(sent.version, '0.1');
  assert.deepEqual(store.thread(id).options.agentInfo, { name: 'fake-acp', title: 'Fake adapter', version: '9.9.9' });
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

test('delegated agents: an agent item in the turn, its own transcript, unknown sessions ignored', async () => {
  const id = await chat('delegate');
  await turnsEnded(id);
  await until(() => store.items(id).find((i) => i.kind === 'agent')?.state === 'completed');
  const items = store.items(id);
  const a = items.find((i) => i.kind === 'agent');
  assert.equal(a.name, 'Explorer');
  assert.equal(a.task, 'Find the config');
  assert.ok(a.ended);
  const mine = items.filter((i) => i.worker === 'c1');
  assert.deepEqual(mine.map((i) => i.kind), ['tool', 'text']);
  assert.equal(mine[1].text, 'Found it');
  assert.ok(!items.some((i) => i.text === 'not mine'));
  assert.equal(ends.get(id)[0].text, 'Delegated.', "the chat's answer is its own agent's");
  assert.deepEqual(store.thread(id).commands, [], "a delegated agent's commands aren't the chat's");
});

test('background tasks: a task item in the turn, its output streamed, its end recorded; the call is marked backgrounded', async () => {
  const id = await chat('bgrun');
  await turnsEnded(id);
  const task = () => store.items(id).find((i) => i.kind === 'task');
  assert.equal(task().state, 'running');
  assert.equal(task().description, 'Build the thing');
  assert.equal(task().turn, store.items(id).find((i) => i.kind === 'tool').turn, "in the turn of the call that started it");
  assert.deepEqual(tm.background(id).map((b) => [b.kind, b.id, b.stoppable]), [['task', 'bg1', true]]);
  await until(() => task().state === 'completed');
  assert.ok(task().ended);
  const tool = store.items(id).find((i) => i.kind === 'tool');
  await until(() => store.item(tool.id).exitCode === 0);
  assert.equal(store.item(tool.id).output, 'step 1\nstep 2\nstep 3\n', 'chunks kept in order, none lost to batching');
  assert.ok(store.item(tool.id).backgrounded);
  assert.deepEqual(tm.taskOutput(id, 'bg1'), { text: 'step 1\nstep 2\nstep 3\n', exitCode: 0 });
  assert.deepEqual(tm.background(id), []);
});

test('background tasks: Stop goes to the adapter; an agent that goes away takes its tasks with it', async () => {
  const id = await chat('bghold');
  await turnsEnded(id);
  assert.equal(await tm.stopTask(id, 'nope'), false);
  assert.equal(await tm.stopTask(id, 'bg2'), true);
  await until(() => store.items(id).find((i) => i.kind === 'task').state === 'stopped');
  const id2 = await chat('bghold');
  await turnsEnded(id2);
  tm.stop(id2);
  await until(() => store.items(id2).find((i) => i.kind === 'task').state === 'disconnected');
});

test("a finished job run's agent is stopped; a chat's stays", async () => {
  const job = store.createThread({ agent: 'fake', cwd: os.tmpdir(), origin: 'job:test' });
  await tm.prompt(job.id, { text: 'hello' });
  const id = await chat('hello');
  await turnsEnded(job.id);
  await turnsEnded(id);
  tm.reapJobs(10 * 60 * 1000);
  assert.ok(tm.live.has(job.id), 'not before it has been idle a while');
  tm.reapJobs(0);
  assert.ok(!tm.live.has(job.id));
  assert.ok(tm.live.has(id));
  await tm.prompt(job.id, { text: 'again' });
  await turnsEnded(job.id, 2);
  assert.ok(!ends.get(job.id)[1].error, 'a reply starts it again');
});

test("a job run's agent stays while it has a background task or a Monitor before its deadline", async () => {
  for (const text of ['bghold', 'monitor']) {
    const job = store.createThread({ agent: 'fake', cwd: os.tmpdir(), origin: 'job:test' });
    await tm.prompt(job.id, { text });
    await turnsEnded(job.id);
    tm.reapJobs(0);
    assert.ok(tm.live.has(job.id), text);
    tm.stop(job.id);
  }
});

test('agents that never report background work are asked to work in the foreground', async () => {
  const pi = await chat('echoall', 'pi'), fake = await chat('echoall');
  await turnsEnded(pi); await turnsEnded(fake);
  const said = (id) => store.items(id).find((i) => i.kind === 'text').text;
  assert.match(said(pi), /Run commands in the foreground/);
  assert.doesNotMatch(said(fake), /foreground/);
});

test('memory: sent to a fresh session unless Claude already has it from ~/home/CLAUDE.md', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-')), file = path.join(home, 'notes', 'memory.md');
  assert.equal(memoryText('codex', home, file), null, 'no file, nothing sent');
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, '# Memory\n- Prefers short answers.\n');
  assert.match(memoryText('codex', home, file), /^\[Memory from Springroll: .*\]\n# Memory\n- Prefers short answers\.$/);
  assert.equal(memoryText('claude', home, file), null);
  assert.equal(memoryText('claude', path.join(home, 'jobs'), file), null);
  assert.ok(memoryText('claude', '/tmp/elsewhere', file), 'Claude outside ~/home gets it');
  assert.ok(memoryText('claude', home + '-other', file), 'a sibling folder is not ~/home');
  assert.equal(memoryText('codex', home, null), null);
  fs.rmSync(home, { recursive: true, force: true });
});

test('personas: /persona switches, the next prompt carries the preset, later ones a reminder, off says so', async () => {
  const id = await chat('echoall');
  await turnsEnded(id);
  const said = () => JSON.parse(store.items(id).filter((i) => i.kind === 'text').at(-1).text);
  assert.deepEqual(said(), ['echoall'], 'no persona, nothing added');
  assert.deepEqual(await tm.prompt(id, { text: '/persona pirate' }), { queued: false, persona: 'pirate' });
  assert.equal(store.thread(id).persona, 'pirate');
  assert.equal(store.items(id).at(-1).text, 'Persona: Pirate');
  await tm.prompt(id, { text: 'echoall' });
  await turnsEnded(id, 2);
  assert.match(said()[0], /^\[Persona: Pirate\. The owner asked you to play this part.*\]\nTalk like a pirate\.$/);
  await tm.prompt(id, { text: 'echoall' });
  await turnsEnded(id, 3);
  assert.match(said()[0], /^\[Persona: Pirate \(.*pirate\.md\): stay in character\. Only the voice changes/);
  await tm.prompt(id, { text: '/persona' });
  assert.match(store.items(id).at(-1).text, /^Persona: Pirate\. Switch with \/persona <name> \(pirate\)/);
  assert.throws(() => tm.setPersona(id, 'nobody'), /no persona nobody \(have: pirate\)/);
  await tm.prompt(id, { text: '/persona off' });
  await tm.prompt(id, { text: 'echoall' });
  await turnsEnded(id, 4);
  assert.deepEqual(said(), ['[Persona off: from now on, speak in your normal voice.]', 'echoall']);
  await tm.prompt(id, { text: 'echoall' });
  await turnsEnded(id, 5);
  assert.deepEqual(said(), ['echoall']);
  assert.equal(store.items(id).filter((i) => i.kind === 'user').length, 5, '/persona messages are not user messages');
});

// A fake ACP agent for the chat tests. What it does depends on the prompt's text:
//   stream   300 chunks of one message (a usage update in the middle), a tool call, then text
//            without message ids: a code block and two sentences
//   hang     says "working" and never finishes (ignores session/cancel)
//   slow     streams slowly until cancelled
//   ask      asks permission, then says which option it got
//   bigdiff  an edit with 10 diffs, the first 3000 lines long
//   bigimage an image of 5 MB
import readline from 'node:readline';

const send = (o) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n');
const update = (u) => send({ method: 'session/update', params: { sessionId: 's1', update: u } });
const say = (text, messageId) => update({ sessionUpdate: 'agent_message_chunk', ...(messageId ? { messageId } : {}), content: { type: 'text', text } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waiting = new Map();
let nextId = 1000, cancelled = false;

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  const m = JSON.parse(line);
  if (m.id != null && !m.method) return waiting.get(m.id)?.(m.result);
  if (m.method === 'initialize') return send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: false } } });
  if (m.method === 'session/new') return send({ id: m.id, result: { sessionId: 's1', configOptions: [{ id: 'model', category: 'model', type: 'select', name: 'Model', currentValue: 'small', options: [{ value: 'small', name: 'Small' }, { value: 'big', name: 'Big' }] }] } });
  if (m.method === 'session/cancel') { cancelled = true; return; }
  if (m.method !== 'session/prompt') return;
  cancelled = false;
  const text = m.params.prompt.map((p) => p.text).join(' ');
  const done = (stopReason = 'end_turn') => send({ id: m.id, result: { stopReason } });
  if (/hang/.test(text)) return say('working');
  if (/slow/.test(text)) {
    for (let i = 0; i < 200; i++) { if (cancelled) return done('cancelled'); say(`s${i} `, 'm1'); await sleep(50); }
    return done();
  }
  if (/stream/.test(text)) {
    for (let i = 0; i < 300; i++) {
      say(`w${i} `, 'm1');
      if (i === 150) update({ sessionUpdate: 'usage_update', used: 10, size: 100 });
      if (i % 50 === 0) await sleep(5);
    }
    update({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'ls', kind: 'execute', status: 'completed' });
    for (const c of ['```py\nos.', 'Path()\n```\nDone.', 'Next part.']) say(c);
    return done();
  }
  if (/ask/.test(text)) {
    const id = nextId++;
    const options = [{ optionId: 'no', name: 'Reject', kind: 'reject_once' }, { optionId: 'always', name: 'Always', kind: 'allow_always' }, { optionId: 'once', name: 'Allow', kind: 'allow_once' }];
    send({ id, method: 'session/request_permission', params: { sessionId: 's1', toolCall: { toolCallId: 't2', title: 'rm -rf build' }, options } });
    const r = await new Promise((resolve) => waiting.set(id, resolve));
    say(`got ${r.outcome.optionId || r.outcome.outcome}`);
    return done();
  }
  if (/bigdiff/.test(text)) {
    const big = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join('\n');
    const content = [{ type: 'diff', path: '/tmp/big.txt', oldText: '', newText: big }, ...Array.from({ length: 9 }, (_, i) => ({ type: 'diff', path: `/tmp/f${i}`, oldText: 'a', newText: 'b' }))];
    update({ sessionUpdate: 'tool_call', toolCallId: 't3', title: 'Edit', kind: 'edit', status: 'completed', content });
    return done();
  }
  if (/bigimage/.test(text)) {
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'image', mimeType: 'image/png', data: 'A'.repeat(5 * 2 ** 20) } });
    return done();
  }
  done();
});

// A fake ACP agent for the chat tests. What it does depends on the prompt's text:
//   stream   300 chunks of one message (a usage update in the middle), a tool call, then text
//            without message ids: a code block and two sentences
//   hang     says "working" and never finishes (ignores session/cancel)
//   slow     streams slowly until cancelled
//   ask      asks permission, then says which option it got
//   bigdiff  an edit with 10 diffs, the first 3000 lines long
//   bigimage an image of 5 MB
//   delegate starts a delegated agent (session c1) that reads a file and answers, while the root answers too;
//            a session nobody announced says something that must not show
//   look     says how many images came with the prompt, and whether they came before the text
import readline from 'node:readline';

const send = (o) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...o }) + '\n');
const update = (u, sessionId = 's1') => send({ method: 'session/update', params: { sessionId, update: u } });
const say = (text, messageId) => update({ sessionUpdate: 'agent_message_chunk', ...(messageId ? { messageId } : {}), content: { type: 'text', text } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waiting = new Map();
let nextId = 1000, cancelled = false;

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  const m = JSON.parse(line);
  if (m.id != null && !m.method) return waiting.get(m.id)?.(m.result);
  if (m.method === 'initialize') return send({ id: m.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: false, promptCapabilities: { image: true } } } });
  if (m.method === 'session/new') return send({ id: m.id, result: { sessionId: 's1', configOptions: [{ id: 'model', category: 'model', type: 'select', name: 'Model', currentValue: 'small', options: [{ value: 'small', name: 'Small' }, { value: 'big', name: 'Big' }] }] } });
  if (m.method === 'session/cancel') { cancelled = true; return; }
  if (m.method !== 'session/prompt') return;
  cancelled = false;
  const text = m.params.prompt.map((p) => p.text || '').join(' ');
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
  if (/delegate/.test(text)) {
    update({ sessionUpdate: 'subagent_spawned', subagentSessionId: 'c1', name: 'Explorer', task: 'Find the config', prompt: 'Look around' });
    update({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Read', kind: 'read', status: 'completed', rawInput: { path: '/tmp/a' } }, 'c1');
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Found it' } }, 'c1');
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'not mine' } }, 'zz');
    say('Delegated.');
    update({ sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'child-only' }] }, 'c1');
    update({ sessionUpdate: 'subagent_state_update', subagentSessionId: 'c1', state: 'completed' });
    return done();
  }
  if (/look/.test(text)) {
    const kinds = m.params.prompt.map((p) => p.type);
    say(`saw ${kinds.filter((k) => k === 'image').length} images${kinds.indexOf('image') < kinds.indexOf('text') ? ', first' : ''}`);
    return done();
  }
  if (/bigimage/.test(text)) {
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'image', mimeType: 'image/png', data: 'A'.repeat(5 * 2 ** 20) } });
    return done();
  }
  done();
});

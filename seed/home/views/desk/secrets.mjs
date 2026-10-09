// Keys: the owner's secrets as NAME=value. One store: ~/.config/springroll/secrets.env (mode 600,
// exported into every new agent session and job), shared with Connections' key fields. Notes and
// dates live beside it in secrets.json. Values never leave this module except on an explicit reveal.
// Agents ask for a key with `secret request NAME "why"` (a Home "Needs you" card); the owner's answer
// is saved here and the asking chat is told it's ready.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { readSecrets, writeSecrets, catalogKeys } from './connections.mjs';

const HOME = os.homedir();
const CONF = path.join(HOME, '.config', 'springroll');
const META = path.join(CONF, 'secrets.json');
const AGENTD = 'http://127.0.0.1:8090';
export const NAME_RE = /^[A-Z_][A-Z0-9_]{0,63}$/;

// Sign-ins Springroll keeps in their own files: listed so the page covers everything, not editable here.
const MANAGED = [
  { file: 'claude-token', name: 'Claude sign-in', note: 'Claude Code token (Settings → Coding agents)' },
  { file: 'gmail', name: 'Gmail sign-in', note: 'Mail app (address and app password)' },
  { file: 'backup-passphrase', name: 'Backup passphrase', note: 'Encrypts keys in backups (Settings → Backups)' },
];

const readMeta = () => { try { return JSON.parse(fs.readFileSync(META, 'utf8')); } catch { return {}; } };
const writeMeta = (m) => { fs.mkdirSync(CONF, { recursive: true }); fs.writeFileSync(META, JSON.stringify(m, null, 2) + '\n', { mode: 0o600 }); };
const hint = (v) => (v.length >= 12 ? `••••${v.slice(-4)}` : '••••');

// Where a key is used: the owner's apps, jobs and connection configs that mention it as a whole word.
function usedBy(names) {
  if (!names.length) return Promise.resolve({});
  return new Promise((resolve) => {
    execFile('git', ['-C', path.join(HOME, 'home'), 'grep', '-n', '-w', '-I', ...names.flatMap((n) => ['-e', n]), '--', 'views', 'jobs', 'connections', ':!views/desk', ':!views/settings', ':!views/gallery', ':!connections/catalog.json', ':!connections/README.md'],
      { maxBuffer: 4 << 20, timeout: 8000 }, (err, out) => {
        const map = {};
        for (const line of (out || '').split('\n')) {
          const file = line.split(':')[0];
          if (!file) continue;
          const where = file.match(/^(views|jobs|connections)\/([^/]+)/);
          const label = where ? `${where[1] === 'views' ? 'app' : where[1] === 'jobs' ? 'job' : 'connection'} ${where[2]}` : file;
          for (const n of names) if (new RegExp(`\\b${n}\\b`).test(line.slice(file.length))) (map[n] ||= new Set()).add(label);
        }
        resolve(Object.fromEntries(Object.entries(map).map(([k, v]) => [k, [...v].slice(0, 6)])));
      });
  });
}

export async function listSecrets() {
  const secrets = readSecrets(), meta = readMeta(), owners = catalogKeys();
  const names = Object.keys(secrets).sort();
  const used = await usedBy(names);
  const keys = names.map((name) => ({
    name, hint: hint(secrets[name]), note: meta[name]?.note || owners[name]?.label || '', updated: meta[name]?.updated || null,
    connection: owners[name]?.id || null, connectionName: owners[name]?.name || null, usedBy: used[name] || [],
  }));
  const managed = MANAGED.filter((m) => fs.existsSync(path.join(CONF, m.file))).map((m) => ({ ...m, updated: fs.statSync(path.join(CONF, m.file)).mtimeMs }));
  let requests = [];
  try { requests = (await (await fetch(`${AGENTD}/signals`)).json()).filter((s) => s.key?.startsWith('secret:')).map((s) => ({ name: s.key.slice(7), why: s.body, from: s.source, thread: s.thread_id, at: s.updated, have: !!secrets[s.key.slice(7)] })); } catch {}
  return { keys, managed, requests };
}

export async function setSecret({ name, value, note }) {
  if (!NAME_RE.test(name || '')) throw new Error('Names are capital letters, digits and _ (like OPENAI_API_KEY)');
  const secrets = readSecrets(), meta = readMeta();
  if (value != null && value !== '') {
    if (/[\r\n]/.test(value)) throw new Error('A key is one line');
    secrets[name] = value;
    writeSecrets(secrets);
    meta[name] = { ...(meta[name] || {}), updated: Date.now() };
  } else if (!secrets[name]) throw new Error('A key needs a value');
  if (typeof note === 'string') meta[name] = { ...(meta[name] || {}), note: note.trim().slice(0, 200) };
  writeMeta(meta);
  if (value) await answerRequest(name);
  return { ok: true };
}

export function revealSecret(name) {
  const v = readSecrets()[name];
  if (v == null) throw new Error('No such key');
  return { value: v };
}

export function deleteSecret(name) {
  const secrets = readSecrets(), meta = readMeta();
  if (secrets[name] == null) throw new Error('No such key');
  if (catalogKeys()[name]) throw new Error(`Used by the ${catalogKeys()[name].name} connection: disconnect it from Services instead`);
  delete secrets[name]; delete meta[name];
  writeSecrets(secrets); writeMeta(meta);
  return { ok: true };
}

// An agent asked for this key: take the card off Home and tell the asking chat it's there.
async function answerRequest(name) {
  let sig = null;
  try { sig = (await (await fetch(`${AGENTD}/signals`)).json()).find((s) => s.key === `secret:${name}`); } catch {}
  if (!sig) return;
  await fetch(`${AGENTD}/signals/clear`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: `secret:${name}` }) }).catch(() => {});
  if (sig.thread_id) {
    const text = `The owner saved ${name} in Springroll's Keys. New sessions have it as $${name}; in this one use "$(secret get ${name})" inline. Never print or echo it. Carry on with what you needed it for.`;
    await fetch(`${AGENTD}/threads/${sig.thread_id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) }).catch(() => {});
  }
}

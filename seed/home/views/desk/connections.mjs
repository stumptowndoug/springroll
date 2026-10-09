// Connections: credentials for outside services, from connections/catalog.json.
// Values go to ~/.config/agentos/secrets.env (mode 600, exported into every
// agent session); connections/<id>/connection.json records what's connected.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';

const HOME = os.homedir();
const DIR = path.join(HOME, 'home', 'connections');
const SECRETS = path.join(HOME, '.config', 'agentos', 'secrets.env');

function catalog() {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, 'catalog.json'), 'utf8')); } catch { return []; }
}

export function readSecrets() {
  const out = {};
  try {
    for (const line of fs.readFileSync(SECRETS, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)='(.*)'$/);
      if (m) out[m[1]] = m[2].replace(/'\\''/g, "'");
    }
  } catch {}
  return out;
}

function writeSecrets(values) {
  const lines = Object.entries(values).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}='${String(v).replace(/'/g, "'\\''")}'`);
  fs.mkdirSync(path.dirname(SECRETS), { recursive: true });
  fs.writeFileSync(SECRETS, `# Secrets for connected services (AgentOS). Exported into agent sessions. Never commit.\n${lines.join('\n')}\n`, { mode: 0o600 });
  fs.chmodSync(SECRETS, 0o600);
}

function connection(id) {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, id, 'connection.json'), 'utf8')); } catch { return null; }
}

export function listConnections() {
  const secrets = readSecrets();
  return catalog().map((c) => {
    const conn = connection(c.id);
    const have = (c.fields || []).map((f) => f.key).filter((k) => secrets[k]);
    return {
      ...c, test: undefined, after: undefined,
      connected: !!conn && have.length === (c.fields || []).length,
      connectedAt: conn?.connectedAt || null, lastTest: conn?.lastTest || null,
      mcpEnabled: fs.existsSync(path.join(DIR, c.id, 'mcp.json')),
      // Non-secret values are shown back; secrets only as "set".
      values: Object.fromEntries((c.fields || []).map((f) => [f.key, f.secret ? (secrets[f.key] ? '••••••••' : '') : secrets[f.key] || ''])),
    };
  });
}

function runWith(cmd, env) {
  return new Promise((resolve) => {
    execFile('bash', ['-c', cmd], { env: { ...process.env, ...env, HOME }, timeout: 30000 }, (err, stdout, stderr) =>
      resolve({ ok: !err, output: (stdout || stderr || (err ? err.message : '')).trim().split('\n').slice(-6).join('\n').slice(0, 600) }));
  });
}

export async function connect(id, values = {}) {
  const c = catalog().find((x) => x.id === id);
  if (!c) throw new Error('unknown service');
  const secrets = readSecrets();
  const env = {};
  for (const f of c.fields || []) {
    let v = values[f.key];
    if (v === '••••••••' || v == null || v === '') v = secrets[f.key]; // unchanged secret
    if (!v) throw new Error(`${f.label} is required`);
    env[f.key] = String(v).trim();
  }
  const test = c.test ? await runWith(c.test, { ...secrets, ...env }) : { ok: true, output: 'Saved' };
  if (!test.ok) return { ok: false, output: test.output };
  writeSecrets({ ...secrets, ...env });
  fs.mkdirSync(path.join(DIR, id), { recursive: true });
  fs.writeFileSync(path.join(DIR, id, 'connection.json'), JSON.stringify({ service: id, keys: Object.keys(env), connectedAt: Date.now(), lastTest: { at: Date.now(), ok: true, output: test.output } }, null, 2) + '\n');
  if (c.after) await runWith(c.after, { ...secrets, ...env });
  commit(`Connect ${c.name}`);
  return { ok: true, output: test.output };
}

export async function testConnection(id) {
  const c = catalog().find((x) => x.id === id);
  if (!c?.test) return { ok: true, output: 'Nothing to test' };
  const r = await runWith(c.test, readSecrets());
  const conn = connection(id);
  if (conn) fs.writeFileSync(path.join(DIR, id, 'connection.json'), JSON.stringify({ ...conn, lastTest: { at: Date.now(), ...r } }, null, 2) + '\n');
  return r;
}

export function setMcp(id, enabled) {
  const c = catalog().find((x) => x.id === id);
  if (!c?.mcp) throw new Error('this service has no MCP server');
  const f = path.join(DIR, id, 'mcp.json');
  if (enabled) { fs.mkdirSync(path.dirname(f), { recursive: true }); const { note, ...m } = c.mcp; fs.writeFileSync(f, JSON.stringify({ name: id, ...m }, null, 2) + '\n'); }
  else fs.rmSync(f, { force: true });
  commit(`${enabled ? 'Enable' : 'Disable'} ${c.name} MCP`);
}

export function disconnect(id) {
  const c = catalog().find((x) => x.id === id);
  if (!c) throw new Error('unknown service');
  const secrets = readSecrets();
  for (const f of c.fields || []) delete secrets[f.key];
  writeSecrets(secrets);
  fs.rmSync(path.join(DIR, id), { recursive: true, force: true });
  commit(`Disconnect ${c.name}`);
}

function commit(msg) {
  execFile('bash', ['-c', `cd ~/home && git add -A connections && git commit -qm "${msg.replace(/"/g, '')}"`], () => {});
}

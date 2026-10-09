// Connections: credentials for outside services, from connections/catalog.json.
// Two ways in: keys (fields), which go to ~/.config/agentos/secrets.env (mode
// 600, exported into every agent session), or a sign-in (signin), where the
// service's own CLI signs in and keeps its credentials (e.g. gh's device flow).
// connections/<id>/connection.json records what's connected and how.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile, spawn } from 'node:child_process';

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
  fs.writeFileSync(SECRETS, `# Secrets for connected services (Springroll). Exported into agent sessions. Never commit.\n${lines.join('\n')}\n`, { mode: 0o600 });
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
    const method = conn?.method === 'signin' ? 'signin' : conn ? 'token' : null;
    return {
      ...c, test: undefined, after: undefined,
      signin: c.signin ? { label: c.signin.label, note: c.signin.note } : undefined, method,
      connected: method === 'signin' || (!!conn && have.length === (c.fields || []).length),
      connectedAt: conn?.connectedAt || null, lastTest: conn?.lastTest || null,
      mcpEnabled: fs.existsSync(path.join(DIR, c.id, 'mcp.json')),
      // Non-secret values are shown back; secrets only as "set".
      values: Object.fromEntries((c.fields || []).map((f) => [f.key, f.secret ? (secrets[f.key] ? '••••••••' : '') : secrets[f.key] || ''])),
    };
  });
}

function runWith(cmd, env, timeout = 30000) {
  return new Promise((resolve) => {
    execFile('bash', ['-c', cmd], { env: { ...process.env, ...env, HOME }, timeout }, (err, stdout, stderr) =>
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
  const viaSignin = connection(id)?.method === 'signin';
  const test = viaSignin ? c?.signin?.test : c?.test;
  if (!test) return { ok: true, output: 'Nothing to test' };
  const r = await runWith(test, viaSignin ? withoutKeys(c, readSecrets()) : readSecrets());
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

export async function disconnect(id) {
  const c = catalog().find((x) => x.id === id);
  if (!c) throw new Error('unknown service');
  if (connection(id)?.method === 'signin' && c.signin?.logout) await runWith(c.signin.logout, withoutKeys(c, readSecrets()));
  const secrets = readSecrets();
  for (const f of c.fields || []) delete secrets[f.key];
  writeSecrets(secrets);
  fs.rmSync(path.join(DIR, id), { recursive: true, force: true });
  commit(`Disconnect ${c.name}`);
}

/* ---------- Sign-in: run the service's CLI login and relay its device code ---------- */
// The catalog's signin: {needs, install, command, test, after, logout}. command must
// print a one-time code and a URL, then wait until the owner approves in a browser.
const signins = new Map(); // id -> {state: starting|waiting|done|failed, code, url, output, proc}

// The service's own keys are left out so the CLI stores its own sign-in
// (gh refuses to sign in while GH_TOKEN is set).
function withoutKeys(c, secrets) {
  const env = { ...secrets };
  for (const f of c.fields || []) { delete env[f.key]; env[f.key] = ''; }
  return env;
}

export async function startSignin(id) {
  const c = catalog().find((x) => x.id === id);
  if (!c?.signin) throw new Error('this service has no sign-in');
  const cur = signins.get(id);
  if (cur && (cur.state === 'starting' || cur.state === 'waiting')) return publicSignin(cur);
  const s = { state: 'starting', code: null, url: null, output: '', step: null };
  signins.set(id, s);
  const env = { ...process.env, ...withoutKeys(c, readSecrets()), HOME };
  if (c.signin.needs && !(await runWith(`command -v ${c.signin.needs}`, env)).ok) {
    s.step = `Installing ${c.signin.needs}`;
    const r = await runWith(c.signin.install, env, 300000);
    if (!r.ok) { Object.assign(s, { state: 'failed', output: `Couldn't install ${c.signin.needs}:\n${r.output}` }); return publicSignin(s); }
  }
  s.step = null;
  const proc = spawn('bash', ['-c', c.signin.command], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  s.proc = proc;
  const onData = (d) => {
    s.output = (s.output + d).slice(-4000);
    s.code ??= s.output.match(/one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i)?.[1] || null;
    s.url ??= s.output.match(/https:\/\/\S+\/device\S*/)?.[0] || null;
    if (s.code && s.url && s.state === 'starting') s.state = 'waiting';
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  const timer = setTimeout(() => proc.kill(), 15 * 60 * 1000); // device codes expire after 15 minutes
  proc.on('close', async (code) => {
    clearTimeout(timer);
    s.proc = null;
    if (s.state === 'cancelled') return;
    if (code !== 0) { Object.assign(s, { state: 'failed', output: s.output.trim().split('\n').slice(-6).join('\n') || `Sign-in stopped (${code})` }); return; }
    if (c.signin.after) await runWith(c.signin.after, env);
    const test = c.signin.test ? await runWith(c.signin.test, env) : { ok: true, output: 'Signed in' };
    fs.mkdirSync(path.join(DIR, id), { recursive: true });
    fs.writeFileSync(path.join(DIR, id, 'connection.json'), JSON.stringify({ service: id, method: 'signin', connectedAt: Date.now(), lastTest: { at: Date.now(), ...test } }, null, 2) + '\n');
    commit(`Connect ${c.name} (sign-in)`);
    Object.assign(s, { state: test.ok ? 'done' : 'failed', output: test.output });
  });
  // Wait briefly for the code so the first response can show it.
  for (let i = 0; i < 60 && s.state === 'starting'; i++) await new Promise((r) => setTimeout(r, 250));
  return publicSignin(s);
}

const publicSignin = (s) => (s ? { state: s.state, code: s.code, url: s.url, step: s.step, output: s.state === 'failed' || s.state === 'done' ? s.output : undefined } : { state: 'idle' });
export const signinStatus = (id) => publicSignin(signins.get(id));
export function cancelSignin(id) {
  const s = signins.get(id);
  if (s?.proc) { s.state = 'cancelled'; s.proc.kill(); }
  signins.delete(id);
}

function commit(msg) {
  execFile('bash', ['-c', `cd ~/home && git add -A connections && git commit -qm "${msg.replace(/"/g, '')}"`], () => {});
}

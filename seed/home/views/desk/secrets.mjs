// Keys: the owner's secrets as NAME=value. One store: ~/.config/springroll/secrets.env (mode 600,
// exported into every new agent session and job), shared with Connections' key fields. Notes and
// dates live beside it in secrets.json. Values never leave this module except on an explicit reveal,
// which the owner can turn off (Settings → Keys: desk.json keys.reveal).
// Agents ask for a key with `secret request NAME "why"` (a "Needs you" card on the Timeline and in Keys); the owner's answer
// is saved here and the asking chat is told it's ready.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { readSecrets, writeSecrets, catalogKeys } from './connections.mjs';

const HOME = os.homedir();
const CONF = path.join(HOME, '.config', 'springroll');
const META = path.join(CONF, 'secrets.json');
const SETTINGS = path.join(HOME, 'home', 'desk.json');
const AGENTD = `http://127.0.0.1:${Number(process.env.SPRINGROLL_AGENTD_PORT) || 8090}`;
export const NAME_RE = /^[A-Z_][A-Z0-9_]{0,63}$/;

// Sign-ins Springroll keeps in their own files: listed so the page covers everything, changed where
// `href` points. The backup passphrase can be revealed: restoring on a new machine needs it.
const MANAGED = [
  { file: 'claude-token', name: 'Claude sign-in', note: 'Claude Code token', href: '#/connections' },
  { file: 'google.json', name: 'Gmail accounts', note: 'App passwords and Google sign-ins', href: '#/connections' },
  { file: 'backup-passphrase', name: 'Backup passphrase', note: 'Encrypts backups. Restoring needs it: keep a copy off this machine', href: '#/v/settings#backups', reveal: true },
];

export function revealAllowed() {
  try { return JSON.parse(fs.readFileSync(SETTINGS, 'utf8')).keys?.reveal !== false; } catch { return true; }
}

const readMeta = () => { try { return JSON.parse(fs.readFileSync(META, 'utf8')); } catch { return {}; } };
const writeMeta = (m) => { fs.mkdirSync(CONF, { recursive: true }); fs.writeFileSync(META, JSON.stringify(m, null, 2) + '\n', { mode: 0o600 }); };
// What a masked value shows: the last four characters of a long token, the kind of a JSON key.
function hint(v) {
  if (/^[{[]/.test(v)) { try { const j = JSON.parse(v); return j.type === 'service_account' ? 'service account' : 'JSON'; } catch {} }
  return v.length >= 12 ? `••••${v.slice(-4)}` : '••••';
}
// A key is one line; a pasted JSON file (a service account key) is kept as one line of JSON.
function normalize(value) {
  const v = value.trim();
  if (/^[{[]/.test(v)) { try { return JSON.stringify(JSON.parse(v)); } catch { throw new Error("That looks like JSON but doesn't parse"); } }
  if (/[\r\n]/.test(v)) throw new Error('A key is one line (a JSON file is fine too)');
  return v;
}
// The project a job works in: its job.json cwd under ~/projects/<name>, else none.
const jobProject = (name) => {
  try { return JSON.parse(fs.readFileSync(path.join(HOME, 'home', 'jobs', name, 'job.json'), 'utf8')).cwd?.match(/^~\/projects\/([^/]+)/)?.[1] || null; } catch { return null; }
};
const title = (kind, name) => {
  if (kind === 'command') return `${name} command`;
  try {
    if (kind === 'app') return fs.readFileSync(path.join(HOME, 'home', 'views', name, 'README.md'), 'utf8').match(/^#\s+(.+)$/m)?.[1].trim() || name;
    if (kind === 'job') return JSON.parse(fs.readFileSync(path.join(HOME, 'home', 'jobs', name, 'job.json'), 'utf8')).title || name;
  } catch {}
  return name;
};

// Where a key is used: the owner's apps, jobs and commands (bin/) that mention it as a whole word.
// The Dev app is left out here: its recipes say exactly which project uses which key (projectKeys).
function usedBy(names) {
  if (!names.length) return Promise.resolve({});
  return new Promise((resolve) => {
    execFile('git', ['-C', path.join(HOME, 'home'), 'grep', '-n', '-w', '-I', ...names.flatMap((n) => ['-e', n]), '--', 'views', 'jobs', 'bin', ':!views/desk', ':!views/settings', ':!views/gallery', ':!views/dev', ':!bin/secret'],
      { maxBuffer: 4 << 20, timeout: 8000 }, (err, out) => {
        const map = {};
        for (const line of (out || '').split('\n')) {
          const where = line.match(/^(views|jobs|bin)\/([^/:]+)/);
          if (!where) continue;
          const kind = { views: 'app', jobs: 'job', bin: 'command' }[where[1]], id = `${kind}:${where[2]}`;
          for (const n of names) if (new RegExp(`\\b${n}\\b`).test(line.slice(line.indexOf(':')))) (map[n] ||= new Map()).set(id, { kind, name: where[2] });
        }
        resolve(Object.fromEntries(Object.entries(map).map(([k, v]) => [k, [...v.values()].slice(0, 6).map((u) => ({
          ...u, title: title(u.kind, u.name), href: u.kind === 'app' ? `#/v/${u.name}` : u.kind === 'job' ? `#/jobs/${u.name}` : null,
          ...(u.kind === 'job' && jobProject(u.name) ? { project: jobProject(u.name) } : {}) }))])));
      });
  });
}

// Which of the owner's projects use which key, from the Dev app's recipes (views/dev/recipes): every
// "secrets"/"secretFiles" at recipe, server and command level, and the Neon key behind a "database".
// Projects sharing a "keyPrefix" (a product's web and API repos) form one group.
function projectKeys() {
  const dir = path.join(HOME, 'home', 'views', 'dev', 'recipes'), uses = {}, groups = new Map(), list = [];
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); } catch {}
  for (const f of files) {
    let r;
    try { r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { continue; }
    const name = f.slice(0, -5), ptitle = r.title || name, gid = r.keyPrefix || name;
    list.push({ name, title: ptitle, prefix: `${(r.keyPrefix || name.toUpperCase().replace(/[^A-Z0-9]+/g, '_'))}_DEV_` });
    const g = groups.get(gid) || { id: gid, projects: [] };
    g.projects.push({ name, title: ptitle }); groups.set(gid, g);
    const names = new Map();  // secret -> the variables it fills in this project
    for (const spec of [r, ...Object.values(r.servers || {}), ...Object.values(r.commands || {})]) {
      if (!spec || typeof spec !== 'object') continue;
      for (const field of ['secrets', 'secretFiles']) for (const [v, sec] of Object.entries(spec[field] || {})) names.set(sec, new Set([...(names.get(sec) || []), v]));
    }
    if (r.database) names.set(r.database.key || 'NEON_API_KEY', new Set([...(names.get(r.database.key || 'NEON_API_KEY') || []), 'its dev database']));
    for (const [sec, vars] of names) (uses[sec] ||= []).push({ kind: 'project', name, title: ptitle, group: gid, vars: [...vars], href: `#/v/dev#p/${encodeURIComponent(name)}` });
  }
  // A group's title: the words its projects' titles share ("Acme" for "Acme web" and "Acme API"), or the one project's title.
  for (const g of groups.values()) {
    if (g.projects.length === 1) { g.title = g.projects[0].title; continue; }
    const words = g.projects.map((p) => p.title.split(/\s+/));
    const common = [];
    for (let i = 0; words.every((w) => w[i] && w[i] === words[0][i]); i++) common.push(words[0][i]);
    g.title = common.join(' ') || g.id;
  }
  const groupOf = {};
  for (const g of groups.values()) for (const p of g.projects) groupOf[p.name] = g.id;
  return { uses, groups: [...groups.values()], groupOf, list };
}

// Which section of the Keys page a key belongs in: its connection; else a project, if a project's dev
// recipe names it or a job working in that project (job.json cwd) uses it (the project with the most
// such uses); else the apps, jobs and commands that use it; else nothing found.
function section(k, groupOf) {
  if (k.connection) return ['connections'];
  const votes = {};
  for (const u of k.usedBy) {
    const g = u.kind === 'project' ? u.group : u.project ? (groupOf[u.project] || u.project) : null;
    if (g) votes[g] = (votes[g] || 0) + 1;
  }
  const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  if (best) return ['projects', best[0]];
  return [k.usedBy.length ? 'apps' : 'unused'];
}

export async function listSecrets() {
  const secrets = readSecrets(), meta = readMeta(), owners = catalogKeys();
  const names = Object.keys(secrets).sort();
  const used = await usedBy(names), projects = projectKeys();
  const keys = names.map((name) => ({
    name, hint: hint(secrets[name]), note: meta[name]?.note || '', label: owners[name]?.label || '', updated: meta[name]?.updated || null,
    connection: owners[name]?.id || null, connectionName: owners[name]?.name || null,
    usedBy: [...(used[name] || []), ...(projects.uses[name] || [])],
  }));
  for (const k of keys) [k.section, k.project] = section(k, projects.groupOf);
  const managed = MANAGED.filter((m) => fs.existsSync(path.join(CONF, m.file))).map((m) => ({ ...m, updated: fs.statSync(path.join(CONF, m.file)).mtimeMs }));
  const reveal = revealAllowed();
  let requests = [];
  try { requests = (await (await fetch(`${AGENTD}/signals`)).json()).filter((s) => s.key?.startsWith('secret:')).map((s) => ({ name: s.key.slice(7), why: s.body, from: s.source, thread: s.thread_id, at: s.updated, have: !!secrets[s.key.slice(7)] })); } catch {}
  // A job's project with no Dev recipe still gets a group, named after the project's folder.
  const groups = [...projects.groups];
  for (const k of keys) if (k.project && !groups.some((g) => g.id === k.project)) groups.push({ id: k.project, title: k.project, projects: [] });
  const projectGroups = groups.filter((g) => keys.some((k) => k.project === g.id));
  return { keys, managed, requests, reveal, projectGroups, projects: projects.list };
}

// Have one of the owner's projects use a key (its Dev recipe reads it as `variable`), through the Dev
// app's API so the recipe is written in one place.
async function useInProject(project, variable, name, note) {
  const port = fs.readFileSync(path.join(HOME, 'home', 'views', 'dev', 'PORT'), 'utf8').trim();
  const r = await fetch(`http://127.0.0.1:${port}/api/projects/${encodeURIComponent(project)}/keys`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ var: variable, secret: name, note }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}

export async function setSecret({ name, value, note, project, variable }) {
  if (!NAME_RE.test(name || '')) throw new Error('Names are capital letters, digits and _ (like OPENAI_API_KEY)');
  const secrets = readSecrets(), meta = readMeta();
  if (value != null && value.trim() !== '') {
    secrets[name] = normalize(value);
    writeSecrets(secrets);
    meta[name] = { ...(meta[name] || {}), updated: Date.now() };
  } else if (!secrets[name]) throw new Error('A key needs a value');
  if (typeof note === 'string') meta[name] = { ...(meta[name] || {}), note: note.trim().slice(0, 200) };
  writeMeta(meta);
  if (value) await answerRequest(name);
  if (project) {
    // The key is saved either way; a project that can't take it is a warning, not a lost key.
    try { return { ok: true, used: await useInProject(project, variable || name, name, typeof note === 'string' && note.trim() ? note.trim() : undefined) }; }
    catch (e) { return { ok: true, warning: `Saved ${name}, but couldn't add it to ${project}: ${e.message}` }; }
  }
  return { ok: true };
}

export function revealSecret(name) {
  if (!revealAllowed()) throw new Error('Showing key values is off (Settings → Keys)');
  const v = readSecrets()[name];
  if (v == null) throw new Error('No such key');
  return { value: v };
}

export function revealManaged(file) {
  if (!revealAllowed()) throw new Error('Showing key values is off (Settings → Keys)');
  const m = MANAGED.find((x) => x.file === file && x.reveal);
  if (!m) throw new Error("This one can't be shown");
  try { return { value: fs.readFileSync(path.join(CONF, m.file), 'utf8').trim() }; } catch { throw new Error('Not set'); }
}

export function deleteSecret(name) {
  const secrets = readSecrets(), meta = readMeta();
  if (secrets[name] == null) throw new Error('No such key');
  if (catalogKeys()[name]) throw new Error(`Used by the ${catalogKeys()[name].name} connection: disconnect it from Services instead`);
  delete secrets[name]; delete meta[name];
  writeSecrets(secrets); writeMeta(meta);
  return { ok: true };
}

// An agent asked for this key: take the card off the Timeline and tell the asking chat it's there.
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

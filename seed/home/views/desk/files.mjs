// Files: Springroll's API for browsing and reading the machine's files (the Files
// View is its UI). Runs as the agent user, so it sees what the agent sees.
//   GET  /api/files/list?path=       a folder: entries with size, time, git status
//   GET  /api/files/read?path=       a file: kind (text|image|pdf|audio|video|sqlite|binary), text if text
//   GET  /api/files/raw?path=[&download=1]   the bytes (sandboxed: never runs as a page)
//   PUT  /api/files/write            {path, text, mtime}: save; 409 if it changed since mtime
//   GET  /api/files/diff?path=       what changed since the last commit (unified diff)
//   GET  /api/files/search?q=        fuzzy file names across the places
//   GET  /api/files/recent           recently changed files
//   GET  /api/files/sqlite?path=&table=&offset=   tables, then rows (read-only)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';

const HOME = os.homedir();
const TEXT_MAX = 2 * 1024 * 1024;
const SKIP = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', '.cache', '.npm', '.next', 'dist', 'build', '.turbo', 'target', '.mypy_cache', '.pytest_cache', '.DS_Store', 'vendor']);

export const PLACES = [
  { id: 'home', label: 'Home', path: path.join(HOME, 'home'), icon: 'house' },
  { id: 'projects', label: 'Projects', path: path.join(HOME, 'projects'), icon: 'folder-git-2' },
  { id: 'data', label: 'Data', path: path.join(HOME, 'data'), icon: 'database' },
  { id: 'machine', label: 'Agent home', path: HOME, icon: 'user' },
  { id: 'root', label: 'Whole disk', path: '/', icon: 'hard-drive' },
];

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
  ico: 'image/x-icon', bmp: 'image/bmp', pdf: 'application/pdf', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', ogg: 'audio/ogg',
  flac: 'audio/flac', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', json: 'application/json', txt: 'text/plain; charset=utf-8',
};
const ext = (p) => path.extname(p).slice(1).toLowerCase();

const run = (cmd, args, opts = {}) => new Promise((resolve) =>
  execFile(cmd, args, { maxBuffer: 32 * 1024 * 1024, timeout: 10000, ...opts }, (err, out) => resolve(err && !out ? null : out)));

export function resolvePath(p) {
  if (!p) return path.join(HOME, 'home');
  p = String(p).replace(/^~(?=$|\/)/, HOME);
  return path.resolve(HOME, p);
}

const tilde = (p) => (p === HOME || p.startsWith(HOME + '/') ? '~' + p.slice(HOME.length) : p);

// The git repo a path is in, with each changed file's status (relative to the repo root).
const gitCache = new Map();
async function gitInfo(dir) {
  const root = (await run('git', ['-C', dir, 'rev-parse', '--show-toplevel']))?.trim();
  if (!root) return null;
  const hit = gitCache.get(root);
  if (hit && Date.now() - hit.at < 3000) return hit.info;
  const [status, branch] = await Promise.all([
    run('git', ['-C', root, 'status', '--porcelain=v1', '-z', '--untracked-files=all']),
    run('git', ['-C', root, 'branch', '--show-current']),
  ]);
  const changes = new Map();
  const parts = (status || '').split('\0');
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const code = e.slice(0, 2), file = e.slice(3);
    if (code[0] === 'R' || code[0] === 'C') i++; // rename: next entry is the old name
    const kind = code === '??' ? 'new' : code.includes('D') ? 'deleted' : code.includes('A') ? 'new' : 'modified';
    changes.set(file, kind);
  }
  const info = { root, branch: branch?.trim() || null, changes };
  gitCache.set(root, { at: Date.now(), info });
  return info;
}

function statusFor(git, abs, isDir) {
  if (!git) return null;
  const rel = path.relative(git.root, abs);
  if (!isDir) return git.changes.get(rel) || null;
  const prefix = rel ? rel + '/' : '';
  for (const f of git.changes.keys()) if (f.startsWith(prefix)) return 'modified';
  return null;
}

export async function list(p) {
  const dir = resolvePath(p);
  const st = fs.statSync(dir);
  if (!st.isDirectory()) throw Object.assign(new Error('Not a folder'), { code: 'ENOTDIR' });
  const git = await gitInfo(dir);
  const entries = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, d.name);
    let s = null;
    try { s = fs.statSync(abs); } catch { try { s = fs.lstatSync(abs); } catch { continue; } }
    const isDir = s.isDirectory();
    entries.push({
      name: d.name, path: abs, type: isDir ? 'dir' : 'file', link: d.isSymbolicLink() || undefined,
      size: isDir ? null : s.size, mtime: s.mtimeMs, hidden: d.name.startsWith('.') || undefined,
      git: statusFor(git, abs, isDir) || undefined,
    });
  }
  entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.type === 'dir' ? -1 : 1));
  const readme = entries.find((e) => e.type === 'file' && /^readme(\.md|\.markdown|\.txt)?$/i.test(e.name));
  return {
    path: dir, display: tilde(dir), parent: dir === '/' ? null : path.dirname(dir), entries,
    git: git ? { root: git.root, branch: git.branch, changed: git.changes.size } : null,
    readme: readme?.path || null,
  };
}

function kindOf(file, size) {
  const e = ext(file);
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp'].includes(e)) return 'image';
  if (e === 'pdf') return 'pdf';
  if (['mp3', 'm4a', 'wav', 'ogg', 'flac'].includes(e)) return 'audio';
  if (['mp4', 'webm', 'mov'].includes(e)) return 'video';
  if (['db', 'sqlite', 'sqlite3'].includes(e) || /\.db$/.test(file)) {
    try { const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(16); fs.readSync(fd, b, 0, 16, 0); fs.closeSync(fd); if (b.toString('latin1').startsWith('SQLite format 3')) return 'sqlite'; } catch {}
  }
  if (size === 0) return 'text';
  try {
    const fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(Math.min(size, 8192));
    fs.readSync(fd, b, 0, b.length, 0);
    fs.closeSync(fd);
    if (b.includes(0)) return b.toString('latin1', 0, 16).startsWith('SQLite format 3') ? 'sqlite' : 'binary';
  } catch { return 'binary'; }
  return 'text';
}

export async function read(p) {
  const file = resolvePath(p);
  const st = fs.statSync(file);
  if (st.isDirectory()) return { path: file, kind: 'dir' };
  const kind = kindOf(file, st.size);
  const git = await gitInfo(path.dirname(file));
  const out = {
    path: file, display: tilde(file), name: path.basename(file), size: st.size, mtime: st.mtimeMs, kind,
    writable: (() => { try { fs.accessSync(file, fs.constants.W_OK); return true; } catch { return false; } })(),
    git: git ? { root: git.root, branch: git.branch, status: statusFor(git, file, false) } : null,
  };
  if (kind === 'text') {
    if (st.size > TEXT_MAX) {
      const fd = fs.openSync(file, 'r');
      const b = Buffer.alloc(TEXT_MAX);
      fs.readSync(fd, b, 0, TEXT_MAX, 0);
      fs.closeSync(fd);
      out.text = b.toString('utf8');
      out.truncated = true;
    } else out.text = fs.readFileSync(file, 'utf8');
  }
  return out;
}

export function raw(p, download, res) {
  const file = resolvePath(p);
  const st = fs.statSync(file);
  if (!st.isFile()) throw new Error('Not a file');
  const headers = {
    'content-type': MIME[ext(file)] || 'application/octet-stream',
    'content-length': st.size,
    // Files are shown, never run: no scripts, even for HTML or SVG.
    'content-security-policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; media-src 'self'",
    'x-content-type-options': 'nosniff',
    'cache-control': 'no-cache',
  };
  if (download) headers['content-disposition'] = `attachment; filename="${path.basename(file).replace(/"/g, '')}"`;
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

export function write({ path: p, text, mtime }) {
  const file = resolvePath(p);
  if (typeof text !== 'string') throw new Error('text required');
  let st = null;
  try { st = fs.statSync(file); } catch {}
  if (st && mtime && Math.abs(st.mtimeMs - mtime) > 1) throw Object.assign(new Error('The file changed since you opened it.'), { status: 409, mtime: st.mtimeMs });
  fs.writeFileSync(file, text);
  gitCache.clear();
  const now = fs.statSync(file);
  return { path: file, size: now.size, mtime: now.mtimeMs };
}

export async function diff(p) {
  const file = resolvePath(p);
  const git = await gitInfo(path.dirname(file));
  if (!git) return { status: null, diff: '' };
  const rel = path.relative(git.root, file);
  const status = git.changes.get(rel) || null;
  if (status === 'new') return { status, diff: '' };
  const d = await run('git', ['-C', git.root, 'diff', 'HEAD', '--no-color', '--no-ext-diff', '-U3', '--', rel]);
  const last = await run('git', ['-C', git.root, 'log', '-1', '--format=%h%x00%s%x00%ct', '--', rel]);
  const [hash, subject, at] = (last || '').trim().split('\0');
  return { status, diff: d || '', lastCommit: hash ? { hash, subject, at: +at * 1000 } : null };
}

// File-name index over the places, refreshed at most every 30 s.
let index = { at: 0, files: [] };
let building = null;
function walk(dir, out, depth = 0) {
  if (depth > 12 || out.length > 60000) return;
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of ents) {
    if (SKIP.has(d.name)) continue;
    const abs = path.join(dir, d.name);
    if (d.isDirectory()) walk(abs, out, depth + 1);
    else if (d.isFile()) out.push(abs);
  }
}
async function files() {
  if (Date.now() - index.at < 30000) return index.files;
  building ??= new Promise((resolve) => setImmediate(() => {
    const out = [];
    for (const pl of PLACES.slice(0, 3)) walk(pl.path, out);
    for (const extra of ['.config/springroll', 'backups']) { const d = path.join(HOME, extra); if (fs.existsSync(d)) out.push(...fs.readdirSync(d).map((f) => path.join(d, f)).filter((f) => { try { return fs.statSync(f).isFile(); } catch { return false; } })); }
    index = { at: Date.now(), files: out };
    building = null;
    resolve(out);
  }));
  return building;
}

// Subsequence match, scored: consecutive runs, word starts and the file name count most.
function score(q, s) {
  const lower = s.toLowerCase();
  const base = lower.lastIndexOf('/') + 1;
  let si = 0, total = 0, run = 0, first = -1;
  for (const c of q) {
    const i = lower.indexOf(c, si);
    if (i < 0) return -1;
    if (first < 0) first = i;
    run = i === si ? run + 1 : 1;
    total += run * 2 + (i >= base ? 3 : 0) + (i === 0 || '/._- '.includes(lower[i - 1]) ? 4 : 0);
    si = i + 1;
  }
  if (lower.slice(base).startsWith(q)) total += 20;
  return total - (s.length - base) * 0.05 - (lower.split('/').length) * 0.3;
}

export async function search(q) {
  q = String(q || '').toLowerCase().replace(/\s+/g, '');
  const all = await files();
  if (!q) return [];
  const scored = [];
  for (const f of all) {
    const rel = tilde(f);
    const s = score(q, rel);
    if (s > 0) scored.push([s, f]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  return scored.slice(0, 40).map(([, f]) => ({ path: f, display: tilde(f), name: path.basename(f) }));
}

export async function recent() {
  const all = await files();
  const withTime = [];
  for (const f of all) {
    if (f.includes('/data/') && /\.(db|sqlite3?)(-wal|-shm|-journal)?$/.test(f)) continue;
    try { withTime.push([fs.statSync(f).mtimeMs, f]); } catch {}
  }
  withTime.sort((a, b) => b[0] - a[0]);
  return withTime.slice(0, 30).map(([mtime, f]) => ({ path: f, display: tilde(f), name: path.basename(f), mtime }));
}

export async function sqlite(p, table, offset = 0) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(resolvePath(p), { readOnly: true });
  try {
    const tables = db.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
      .map((t) => ({ ...t, rows: (() => { try { return db.prepare(`SELECT count(*) AS n FROM "${t.name.replace(/"/g, '""')}"`).get().n; } catch { return null; } })() }));
    if (!table) return { tables };
    const t = tables.find((x) => x.name === table);
    if (!t) throw new Error('No such table');
    const q = `"${t.name.replace(/"/g, '""')}"`;
    const rows = db.prepare(`SELECT * FROM ${q} LIMIT 100 OFFSET ?`).all(Math.max(0, +offset || 0));
    const columns = db.prepare(`PRAGMA table_info(${q})`).all().map((c) => c.name);
    const clip = (v) => (v instanceof Uint8Array ? `<${v.length} bytes>` : typeof v === 'string' && v.length > 400 ? v.slice(0, 400) + '…' : typeof v === 'bigint' ? String(v) : v);
    return { tables, table: t.name, columns, rows: rows.map((r) => columns.map((c) => clip(r[c]))), offset: +offset || 0, total: t.rows };
  } finally { db.close(); }
}

export const places = () => ({
  user: os.userInfo().username, home: HOME,
  places: PLACES.filter((p) => fs.existsSync(p.path)).map((p) => ({ ...p, display: tilde(p.path) })),
});

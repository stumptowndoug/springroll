// `@path` file mentions in the chat composer: the one being typed, and the folder's files ranked for it.
// agentd sends a mention of a file that exists as a resource link (agentd/threads.mjs mentionBlocks).
import { api } from './api.js';

// The `@query` being typed at the caret, if any: `start` is the index of the `@`.
export function mentionAt(text, caret) {
  const m = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
  return m ? { start: caret - m[1].length - 1, query: m[1] } : null;
}

const basename = (p) => p.slice(p.lastIndexOf('/') + 1);

// Gaps between the query's characters in text, or null when it isn't a subsequence.
function gaps(text, q) {
  let from = 0, n = 0;
  for (const ch of q) {
    const at = text.indexOf(ch, from);
    if (at < 0) return null;
    if (at > from) n++;
    from = at + 1;
  }
  return n;
}

// Lower is better; null: no match. Name before path; loosely ("thjs" finds thread.js) last.
function score(file, q) {
  const lower = file.toLowerCase(), name = basename(lower);
  if (name === q) return 0;
  if (name.startsWith(q)) return 1 + name.length / 100;
  if (name.includes(q)) return 2 + name.length / 100;
  if (lower.includes(q)) return 3 + lower.length / 1000;
  const inName = gaps(name, q);
  if (inName !== null) return 4 + inName / 10 + name.length / 1000;
  const inPath = gaps(lower, q);
  return inPath === null ? null : 5 + inPath / 10 + lower.length / 10000;
}

export function rankFiles(files, query, limit = 8) {
  const q = query.toLowerCase();
  if (!q) return files.filter((f) => !f.includes('/')).slice(0, limit);
  const scored = [];
  for (const f of files) { const s = score(f, q); if (s !== null) scored.push([s, f]); }
  return scored.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1])).slice(0, limit).map(([, f]) => f);
}

// A folder's files, cached a short while so new ones show up.
const FRESH_MS = 30000;
const cache = new Map(); // cwd -> { files, at, pending }
export function folderFiles(cwd) {
  const e = cache.get(cwd);
  if (e?.pending) return e.pending;
  if (e && Date.now() - e.at < FRESH_MS) return Promise.resolve(e.files);
  const pending = api.get(`api/agent/files?cwd=${encodeURIComponent(cwd)}`)
    .then((r) => { cache.set(cwd, { files: r.files, at: Date.now() }); return r.files; })
    .catch(() => { cache.set(cwd, { files: e?.files || [], at: e?.at || 0 }); return e?.files || []; });
  cache.set(cwd, { files: e?.files || [], at: e?.at || 0, pending });
  return pending;
}

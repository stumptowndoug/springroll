// Only static test fixtures and production assets. Never starts agentd or reads user data.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.resolve(here, '../../seed/home/views/desk/public');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const testFile = url.pathname === '/' ? 'harness.html' : url.pathname.startsWith('/__test__/') ? url.pathname.slice(10) : null;
  const root = testFile == null ? assets : here;
  const file = path.resolve(root, testFile ?? '.' + url.pathname);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
}).listen(4178, '127.0.0.1');

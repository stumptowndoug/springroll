// Builds seed/home/views/desk/public/ui/vendor/: ES modules the kit imports on
// demand. Output is committed; the box never needs npm for it.
//   code.js, markdown.js   our entry points (src/), bundled with marked + DOMPurify
//   pce/                   prism-code-editor's own ES modules (the ones we reach), each minified but
//                          otherwise as published: its grammars register in a
//                          shared table, so their import order must be kept
//                          (esbuild's code splitting reorders them)
import { build, transform } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const here = import.meta.dirname;
const out = path.resolve(here, '../../seed/home/views/desk/public/ui/vendor');
const pceDist = path.join(here, 'node_modules/prism-code-editor/dist');
fs.rmSync(out, { recursive: true, force: true });

// 2. Our entry points. Imports of prism-code-editor point at the copied modules.
const pce = {
  name: 'pce-external',
  setup(b) {
    b.onResolve({ filter: /^prism-code-editor(\/|$)/ }, async (args) => {
      if (args.pluginData === 'inner') return undefined;
      const r = await b.resolve(args.path, { kind: args.kind, resolveDir: args.resolveDir, pluginData: 'inner' });
      if (r.errors.length) return { errors: r.errors };
      return { path: '/ui/vendor/pce/' + path.relative(pceDist, r.path).split(path.sep).join('/'), external: true };
    });
  },
};
// Editing behavior (comments, indentation) only for the languages code.js highlights,
// found by which module registers each id; one import each instead of all ~240.
const ids = [...fs.readFileSync(path.join(here, 'src/code.js'), 'utf8').matchAll(/^  '?([\w-]+)'?: \(\) => import/gm)].map((m) => m[1]);
const langDir = path.join(pceDist, 'languages');
const behaviorFiles = new Set();
for (const f of fs.readdirSync(langDir).filter((f) => f.endsWith('.js') && f !== 'index.js')) {
  const src = fs.readFileSync(path.join(langDir, f), 'utf8');
  if (ids.some((id) => new RegExp(`\\.${id.replace(/-/g, '\\-')}\\s*=|\\["${id}"\\]\\s*=`).test(src))) behaviorFiles.add(f.replace(/\.js$/, ''));
}
const behaviors = {
  name: 'behaviors',
  setup(b) {
    b.onResolve({ filter: /^virtual:behaviors$/ }, () => ({ path: 'behaviors', namespace: 'virtual' }));
    b.onLoad({ filter: /.*/, namespace: 'virtual' }, () => ({ contents: [...behaviorFiles].map((f) => `import 'prism-code-editor/languages/${f}';`).join('\n'), resolveDir: here }));
  },
};

await build({
  entryPoints: { code: 'src/code.js', markdown: 'src/markdown.js', 'editor-extensions': 'src/editor-extensions.js' },
  bundle: true, splitting: true, format: 'esm', minify: true, target: 'es2022',
  outdir: out, chunkNames: 'chunks/[name]-[hash]', legalComments: 'eof', logLevel: 'warning',
  absWorkingDir: here, plugins: [pce, behaviors], external: ['/ui/vendor/*'],
});

// 3. prism-code-editor, file by file: only the modules our code can reach.
const reach = new Map(); // file -> minified code (comments gone, so only real imports are followed)
const visit = async (rel) => {
  if (reach.has(rel)) return;
  reach.set(rel, null);
  const { code } = await transform(fs.readFileSync(path.join(pceDist, rel), 'utf8'), { minify: true, format: 'esm', target: 'es2022', legalComments: 'none' });
  reach.set(rel, code);
  for (const m of code.matchAll(/(?:from\s*|import\s*\(?\s*)["'](\.[^"']+)["']/g)) await visit(path.normalize(path.join(path.dirname(rel), m[1])));
};
for (const f of fs.readdirSync(out, { recursive: true }).filter((f) => f.endsWith('.js'))) {
  for (const m of fs.readFileSync(path.join(out, f), 'utf8').matchAll(/["']\/ui\/vendor\/pce\/([^"']+)["']/g)) await visit(m[1]);
}
for (const [f, code] of reach) {
  fs.mkdirSync(path.dirname(path.join(out, 'pce', f)), { recursive: true });
  fs.writeFileSync(path.join(out, 'pce', f), code);
}

// 4. The editor's structural CSS (layout, static blocks, search box); colors come from kit.css.
fs.writeFileSync(path.join(out, 'code.css'), ['layout.css', 'code-block.css', 'search.css']
  .map((f) => fs.readFileSync(path.join(pceDist, f), 'utf8')).join('\n'));

const versions = Object.fromEntries(['prism-code-editor', 'marked', 'dompurify'].map((p) => [p, JSON.parse(fs.readFileSync(path.join(here, `node_modules/${p}/package.json`))).version]));
fs.writeFileSync(path.join(out, 'README.md'), `# Vendor

Built by \`tools/vendor\` (\`npm ci && npm run build\`); don't edit by hand.
${Object.entries(versions).map(([k, v]) => `- ${k} ${v}`).join('\n')}
`);

let total = 0, files = 0;
for (const f of fs.readdirSync(out, { recursive: true })) {
  const p = path.join(out, f);
  if (!fs.statSync(p).isFile() || !p.endsWith('.js')) continue;
  files++;
  const gz = zlib.gzipSync(fs.readFileSync(p)).length;
  total += gz;
  if (!f.includes('/')) console.log(`${f.padEnd(22)} ${(gz / 1024).toFixed(1)} KB gz`);
}
console.log(`${files} files, ${(total / 1024).toFixed(0)} KB gz in all (loaded only as needed)`);

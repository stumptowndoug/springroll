// Code highlighting and editing for the Desk kit, built on prism-code-editor.
// Loaded on demand by kit.js (ui.code); grammars load per language.
import { languages } from 'prism-code-editor/prism';
import { renderCodeBlock } from 'prism-code-editor/ssr';
import { highlightText } from 'prism-code-editor/prism';

// One lazy chunk per grammar. Ids are Prism's.
const GRAMMARS = {
  javascript: () => import('prism-code-editor/prism/languages/javascript'),
  typescript: () => import('prism-code-editor/prism/languages/typescript'),
  jsx: () => import('prism-code-editor/prism/languages/jsx'),
  tsx: () => import('prism-code-editor/prism/languages/tsx'),
  json: () => import('prism-code-editor/prism/languages/json'),
  json5: () => import('prism-code-editor/prism/languages/json5'),
  markup: () => import('prism-code-editor/prism/languages/markup'),
  xml: () => import('prism-code-editor/prism/languages/xml'),
  css: () => import('prism-code-editor/prism/languages/css'),
  scss: () => import('prism-code-editor/prism/languages/scss'),
  less: () => import('prism-code-editor/prism/languages/less'),
  markdown: () => import('prism-code-editor/prism/languages/markdown'),
  python: () => import('prism-code-editor/prism/languages/python'),
  bash: () => import('prism-code-editor/prism/languages/bash'),
  'shell-session': () => import('prism-code-editor/prism/languages/shell-session'),
  powershell: () => import('prism-code-editor/prism/languages/powershell'),
  batch: () => import('prism-code-editor/prism/languages/batch'),
  ini: () => import('prism-code-editor/prism/languages/ini'),
  toml: () => import('prism-code-editor/prism/languages/toml'),
  yaml: () => import('prism-code-editor/prism/languages/yaml'),
  properties: () => import('prism-code-editor/prism/languages/properties'),
  editorconfig: () => import('prism-code-editor/prism/languages/editorconfig'),
  ignore: () => import('prism-code-editor/prism/languages/ignore'),
  systemd: () => import('prism-code-editor/prism/languages/systemd'),
  nginx: () => import('prism-code-editor/prism/languages/nginx'),
  apacheconf: () => import('prism-code-editor/prism/languages/apacheconf'),
  docker: () => import('prism-code-editor/prism/languages/docker'),
  makefile: () => import('prism-code-editor/prism/languages/makefile'),
  cmake: () => import('prism-code-editor/prism/languages/cmake'),
  nix: () => import('prism-code-editor/prism/languages/nix'),
  hcl: () => import('prism-code-editor/prism/languages/hcl'),
  sql: () => import('prism-code-editor/prism/languages/sql'),
  graphql: () => import('prism-code-editor/prism/languages/graphql'),
  protobuf: () => import('prism-code-editor/prism/languages/protobuf'),
  csv: () => import('prism-code-editor/prism/languages/csv'),
  diff: () => import('prism-code-editor/prism/languages/diff'),
  git: () => import('prism-code-editor/prism/languages/git'),
  log: () => import('prism-code-editor/prism/languages/log'),
  regex: () => import('prism-code-editor/prism/languages/regex'),
  go: () => import('prism-code-editor/prism/languages/go'),
  rust: () => import('prism-code-editor/prism/languages/rust'),
  zig: () => import('prism-code-editor/prism/languages/zig'),
  c: () => import('prism-code-editor/prism/languages/c'),
  cpp: () => import('prism-code-editor/prism/languages/cpp'),
  csharp: () => import('prism-code-editor/prism/languages/csharp'),
  fsharp: () => import('prism-code-editor/prism/languages/fsharp'),
  java: () => import('prism-code-editor/prism/languages/java'),
  kotlin: () => import('prism-code-editor/prism/languages/kotlin'),
  scala: () => import('prism-code-editor/prism/languages/scala'),
  groovy: () => import('prism-code-editor/prism/languages/groovy'),
  gradle: () => import('prism-code-editor/prism/languages/gradle'),
  swift: () => import('prism-code-editor/prism/languages/swift'),
  dart: () => import('prism-code-editor/prism/languages/dart'),
  ruby: () => import('prism-code-editor/prism/languages/ruby'),
  php: () => import('prism-code-editor/prism/languages/php'),
  perl: () => import('prism-code-editor/prism/languages/perl'),
  lua: () => import('prism-code-editor/prism/languages/lua'),
  r: () => import('prism-code-editor/prism/languages/r'),
  julia: () => import('prism-code-editor/prism/languages/julia'),
  elixir: () => import('prism-code-editor/prism/languages/elixir'),
  erlang: () => import('prism-code-editor/prism/languages/erlang'),
  haskell: () => import('prism-code-editor/prism/languages/haskell'),
  ocaml: () => import('prism-code-editor/prism/languages/ocaml'),
  clojure: () => import('prism-code-editor/prism/languages/clojure'),
  vue: () => import('prism-code-editor/prism/languages/vue'),
  svelte: () => import('prism-code-editor/prism/languages/svelte'),
  astro: () => import('prism-code-editor/prism/languages/astro'),
  latex: () => import('prism-code-editor/prism/languages/latex'),
  vim: () => import('prism-code-editor/prism/languages/vim'),
};

const ALIAS = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', node: 'javascript', ts: 'typescript', mts: 'typescript', cts: 'typescript',
  html: 'markup', htm: 'markup', svg: 'xml', plist: 'xml', xsd: 'xml', rss: 'xml', atom: 'xml',
  py: 'python', pyw: 'python', python3: 'python', sh: 'bash', zsh: 'bash', shell: 'bash', console: 'shell-session', ps1: 'powershell',
  bat: 'batch', cmd: 'batch', cfg: 'ini', conf: 'ini', env: 'bash', yml: 'yaml', md: 'markdown', mdx: 'markdown', markdown: 'markdown',
  service: 'systemd', timer: 'systemd', socket: 'systemd', mount: 'systemd', target: 'systemd', path: 'systemd',
  dockerfile: 'docker', containerfile: 'docker', mk: 'makefile', tf: 'hcl', tfvars: 'hcl', proto: 'protobuf', tsv: 'csv',
  patch: 'diff', rs: 'rust', h: 'c', hpp: 'cpp', cc: 'cpp', cxx: 'cpp', hh: 'cpp', cs: 'csharp', fs: 'fsharp', kt: 'kotlin', kts: 'kotlin',
  rb: 'ruby', gemspec: 'ruby', pl: 'perl', pm: 'perl', jl: 'julia', ex: 'elixir', exs: 'elixir', erl: 'erlang', hs: 'haskell', ml: 'ocaml',
  clj: 'clojure', cljs: 'clojure', edn: 'clojure', tex: 'latex', vimrc: 'vim', gql: 'graphql', jsonl: 'json', webmanifest: 'json',
  lock: 'json', geojson: 'json', gitignore: 'ignore', dockerignore: 'ignore', npmignore: 'ignore', gitconfig: 'ini', gitattributes: 'ignore',
  editorconfig: 'editorconfig', npmrc: 'ini', bashrc: 'bash', profile: 'bash', bash_profile: 'bash', zshrc: 'bash', tmux: 'bash',
  makefile: 'makefile', gnumakefile: 'makefile', cmakelists: 'cmake', gemfile: 'ruby', rakefile: 'ruby', procfile: 'yaml', caddyfile: 'nginx',
  sql: 'sql', sqlite: 'sql', psql: 'sql', ini: 'ini', toml: 'toml', json: 'json', css: 'css', go: 'go', c: 'c', java: 'java', lua: 'lua',
  r: 'r', swift: 'swift', dart: 'dart', php: 'php', scala: 'scala', vue: 'vue', svelte: 'svelte', astro: 'astro', zig: 'zig', nix: 'nix',
  log: 'log', diff: 'diff', jsx: 'jsx', tsx: 'tsx', scss: 'scss', less: 'less', xml: 'xml', csv: 'csv', yaml: 'yaml', groovy: 'groovy', gradle: 'gradle',
};

// The Prism language for a file name ("server.mjs" -> "javascript"), or a fence tag ("sh" -> "bash"); null if unknown.
export function langFor(name = '') {
  const n = String(name).toLowerCase().split('/').pop();
  if (GRAMMARS[n]) return n;
  if (ALIAS[n]) return ALIAS[n];
  const ext = n.includes('.') ? n.split('.').pop() : n.replace(/^\./, '');
  if (n.startsWith('dockerfile') || n.endsWith('.dockerfile')) return 'docker';
  if (n === 'cmakelists.txt') return 'cmake';
  if (/^\.?env(\..*)?$/.test(n)) return 'bash';
  return GRAMMARS[ext] ? ext : ALIAS[ext] || null;
}

const loading = new Map();
export function load(lang) {
  if (!lang || !GRAMMARS[lang]) return Promise.resolve(false);
  if (languages[lang]) return Promise.resolve(true);
  if (!loading.has(lang)) loading.set(lang, GRAMMARS[lang]().then(() => true, () => false));
  return loading.get(lang);
}

const BIG = 400_000; // characters; beyond this, plain text (tokenizing gets slow)

// A static code block (line numbers, highlighting) as HTML. Markup matches the editor's.
export async function render(value, lang, { lineNumbers = true, wordWrap = false, addLineClass } = {}) {
  const ok = value.length <= BIG && (await load(lang));
  return renderCodeBlock({ language: ok ? lang : 'plain', value, lineNumbers, wordWrap, guideIndents: false, tabSize: 2, addLineClass, class: 'ui-code' });
}

// Highlighted HTML for a snippet without line structure (markdown fences, inline use).
export async function highlight(value, lang) {
  const ok = value.length <= BIG && (await load(lang));
  if (!ok) return value.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return highlightText(value, languages[lang]);
}

// An editor in el. Returns the prism-code-editor instance (editor.value, editor.setOptions, editor.remove, ...).
export async function edit(el, { value = '', lang, onUpdate, readOnly = false, wordWrap = false } = {}) {
  // The editor re-highlights the whole file on each keystroke; past ~150 KB, edit as plain text.
  const hl = value.length <= 150_000;
  const [{ createEditor }, ext] = await Promise.all([import('prism-code-editor'), import('/ui/vendor/editor-extensions.js'), hl && load(lang)]);
  return createEditor(el, { language: hl && languages[lang] ? lang : 'plain', value, lineNumbers: true, wordWrap, readOnly, tabSize: 2, class: 'ui-code', onUpdate }, ...ext.extensions());
}

export { languages };

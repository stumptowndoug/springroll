// Full GitHub-flavored Markdown for documents (READMEs, notes), sanitized.
// Code fences are highlighted with the same grammars as the code viewer.
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { highlight, langFor } from './code.js';

const marked = new Marked({ gfm: true, breaks: false });

// Headings get ids so #anchors and a table of contents work.
const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');

let fences = [], seen = new Map();
marked.use({
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      let id = slug(text) || 'section';
      const n = seen.get(id) || 0; seen.set(id, n + 1);
      if (n) id += '-' + n;
      return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true"></a>${text}</h${depth}>\n`;
    },
    code({ text, lang }) {
      const l = langFor((lang || '').split(/\s/)[0]);
      fences.push({ text, lang: l });
      return `<pre data-lang="${(lang || '').split(/\s/)[0].replace(/[^\w+-]/g, '')}"><code data-fence="${fences.length - 1}"></code></pre>\n`;
    },
  },
});

// Render markdown to safe HTML. resolve(url, kind) can rewrite relative links and images.
export async function render(src, { resolve } = {}) {
  fences = []; seen = new Map();
  const raw = marked.parse(String(src), { async: false });
  const mine = fences;
  const html = DOMPurify.sanitize(raw, { ADD_ATTR: ['data-fence', 'data-lang', 'aria-hidden'] });
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  await Promise.all([...tpl.content.querySelectorAll('code[data-fence]')].map(async (el) => {
    const f = mine[+el.dataset.fence];
    el.innerHTML = f ? await highlight(f.text, f.lang) : '';
    if (f?.lang) el.className = `language-${f.lang}`;
    el.removeAttribute('data-fence');
  }));
  for (const a of tpl.content.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (/^[a-z]+:/i.test(href)) { a.target = '_blank'; a.rel = 'noopener'; continue; }
    if (resolve && !href.startsWith('#')) { const r = resolve(href, 'link'); if (r) a.setAttribute('href', r); }
  }
  for (const img of tpl.content.querySelectorAll('img[src]')) {
    const src2 = img.getAttribute('src');
    img.loading = 'lazy';
    if (resolve && !/^([a-z]+:|\/\/)/i.test(src2)) { const r = resolve(src2, 'image'); if (r) img.setAttribute('src', r); }
  }
  for (const box of tpl.content.querySelectorAll('input[type=checkbox]')) box.disabled = true;
  const div = document.createElement('div');
  div.append(tpl.content);
  return div.innerHTML;
}

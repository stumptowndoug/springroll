# Files

Browse and read everything on the machine: code highlighted, Markdown rendered, what changed since the last commit.

Part of Springroll (a system View, in the sidebar as **Files**). Static: `index.html`
and `files.js` here, using Springroll's Files API (`views/desk/files.mjs`):

- `GET /api/files/places` · `list?path=` · `read?path=` · `raw?path=[&download=1]` ·
  `diff?path=` · `search?q=` · `recent` · `sqlite?path=&table=&offset=`
- `PUT /api/files/write` `{path, text, mtime}` (409 if the file changed since `mtime`)

Links: `#/v/files#p=<url-encoded path>&l=12-20` opens a file (or folder) at those
lines; `#/v/files#search` opens the file search. The kit does the rendering:
`ui.codeBlock` and `ui.editor` (prism-code-editor), `ui.document` (marked +
DOMPurify); see `views/desk/public/ui/vendor/README.md`.

What the owner is looking at (file, selected lines) is passed to the agent with
`desk.context()`, so "this" in the Ask panel means that file.

# To-dos

Your list and every project's TODO.md board, kept current by the owner and their agents (Shep, a desktop app, shows the same files).

## What it does

A kanban: pick **All boards** or one board from the picker. All boards has one column per kind
(Backlog, In Progress, Blocked if any, Done) with every board's cards tagged by board; a single
board shows its own columns. Boards: `Personal` is `~/data/todos/TODO.md` (the owner's own list,
which replaced `notes/todo.md`); every `~/projects/<name>/TODO.md` (any case) is a board named
after its folder, found on each request, so a new project's board just appears.

- Drag a card to another column to move it (in All boards, to that kind of column in its own
  file). Hover shows Chat and ⋯ (move, open in file, rename, delete).
- Click (or tap) a card for its sheet: the notes and sub-steps, a Column picker, the file at that
  line, Chat, and Mark done / Reopen.
- **Add a card** at the bottom of a column; the heading's **Add a to-do** goes to the Backlog
  (Personal's when showing All boards).
- **Done** shows its first 8; **Archive** (on a single board) moves its cards to the board's
  archive file. Nothing is ever deleted: finished cards are the record (the shep-todos rule).
- The board component is the kit's `ui-board` (DESIGN.md, Gallery).

## The format

The boards are the markdown kanban of the `shep-todos` skill (in each project's
`.agents/skills/shep-todos/SKILL.md`): `##` headings are columns, each top-level `- [ ]` line is
a card, indented lines and nested checkboxes belong to it, Done-like columns hold `- [x]` cards.
Column kinds come from their titles (`board.py` `kind()`): done (✅, Done), progress (🚧, In
Progress), blocked (⛔), backlog (📋, Backlog, To-do, Later); anything else is "other".

## How it's built

- `board.py`: parse and edit a TODO.md. Edits follow Shep's own (`src-tauri/src/todos.rs`)
  so both agree: a card's block ends at the next item at its indent or shallower, a heading or a
  blank line; moves and adds go to the end of the target column, keeping the file's spacing
  (blank line between cards or not). Every edit re-reads the file and finds the card by id, a
  hash of its text (`8f3a…`, `-2` for duplicates), so an agent's edit in between gives a 409, not
  a lost change. Writes are atomic (temp file + rename) and one at a time (a lock in the server).
- `server.py`: stdlib HTTP on `127.0.0.1:8105` (`PORT`), service `todos.service`. No database:
  the files are the source of truth.
- `index.html`: the page (kit only: `ui-board`, `ui-sheet`, `ui.combobox`). Refreshes every 30 s
  and on focus, not while a card's sheet is open or a card is being dragged.
- `~/home/bin/todo`: the CLI for agents and jobs (`todo --help`).
- Project boards are edited in the working tree and **not committed**: the project's own agents
  and jobs commit TODO.md with their work

## Archives

`todo archive <board>` / Archive appends Done cards under `## Archived <date>` to:
`<project>/docs/archive/TODO-done-<date>.md` when the project has `docs/`,
else `<project>/TODO-done.md`; Personal's go to `~/data/todos/TODO-done.md`.
Archiving is by hand (the owner or an agent asked); housekeeping never touches boards.

## JSON API

- `GET api/boards` → `[{id, name, path, exists, updated, archive, open, progress, done}]`
- `GET api/boards/<id>` → that plus `title`, `preamble`, `columns: [{title, kind, line, level,
  cards: [{id, text, done, line, end, lines: [first, last] (1-based, for Files), children:
  [{text, done, depth}], body}]}]`
- `GET api/now` → in-progress cards across boards (`board`, `board_name`, `path`, `column` added)
- `POST api/boards/<id>/cards` `{text, column?, notes?: [line]}` → the new card (+ `column`);
  creates Personal's file with the standard three columns if missing
- `PATCH api/boards/<id>/cards/<cid>` `{text?, column?, done?}`: rename; move to a column
  (title, part of one, or a kind); `done: true|false` moves to the first Done / Backlog column
- `DELETE api/boards/<id>/cards/<cid>`
- `POST api/boards/<id>/archive` → `{archived, file}`

Errors are `{error}`: 404 unknown board, 409 the card changed on disk, 400 bad input.

## Ideas

Due dates on Personal cards (for the Calendar app and Needs you), an opt-in job that archives Done
on boards the owner picks, In Progress cards on the Timeline.

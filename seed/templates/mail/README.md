# Mail
Read-only view of your Gmail inbox: search, read, sandboxed HTML mail.

Read-only Gmail reader: inbox list, search, sandboxed HTML reading pane.

- **Read-only by design.** `sync.py` logs in over IMAP (`imap.gmail.com`) with
  `~/.config/agentos/gmail` (line 1 address, line 2 app password), opens INBOX
  with `EXAMINE` (readonly) and fetches with `BODY.PEEK[]`. It never sends,
  deletes, moves or sets flags. Keep it that way.
- **Sync:** `mail-sync.timer` runs `mail-sync.service` every 3 min. First run
  pulls the last 30 days (`MAIL_DAYS`), later runs fetch only new UIDs, refresh
  `\Seen` state and drop messages that left the inbox. Resets if UIDVALIDITY changes.
- **Data:** `~/data/mail/mail.db` (SQLite; tables `msgs`, `inline` (cid images),
  FTS5 `fts` for search). Attachments are only listed by name, not stored.
- **Server:** `server.py` (stdlib Python, port in `PORT`, 8101) serves `index.html`
  and `api/list?q=&before=`, `api/msg/<uid>`, `api/status`, `frame/<uid>?images=0|1`.
  The frame endpoint returns the mail HTML with a strict CSP (no scripts; remote
  images only with `images=1`) and is loaded in an iframe with `sandbox` (no scripts,
  no same-origin). Links open in a new tab.
- **Run:** `systemctl --user restart mail`; sync now: `systemctl --user start mail-sync`;
  logs: `journalctl --user -u mail -u mail-sync`. Test with a fake DB via
  `MAIL_DB=... MAIL_PORT=...`.

## JSON API (for other Views/agents)

`curl localhost:8101/api/list?q=<text>&before=<unix ts>` (60 newest per page: uid, from_name, from_addr, subject, snippet, date, seen, att), `/api/msg/<uid>` (full text, headers), `/api/status` (count, unread, last_sync).

## UI

Built from the design kit (`~/home/DESIGN.md`, Gallery View): `body.ui-app` →
`ui-toolbar` (title, unread `ui-badge`, `ui-search`) → `ui-split` (list | reading
pane). Rows are `button.ui-row` with `ui-avatar sm`, `.unread`/`.selected`;
`ui-skeleton` while loading, `ui-empty` for no selection / no matches / errors,
sync status as a `ui-dot` (ok, warn if stale >15 min or no credentials). On phones
(≤720px) the split shows list or message (`.show-detail`), with a back button in
the reading pane's toolbar. View CSS is layout only, plus the mail-frame handling.
Icon: `ICON` (mail).

Mail bodies keep their own colors inside the frame (the frame endpoint gives HTML
mail a white page); plain-text mails take the theme's fg/bg via query params.
In dark themes HTML mail is shown with an invert+hue-rotate filter (images re-inverted); `frame/<uid>?dark=1&bg=<hex>`; the "Original colors" button toggles it per message.

# Chat design — accepted direction

**Decided 2026-08-12.** Chat is Springroll's input layer, not a destination.
The interactive spec with clickable mockups is
[`docs/design/chat-flow.html`](design/chat-flow.html) (published copy:
<https://claude.ai/code/artifact/7c9631e3-97b7-4c0f-a382-45d8d80442f1>).
The exploratory variation studies that led here were removed; the spec
supersedes their picks.

The mental model that settled the run-vs-chat question: **a run is a
templatized chat, and a chat is an untemplated run.** Same engine, two
frequencies, one surface (the thread), two record origins (a timer sent it,
or you did).

## The six rules

1. **The bottom bar is a progressive new-chat entry: collapsed launcher →
   compact draft → full-screen thread.** A thin (~46px) pill is docked at the
   bottom of every non-thread page. Clicking or focusing it expands the same
   surface upward into a two-line composer that grows to roughly six lines,
   with page context, model selection, attachments, and Send. It is a drafting
   surface, not a mini conversation: the first send creates a fresh session
   and opens its full-screen thread, where letters, credential cards, tool activity, and
   replies have room. Escape or click-away collapses the draft without
   clearing it; `/` expands and focuses it. On narrow screens the drafting
   state becomes a full-height sheet below the app chrome. Its clock-labeled
   History control opens Inbox Chats.
2. **Page context is suggested, visible, and removable.** A launcher on a
   recipe, run, or integration shows that subject as a chip. Removing the
   chip creates a general chat instead. On send, the retained chip moves into
   the full-screen thread as linked provenance and becomes the primary label
   its Inbox row carries ("Morning digest"). A thread started without page
   context uses "Springroll" as its label. Once a turn has used context, the
   thread keeps that provenance rather than pretending it can unsee it.
3. **Every thread is an Inbox record the moment it starts** — standard row
   grammar: mono time, subject label first, then a short one-line receipt
   from the first ask. Chat rows have no status dot; run rows keep outcome
   color (running pulse / ok / needs-you / failed).
4. **"Chats" in Inbox is the chat history — all of it.** The
   Runs · Chats segmented switch is required: there is no mixed All feed.
   No Chat tab, chat index, or separate archive. History is kept in the
   Chats view.
5. **Runs and chats are linked records, never nested surfaces.** A run page
   keeps the bottom launcher and suggests the run chip. Sending always creates
   a fresh run-tagged chat at `/chat/:id`; it never resumes the first matching
   session or renders a discussion beneath the run letter. Existing threads
   open only on their full-screen page, whose compact bottom-anchored composer
   owns replies, model changes, attachments, editing, and Stop. Thread pages do
   not also render the bottom launcher.
6. **Asking is the primary path; forms are the fallback.** Facts on detail
   pages carry a quiet **Ask** affordance that seeds the bar. The bar's
   scope-aware placeholder is where "chat does everything" is communicated
   ("Ask, or fix anything — reconnect, permissions, which recipes use it…").

Credential rule unchanged: credentials are never typed into chat — setup
ceremonies happen in their own surfaces.

## Deleted by this design

- The Chat tab, `/chat` as home and the chat index page (`/` routes to Inbox)
- Inline reply threads and composers beneath run letters
- Every scattered `ChatContextButton` (run and connection asks use the
  context-aware launcher)
- The separate integration composer (the bar on Connections, scoped)
- The recipe composer as a distinct surface (the bar on Recipes: "Describe a
  new recipe, or ask about the ones you have")

## Ship order (each step stands alone)

1. Make the bottom bar progressively expand for drafting and show removable
   page context, model selection, and attachments before the first send.
2. Give full-screen threads their own compact bottom-anchored composer and
   remove inline run conversations.
3. Keep every chat in the Inbox Chats feed and route every row to `/chat/:id`.
4. Add quiet Ask affordances on facts, page by page.

Open dogfood questions: does the desktop expansion feel large enough for a
thoughtful initial prompt without covering too much of the page? Does the
full-height narrow-screen draft feel like a natural continuation of the
launcher? And if resolved threads silt up the feed, collapse them to
receipt-height rows.

## Implementation prompt

Paste this into a fresh session to build it:

> Implement Springroll's accepted chat design. Read `docs/chat-design.md`
> for the rules and open `docs/design/chat-flow.html` in a browser to click
> through the five-step flow before writing code. The work is in
> `app/src/client/` (springroll-app.tsx, chat-page.tsx, styles.css) plus
> whatever server/API changes the feed needs; do not touch kernel execution
> code.
>
> Ship step N of the ship order in `docs/chat-design.md` (start at 1 if I
> didn't say): (1) make the thin bottom bar expand upward into a compact
> drafting composer, then create a fresh session and open `/chat/:id` on send;
> (2) put the compact bottom-anchored reply/model/attachment composer inside
> the full-screen thread and
> remove every inline run conversation; (3) route every Inbox chat row to its
> full-screen thread while preserving the Runs · Chats split; (4) add quiet
> "Ask" affordances on detail-page facts that seed the launcher.
>
> Constraints: chat history stays persisted in Inbox — never delete sessions;
> credentials never enter chat; follow the
> design system (`app/src/client/design-system.css` tokens,
> `docs/design/style-guide.md` grammar — one popover shell, color only via
> tokens, mono = telemetry); match the spec's thread styling (asks as
> right-aligned muted asides, replies as letters, tool pills, mono meta).
> Keep `app/test` green and update tests where routes and entry points
> change. Remember `bun run dev:app` builds the client once at startup —
> restart the server to see client edits. Update the TODO.md card for the
> step you shipped.

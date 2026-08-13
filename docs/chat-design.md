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

1. **The bar takes a sentence; ⏎ always opens a full-screen thread.** A thin
   (~46px) pill launcher docked at the bottom of every page. It never grows a
   panel — the conversation always happens at full width, where letters,
   credential cards, and tool activity have room. `/` focuses it.
2. **Every thread is tagged with its origin.** The bar carries the page's
   subject as a chip (recipe, run, connection); the thread page wears that
   chip in its running head, where it is simultaneously the scope (what the
   thread can see and change), the link back, and the primary label its Inbox
   row carries ("Morning digest"). Backspace on an empty bar drops the chip →
   general scope. A thread started from Inbox uses "Springroll" as its label.
3. **Every thread is an Inbox record the moment it starts** — standard row
   grammar: mono time, status dot (running pulse / ok / needs-you / failed),
   subject label first, then a short one-line receipt from the first ask.
4. **"Asked" in Inbox is the chat history — all of it.** The
   All · Scheduled · Asked segmented switch narrows the feed, but rows carry
   no repeated source-type marker. No Chat tab, chat index, or separate
   archive. History is kept in the feed.
5. **Letters and threads are one surface.** Run letters end in a reply
   composer; replying continues that run as a thread in place ("Fix the Gmail
   thing"). Thread pages and run letters have no bar — their composer *is*
   the bar. Everything else (including Settings) has the bar.
6. **Asking is the primary path; forms are the fallback.** Facts on detail
   pages carry a quiet **Ask** affordance that seeds the bar. The bar's
   scope-aware placeholder is where "chat does everything" is communicated
   ("Ask, or fix anything — reconnect, permissions, which recipes use it…").

Credential rule unchanged: credentials are never typed into chat — setup
ceremonies happen in their own surfaces.

## Deleted by this design

- The Chat tab, `/chat` as home and the chat index page (`/` routes to Inbox)
- Every scattered `ChatContextButton` ("Ask about this run" → reply to the
  letter; connection asks → the bar, scoped)
- The separate integration composer (the bar on Connections, scoped)
- The recipe composer as a distinct surface (the bar on Recipes: "Describe a
  new recipe, or ask about the ones you have")

## Ship order (each step stands alone)

1. Reply composer on run letters — smallest change, loudest signal.
2. The bar + full-screen thread page with tags; kill the Chat tab; `/` →
   Inbox (redirect old `/chat/:id` links).
3. Add the Inbox source switch; migrate existing chat sessions into the feed;
   retire the chat index.
4. Ask affordances on facts, page by page.

Open dogfood questions: does ⏎-to-full-screen feel heavy for tiny asks
("pause this")? If so, make the thread open *already answered* — never a
mini panel. And if resolved threads silt up the feed, collapse them to
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
> didn't say): (1) reply composer on run letters — replying continues the
> run as a thread rendered under the letter, replacing the "Ask about this
> run" button; (2) the thin ask bar on every page (46px pill, subject chip,
> scope-aware placeholder, `/` to focus, never expands — Enter creates the
> session via the existing enterChat entry wiring and navigates to a
> full-screen thread page with running head: back link, title from the first
> ask, subject tag chip linking to its entity) and kill the Chat tab, routing
> `/` to Inbox with old `/chat/:id` redirecting; (3) every chat session in the
> Inbox feed as a label-first row (time, status dot incl. running pulse,
> subject label, short one-line response), keep the All · Scheduled · Asked
> source switch without per-row type markers, then retire the chat index; (4)
> quiet "Ask" affordances on detail-page
> facts that seed the bar.
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

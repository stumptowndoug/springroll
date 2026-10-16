# Personas

How the agent talks in a chat: presets the owner picks in the composer's settings menu, by typing
`/persona <id>` (`/persona off` for none), or as the default (Settings → Chats, `desk.json`
`persona.default`). A job can set `"persona"` in its `job.json`; jobs speak plainly otherwise.

One file per preset, `<id>.md`: frontmatter (`name`, `icon` (Lucide), `description`), then, short
(~1 KB): two or three lines of personality, then a **Style** list (how the sentences move, the images
and humor they reach for, how they give bad news, one "Avoid" line for the caricature). No example
exchanges: the agent copies them too closely; describe the style and let it play. Ground it in research (their own words, the
screenplay for a character, critics), but keep only what changes the writing. Say "in the manner
of X, never as X" for real people: no claiming their life story or inventing their quotes.

agentd (`agentd/personas.mjs`) sends the whole file with the first message after a switch, telling
the agent the owner asked it to play the part and to commit to it, then a one-line "stay in
character" reminder with each message. Only the voice changes: facts, actions, rules and approvals
stay as they are. Memory (`notes/memory.md`) holds preferences about substance; a persona is voice only.

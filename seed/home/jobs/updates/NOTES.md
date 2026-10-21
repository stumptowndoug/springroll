# Updates

Daily, 04:40: `updates apply` (~/home/bin/updates) moves what Springroll installs outside ~/home to its
newest ready version. One kind of item so far, each agent's chat part (`chat:<agent>`: claude-agent-acp,
codex-acp, pi-acp, Google's Antigravity runtime). They bundle their own copy of the agent, so without
this chat falls behind the CLI and never catches up (seen in practice: chat on Claude 2.1.293 while the CLI was on 2.1.304).

- Ready = out 3 days (npm publish time; for Antigravity the download's Last-Modified). A version must
  answer ACP initialize before it becomes current; one that doesn't is held back (a Worth knowing card,
  key `updates:chat:<agent>`) and retried after 7 days or replaced by a newer one.
- Each version has its own folder under ~/.local/share/springroll/chat/<agent>/; the launcher in
  ~/.local/bin picks `current` as a chat starts, so running chats keep theirs. Folders no process uses
  (and the old npm -g copies, and ~/.local/share/springroll/agy-acp) are removed on a later run.
- A failed run is a fetch that didn't work (network, npm registry): it retries once after 30 minutes.
- Only items already set up are touched. `updates` shows the state; `updates --json` for agents.
- Ideas for later items: the agent CLIs whose own auto-update is off (Claude's is, in ~/.claude.json),
  global npm tools (agent-browser, playwright and its browsers), apt security updates.

# Updates

Daily, 04:40: `bash ~/home/jobs/updates/run.sh` keeps chat adapters current and
maintains standalone CLIs (below). `updates apply` (~/home/bin/updates) manages each agent's
chat part (`chat:<agent>`: claude-agent-acp, codex-acp, pi-acp, Google's Antigravity runtime).
These bundle their own copy of the agent, so without this, chat falls behind the CLI
(seen in practice: chat on Claude 2.1.293 while the CLI was on 2.1.304).

- Ready = out 3 days (npm publish time; for Antigravity the download's Last-Modified). A version must
  answer ACP initialize before it becomes current; one that doesn't is held back (a Worth knowing card,
  key `updates:chat:<agent>`) and retried after 7 days or replaced by a newer one.
- Each version has its own folder under ~/.local/share/springroll/chat/<agent>/; the launcher in
  ~/.local/bin picks `current` as a chat starts, so running chats keep theirs. Folders no process uses
  (and the old npm -g copies, and ~/.local/share/springroll/agy-acp) are removed on a later run.
- A failed run is a fetch that didn't work (network, npm registry): it retries once after 30 minutes.
- Only items already set up are touched. `updates` shows the state; `updates --json` for agents.
- Remaining items outside this job: Playwright and its browsers, gh/apt updates.

## Standalone CLIs

The daily job now runs `bash ~/home/jobs/updates/run.sh`: chat adapters first, then
`python3 jobs/updates/cli.py --apply`. Both run even if the other fails. The job's
existing retry and Timeline failure handling cover both. No service restart needed.

- Covers installed Claude, Codex, OpenCode, Pi and agent-browser via their official npm packages.
  Stable releases must be at least 3 days old; never downgrade. Installs in version folders under
  `~/.local/share/springroll/cli`, checks exact version and `--help`, then atomically replaces a
  launcher in `~/.local/bin` (ahead of old /usr/local and global npm copies). Running processes
  retain their version paths. Retains two recent versions and any version a process still uses.
- Claude's launcher strips Anthropic API credentials; subscription sign-in is preserved. Its own
  auto-update remains disabled. Existing native/global binaries are left as fallbacks.
- Antigravity (`agy update`) and Cursor (`cursor-agent update`) use their vendor stable updaters,
  without our npm three-day delay. Both must still pass version/help checks afterward.
- Saves version results in `~/data/updates/cli-status.json`, and Antigravity/Cursor live model lists
  beside it. These list checks make no generation requests; they do not prove a model can answer.
- Antigravity's chat model menu was stale despite both runtimes being current. After updates,
  invalidate only the `images` marker on its cached agent_options row, then GET the existing
  `/agents/antigravity/options` API: agentd's cache-miss path probes a fresh session and saves its
  real models, preserving preferences. No active chat is stopped or changed. Snapshot saved as
  `antigravity-chat-models.json`; a failed probe fails this run. This is a workaround until agentd
  offers an explicit model-refresh API. Google's separate chat runtime lists fewer models than agy.
- `python3 jobs/updates/cli.py --check` inspects versions without updating software (writes its
  status snapshot). `updates` by itself still lists chat adapters only.
- Deliberately excludes gh/apt and Playwright + browser binaries. Browser-library updates need to
  keep the library, downloaded Chromium and shots' global import path together; do not update just
  the Playwright command and claim the browser stack is current.
- Check: `python3 -m unittest discover -s jobs/updates -p 'test_*.py'`.

## Codex chat menu

Codex's model list comes from OpenAI's server, not the npm package: codex-acp 2.6.0 (bundled
codex 0.166) already received GPT-6.2 Sol/Astra, but agentd's remembered menu stayed on 6.1 because
it only re-asks on a cache miss. The Antigravity menu refresh is now `refresh_chat_menu(agent)` over
`MENU_AGENTS` (antigravity, codex); each run re-probes both and saves `<agent>-chat-models.json`.
A model whose `minimal_client_version` is above the bundled codex would still need a codex-acp
release, which the chat-adapter half of this job installs after 3 days.

# Agents

`agents.json` is the registry of coding-agent harnesses this machine can run:
how to install each, sign in, start it with full access, resume it, and run
it headless. Springroll reads it (Settings → Agents, and the agent pane's "+"
menu), and so can you. Nothing in Springroll is specific to one harness; to add
one, add an entry.

`startWithPrompt` starts an interactive session already working on a prompt
(`{prompt}` is replaced, shell-quoted). `headlessArgv` is the exact command to run a harness non-interactively from
code, with `{prompt}` replaced by the prompt (the System View's watchdog uses
it).

Every agent is optional, in two parts: the CLI (`install`; terminal and jobs) and
chat (`acp`: the command Springroll's chat runs, an Agent Client Protocol mode).
Chat is built in when `acp[0]` is the CLI itself (`opencode acp`, `cursor-agent
acp`); otherwise `acpInstall` adds an adapter or runtime and `acpRemove` takes it
away. Connections → Coding agents shows both parts with what they take on disk:
`size` is the estimate in MB (`cli`, `chat`, and `chatDownload` when the download
differs), and `disk` lists the paths measured once installed (`npm:<package>` for
a global npm package; globs allowed). Install there does both parts and signs in;
a new chat with an agent that isn't ready offers the same one click.

`account` is a shell command printing `{account, plan, method}` as JSON: who the
harness is signed in as (an email), its plan id (`max`, `prolite`), and how
(`Setup token`, `ChatGPT sign-in`, `OpenRouter API key`). Clicking a coding
agent in Connections shows it (`GET /api/agents/<id>/account`); leave out what
the harness doesn't say. It must not print secrets.

`chatSignin` is for a chat runtime that signs in on its own, apart from the CLI
(`command`, `kind` like `signin`, its `auth` files, and `paste`: what to ask the
owner to paste). Antigravity's is Google's official ACP server, installed by
`bin/agy-acp-install` (pinned version, SHA-256 checked; see the script to move
to a new version); its Google sign-in ends on a 127.0.0.1 page on this machine,
so the owner pastes that address back and the script fetches it here.

`providerAuth` is for harnesses that take any provider and list models they
can't use here (OpenCode lists its own Zen models whether or not you've signed
in to Zen). Model ids are `provider/model`; chat offers only the models of
providers with a key: a key in one of the `auth` files, a provider set up in one
of the `config` files, or `<PROVIDER>_API_KEY` in the environment. When the
harness starts on a model outside those, a new chat switches to the newest match
for the first of `preferModels` it has (else the first usable model).

Interactive sessions are tmux sessions, started by `bin/agent-session`, so
they survive closed browsers and Springroll restarts. The session named after a
harness (e.g. `claude`) resumes its last conversation when restarted.

Agent marks are rendered everywhere by `ui.agentMark(id, name)`, from
`views/desk/public/ui/logos.svg` or a standalone SVG for masked brand assets.
Antigravity has its own official colored mark,
from `https://antigravity.google/favicon.svg` (retrieved 2026-10-14), with
the favicon background circle omitted. Its transparent standalone SVG is
`views/desk/public/ui/antigravity.svg`, keeping the original paths, mask and
color filters with unique Antigravity IDs. The kit renders it as an image
because its mask loses its shape inside the zero-sized inline sprite. Keep
its registry `logo: antigravity` and the kit's supported marks in sync. Gallery's
`#agent-marks` section previews every agent, including Gemini separately.

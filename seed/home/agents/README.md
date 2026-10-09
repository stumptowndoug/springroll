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

Interactive sessions are tmux sessions, started by `bin/agent-session`, so
they survive closed browsers and Springroll restarts. The session named after a
harness (e.g. `claude`) resumes its last conversation when restarted.

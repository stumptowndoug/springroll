# Agents

`agents.json` is the registry of coding-agent harnesses this machine can run:
how to install each, sign in, start it with full access, resume it, and run
it headless. The Desk reads it (Settings → Agents, and the agent pane's "+"
menu), and so can you. Nothing in the Desk is specific to one harness; to add
one, add an entry.

Interactive sessions are tmux sessions, started by `bin/agent-session`, so
they survive closed browsers and Desk restarts. The session named after a
harness (e.g. `claude`) resumes its last conversation when restarted.

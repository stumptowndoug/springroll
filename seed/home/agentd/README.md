# agentd

The agent runtime behind Springroll: threads (conversations with any coding
agent that speaks ACP, the Agent Client Protocol) and scheduled jobs.
Node, no dependencies (`node:sqlite`). HTTP + server-sent events on
127.0.0.1:8090; Springroll proxies it at `/api/agent/`.

- `acp.mjs`: JSON-RPC over stdio to an agent's ACP mode (`acp` in
  `agents/agents.json`: claude-agent-acp, codex-acp, opencode acp, pi-acp).
- `threads.mjs`: one agent process per active thread, started on demand and
  stopped after 15 idle minutes; sessions resume with `session/load`. ACP
  updates become timeline items: `user`, `text`, `thought`, `tool`, `plan`,
  `permission`, `media`, `notice`, `turn`. Access `full` (default) answers
  permission requests with "allow" and puts the harness in its full-access
  mode; `ask` switches it back (right away, mid-chat) and shows requests to the
  owner. The thread's `options` (models, effort, modes, other settings such as
  Fast mode) follow what the agent reports, including changes it makes itself
  (`config_option_update`); a refused change leaves a `notice`. A model picked
  in the composer is what new chats with that agent start on
  (`agent_options.preferredModel`). For an agent with `providerAuth` in
  `agents.json` (OpenCode), models of providers it has no key for are left out,
  and one it starts on that it can't use is switched for a usable one
  (`usableModels` in `threads.mjs`). An agent that hasn't started within a
  minute fails the turn; stopping it kills its whole scope or process group.
  Stop (`/cancel`) asks the agent to cancel and drops messages queued behind
  the turn; an agent still going 30s later is closed (its session resumes on
  the next message). Streamed text is written and sent every 100ms, as
  `append` events (`{threadId, id, from, text}`: the text added at offset
  `from`), not per chunk. Size limits: tool output keeps its last 24k characters;
  a diff over 24k characters or 2000 lines is kept as `{path, truncated}`, at
  most 8 per tool call; an image over 4 MB becomes a notice. Switching a chat to
  Full access answers its waiting requests (allow once).
- `jobs.mjs` + `cron.mjs`: jobs in `~/home/jobs/<name>/job.json` (+ the
  agent's `NOTES.md`), five-field cron schedules, skip missed runs unless
  `catchUp: "once"`, never overlapping. Each run is a thread (origin
  `job:<name>`); its final message is the report, sent to the owner's phone.
- `store.mjs`: SQLite at `~/data/agentd/agentd.db`.
- `test/`: the chat runtime against a fake ACP agent (streaming, Stop, permissions, size limits):
  `node --test agentd/test/chat.test.mjs`. Run it after changing `threads.mjs`.
- Connected services' MCP servers (`~/home/connections/<name>/mcp.json`) are
  given to every new session.

API: `GET /threads[?q=]`, `POST /threads {agent, cwd, text, context}`,
`GET /threads/:id`, `POST /threads/:id/messages {text}`, `.../cancel`,
`.../permissions/:itemId {optionId}`, `PATCH /threads/:id {title, archived,
pinned, read, model, effort, access, option: {id, value}}`, `DELETE /threads/:id`; `GET|POST /jobs`,
`GET|PATCH|DELETE /jobs/:name`, `POST /jobs/:name/run`, `GET /cron?expr=`;
`GET /events` (SSE: `thread`, `item`, `append`, `jobs`, `deleted`).

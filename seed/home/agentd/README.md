# agentd

The agent runtime behind the Desk: threads (conversations with any coding
agent that speaks ACP, the Agent Client Protocol) and scheduled jobs.
Node, no dependencies (`node:sqlite`). HTTP + server-sent events on
127.0.0.1:8090; the Desk proxies it at `/api/agent/`.

- `acp.mjs`: JSON-RPC over stdio to an agent's ACP mode (`acp` in
  `agents/agents.json`: claude-agent-acp, codex-acp, opencode acp, pi-acp).
- `threads.mjs`: one agent process per active thread, started on demand and
  stopped after 15 idle minutes; sessions resume with `session/load`. ACP
  updates become timeline items: `user`, `text`, `thought`, `tool`, `plan`,
  `permission`, `media`, `notice`, `turn`. Access `full` (default) answers
  permission requests with "allow"; `ask` shows them to the owner.
- `jobs.mjs` + `cron.mjs`: jobs in `~/home/jobs/<name>/job.json` (+ the
  agent's `NOTES.md`), five-field cron schedules, skip missed runs unless
  `catchUp: "once"`, never overlapping. Each run is a thread (origin
  `job:<name>`); its final message is the report, sent to the owner's phone.
- `store.mjs`: SQLite at `~/data/agentd/agentd.db`.
- Connected services' MCP servers (`~/home/connections/<name>/mcp.json`) are
  given to every new session.

API: `GET /threads[?q=]`, `POST /threads {agent, cwd, text, context}`,
`GET /threads/:id`, `POST /threads/:id/messages {text}`, `.../cancel`,
`.../permissions/:itemId {optionId}`, `PATCH /threads/:id {title, archived,
pinned, read, model, access}`, `DELETE /threads/:id`; `GET|POST /jobs`,
`GET|PATCH|DELETE /jobs/:name`, `POST /jobs/:name/run`, `GET /cron?expr=`;
`GET /events` (SSE: `thread`, `item`, `jobs`, `deleted`).

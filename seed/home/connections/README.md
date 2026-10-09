# Connections

Outside services agents can use. `catalog.json` lists what Springroll offers
(Connections page): the fields to ask for, how to get them, a test command,
and optionally an MCP server.

Values live in `~/.config/agentos/secrets.env` (mode 600, never in git) and
are exported into every agent session and job, so an agent uses them like any
environment variable: `curl -H "Authorization: Bearer $GH_TOKEN" …`. A
connected service gets a folder here with `connection.json` (when, which
keys) and, if its MCP server is turned on, `mcp.json`, which agentd hands to
new agent sessions.

To add a service, add an entry to `catalog.json`. Never print secret values;
refer to them by variable name.

# Springroll

Springroll is a local-first scheduled agent for macOS. Describe a recurring job
in plain language, choose the services it may use, and let it run on your Mac
with a readable result, source activity, token usage, and cost.

> [!IMPORTANT]
> Springroll is preparing for an experimental source-first alpha. It is not yet
> packaged, security-audited, or licensed for redistribution. Expect rough
> edges and breaking changes.

## What works today

- Create one-time or scheduled recipes through chat.
- Review, pause, edit, and run recipes from the local app.
- Read completed work and conversations together in the Inbox.
- Set a per-run model-turn limit and an optional approximate cost budget.
- Connect OpenRouter, OpenAI, or xAI model accounts.
- Connect Gmail, Google Calendar, Google Drive, Outlook, OneDrive, Microsoft
  Teams, SharePoint, Slack, Neon, web search, custom MCP servers, and reviewed
  HTTP APIs.
- Keep the recipe catalog, run history, chats, and artifacts on the Mac.

Springroll currently runs only while its local process is open. There is no
hosted account or run-anywhere service.

## Five-minute local setup

Requirements:

- macOS (credentials currently use macOS Keychain)
- [Bun](https://bun.sh/) 1.3.14 or newer
- a key for at least one supported model provider

Clone the repository, install dependencies, and start the app:

```sh
git clone https://github.com/stumptowndoug/springroll.git
cd springroll
bun install
bun run dev:app
```

Open [http://127.0.0.1:4117](http://127.0.0.1:4117), then:

1. Open **Settings** and connect a model provider.
2. Open **Integrations** to connect any services a recipe should use.
3. Choose **Add recipe** and describe the work and schedule in plain language.
4. Review the proposed recipe before saving it.

No environment file is required to start Springroll. Some one-click OAuth
integrations need application-owned client configuration that is not bundled
with this pre-release source tree. Contributors testing Google, Microsoft, or
Slack sign-in should copy `.env.example` to `.env` and follow
[the connector setup guide](docs/one-click-connectors.md). A packaged release
should ship those public desktop client identifiers so end users only choose
**Sign in**.

## Local data, credentials, and third parties

By default, Springroll stores its SQLite databases and artifacts under
`.local/` and stores account tokens and API keys in macOS Keychain. The local
HTTP app listens on loopback rather than the network.

Local-first does not mean offline. Recipe instructions, chat messages, relevant
tool results, and requested files or images may be sent to the selected model
provider. Connector calls send the requested data to the connected service or
MCP server. Springroll is designed to keep credential values out of prompts,
SQLite, run events, and normal logs, but it has not received an independent
security review.

Read [Security and data flow](docs/security-and-data.md) before connecting
sensitive accounts. Security issues should follow [SECURITY.md](SECURITY.md).

## Costs and run limits

Springroll uses your provider accounts, so model and integration providers bill
you directly. The app records provider-reported or catalog-estimated model cost
when available.

The turn limit is a hard limit on model turns, including tool-calling and final
report turns. The optional dollar budget is an approximate boundary checked
between model turns; the request already in flight, including the final
wrap-up, can take the total over the configured amount. Neither setting is a
provider billing cap.

## Development

Run the complete local check:

```sh
bun run check
bun run build
```

The workspace is organized as:

- `kernel/` — agent loop, policies, scheduling contracts, and persistence
- `app/` — local HTTP server and React interface
- `cli/` — development command-line shell
- `docs/` — product, architecture, integration, and acceptance notes
- `spikes/` — isolated architectural proofs

The default database is `.local/springroll.sqlite`. Override it with
`SPRINGROLL_DB_PATH` when a test or isolated development environment needs a
different location.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and
[the integration runtime notes](docs/integration-runtime.md) for connector
architecture.

## Project status

The immediate roadmap is deliberately small:

1. Prepare and publish a source-first experimental alpha.
2. Polish chat and the default light, dark, and optional glass themes.
3. Prove the macOS package architecture with an unsigned developer build.

Hosted execution is deferred until the local product and packaging are proven.
The live board is in [TODO.md](TODO.md).

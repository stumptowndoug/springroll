<p align="center">
  <img src="./logo.svg" width="112" alt="Springroll logo">
</p>

<h1 align="center">Springroll</h1>

<p align="center"><strong>Tell it once. Let it run.</strong></p>

<p align="center">
  A local-first scheduled agent for macOS. Describe recurring work in plain
  English, connect the services it needs, and get a readable result on schedule.
</p>

> [!IMPORTANT]
> Springroll is experimental source-alpha software. It works today, but it is
> not yet a packaged Mac app or independently security-audited. Expect rough
> edges and breaking changes.

## Why Springroll

- **Recipes, not scripts.** Ask for “a weekday briefing from my calendar and
  inbox,” review the proposed schedule and access, then save it.
- **One place for the result.** Runs and conversations land in a shared Inbox
  with the report, source activity, token usage, tool calls, duration, and cost.
- **Your Mac is the runtime.** Recipes, history, chats, and artifacts stay in
  local storage; account secrets live in macOS Keychain.
- **Real integrations.** Connect individual Google, Microsoft, Slack, Neon,
  model-provider, MCP, and HTTP API accounts.

## Quick start

You need macOS, [Bun](https://bun.sh/) 1.3.14 or newer, and either a supported
model API key or a ChatGPT plan with Codex access.

```sh
git clone https://github.com/stumptowndoug/springroll.git
cd springroll
bun install
bun run dev:app
```

Open [http://127.0.0.1:4117](http://127.0.0.1:4117), then:

1. Open **Settings** and connect a model provider.
2. Open **Integrations** and connect any services the recipe should use.
3. Choose **Add recipe** and describe the job and schedule.
4. Review the recipe, save it, and run it once.

No `.env` file is required for the app to start.

## The loop

```text
Describe the job → Review the recipe → Connect its tools → Run on schedule → Read the result
```

Springroll keeps the agent loop understandable without pretending it is
deterministic. You can inspect what it called, cap model turns, set an
approximate per-run cost boundary, pause a recipe, or stop an active run.

## What works today

| Area | What you get |
| --- | --- |
| Recipes | One-time and scheduled work created through chat, with review before saving |
| Inbox | Completed run reports and ordinary conversations in one chronological place |
| Controls | Enable, pause, edit, run now, stop, reconnect, and recover after sleep |
| Evidence | Visible source activity and tool calls behind each result |
| Usage | Model turns, tokens, tool calls, duration, and recorded or estimated cost |
| Extensibility | One-click accounts plus custom remote/local MCP and reviewed HTTP APIs |

### Integrations

| Category | Available connections |
| --- | --- |
| Models | OpenRouter, OpenAI, Anthropic, Google AI, xAI, Groq, plus experimental Claude and Codex subscription connections |
| Google | Gmail, Google Calendar, Google Drive |
| Microsoft 365 | Outlook, OneDrive, Microsoft Teams, SharePoint |
| Work and data | Slack, Neon |
| Web | Built-in web reading and optional Exa search |
| Custom | Remote MCP, reviewed local MCP packages, OpenAPI-backed HTTP APIs |

Connections are account-specific. Springroll starts supported OAuth services
with read access and offers additional write permissions explicitly from the
account page.

## Local-first, not offline

| Stays on this Mac | Leaves when you ask Springroll to use it |
| --- | --- |
| Recipe catalog, schedules, chats, run history, usage ledger | Recipe instructions and relevant conversation context sent to the selected model |
| SQLite databases and generated artifacts under `.local/` | Tool arguments sent to the connected service or MCP server |
| API keys and OAuth tokens in macOS Keychain | Relevant connector results returned to the model for reasoning and reporting |
| Local app on loopback `127.0.0.1` | Files or images explicitly supplied to a model or integration |

There is currently no Springroll account, cloud sync, or hosted scheduler.
Closing the local process stops future recipe execution. Read
[Security and data flow](docs/security-and-data.md) before connecting sensitive
accounts.

## Costs and limits

Springroll uses your provider accounts, so those providers bill you directly.
The app records provider-reported or catalog-estimated model cost when
available.

- The **turn limit** caps model turns, including tool-calling and report turns.
  A turn can contain several parallel tool calls.
- The optional **cost budget** is checked between model turns. A request already
  in flight, including the wrap-up call, can take the total over the target.
- Neither setting replaces a provider-side spending limit.
- Codex subscription recipes currently treat the turn limit as guidance, and
  the cost budget does not apply because those runs are not metered API calls.

## OAuth connector setup

Ordinary users of a future packaged release should only choose **Sign in**.
This source alpha does not bundle Springroll's public desktop OAuth client
configuration, so contributors testing Google, Microsoft, or Slack sign-in must
copy `.env.example` to `.env` and follow the
[one-click connector guide](docs/one-click-connectors.md).

## Current limitations

- Source-run only; there is no signed `.app`, DMG, or automatic updater yet.
- macOS is required because credentials currently use Keychain.
- The local Springroll and Rivet processes must remain running for schedules.
- Hosted/run-anywhere execution is intentionally deferred.
- OAuth publishers still need provider review before a broad public release.
- Codex subscription support is experimental, local-only, recipe-only, and
  does not yet support Springroll approval continuations or a hard turn cap.
- This is experimental software, not a hardened multi-user security boundary.

## Development

```sh
bun run check
bun run build
```

| Path | Responsibility |
| --- | --- |
| `kernel/` | Agent loop, policies, scheduling contracts, and persistence |
| `app/` | Local HTTP server, host adapters, and React interface |
| `cli/` | Thin development command-line shell |
| `docs/` | Product, architecture, integration, and acceptance notes |
| `spikes/` | Isolated architectural proofs |

The default database is `.local/springroll.sqlite`. Set
`SPRINGROLL_DB_PATH` when a test or isolated development environment needs a
different location.

## Documentation

| Topic | Guide |
| --- | --- |
| Contributing | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Security and data flow | [docs/security-and-data.md](docs/security-and-data.md) |
| One-click OAuth connectors | [docs/one-click-connectors.md](docs/one-click-connectors.md) |
| Model providers and coding subscriptions | [docs/model-providers.md](docs/model-providers.md) |
| Integration runtime | [docs/integration-runtime.md](docs/integration-runtime.md) |
| Product and architecture status | [TODO.md](TODO.md) |

The immediate roadmap is source alpha, first-impression design polish, and an
unsigned macOS package proof. Hosted execution comes later.

## License

MIT. See [LICENSE](LICENSE).

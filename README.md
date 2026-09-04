# Springroll

Working repository for a local-first scheduled agent app.

The product lets someone describe a recurring job in a sentence, review the
schedule and capability contract, and run it locally. A later paid service can
cover opted-in runs while the local machine is unavailable.

## Workspace

- `kernel/` — scheduling, task execution, and connector policy
- `app/` — local desktop/web shell
- `cli/` — thin development shell
- `docs/` — product, architecture, and acceptance scenarios

## Development

Install [Bun](https://bun.sh/) and run:

```sh
bun install
bun run check
bun run dev:app
```

Open [http://127.0.0.1:4117](http://127.0.0.1:4117) to use the local
Springroll app. It keeps its SQLite database in `.local/`, runs the scheduler
while the process is open, and reads connection secrets from macOS Keychain.

The app opens on Runs and includes:

- sentence-first task proposals with a capability contract
- run-once and scheduled task creation
- task enable, pause, run-now, and wake-after-sleep controls
- readable run letters with quiet cost and duration details
- OpenRouter and remote Neon MCP connection setup

Run `bun run build` to produce the browser bundle without starting the local
service.

## Development CLI

To prepare and run the live Phase 2 Hacker News acceptance check:

```sh
read -s "OPENAI_API_KEY?OpenAI API key: " && export OPENAI_API_KEY && echo
bun run dev:cli -- openai:connect
unset OPENAI_API_KEY
bun run dev:cli -- hn:once
```

OpenRouter is also supported with a single API key:

```sh
read -s "OPENROUTER_API_KEY?OpenRouter API key: " && export OPENROUTER_API_KEY && echo
bun run dev:cli -- openrouter:connect
unset OPENROUTER_API_KEY
bun run dev:cli -- hn:once openrouter
```

The first command validates the key without generating tokens, then stores it
in macOS Keychain. The second command reads it from Keychain and makes a paid
model request. Neither command prints or stores the key in SQLite.

For local development, Bun also loads a repository-root `.env` file:

```dotenv
OPENROUTER_API_KEY=sk-or-v1-your-key-here

# Optional during development: Google OAuth Desktop credential for Gmail,
# Google Calendar, and Google Drive. Both values come from the same credential.
SPRINGROLL_GOOGLE_OAUTH_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
SPRINGROLL_GOOGLE_OAUTH_CLIENT_SECRET=your-google-oauth-client-secret

# Optional: enables native Sign in for Outlook, OneDrive, Teams, and SharePoint
SPRINGROLL_MICROSOFT_OAUTH_CLIENT_ID=your-entra-application-client-id
# Optional; defaults to common
SPRINGROLL_MICROSOFT_OAUTH_TENANT=common

# Optional: enables Slack's public desktop OAuth client
SPRINGROLL_SLACK_OAUTH_CLIENT_ID=your-slack-client-id
```

The file is ignored by Git. After `openrouter:connect` stores the key in
Keychain, the environment value is no longer needed for later runs.

Springroll's Gmail, Google Calendar, and Google Drive connectors use Google's
production REST APIs with one Google OAuth **Desktop app** client. Enable the
Gmail, Calendar, and Drive APIs in Google Cloud and create that Desktop client.
Google's installed-app flow sends consent back to Springroll's local loopback
server (the default port is `4117`), so there are no Web redirect URIs for an
operator or end user to register:

```text
http://127.0.0.1:4117/api/connectors/gmail/oauth/callback
http://127.0.0.1:4117/api/connectors/google-calendar/oauth/callback
http://127.0.0.1:4117/api/connectors/google-drive/oauth/callback
```

Set the Google client ID and secret from Google's downloaded Desktop
credential, then restart Springroll. Desktop applications cannot keep that
secret confidential, but Google's token endpoint still requires it. A packaged
release should supply this application-owned client configuration; end users
should only click Sign in. Each sign-in creates an independent account connection.
Gmail starts at `gmail.readonly`, Calendar at `calendar.readonly`, and Drive at
`drive.readonly`. Connected accounts can add write permission sets from the
account page. Add those scopes to the Google Auth Platform Data Access list
before testing them. Operator setup, Slack's public desktop app, and the
Grok-style catalog split are documented in `docs/one-click-connectors.md`. A
public release still requires Google's applicable OAuth verification;
development projects can use configured test users.

Outlook, OneDrive, Microsoft Teams, and SharePoint likewise share one Entra ID
public desktop app while keeping each service and account independently
consented. Add the four
`/api/connectors/{outlook|onedrive|microsoft-teams|sharepoint}/oauth/callback`
`http://localhost` redirect URIs under Mobile and desktop applications, set the
Microsoft client ID (and optionally restrict the tenant), and restart. Microsoft
starts each connector read-only and Springroll offers write permissions as
explicit account-page upgrades. The exact delegated permissions and copy-paste
callback list are in `docs/one-click-connectors.md`.

Slack uses its official remote MCP server with a fixed Springroll app identity.
Enable PKCE on that Slack app and register Springroll's localhost callback, then
set only `SPRINGROLL_SLACK_OAUTH_CLIENT_ID`. Slack's desktop flow exchanges and
refreshes tokens without a client secret. Internal apps work for one workspace;
arbitrary customer workspaces require a Slack Marketplace-published app.

The kernel keeps scheduling, connector policy, persistence, and model access
behind explicit adapters so the UI, CLI, and later hosted shell share the same
execution path.

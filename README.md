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

# Optional: enables native Sign in for Gmail, Google Calendar, and Google Drive
SPRINGROLL_GOOGLE_OAUTH_CLIENT_ID=your-google-oauth-client-id.apps.googleusercontent.com
SPRINGROLL_GOOGLE_OAUTH_CLIENT_SECRET=your-google-oauth-client-secret
```

The file is ignored by Git. After `openrouter:connect` stores the key in
Keychain, the environment value is no longer needed for later runs.

Springroll's Gmail, Google Calendar, and Google Drive connectors use Google's
production REST APIs with one registered Web application OAuth client. Enable
the Gmail, Calendar, and Drive APIs in Google Cloud, then register these local
redirect URIs (the default Springroll port is `4117`):

```text
http://127.0.0.1:4117/api/connectors/gmail/oauth/callback
http://127.0.0.1:4117/api/connectors/google-calendar/oauth/callback
http://127.0.0.1:4117/api/connectors/google-drive/oauth/callback
```

Set both Google OAuth variables and restart Springroll. Each sign-in creates an
independent account connection; the same stable callback works for additional
personal, work, or client accounts. Gmail starts at `gmail.readonly`, Calendar
at `calendar.readonly`, and Drive at `drive.readonly`. Connected accounts can
add write permission sets from the account page. Add those scopes to the
Google Auth Platform Data Access list before testing them. Operator setup,
Slack's confidential app, and the Grok-style catalog split are documented in
`docs/one-click-connectors.md`. A public release still requires Google's
restricted-scope OAuth verification; development projects can use configured
test users.

The kernel keeps scheduling, connector policy, persistence, and model access
behind explicit adapters so the UI, CLI, and later hosted shell share the same
execution path.

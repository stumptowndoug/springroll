# One-click connectors

How Springroll ships Grok-style connectors, what is ready now, and what you
need to configure on Google Cloud or Slack so Sign in actually opens.

## Grok's model, mapped onto Springroll

Grok splits connectors into three kinds. Springroll follows that split.

| Grok kind | What the user does | Springroll route |
| --- | --- | --- |
| Built-in | Sign in with the vendor. xAI owns the OAuth app and talks to the stable API. | Native `http-api` adapters. Springroll owns the OAuth client. |
| Catalog | Sign in. The provider hosts MCP and usually supports dynamic client registration. | Curated `mcp-remote` manifests. No Springroll OAuth app. |
| Custom MCP | Paste a server URL. | Existing researched / custom MCP path. |

Grok's built-in set is Gmail, Google Calendar, Google Drive, Outlook Mail &
Calendar, OneDrive, Microsoft Teams, SharePoint, and Salesforce. Its catalog
covers Notion, Slack, GitHub, Linear, and similar. Grok keeps Gmail and
Calendar as **separate** connectors with their own OAuth consent and a
read-then-write permission ladder.

Springroll now matches that for Google: Gmail, Calendar, and Drive are native
REST adapters on **one** Google Cloud OAuth client, each with its own Sign in
and optional write upgrade. GitHub, Jira, Linear, Notion, Stripe, and Neon stay
on the provider's official MCP OAuth. Slack stays on Slack's official MCP
server, but Slack refuses dynamic client registration, so Springroll's Slack
app has to exist first.

Microsoft 365 and Salesforce remain catalog placeholders until Springroll has
an Entra ID app and a Salesforce Connected App. Do not treat those cards as
working sign-in.

## Ready without extra operator setup

These use the provider's OAuth (dynamic client registration). Click **Sign in**
in Integrations. You do not create a Springroll OAuth app.

- **GitHub** — `https://api.githubcopilot.com/mcp/`. Official remote MCP with
  OAuth. A personal access token is not required. GitHub hosts this URL on the
  Copilot MCP hostname; you still sign in as a normal GitHub user.
- **Jira** — Atlassian remote MCP at `https://mcp.atlassian.com/v1/mcp/authv2`.
- **Linear** — official read-write MCP at `https://mcp.linear.app/mcp`. If an
  older Linear connection was created against the readonly URL, reconnect it.
- **Notion** — `https://mcp.notion.com/mcp`.
- **Stripe** — `https://mcp.stripe.com`. Review write tools before use.
- **Neon** — Sign in with Neon, or paste one API key.

## Google Workspace (Gmail, Calendar, Drive)

Springroll already has the native connectors. They become one-click as soon as
the existing Google Web OAuth client is in `.env` — the same
`SPRINGROLL_GOOGLE_OAUTH_*` pair Gmail uses.

You still have to widen that Google Cloud project so Calendar and Drive consent
succeeds.

### 1. Enable APIs

In the same Google Cloud project as Gmail:

1. Enable **Gmail API**, **Google Calendar API**, and **Google Drive API**.
2. Leave other Google APIs off unless a later connector needs them.

### 2. OAuth client redirect URIs

Auth platform → Clients → the Springroll Web client. Add all three local
callbacks (default port `4117`):

```text
http://127.0.0.1:4117/api/connectors/gmail/oauth/callback
http://127.0.0.1:4117/api/connectors/google-calendar/oauth/callback
http://127.0.0.1:4117/api/connectors/google-drive/oauth/callback
```

### 3. Data Access scopes

Add these to the OAuth consent screen's Data Access list. Restricted Gmail
scopes still need test users on an External + Testing project.

| Connector | Requested on Sign in | Optional upgrade on the account page |
| --- | --- | --- |
| Gmail | `gmail.readonly` | `gmail.modify` (Drafts and organize), `gmail.send` (Send mail) |
| Google Calendar | `calendar.readonly`, `userinfo.email` | `calendar.events` (Manage events) |
| Google Drive | `drive.readonly`, `userinfo.email` | `drive` (Create and organize) |

### 4. Test users

External testing apps only allow listed Google accounts. Add every dogfood
account, including `doug@assessorsearch.com` if that is the account you will
sign in with. Error 403 `access_denied` means the account is not a test user.

### 5. Restart Springroll

Repo-root `.env`:

```dotenv
SPRINGROLL_GOOGLE_OAUTH_CLIENT_ID=....apps.googleusercontent.com
SPRINGROLL_GOOGLE_OAUTH_CLIENT_SECRET=...
```

`dev:app` loads `../.env`. Restart after changing the file. Gmail, Calendar,
and Drive should leave Coming soon and show Sign in.

A public/production Google project still needs Google's restricted-scope
verification before anyone outside the test-user list can connect Gmail.

## Slack

Slack's MCP server (`https://mcp.slack.com/mcp`) does **not** support dynamic
client registration. Springroll must be a Slack app with a fixed client ID.

Until the app exists, Slack stays Coming soon.

### Create the Slack app

1. Create an **internal** Slack app at [api.slack.com/apps](https://api.slack.com/apps)
   (marketplace listing is not required for an internal app; unlisted public
   apps cannot use Slack MCP).
2. Enable **user-token** OAuth. Slack MCP uses user tokens, not bot tokens.
3. Redirect URL:

   ```text
   http://127.0.0.1:4117/api/connectors/slack/oauth/callback
   ```

4. Add the user-token scopes Slack documents for MCP (search, history, and
   users.read at minimum; `chat:write` only if you want send). Copy the current
   table from
   [Slack MCP authentication](https://docs.slack.dev/ai/slack-mcp-server/).
5. Install the app to the dogfood workspace. Workspace admins may still have to
   approve the MCP client.
6. Put the credentials in `.env` and restart:

   ```dotenv
   SPRINGROLL_SLACK_OAUTH_CLIENT_ID=...
   SPRINGROLL_SLACK_OAUTH_CLIENT_SECRET=...
   ```

Sign in with Slack should then appear in the one-click row. Live consent still
needs a real Slack workspace and that app.

## Microsoft 365 and Salesforce (not ready)

Grok implements these as native Graph / Salesforce connectors with xAI-owned
OAuth apps. Springroll shows them in the catalog so the set matches Grok, but
they stay Coming soon until we add the same native adapters.

When you are ready to unlock them, the operator work is:

**Microsoft (one Entra ID app, several connectors later)**

1. App registration, supported account types matching dogfood (personal,
   work/school, or both).
2. Web redirect URIs per connector, for example
   `http://127.0.0.1:4117/api/connectors/outlook/oauth/callback`.
3. Delegated Graph permissions, starting with `User.Read`, `Mail.Read`,
   `Calendars.Read`, `Files.Read`, plus `offline_access`.
4. Client ID/secret in env (not wired yet).
5. Admin consent if the tenant requires it.

**Salesforce**

1. Connected App with OAuth, PKCE, and refresh tokens.
2. Callback per connector.
3. Instance URL handling — Salesforce tokens are org-specific, so the native
   adapter cannot use a single hardcoded REST host the way Gmail can.

Do not create those apps until the native adapters land; unused redirect URIs
just rot.

## What you should do now

1. In the existing Google Cloud project, enable Calendar API and Drive API,
   add the two extra redirect URIs, and add the Calendar/Drive scopes plus
   `userinfo.email` to Data Access.
2. Add every Google account you will test as a test user (this unblocks Gmail
   too).
3. Restart Springroll and click Sign in on Gmail, Calendar, and Drive.
4. Optionally create the internal Slack app and set `SPRINGROLL_SLACK_OAUTH_*`.
5. Click through GitHub, Linear, Notion, Jira, Stripe, or Neon whenever you
   want to dogfood a catalog MCP provider — no extra Cloud setup.

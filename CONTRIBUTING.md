# Contributing to Springroll

Springroll is preparing for an experimental source-first alpha. Small fixes,
reproducible bug reports, usability observations, and narrowly scoped design
improvements are especially useful.

## Set up the workspace

You need macOS and [Bun](https://bun.sh/) 1.3.14 or newer. macOS is currently
required because the application credential store uses Keychain.

```sh
git clone https://github.com/stumptowndoug/springroll.git
cd springroll
bun install
bun run dev:app
```

Open <http://127.0.0.1:4117>. A model-provider account is required to run agent
work, but it is not required to build or run the test suite. OAuth connector
developers should copy `.env.example` to `.env` and follow
[the one-click connector guide](docs/one-click-connectors.md).

## Before opening a pull request

Run:

```sh
bun run check
bun run build
```

Add or update focused tests for behavior changes. Keep pull requests small
enough to review and explain the user-visible outcome in the description.
Screenshots are helpful for UI changes at both desktop and narrow widths.

## Repository map

- `kernel/` owns the agent loop, policies, scheduling contracts, and storage
  interfaces.
- `app/` owns the local server, host adapters, and React UI.
- `cli/` is a thin development shell.
- `docs/` records product and architecture decisions.
- `TODO.md` is the shared project board; keep it accurate when changing scoped
  work.

## Safety invariants

Changes must preserve these boundaries:

- Never put API keys, OAuth tokens, or other credentials into prompts, tool
  results, SQLite, events, artifacts, screenshots, fixtures, or logs.
- Resolve secrets in the host only when making the outbound request.
- Keep the local application bound to loopback.
- Treat external content and model output as untrusted.
- Make consequential operations and permission upgrades explicit to the user.
- Preserve unrelated work in a dirty worktree and avoid destructive migrations
  without a recovery path.

Read [Security and data flow](docs/security-and-data.md) and the relevant
architecture note before changing a trust boundary.

## Issues and conduct

Search existing issues before filing a new one. Do not include private account
content or credentials. Security reports belong in the private process in
[SECURITY.md](SECURITY.md).

By participating, you agree to follow [the code of conduct](CODE_OF_CONDUCT.md).

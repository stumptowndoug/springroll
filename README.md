# Shrimp Roll

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
bun run dev:cli
```

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

The kernel keeps scheduling, connector policy, persistence, and model access
behind explicit adapters so the UI, CLI, and later hosted shell share the same
execution path.

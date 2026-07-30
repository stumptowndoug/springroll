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

The kernel stays independent of React, Tauri, Hono, databases, and model
providers. Shells supply those adapters.

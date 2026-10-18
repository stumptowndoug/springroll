---
name: dev
description: Running the owner's projects (~/projects) on this machine - writing a project's dev recipe, working out which of its environment variables a dev server needs, getting those keys from the owner (one pasted .env, or one key at a time), and giving it a dev database. Use when setting up a project to run, when a dev server lacks keys or a database, or when the owner asks what a project needs to run here.
---

# Running a project here

The Dev app (`views/dev/`, README there) runs each project from a recipe,
`views/dev/recipes/<project>.json`; `dev help` has the format. Read the project's own
`AGENTS.md`/`README` first, then `dev detect <project>` for what its Makefile and package.json offer.

## Its environment variables

A project lists what it reads in an `example.env`, `.env.example` or `.env.local.example`, a
settings class, or `process.env.*` / `os.environ` in its code. Most of that list is production's,
not dev's. Sort every variable into one of four:

| Kind | Examples | Where it goes |
|---|---|---|
| A setting, not a secret | `ENVIRONMENT`, URLs, feature flags, timeouts, pool sizes | the recipe's `"env"`, and only if the default doesn't work in dev |
| Supplied by the Dev app | `PORT`, `DATABASE_URL` | nothing: `$PORT` per server, `"database"` for a Neon branch |
| A key dev needs for the work at hand | a Stripe **test-mode** key, a Clerk **development** instance | Keys, named `<PROJECT>_DEV_<NAME>`, mapped in `"secrets"` |
| Production only | live payment and webhook secrets, analytics IDs, meter publishers | leave unset; say so in `notes` |

- **Ask for keys when the work needs them, not up front.** Starting a project doesn't mean
  requesting all twenty keys in its example file. When a task needs one (testing checkout needs the
  Stripe test key), run `secret request <PROJECT>_DEV_<NAME> "what it's for, and where to get it"`;
  the owner gets a card and pastes it there. Then `dev keys <project> --add VAR=<KEY>` puts it in the
  recipe. (When the owner adds a key themselves, Keys → Add a key → Used by does both.)
- **Never a production secret in dev.** Live Stripe, production Clerk, a service that bills or
  emails real people: use its test or sandbox key, or leave the feature off. Analytics IDs stay
  unset so dev traffic doesn't count.
- **Make what's just random.** A salt, a local admin or API key the project checks against
  itself: generate it and `printf %s "$v" | secret set <PROJECT>_DEV_<NAME>`; don't ask.
- **A .env is imported, never kept.** The recipe names keys; they reach the server as environment
  variables at each start. When the owner has a project's `.env`, they paste it once: the project
  page's **Paste a .env** (or `dev env <project> <file>`, then `--apply`) sorts each line, saves keys
  into Keys as `<keyPrefix>_DEV_<NAME>` (reusing a key already there with the same value), writes
  settings into the recipe, and skips what the Dev app supplies, live keys and analytics. Set
  `"keyPrefix"` so related projects share keys (a product's web and API repos both use `ACME`).
  Delete the file afterwards if it was on this machine.
- **Write it down.** In the recipe, `"keyNotes": {"SECRET": "what it's for"}` explains each named
  key (the app shows it when it's missing), and `notes` says which features don't work without
  which keys. The project page's Keys section then shows set and missing at a glance.

## A dev database

A project that needs Postgres on Neon gets `"database": {"neon": "<project id>", "from":
"production", "env": "DATABASE_URL"}`: `dev up` makes the branch `dev-<project>` (a copy of
production) and reuses it; `dev db <project> reset` makes it a fresh copy. Find the Neon project
with the read-only Neon MCP. Never point a dev server at production or at a branch the owner made.

## Done means

Every server and command in the recipe has been run once, the page shows what it lacks, and
`notes` tells the next agent what works and what doesn't.

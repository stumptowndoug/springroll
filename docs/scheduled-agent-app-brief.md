# Product Brief: ShrimpRoll

*Working name: ShrimpRoll · Drafted 2026-07-30.*

## The idea in one sentence

A downloadable menubar app where you schedule AI tasks in plain language — "check my email every 5 minutes and flag anything urgent" — that run on your machine while it's on, and (with a subscription) run in the cloud when it isn't.

## Intent

This is a deliberate simplification born from building spring-roll. The lesson learned there: most of the complexity (agent subprocesses, session-file reconciliation, workspace filesystems, sandbox/hosting agonies) was structural to running a *coding agent* — an open-ended tool with a shell and a filesystem. This product is not that.

**The product convictions:**

1. **Simple scheduled tasks, not workflows.** "Check my email," "watch app reviews and draft replies to detractors," "summarize HN every morning." One prompt, one schedule, a few connections. No DAGs, no multi-step builders.
2. **A closed tool catalog is a feature.** Tasks can only do what curated connectors expose. This is the guardrail story, the trust story, and the reason the architecture stays small. We are not building a coding agent; there is no shell, no filesystem, no sandbox — a run is pure I/O (LLM calls + connector API calls).
3. **Local-first, cloud as backstop.** The free app is complete: tasks run whenever the machine is on. The paid service is one sentence: *your tasks run even when your machine doesn't.* The subscription is renting uptime — the always-on clock plus fallback compute plus away-notifications.
4. **The user thinks in sentences.** Task creation is a text box. The app derives the schedule, the needed connections, and a plain-language contract of what the task can and cannot do, and asks for confirmation. Config forms are the fallback, never the front door.
5. **Vendor-light by construction.** End-state ownership: a GitHub repo and a Neon database. Everything else is the user's laptop, rented serverless functions, and billing accounts (Stripe, Resend, Apple Developer). Nothing we operate, patch, or monitor.

**What this is not:** a coding agent, a workflow automation platform (n8n/Zapier), an agent framework, or infrastructure. It competes on *trustworthy simplicity*.

## What the user sees

Three nouns only: **Tasks, Runs, Connections.** No models, tokens, sync, or infra anywhere in the UI.

- **Creating a task:** type a sentence → one structured-output LLM call proposes schedule + required connections + a capability contract ("Every 5 minutes I'll read unread mail and notify you if something looks urgent. I can read your email; I can't send, delete, or move anything.") → confirm. Edit-details form exists as fallback.
- **Connections are just-in-time:** the Gmail sign-in appears the first time a task needs it, not as setup.
- **Propose-then-act:** tasks that act on the world (send replies, post) default to producing drafts for approval; the user can graduate a task to autonomous. This is the trust feature that lets normal people schedule agents.
- **Notifications are the deliverable, not a log.** Quiet by default. Users hear about output ("3 urgent emails") and problems ("Gmail connection expired — tap to fix"), never mechanics. OS notifications locally; email/push from the service when away.
- **Per-task privacy switch:** "local only" (credentials never leave the Keychain; runs skip when the machine is off) vs. "run anywhere" (tokens escrowed to the service — an explicit consent moment in the UI, because that's what it is).
- **Local-only connectors as a differentiator (later):** the local runner can touch things the cloud never can — filesystem, Apple Notes, etc.
- **Known-bad onboarding moment:** v1 requires pasting an API key (BYOK). Soften it (direct get-a-key link, test button); the real fixes are later — subscription-bundled model access, and/or Ollama for a free local mode.

## The app as an MCP server (first-class requirement)

The app exposes its own MCP server so other AI tools — Claude Desktop, ChatGPT, IDE agents — can create tasks and read results. This is both a workflow multiplier ("schedule this daily" said mid-conversation in any assistant becomes a task here) and the distribution story (MCP directories/integrations are how tools get found).

- **Tools exposed:** `create_task` (sentence in → same proposal pipeline as the UI), `list_tasks`, `get_task`, `set_task_enabled`, `run_task_now`, `list_runs`, `get_run` (the letter/transcript), `pending_approvals`, `approve_draft`.
- **v1 — local:** stdio + streamable-HTTP on localhost from the desktop app, via the official MCP TS SDK. One-click "Add to Claude Desktop" config snippet in Settings.
- **v2 — remote:** the hosted shell serves the same MCP surface over streamable HTTP with OAuth (better-auth has an MCP-provider path), so claude.ai / ChatGPT / phone assistants reach your tasks from anywhere. Rides on the same device-token/auth work as sync.
- **Guardrail:** externally created tasks land as **proposals**, not live schedules — the app notifies ("Claude Desktop wants to add a task: …") and the user confirms in-app, seeing the same contract sentence. External tools can never mint new connections or flip a task to run-anywhere; those consents stay in the app. Reads (runs, transcripts) are unrestricted for connected clients.
- **Implementation note:** the MCP server is a thin adapter over the exact task-CRUD and query functions the UI uses — kernel code, ~a day of work, not a subsystem.

## Architecture

**One TypeScript kernel, three shells.** The kernel is a plain TS library: agent loop, connector catalog, Drizzle schema, sync logic. Shells: the desktop app (Tauri menubar wrapping a Bun sidecar), the hosted serverless functions, and a dev CLI. All shells import the same kernel; each is thin.

**Two instances of the same program.** The local app and the hosted side run identical logic against their own SQLite/Postgres. Coordination is three rules, not a protocol:

| Data | Sync rule |
|---|---|
| `runs`, `run_events` | Append-only union. Each side inserts only its own rows; sync copies missing rows both ways. `(task_id, scheduled_time)` is the dedupe key. Rows are immutable events. |
| `tasks` | Last-write-wins on `updated_at` (edited in one UI at a time). |
| `connections` (secrets) | Never sync implicitly. Pushed up only on explicit "run anywhere" consent. Local secrets live in the Keychain. |
| `device_settings` | Local only. `users`/`subscriptions`: hosted only. |

Sync is explicit HTTP ("POST rows you haven't acked, GET rows you don't have"), ~200 lines. It is deliberately *not* database replication — explicitness is what makes the failover observable and the hosted side serverless-compatible.

**Scheduling: the tick.** No scheduler service exists. Schedule state is a `next_run_at` column. A stateless tick (30s `setInterval` locally; a per-minute platform cron hosted) asks "what's due?" and acts. Missed ticks need no recovery — the next tick sees everything overdue. Per-task policy toggle for wake-after-sleep: *catch up* (run late) vs. *skip to next*.

**Failover: the hesitation rule.** Local runs due tasks immediately. Hosted runs a due task only if scheduled_time is 3+ minutes past AND no run row for that occurrence has synced up. The sync itself is the liveness signal — no heartbeats, no leader election. Edge case (local runs but can't sync → duplicate): tolerated in v1, because every connector is a cloud API — a machine that can't reach our sync endpoint usually can't reach Gmail either. Escalation if ever needed: a one-HTTP-call claim before local runs, not a redesign.

**The hosted side is the app, awake.** Its jobs: tick, run fallback jobs, accept syncs, send away-notifications, hold accounts/billing. Nothing else. It exists only after subscriptions exist.

## Stack (decided)

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript everywhere | One language, one schema, types flow kernel→UI. No Rust backend — workload is pure I/O; Tauri's shell is the right amount of Rust. |
| Runtime | Bun | `bun build --compile` for the sidecar binary. |
| Web/API | Hono | Runs identically in the local app and in serverless functions. |
| DB | SQLite local, Neon Postgres hosted | One Drizzle schema, two dialects. SQLite is a file inside the process — nothing to host locally. |
| Agent loop | Vercel AI SDK (`ai`) | Open source (not a Vercel service). Provider-agnostic BYOK, tool-loop built in, Zod tool schemas feed the guardrail contracts, Ollama door open. ~150-line loop behind a `runTask()` kernel interface — swappable. |
| MCP server | `@modelcontextprotocol/sdk` | The app *is* an MCP server (see section above): local stdio/HTTP in v1, remote OAuth-gated in v2. Thin adapter over kernel task-CRUD. |
| Connectors | First-party TS modules and remote MCP | Launch with Neon via remote MCP and a read-only Gmail module. Tools use JSON-schema params and per-task allowlists. Curated connections come first; trustworthiness before extensibility. |
| Desktop shell | Tauri (menubar/tray) | Signed + notarized, auto-update via Tauri updater. Apple Developer account required. |
| Hosted shell | Vercel: Cron (the tick) + Fluid functions (fallback runs) + API routes (sync/auth) | Plain HTTP handlers — lowest lock-in of the serverless options. Cloudflare (Workers/D1/Workflows) is the documented plan B behind the kernel/shell split. |
| Auth | better-auth on Neon + Resend email codes | A library, not a service. Users live in our Postgres. Device pairing: browser sign-in → mint long-lived device token → Keychain. Clerk considered and passed. |
| Billing / email | Stripe / Resend | Webhook handler + API key. |
| UI | Small client-routed React SPA, lean bundle | Snappiness comes from data locality (local SQLite reads, sub-ms). Optimistic local writes, no spinners for local ops, stream run transcripts, paginate only `run_events`. |

**Rejected, with reasons (so we don't relitigate):**
- **Turso / DB replication for sync** — whole-DB sync can't express per-table policy (secrets!), couples failover correctness to replication opacity, native binary in the desktop app, platform mid-rewrite. Revisit only for N-way multi-device.
- **Honker** — our queue needs are ~30 lines; native extension complicates app shipping. Adopt only if retry/queue logic outgrows ~100 lines.
- **Owned Fly container** — sound design, rejected because we don't want to operate anything. The serverless hosted shell is possible *because* sync is explicit HTTP and runs are stateless.
- **Fly Sprites / sandboxes (Modal, E2B, nono)** — solve per-tenant stateful machines / code execution; this product deleted both. Sprites remains the escape hatch if a `run_code` connector is ever justified.
- **Rust backend split** — no CPU-bound work; TS ecosystem gravity (AI SDK, MCP); language boundary is a permanent type-duplication tax.
- **Cloudflare as primary** — great primitives, but D1/Workflows lock-in and it contradicts the "I own a Neon database" end goal. Plan B.

**End-state ownership inventory:** GitHub repo, Neon database, Vercel project config, domain, Stripe/Resend accounts, Apple Developer account. No machines.

## Build order

Each chunk independently testable; 1–4 need zero infrastructure and gate everything after.

- **Chunk 0 — workspace.** Bun workspace: `kernel/`, `app/`. Kernel exports schema, `tick(db)`, `runTask(task, connections)`.
- **Chunk 1 — heartbeat.** Schema (tasks, runs, run_events, connections) + tick + `next_run_at` + stub executor. *Done when a seeded task produces run rows on schedule.*
- **Chunk 2 — brain + free connector.** AI SDK loop + one no-OAuth connector (allowlisted `web.fetch` / RSS / HN). *Done when "summarize HN every morning" runs end-to-end with a real transcript.* The product exists at this moment.
- **Chunk 3 — local UI.** Hono + React on localhost: task list, sentence-first create flow, run history with readable transcripts, enable/disable. Design iteration lives here.
- **Chunk 4 — OAuth + notifications.** Gmail read-only (localhost callback, Keychain), macOS notifications. *Done when "summarize unread email hourly" pings you.* **Then dogfood for 2+ weeks — this is the cheapest test of the entire thesis. Everything below is gated on it.**
- **Chunk 4b — MCP server (local).** stdio + localhost HTTP exposing task CRUD, run queries, and `run_task_now`; external `create_task` lands as an in-app proposal. *Done when a task created from a Claude Desktop conversation appears in the app for confirmation, and "what did my review sweep find?" answers from the transcript.* Small chunk, big demo.
- **Chunk 5 — menubar packaging.** Tauri wrap, tray, launch-at-login; signing/notarization/auto-update. Mechanics, no product risk.
- **Chunk 6 — the double.** Second instance locally with `ROLE=hosted`: sync module + hesitation rule. *Done when killing the local instance and watching the hosted one cover the missed run works on one machine.* Only then port the shell to Vercel/Neon.
- **Chunk 7 — money.** better-auth, Stripe, device pairing, credential escrow consent flow. Strictly last.

## Open questions

1. **Bundle identity and brand assets.**
2. **Model access without BYOK friction** — bundle via subscription later? Ollama free tier?
3. **MCP door timing and permission UI** (per-task tool allowlists for *inbound* connector MCP servers — distinct from the app's own outbound MCP server, which is v1).
4. **External-task approval ergonomics** — is confirm-in-app right for every MCP-created task, or should clients the user marks trusted (their own Claude Desktop) skip to enabled-with-notification?
5. **Multi-device** (two Macs, phone viewer) — hub-and-spoke via the hosted side when it comes; deferred.
6. **Windows/Linux** — Tauri makes it possible; macOS-first.

## Relationship to spring-roll

Carries over: the market research (scheduled-agents niche, 2026-07), the design language and editorial UI sensibility, the propose-then-act pattern (born as chat proposals), and every hard-won lesson about what *not* to build. Abandoned with intent: Pi as subprocess, filesystem state, session reconciliation, workspaces, self-host-image ambitions, Elixir. Spring-roll stays as reference material; this repo starts clean.

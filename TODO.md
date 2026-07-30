# To-dos

## 📋 Backlog

- [ ] Phase 3 — Build the local product surfaces
  - [ ] Serve the local API with Hono and a lean client-routed React app
  - [ ] Make Runs the homepage with attention items first and repeated non-events aggregated
  - [ ] Render run detail as a first-person, past-tense letter with mechanics in a quiet footnote
  - [ ] Build the sentence-first task composer and structured proposal call
  - [ ] Show proposed schedule, required connection, capability contract, and execution mode before confirmation
  - [ ] Add “Run it once now” and “Schedule” paths plus a fallback details editor
  - [ ] Add task list, task detail, enable/disable, run-now, and catch-up controls
  - [ ] Add the Connections surface with just-in-time connection prompts
  - [ ] Keep user-facing navigation and language limited to Tasks, Runs, and Connections

- [ ] Phase 4 — Add Gmail and close the local trust loop
  - [ ] Implement read-only Gmail OAuth with localhost callback handling
  - [ ] Store local credentials in macOS Keychain and support expiry, reconnect, and revoke flows
  - [ ] Add macOS notifications for meaningful output and connection failures
  - [ ] Keep quiet or empty runs out of notifications while preserving them in the Runs feed
  - [ ] Add proposal, approval, edit, dismiss, and audit states for actions that affect the world
  - [ ] Default action-capable tasks to draft-only and require an explicit autonomy change
  - [ ] Exit when hourly unread-mail triage reliably notifies about important messages

- [ ] Gate A — Dogfood the local app for at least two weeks
  - [ ] Run the chosen HN and Gmail tasks on a real daily schedule
  - [ ] Track missed runs, duplicate runs, false-positive notifications, auth failures, and proposal edits
  - [ ] Validate that sentence-first creation and readable transcripts build sufficient trust
  - [ ] Choose the launch connector set from observed personal value
  - [ ] Decide whether BYOK is acceptable for v1 or requires bundled/local model access
  - [ ] Record a go, revise, or stop decision before starting packaging or hosted work

- [ ] Phase 4b — Expose the local app through MCP
  - [ ] Add stdio and localhost streamable-HTTP transports with the official MCP TypeScript SDK
  - [ ] Expose task CRUD, enable/disable, run-now, run queries, approvals, and draft approval tools
  - [ ] Route MCP tools through the same kernel functions used by the UI
  - [ ] Make externally created tasks inactive proposals that require in-app confirmation
  - [ ] Evaluate an MCP App proposal card for reviewing and confirming externally created tasks
  - [ ] Prevent external clients from creating connections, enabling run-anywhere, or granting autonomy
  - [ ] Add one-click Claude Desktop configuration and client-focused integration tests
  - [ ] Exit when an external assistant can propose a task and later answer from its run transcript

- [ ] Phase 5 — Package the validated local app for macOS
  - [ ] Wrap the app and Bun sidecar in a Tauri menubar shell
  - [ ] Implement the glance popover with needs-you, recent runs, next run, new task, and pause-all controls
  - [ ] Add tray status, attention dot, launch at login, lifecycle handling, and safe shutdown
  - [ ] Provision Apple signing and notarization
  - [ ] Configure and test signed automatic updates
  - [ ] Verify install, upgrade, credential persistence, sleep/wake, and uninstall behavior on clean Macs

- [ ] Phase 6 — Prove local/cloud coordination before deploying it
  - [ ] Run a second local instance with `ROLE=hosted` and Postgres-compatible storage behavior
  - [ ] Implement explicit HTTP sync for append-only runs/events and last-write-wins tasks
  - [ ] Keep device settings local and block implicit secret synchronization
  - [ ] Add sync acknowledgements, idempotency, pagination, retry, and observability
  - [ ] Implement the three-minute hosted hesitation rule
  - [ ] Test offline local runs, delayed sync, duplicate tolerance, clock skew, and recovery
  - [ ] Exit when stopping the local runner causes the second instance to cover a missed occurrence

- [ ] Phase 7 — Ship paid run-anywhere
  - [ ] Port the hosted shell to Vercel cron/functions with Neon Postgres
  - [ ] Add better-auth email-code sign-in and browser-to-device pairing
  - [ ] Store long-lived device tokens in Keychain with revoke and rotation support
  - [ ] Build per-task local-only versus run-anywhere controls
  - [ ] Add an explicit, reversible credential-escrow consent sheet with encrypted hosted storage
  - [ ] Implement Stripe subscription state, webhooks, entitlements, and billing recovery
  - [ ] Send quiet away notifications through Resend or push only when the local app is unavailable
  - [ ] Add hosted operations for sync lag, failed fallback runs, expired credentials, and billing events
  - [ ] Exit when an opted-in task runs while the Mac is off without duplicating a synced local run

- [ ] Phase 8 — Add remote access only after run-anywhere is stable
  - [ ] Serve the existing MCP surface over authenticated streamable HTTP
  - [ ] Add OAuth client authorization, scopes, revocation, and audit visibility
  - [ ] Preserve in-app consent for new tasks, new connections, run-anywhere, and autonomy
  - [ ] Validate task and run access from web and phone-based assistants

- [ ] Later — Revisit deliberately deferred expansion
  - [ ] Evaluate Ollama or bundled model access after measuring BYOK drop-off
  - [ ] Broaden bring-your-own MCP installation beyond the audited launch catalog
  - [ ] Evaluate App Store reviews, Slack/Discord posting, and calendar from dogfood demand
  - [ ] Revisit trusted-client shortcuts for externally proposed tasks
  - [ ] Design hosted hub-and-spoke sync before adding multiple Macs or a phone viewer
  - [ ] Consider local-only Apple Notes and filesystem connectors
  - [ ] Evaluate Windows and Linux only after the macOS product is stable

## 🚧 In Progress

- [ ] Phase 0 — Define the dogfood slice and scaffold the workspace
  - [ ] Choose the working product name and macOS-first bundle identity
  - [ ] Select 2–3 launch connectors around tasks Doug will personally run
  - [x] Write v1 acceptance scenarios for HN digest, Gmail triage, and task creation
  - [x] Define one `ToolSource` boundary for native tools and remote MCP servers
  - [x] Prototype per-run MCP discovery and execution through the AI SDK
  - [x] Evaluate MCP Apps for connector-provided configuration and approval UI
  - [x] Compare direct remote MCP OAuth with Pipedream, Composio, Nango, and Activepieces
  - [x] Store a pinned per-task tool allowlist and detect schema changes before later runs
  - [x] Classify tools as read, write, destructive, and open-world with curated overrides
  - [x] Declare whether each connection can run locally, hosted, or in both places
  - [x] Decide whether v1 supports remote MCP only or a small audited stdio catalog
  - [x] Create the Bun workspace with `kernel/`, `app/`, and a thin development CLI
  - [x] Add shared TypeScript, lint, test, and CI configuration
  - [x] Define kernel boundaries for schema, `tick(db)`, `runTask(task, connections)`, and shell adapters
  - [x] Exit when one native tool and one MCP server run through the same policy and transcript pipeline
    - [x] Native tool path covered by kernel tests
    - [x] Remote MCP path covered by a streamable-HTTP integration test

- [ ] Phase 2 — Run one useful task end to end
  - [x] Add secure BYOK configuration with a direct key-creation link and connection test
  - [x] Add OpenRouter API-key configuration and make it selectable for the live digest
  - [x] Implement the AI SDK tool loop behind the kernel `runTask()` interface
  - [x] Create an allowlisted web/RSS/Hacker News connector with explicit schemas and capabilities
  - [x] Persist readable transcripts, tool-call summaries, duration, status, and cost metadata
  - [x] Add failure classification and bounded retry behavior for model and connector calls
  - [ ] Exit when “summarize Hacker News every morning” produces a real readable transcript

## ✅ Done

- [x] Phase 1 — Prove the local scheduling heartbeat
  - [x] Add Drizzle schemas for tasks, runs, run events, and connection metadata on SQLite
  - [x] Store `next_run_at`, scheduled occurrence time, enabled state, and catch-up policy per task
  - [x] Implement the local 30-second tick and due-task query
  - [x] Add a stub executor that emits immutable run and run-event rows
  - [x] Enforce `(task_id, scheduled_time)` occurrence deduplication
  - [x] Test catch-up, skip-to-next, disabled-task, restart, and concurrent-tick behavior
  - [x] Exit when a seeded task reliably creates one run per scheduled occurrence

- [x] Decide the integration architecture for broad connector support
  - [x] Verify what the Vercel AI SDK and MCP SDK provide
  - [x] Compare open-source connector and managed-auth options
  - [x] Evaluate the AI SDK's native MCP Apps support and its role in the product
  - [x] Define a small framework boundary that can use curated native tools and MCP servers
  - [x] Recommend a Phase 0 proof of concept and update the backlog
  - [x] Use direct MCP for the core and keep aggregation providers behind the same boundary

- [x] Review the product brief and UX mockups and create a phased implementation backlog

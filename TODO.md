# To-dos

## 📋 Backlog

- [ ] Phase 4 — Add Gmail and close the local trust loop
  - [ ] Implement read-only Gmail OAuth with localhost callback handling
  - [ ] Store local credentials in macOS Keychain and support expiry, reconnect, and revoke flows
  - [ ] Add macOS notifications for meaningful output and connection failures
  - [ ] Keep quiet or empty runs out of notifications while preserving them in the Runs feed
  - [ ] Add proposal, approval, edit, dismiss, and audit states for actions that affect the world
  - [ ] Default action-capable tasks to draft-only and require an explicit autonomy change
  - [ ] Exit when hourly unread-mail triage reliably notifies about important messages

- [ ] Gate A — Dogfood the local app for at least two weeks
  - [ ] Run the chosen Neon and Gmail tasks on a real daily schedule
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

- [ ] Phase 6 — Prove Turso sync and local/cloud ownership before deploying it
  - [ ] Record the Turso-first architecture decision and retire Neon, Vercel Workflow, and custom HTTP-sync assumptions from the product plan
  - [ ] Keep scheduling behind storage-neutral task, occurrence, and hosted-registration adapters
  - [ ] Make one per-user Turso database the source of truth for tasks, schedules, revisions, runs, events, transcripts, usage, and results
  - [ ] Prototype `@tursodatabase/sync` for local writes, explicit push/pull, long-polling pulls, checkpointing, reconnect, and observable sync status
  - [ ] Push schedule changes immediately and show saved-local, cloud-active, pending-sync, and offline states honestly
  - [ ] Add per-task local-only, local-preferred with hosted fallback, and hosted-only execution policies
  - [ ] Define deterministic scheduled-occurrence IDs and persist separate attempts beneath each occurrence
  - [ ] Claim cloud-enabled occurrences atomically against remote Turso with owner, claim token, started time, heartbeat, lease expiry, and completion status
  - [ ] Renew local leases independently of model and tool calls so long-running agents remain owned while healthy
  - [ ] Let hosted execution take over an expired lease and require stale runners to stop when their fencing token no longer matches
  - [ ] Require cloud-enabled local runs to obtain a remote claim while allowing local-only tasks to continue fully offline
  - [ ] Run the same selected `AgentRunner`, capability contract, and event schema in local and hosted processes
  - [ ] Validate model, tool, MCP endpoint, and credential availability before enabling hosted execution
  - [ ] Checkpoint provider-native resume state and ShrimpRoll events at model-turn and tool-call boundaries in Turso
  - [ ] Give consequential tool calls stable occurrence-and-call idempotency keys
  - [ ] Add cancellation flags and timeouts that every runner checks between model turns and tool calls
  - [ ] Test simultaneous claims, healthy multi-hour runs, Mac sleep, forced termination, expired-lease takeover, stale-owner fencing, clock skew, and reconnect
  - [ ] Exit when stopping the local runner causes a second hosted-mode process to complete the same occurrence once and sync its result back

- [ ] Phase 7 — Ship paid run-anywhere
  - [ ] Provision one Turso Cloud database per subscribed user plus the minimum shared account-to-database directory
  - [ ] Register Turso-backed task schedules through an adapter that uses managed Inngest events, durable sleeps, cancellation, retries, and observability
  - [ ] Validate the task revision in Turso whenever hosted work wakes so stale schedule registrations exit safely
  - [ ] Deploy the selected hosted runner behind Inngest on portable Node compute without making Vercel a domain dependency
  - [ ] Add better-auth email-code sign-in and browser-to-device pairing
  - [ ] Store long-lived device tokens in Keychain with revoke and rotation support
  - [ ] Build per-task local-only versus run-anywhere controls
  - [ ] Keep local credentials in macOS Keychain and never sync them implicitly
  - [ ] Evaluate Turso's encrypted local secrets-vault pattern rather than treating it as a managed vault service
    - [ ] Verify encrypted-vault compatibility with Turso Sync and hosted access before selecting it
    - [ ] Keep secret values out of agent-visible queries while exposing safe provider, account, environment, access, and usage metadata
    - [ ] Inject secrets only into the narrow model or connector process that needs them and redact accidental output exposure
    - [ ] Store an append-only audit record for secret use, denial, rotation, and revocation
    - [ ] Keep the vault encryption key in macOS Keychain locally and use a real cloud KMS or managed secret store for hosted decryption
    - [ ] Treat output scrubbing as defense in depth, not as a sandbox against a malicious tool
  - [ ] Add explicit, reversible per-credential cloud escrow consent with separate local and hosted availability
  - [ ] Implement Stripe subscription state, webhooks, entitlements, and billing recovery
  - [ ] Send quiet away notifications through Resend or push only when the local app is unavailable
  - [ ] Add hosted operations for sync lag, sleeping registrations, failed takeovers, expired credentials, Inngest runs, and billing events
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

- [ ] Phase 3b — Add model choice and complete AI usage visibility
  - [x] Define a versioned `RunResultV1` envelope with Markdown body, semantic disposition, structured sources, notices, proposals, and future artifacts
  - [x] Render a safe Markdown subset while keeping layout and typography under app control
  - [x] Define a schema-versioned, provider-neutral `AgentEvent` contract for lifecycle, messages, sources, tool calls, tool results, policy decisions, and usage
  - [x] Let `PiAgentRunner` emit events as steps finish and persist them before projecting the final transcript
  - [ ] Keep `runs` as a materialized summary while `run_events` remains the replayable source of truth
  - [x] Add `PiAgentRunner` conformance tests for lifecycle, messages, tools, usage, cancellation, and failures
  - [x] Compare AI SDK harnesses, providers, usage, cost, and persistence with Pi before committing to the runner
  - [x] Adopt the stable AI SDK `ToolLoopAgent` as the default runner
  - [ ] Evaluate optional AI Gateway search and exact accounting alongside OpenRouter
    - [x] Verify AI Gateway's public model discovery API exposes current pricing, capabilities, context limits, and supported parameters
    - [ ] Live-verify request-scoped BYOK, provider routing, web-search accounting, and exact generation cost
  - [ ] Verify direct OpenAI, xAI/Grok, and OpenRouter providers against one capability, usage, cost, tool, and error contract
    - [x] Implement and contract-test all three AI SDK provider connections
    - [x] Live-verify OpenRouter through a real tool-using agent run
    - [ ] Live-verify OpenAI and xAI when development keys are available
  - [ ] Verify Codex, Claude Code, and Pi harness adapters for local subscription auth, curated tools, native resume state, and usage fidelity
  - [x] Keep harness-backed coding agents as optional runners while the stable AI SDK runner remains the product default
  - [ ] Run every provider and harness through the same ShrimpRoll event, persistence, cancellation, and tool-policy conformance suite
  - [ ] Keep model providers behind the ShrimpRoll runner boundary with independent provider, model, and credential selection
  - [x] Add direct provider connections alongside OpenRouter without changing the task or tool runtime
  - [ ] Build one cache-backed models.dev catalog without maintaining a ShrimpRoll-owned model list
    - [x] Fetch the live provider-specific catalog from models.dev
    - [ ] Add the type-safe models.dev snapshot as a first-run offline bootstrap
    - [x] Map each model connection to one models.dev provider ID, starting with `openrouter`, `openai`, and `xai`
    - [x] Show models from that provider entry and avoid separate Gateway, OpenRouter, and direct-provider discovery services
    - [ ] Let harness-reported entitlements narrow the catalog when a subscription does not include every listed API model
    - [ ] Normalize model identity, provider, runtime, context, modalities, tool support, reasoning, structured output, and token pricing
      - [x] Normalize identity, provider, context, modalities, tool support, reasoning, and token pricing for the picker
      - [ ] Add structured-output and runtime capability metadata when those become selection constraints
    - [x] Keep the disposable catalog in a separate local cache database rather than syncing it through every user's Turso database
    - [x] Refresh the local cache with models.dev ETags, stale-cache fallback, and last-updated visibility
    - [ ] Add the same independent refresh path to hosted workers and the bundled offline snapshot
    - [x] Persist only provider metadata, credential references, global selection, and per-task overrides in the sync-ready product database
    - [ ] Snapshot the catalog revision and pricing used onto each run so historical estimates remain explainable
    - [x] Filter the catalog to text-output, tool-capable models and reject incompatible direct-provider overrides for current hosted web tools
    - [ ] Expand per-task capability filtering as image, artifact, and structured-output tasks arrive
    - [x] Use catalog prices as estimates while preserving provider-reported actual run cost and model-access failures
  - [ ] Add provider and model selection to the UI
    - [x] Add a dedicated Models surface and show connected runtimes as aggregator or direct API
    - [ ] Add Gateway and local subscription harness runtime types when their connections ship
    - [x] Offer Automatic as the default plus searchable compatible model choices
    - [ ] Add recommended and recent model groups after observing real selection behavior
    - [x] Show input and output price, context, reasoning, and tool badges without overwhelming the picker
    - [x] Persist one global default with an optional per-task provider and model override
    - [x] Let users add OpenRouter, OpenAI, and xAI with one tested API-key form per provider
    - [x] Store local API keys in macOS Keychain and keep only credential references and availability metadata in SQLite
    - [ ] Add explicit hosted secret setup later rather than silently syncing local keys
  - [ ] Offer local-only Codex subscription authentication through the Pi harness adapter without copying credentials into ShrimpRoll
  - [ ] Label subscription-backed Codex usage separately from metered API cost instead of implying a zero-dollar call
  - [ ] Route proposal, run, and future chat inference through one recorded model-call boundary
    - [x] Route proposals and runs through the selected provider/model
    - [ ] Record proposal calls and future chat calls through the same event boundary as runs
  - [ ] Record total multi-step input, output, reasoning, and cached tokens plus provider-reported cost
  - [ ] Record server-side web-search request counts and costs when available
  - [ ] Show the model, tokens, tool usage, duration, and cost on run details without making them the primary UI

- [ ] Phase 3 corrective — Match task proposals to real connector capabilities
  - [x] Prove OpenRouter's agent-controlled web-search server tool through the current AI SDK boundary
  - [x] Re-run OpenRouter web search and URL fetch live through the local app
  - [x] Preserve provider citations and provider-reported model cost in web run results
  - [x] Add a safe read-only URL fetch tool for direct public pages and feeds
  - [x] Let tasks grant capability sets while the runtime agent chooses the calls and sequence
  - [ ] Reject unsupported requests instead of substituting an unrelated connector
  - [x] Implement `PiAgentRunner` with in-memory Pi state, no built-in coding tools, an injected credential store, and ShrimpRoll `ToolSource` adapters
  - [ ] Compare OpenRouter coverage, normalized events, token usage, cost, cancellation, and failures through AI SDK and Pi-backed runners
  - [ ] Select an observable hosted web-search tool path, considering AI Gateway search tools alongside OpenRouter and equivalent ShrimpRoll tools
  - [ ] Verify Pi's local Codex connection can use ShrimpRoll's curated tools while keeping shell and filesystem access unavailable
  - [x] Verify the reported Google Trends task proposes and runs without Hacker News

## ✅ Done

- [x] Phase 0 — Define the dogfood slice and scaffold the workspace
  - [x] Choose the product name: ShrimpRoll
  - [x] Choose the macOS-first bundle identity: `com.shrimproll.app`
  - [x] Select the launch connectors: Neon via remote MCP and Gmail
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

- [x] Choose the hosted execution shape for `PiAgentRunner`
  - [x] Use Vercel Workflows for durable multi-minute execution and keep the schedule tick dispatch-only
  - [x] Keep ShrimpRoll's Neon event log as the portable product record across local and hosted runs
  - [x] Require hosted provider credentials instead of copying local subscription credentials

- [x] Compare Pi's open-source provider, authentication, and session architecture with ShrimpRoll
  - [x] Trace Codex and Claude subscription authentication in `pi-ai`
  - [x] Compare Pi's normalized messages, events, usage, and session persistence with ShrimpRoll's SQLite model
  - [x] Record the provider-independent boundaries ShrimpRoll should preserve in the integration runtime decision
  - [x] Keep official provider runtimes responsible for subscription credentials rather than copying Pi's direct OAuth transports

- [x] Phase 3 — Build the local product surfaces
  - [x] Serve the local API with Hono and a lean client-routed React app
  - [x] Add Neon via remote MCP as the first user-configurable MCP connection
  - [x] Make Runs the homepage with attention items first and repeated non-events aggregated
  - [x] Render run detail as a first-person, past-tense letter with mechanics in a quiet footnote
  - [x] Build the sentence-first task composer and structured proposal call
  - [x] Show proposed schedule, required connection, capability contract, and execution mode before confirmation
  - [x] Add “Run it once now” and “Schedule” paths plus a fallback details editor
  - [x] Add task list, task detail, enable/disable, run-now, and catch-up controls
  - [x] Add the Connections surface with just-in-time connection prompts
  - [x] Keep user-facing navigation and language limited to Tasks, Runs, and Connections

- [x] Phase 2 — Run one useful task end to end
  - [x] Add secure BYOK configuration with a direct key-creation link and connection test
  - [x] Add OpenRouter API-key configuration and make it selectable for the live digest
  - [x] Fix Keychain persistence and root `.env` loading found during the live check
  - [x] Implement the AI SDK tool loop behind the kernel `runTask()` interface
  - [x] Create an allowlisted web/RSS/Hacker News connector with explicit schemas and capabilities
  - [x] Persist readable transcripts, tool-call summaries, duration, status, and cost metadata
  - [x] Add failure classification and bounded retry behavior for model and connector calls
  - [x] Exit when “summarize Hacker News every morning” produces a real readable transcript

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

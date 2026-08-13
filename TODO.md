# To-dos

Guiding principle: one agent loop, direct capability-scoped tools, and host-enforced boundaries (schemas, credentials, idempotency, audit). If a tool is available, the agent is authorized to use it. Checks are user-configured exceptions, not defaults.

## 📋 Backlog

- [ ] Compact chat tool-loop context without busting prompt cache
  - [ ] Diagnosed chat a195762d: 372,994 billed tokens were 18 steps totaling, peak input 40,599; `pruneMessages` would drop the SQL/property evidence still needed
  - [x] Do not compact routinely — rewriting history invalidates cached input (see agent-loop-policy comment)
  - [x] Share the scheduled-run evidence-ledger fuse with chat `prepareStep` as an emergency bound
  - [ ] Project SQL/property connector results tighter than the 12k-character truncate
  - [ ] Show peak step tokens versus billed cumulative tokens on the turn footer

- [ ] Load Springroll app tools on demand in chat
  - [ ] Inject a small core set (list/get/create/run) plus search_application_tools; load the rest on demand instead of all ~30 every turn
  - [ ] Trim tool descriptions to the same standard as the system prompt: capability first, one constraint, no restated global rules
  - [ ] Align tool names with product language (recipe vs task) or keep the one-line prompt bridge


- [ ] Runtime hardening and test coverage
  - [ ] Assert secrets never enter messages, model inputs, tool inputs/outputs, SQLite, logs, events, citations, or cost records
  - [ ] Contract-test usage and cost aggregation across OpenRouter, OpenAI, xAI, provider-hosted tools, and Springroll/MCP tools
  - [ ] Cover live reconnect, simultaneous viewers, restart recovery, cancellation, and multi-minute runs
  - [ ] Add cancellation checks between model turns and tool calls
  - [ ] Keep raw chain-of-thought and unbounded raw tool output out of storage and the default event log

- [ ] Model and provider follow-ups
  - [ ] Live-verify direct OpenAI when a development key is available
  - [ ] Add the models.dev snapshot as a first-run offline bootstrap
  - [ ] Add direct-provider native web-search mappings; record requested profile, actual engine, citations, and cost on the run
  - [ ] Filter task model choices by the actual provider-tool adapter contract
  - [ ] Evaluate Codex and Claude CLI commands as separately permissioned AI SDK tools with bounded input, output, cancellation, and authentication

- [ ] Gate A — Dogfood the local app for at least two weeks
  - [ ] Run the chosen Neon and Gmail tasks on a real daily schedule
  - [ ] Track missed runs, duplicate runs, false-positive notifications, auth failures, and instruction edits
  - [ ] Validate that sentence-first creation and readable transcripts build sufficient trust
  - [ ] Choose the launch connector set from observed personal value
  - [ ] Decide whether BYOK is acceptable for v1 or requires bundled/local model access
  - [ ] Record a go, revise, or stop decision before starting packaging or hosted work

- [ ] Phase 4 — Add Gmail and close the local trust loop
  - [ ] Register Springroll OAuth client identities for Gmail and Slack (no dynamic client registration)
  - [ ] Implement read-only Gmail OAuth with localhost callback handling
  - [ ] Store local credentials in macOS Keychain and support expiry, reconnect, and revoke flows
  - [ ] Add macOS notifications for meaningful output and connection failures
  - [ ] Keep quiet or empty runs out of notifications while preserving them in the Runs feed
  - [ ] Exit when hourly unread-mail triage reliably notifies about important messages

- [ ] "New Theme" AI button — prompt → structured theme JSON → contrast validation → preview → save
  - [ ] Implement as a direct tool once user-created themes have storage
  - [ ] Validator and role schema already in place (`themes.ts`)

- [ ] Phase 5 — Package the validated local app for macOS
  - [ ] Wrap the app and Bun sidecar in a Tauri menubar shell
  - [ ] Implement the glance popover with needs-you, recent runs, next run, new task, and pause-all controls
  - [ ] Add tray status, attention dot, launch at login, lifecycle handling, and safe shutdown
  - [ ] Provision Apple signing and notarization
  - [ ] Configure and test signed automatic updates
  - [ ] Verify install, upgrade, credential persistence, sleep/wake, and uninstall behavior on clean Macs

- [ ] Phase 6 — Prove Rivet actor ownership and hosted portability
  - [ ] Keep every `rivetkit` import in the kernel host layer and run the same selected `AgentRunner`, capability contract, and event schema locally and in Rivet Cloud
  - [ ] Give each task one actor that owns its schedule, run rows, checkpoints, events, and mutable recipe notes
  - [ ] Keep local SQLite authoritative for task catalog/editing, chats, the local ledger, and read-only mirrors of cloud-owned run history
  - [ ] Push task definition, pinned tools, model settings, and schedule to the actor on promote and every subsequent edit
  - [ ] Append actor-owned history through `getHistorySince(cursor)` on launch and reconnect; treat live actor events as transient presentation only
  - [ ] Build one account actor per hosted user for the cloud-task index, usage/cost entries, credential audit events, and subscription state
  - [ ] Implement explicit promote and demote migrations with one writer at every step and complete data export in both directions
  - [ ] Add local-only and run-anywhere task policies without local-preferred dual execution or distributed occurrence claiming
  - [ ] Validate model, tool, MCP endpoint, and credential availability before promotion; keep stdio-only connectors local
  - [ ] Define recovery for a crash after queue consumption, including one-shot checkpoint resume and stable consequential-tool idempotency keys
  - [ ] Test healthy multi-hour runs, overlap skip, Mac sleep/wake, forced registry and engine termination, missed alarms, reconnect catch-up, and actor schema upgrades
  - [ ] Hosted-runner groundwork: CredentialStore interface split, per-location checks, explicit run payload
  - [ ] Exit when one task can promote to a hosted actor, run with the Mac off, mirror its history on reconnect, and demote with all data preserved

- [ ] Phase 7 — Ship paid run-anywhere
  - [ ] Deploy the task/account actor registry to Rivet Cloud under Springroll's org and keep Rivet invisible to end users
  - [ ] Namespace actor keys by authenticated user and enforce the shared tenancy guard in every action
  - [ ] Add better-auth email-code sign-in and browser-to-device pairing
  - [ ] Store long-lived device tokens in Keychain with revoke and rotation support
  - [ ] Build per-task local-only versus run-anywhere controls
  - [ ] Keep local credentials in macOS Keychain and never sync them implicitly
  - [ ] Build the hosted KMS or managed secret store for explicitly escrowed connector and BYOK model credentials
  - [ ] Add explicit, reversible per-credential cloud escrow consent with separate local and hosted availability
  - [ ] Implement Stripe subscription state, webhooks, entitlements, usage metering, and billing recovery on the account actor
  - [ ] Clear task-actor schedules on payment failure while retaining state, and wire cancel/delete to demote or purge actors and secrets
  - [ ] Send quiet away notifications through Resend or push only when the local app is unavailable
  - [ ] Add hosted operations for actor wakes, failed runs/resumes, mirror lag, expired credentials, tenancy denials, and billing events
  - [ ] Exit when an opted-in task runs while the Mac is off, appears locally through cursor catch-up, and never has two writable owners

- [ ] Phase 4b — Expose the local app through MCP
  - [ ] Expose task CRUD, enable/disable, run-now, and run-query tools from the shared registry
  - [ ] Treat external clients as a real trust boundary: externally created tasks start inactive and require in-app confirmation
  - [ ] Prevent external clients from creating connections, enabling run-anywhere, or granting autonomy
  - [ ] Add one-click Claude Desktop configuration and client-focused integration tests
  - [ ] Exit when an external assistant can propose a task and later answer from its run transcript

- [ ] Phase 8 — Add remote access only after run-anywhere is stable
  - [ ] Serve the existing MCP surface over authenticated streamable HTTP
  - [ ] Add OAuth client authorization, scopes, revocation, and audit visibility
  - [ ] Validate task and run access from web and phone-based assistants

- [ ] Later — Revisit deliberately deferred expansion
  - [ ] Evaluate Ollama or bundled model access after measuring BYOK drop-off
  - [ ] Broaden bring-your-own MCP installation beyond the audited launch catalog
  - [ ] Evaluate a searchable one-tool integration catalog only when real tool-schema volume creates measurable context pressure
  - [ ] Evaluate App Store reviews, Slack/Discord posting, and calendar from dogfood demand
  - [ ] Design hosted hub-and-spoke sync before adding multiple Macs or a phone viewer
  - [ ] Consider local-only Apple Notes and filesystem connectors
  - [ ] Consider an optional per-recipe dollar ceiling only if dogfooding shows accurate cost reporting is insufficient
  - [ ] Evaluate Windows and Linux only after the macOS product is stable
- [ ] Dogfood integration creation across MCP, API, and custom formats
  - [ ] Exercise the prompt matrix through the product UI as an end user; capture unclear or dead-end states (re-run after the simplification lands)
  - [ ] Reduce connector research token cost (Context7 replay used 58k tokens; Open Library 65k across 11 steps)
  - [ ] Reproduce a local npm MCP package install failure and verify retry/recovery from the rendered setup flow
  - [ ] Accept disposable API-key connectors to verify credential setup, disconnect, reconnect, and removal
  - [ ] Support provider-owned GitHub OpenAPI YAML without weakening same-provider verification
  - [ ] Replay the matrix visually when an in-app browser runtime is available

## 🚧 In Progress

- [ ] Implement the accepted chat design (thin bar → tagged full-screen threads → Asked filter)
  - [ ] Direction + implementation prompt: `docs/chat-design.md`; interactive spec: `docs/design/chat-flow.html`
  - [x] Step 1 — reply composer on run letters (replaces "Ask about this run")
  - [x] Step 2 — thin ask bar everywhere + full-screen tagged thread page; kill Chat tab, `/` → Inbox
  - [x] Step 3 — All · Scheduled · Asked filter; chat sessions become Inbox rows; retire chat index
  - [ ] Step 4 — quiet "Ask" affordances on detail-page facts
  - [x] Always-on ask bar (no in-page composers); header matches bar height

- [ ] Verify Rollmark rendering and themed charts visually
  - [x] Rollmark integrated: mounting, themed chart colors, fallback styles, prompt kit in report generation
  - [ ] Inspect rendered charts, Mermaid, and fallback behavior across light, dark, and glass themes
    - [ ] 2026-08-09: blocked — in-app browser selection returned no available runtime

## ✅ Done

- [x] Refresh models.dev catalog on demand so new models appear before the 6-hour cache expires
  - [x] Gemini 3.7 Flash was on models.dev/OpenRouter but hidden by the 6-hour cache
  - [x] Models page Refresh bypasses TTL; `POST /api/models/refresh`

- [x] Share agent loop-control policy across chat and scheduled runs
  - [x] Extract compaction, wrap-up bounds, and emergency instructions into `agent-loop-policy.ts`
  - [x] Chat prepareStep uses the same fuse and wrap-up as runs (20 steps, 2M tokens, 10 min)
  - [x] On stream error with tool evidence, synthesize instead of failing the turn

- [x] Surface real provider errors on failed chat turns
  - [x] Chat a195762d stored only "Assistant response failed"; the OpenRouter/Gemini stream error was discarded
  - [x] Persist a sanitized publicFailureMessage on the turn and model call
  - [x] Failed-turn banner already shows `latestTurn.error`, so the stored text is what the user sees

- [x] Apply a localized accent spotlight to the ask bar
  - [x] Restore the production bar after the over-tinted first pass
  - [x] Compare neutral, halo, edge-glint, and ground-spotlight studies
  - [x] Try option B with a neutral fill and perimeter halo
  - [x] Apply option D with a neutral bar over a soft accent glow

- [x] Strengthen the bottom ask bar accent treatment
  - [x] Reverted the first pass at the user's request; it was too strong

- [x] Explore revamped chat layouts — direction decided 2026-08-12
  - [x] Iterated four HTML studies (index/detail, placement, IA, companion) to the accepted design: chat as the input layer
  - [x] Accepted spec: `docs/design/chat-flow.html`; rules + implementation prompt: `docs/chat-design.md`
  - [x] Superseded variation studies removed from `docs/design/`

- [x] Render recipe instructions through Rollmark like reports
  - [x] Ask create/update tools for Markdown that can include visual blocks
  - [x] Mount the recipe detail prompt through RollmarkDocument
  - [x] Point recipe-creation prompt directions at the same Markdown format

- [x] Reject heading-only scheduled-run reports
  - [x] Diagnose run a5d77487 and recover the finalization sequence
  - [x] Save the research model's final answer as the report (no rewrite turn)
  - [x] Require that Markdown to contain substantive body content
  - [x] Compute summary from the report and show it on the detail page
  - [x] Add regression coverage and verify the production build

- [x] Consolidate and commit the current feature branch
  - [x] Audit every worktree change and recover the web-research distiller branch
  - [x] Verify the distilled web-search model selector, API, persistence, and runtime reach the production build
  - [x] Run repository checks and commit the complete branch state

- [x] Correct scheduled-run research and terminal-output separation
  - [x] Keep structured output out of the tool/research loop
  - [x] Require configured-source evidence before a run can succeed
  - [x] Reject placeholder reports and verify research retry plus finalization

- [x] Standardize generated recipe content and UI rendering on Markdown
  - [x] Define create and update recipe instructions as GitHub-flavored Markdown
  - [x] Render recipe instructions as sanitized Markdown on cards and detail pages
  - [x] Verify schemas, renderer safety, types, and the production browser build

- [x] Repair local database compatibility after branch switches
  - [x] Confirm a clean restart rebuilt the browser bundle and started a new server process, but cannot repair the persisted schema mismatch
  - [x] Reproduce SQLite returning quoted missing column names as literals, which Drizzle converts into `Invalid Date` values
  - [x] Reconcile the applied `0023_living_recipe_notes` migration with the checked-out schema and migration journal
  - [x] Restore compatibility for stored DataForSEO read-only POST operations and HTTP Basic credentials
  - [x] Restart the dev server and rebuild browser assets so UI, API code, and SQLite mapping use one revision
  - [x] Verify `/api/tasks/:id/knowledge` returns active notes with valid ISO dates
  - [x] Verify `/api/connections` accepts every stored manifest and returns the Connections list

- [x] Diagnose Connections mutation-classification error
  - [x] Confirm `/api/connections` fails because the DataForSEO manifest contains four read-only POST operations created under feature-branch validation rules
  - [x] Confirm the same manifest uses feature-branch HTTP Basic credential fields absent from the checked-out validator

- [x] Diagnose Invalid Date in recipe knowledge
  - [x] Confirm the knowledge API returns HTTP 500 `Invalid Date` while the stored revision and epoch-millisecond timestamps are valid
  - [x] Trace the mismatch to a long-running watched server, stale browser bundle, and an applied branch-only migration that dropped columns still present in the checked-out schema

- [x] Distill oversized web results with an assignable lightweight model
  - [x] Distill search_web / fetch_public_url results once at tool-execution time into Markdown research notes (verbatim figures, source URLs, re-fetch hint)
  - [x] Add the optional "Research distiller" role to the Models page; unassigned falls back to mechanical trimming
  - [x] Record distiller calls in `model_calls` under a `distill` context kind
  - [x] Remove the per-step superseded-web-result rewrite that broke provider prompt caches

- [x] Make recipe notes a living document and remove the dead review machinery
  - [x] Add a `# Recipe notes` run-prompt section reminding the agent to save reusable context (snippets, SQL, URLs, endpoints) with `update_task_notes`
  - [x] Delete the unused approve/markStale/learning paths, review statuses, and approval columns (migration `0023_living_recipe_notes`)
  - [x] Reword the tool description, injected `<recipe_knowledge>` framing, recipe-page copy, and docs to the living-notes model

- [x] Support multi-field API credentials such as HTTP Basic login and password
  - [x] Model named credential fields without exposing values to the agent
  - [x] Collect and validate all required fields in one setup form
  - [x] Store and inject the credential bundle through the existing Keychain boundary

- [x] Make connector proposal failures converge instead of looping
  - [x] Reproduce the DataForSEO chat: 58 model calls, 35 proposals, 2.21M tokens, and no valid connector
  - [x] Treat API documentation and operations as user-reviewed guidance; enforce only safe request and secret boundaries
  - [x] Default an unspecified API credential rail to the Authorization header
  - [x] Allow POST-based query APIs to declare their actual read effect
  - [x] Select recent relevant provider evidence; one stale unavailable source must not poison every later proposal
  - [x] Require MCP-specific evidence before rendering a credentialed endpoint as a ready Remote MCP connector
  - [x] Compact superseded proposal attempts so retries do not multiply context cost

- [x] Move connector permissions to the connection boundary
  - [x] Make each connector's access mode and per-tool policy the authoritative permission ceiling and approval source
  - [x] Let recipes select a subset of connector tools without owning a competing approval policy
  - [x] Make every displayed Allow, Check first, or Off state match the effective runtime behavior
  - [x] Classify Neon `run_sql` as read when the connection is authenticated in read-only mode
  - [x] Default connector and app actions to no human-in-the-loop; checks are explicit user policy, not risk-prescribed defaults
  - [x] Activate safe recipe memory revisions immediately without a human-review gate
  - [x] Document the connector-boundary and opt-in human-check philosophy

- [x] Diagnose unexpected approvals for read-only Neon SQL
  - [x] Confirm the AssessorSearch recipe stores `run_sql` as Allow (`approval = never`) but Neon advertises it as destructive
  - [x] Trace the executor's destructive-risk override that restores `before_call` for every SQL invocation, including `SELECT`

- [x] Stop proactive connector acquisition; make web research the default answer path
  - [x] Diagnosed the Redmond-weather chat: 96s, ~35 tool calls, six failed connector proposals, no answer, while Exa sat connected
  - [x] Rewrite `# Connections`: research/set up integrations only on explicit user request; answer informational questions first, offer the connection after
  - [x] Add first-class `search_web` and `fetch_public_url` registry tools proxying the web-search connection, so chat gets web research without the connector-tool ceremony

- [x] Render Rollmark documents in chat responses
  - [x] Mount completed assistant messages and interleaved run reports through the Rollmark renderer; streaming text stays plain Markdown until the message completes
  - [x] Share the `# Visual blocks` prompt section (bridge + format contract) across chat and runs
  - [ ] Verify chat chart rendering visually when an in-app browser runtime is available

- [x] Consolidate prompts into one shared fragment module
  - [x] Define every rule once in `kernel/src/prompts.ts`; chat and run prompts differ only by identity line
  - [x] Share the conduct, web-research, and Markdown output guidance verbatim across both surfaces
  - [x] Adopt rollmark v0.1.2's sectioned prompt kit: use `promptKit.format` verbatim in run prompts only; Springroll's Output section replaces the package preamble
  - [x] Collapse the two emergency wrap-up strings into one template
  - [x] Snapshot-test the assembled prompts and assert each shared rule appears exactly once
  - [x] Restructure the assembly into one outline: `# Conduct` / `# Research` / `# Output` / `# Visual blocks` / `# Context`, positive response-shape rules first, tagged context data placed last

- [x] Simplify Springroll around one tool-driven agent loop — do this before anything else below
  - [x] 1. Replace the propose_* ceremony with direct tools and risk-based approvals
    - [x] Convert `springroll_propose_task` → `create_task` end to end as the pattern; the generic approval card fires only for destructive or user-flagged tools
    - [x] Convert the remaining task tools: update, run now, pause/resume, delete, tool repair
    - [x] Convert connection actions; keep OAuth and credential entry as native host flows (they need a human, not a ceremony)
    - [x] Route destructive and check-first tools through the existing generic tool-approval ledger; delete the bespoke proposal workflow rows
    - [x] Add per-recipe capability settings: Allow (default for deliberately added tools) / Check first / Off
  - [x] 2. Delete assistant-step-policy orchestration
    - [x] Remove intent tool packs, forced tool choices, attempt counting, and injected terminal instructions
    - [x] Keep web-evidence compaction as context hygiene
    - [x] Demote intent to a UI breadcrumb; one tool set for the assistant
  - [x] 3. Shrink the shared system prompt to identity, truthfulness, untrusted-content handling, secrets, and response format
  - [x] 4. Delete the side-band model calls
    - [x] Manual recipe composer (`proposal-generator.ts`) → the chat agent with `create_task`
    - [x] Post-run knowledge reflection → an `update_task_notes` tool the run agent calls directly during the run
  - [x] 5. Presentation only, after the above: show run results as turns in the recipe's conversation while keeping scheduled runs as separate fresh executions

- [x] Phase R2 — RivetKit actor per task (local SQLite stays authoritative)
  - [x] Actor scheduling, serialized execution, queue replay, restart reconciliation, and versioned-state migrations proven against the real engine
  - [ ] Validate Tauri-owned engine startup, quit, forced termination, update, and macOS sleep/wake once the packaged shell owns both sidecars

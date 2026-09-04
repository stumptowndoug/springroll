# To-dos

Guiding principle: one agent loop, direct capability-scoped tools, and host-enforced boundaries (schemas, credentials, idempotency, audit). If a tool is available, the agent is authorized to use it. Checks are user-configured exceptions, not defaults.

## 📋 Backlog

- [ ] Polish the public-alpha first impression
  - [ ] Make chat surfaces and composer states visually logical; remove accidental see-through layering
  - [ ] Ship one excellent default light theme and one excellent default dark theme
  - [ ] Keep glass as an intentional optional theme and verify contrast and legibility across the four main pages and chat
  - [ ] Tighten first-run empty states so a new user can connect a model, create a recipe, and understand local scheduling
  - [ ] Run a focused desktop and narrow-width visual/accessibility pass before publishing screenshots

- [ ] De-risk the macOS application package
  - [ ] Confirm the Tauri shell architecture for the UI, Bun application sidecar, and Rivet engine lifecycle
  - [ ] Build an unsigned developer package that launches the existing app from a clean Mac account
  - [ ] Verify application-support paths, Keychain access, loopback OAuth, single-instance behavior, quit, and sleep/wake
  - [ ] Use the spike to scope the full signed, notarized, auto-updating Phase 5 release

## 🚧 In Progress

- [ ] Expand model providers and add subscription-backed coding agents
  - [x] Add the major API-key providers supported directly by the AI SDK, with a shared connection path and provider-specific verification
  - [x] Define an agent-runtime provider boundary alongside the existing AI SDK model connections; do not pretend a coding-agent subscription is a raw model API
  - [x] Establish the experimental Codex recipe runtime through the official Codex app server, with isolated managed ChatGPT browser sign-in, plan identity, subscription billing, host tools, usage, and cancellation
  - [x] Add Claude Agent SDK as a subscription-backed recipe runtime
    - [x] Add isolated Claude connection status and managed sign-in guidance
    - [x] Normalize Claude streaming, Springroll tool calls, usage, cancellation, and terminal reports through `AgentRunner`
    - [x] Wire Claude models through the provider catalog, Settings, and runtime selection
    - [x] Cover connection, model discovery, runner behavior, and application APIs with regression tests
    - [x] Verify 585 tests, typecheck, changed-file lint, production build, and equal provider-card sizing
  - [ ] Surface Codex rate-limit state and add hard host enforcement or clearly separate controls that app server cannot enforce
  - [ ] Add Codex continuation for Springroll tools requiring per-call approval
  - [ ] Dogfood Codex sign-in and a scheduled recipe against a real isolated Springroll account
  - [ ] Evaluate GitHub Copilot next through its official TypeScript SDK and per-user GitHub OAuth subscription flow
  - [ ] Spike Gemini CLI through its official local sign-in and cached headless flow; verify that its package boundary, terms, and scheduled-run behavior are suitable before committing to it
  - [x] Record the Claude boundary: Agent SDK integrations use API-key or supported cloud-provider billing; subscription use requires direct user sign-in to an unmodified Claude Code binary or explicit Anthropic approval
  - [ ] Normalize connected, signed-out, expired, rate-limited, and unsupported states plus model capabilities, cancellation, approvals, usage, and `subscription` versus `metered` billing labels
  - [x] Re-check official provider documentation and record the current runtime matrix and constraints
  - [x] Verify 581 tests, typecheck, lint, production build, and equal provider-card sizing at desktop and narrow widths
  - [ ] Cover interactive setup and unattended scheduled runs with live acceptance tests
  - [ ] Revalidate Rivet local/cloud parity for subscription runtimes, including process execution, isolated provider auth, credential portability, and current Rivet platform capabilities
    - [x] Confirm Rivet Compute can run the Springroll actor host and official provider runtimes from our Docker image
    - [x] Reopen agentOS as an optional isolated runtime now that it supports macOS/Linux sidecars, Codex, Claude Code, persistent filesystems, and host bindings
    - [x] Separate runtime portability from provider auth: Codex supports securely seeded trusted-runner auth, while Claude subscription credentials may not be intermediated by Springroll
    - [ ] Run the same Codex subscription acceptance case locally and on Rivet Compute, including refresh persistence, cancellation, usage, and sleep/wake
    - [ ] Spike agentOS locally and on Rivet Cloud with a credential-free fake, host tool binding, and API-key agent before testing any subscription credential
    - [ ] Confirm hosted subscription product usage with OpenAI and the unmodified-Claude-Code path with Anthropic before presenting either as generally available

- [ ] Prepare a source-first public alpha
  - [x] Choose an open-source license and confirm the Springroll name and future package namespace
    - [x] Confirm the existing SpringRoll HTML5 project owns the unscoped springroll npm package
    - [x] Keep the Springroll product name and leave packages private or scoped rather than claiming the unscoped package
    - [x] Use the permissive MIT license
  - [ ] Rewrite the README for an outside contributor with a product screenshot, current capabilities, macOS prerequisites, a five-minute quick start, and known limitations
    - [x] Rewrite the outside-contributor overview, quick start, capabilities, and known limitations
    - [x] Add the product logo and a concise product-first README structure
    - [ ] Capture the final product screenshot after the first-impression polish
  - [x] Document what stays local, what is sent to model and integration providers, expected model costs, and the experimental security posture
  - [x] Add SECURITY.md, CONTRIBUTING.md, a code of conduct, and lightweight issue and pull-request templates
  - [ ] Scan the full Git history for secrets and private data, then enable GitHub secret scanning, Dependabot alerts, and CodeQL
    - [x] Scan all 282 commits with Gitleaks; no leaks found
    - [x] Enable Dependabot alerts and add native Bun and GitHub Actions update configuration
    - [x] Add an actionlint-validated CodeQL v4 workflow for JavaScript and TypeScript
    - [ ] Enable secret scanning and confirm the first CodeQL run when the repository is public; GitHub reports secret scanning unavailable while it is private
  - [ ] Commit the current branch, land it on main, and require the existing CI check before merging
    - [x] Commit the completed connector and creation-action work on the feature branch
    - [x] Commit the public-alpha preparation changes
    - [x] Open pull request #2 against main
    - [x] Fix the clean CI runner's stale unscoped Rollmark test import
    - [x] Run the primary CI suite on Springroll's supported macOS target
    - [x] Land pull request #2 on main after the macOS CI check passed
    - [ ] Require the CI check before future merges
  - [ ] Verify a clean-clone startup on a fresh Mac with no existing environment, Keychain entries, or Springroll database
    - [x] Verify a clean clone with no .env or .local directory can install, build, start, and serve an empty snapshot
    - [ ] Repeat the smoke test from a separate clean Mac account before publishing
  - [ ] Make the repository public as an experimental source-run alpha and invite focused feedback

## ✅ Done

- [x] Use the OpenAI mark for Codex subscription surfaces
  - [x] Share the existing OpenAI provider logo instead of maintaining a separate Codex mark
  - [x] Verify provider catalog behavior, 67 focused tests, and typecheck

- [x] Unify chat across API and subscription providers
  - [x] Replace the API-only chat runtime boundary with a provider-neutral conversation runner
  - [x] Support Codex and Claude subscription models in new and resumed chats
  - [x] Preserve Springroll tools, UI streaming, usage, cancellation, persisted history, and explicit attachment capability checks
  - [x] Return Settings to one default model with per-chat and per-recipe overrides
  - [x] Verify a live two-turn Codex chat, 586 tests, lint, typecheck, production build, and responsive UI

- [x] Clarify model selection by provider type
  - [x] Add an explicit provider selector before the model list
  - [x] Label API, aggregator, and subscription providers clearly
  - [x] Offer subscription models for recipe defaults and recipe overrides
  - [x] Keep subscription models out of chat until a supported runtime exists; retain the API-only distiller boundary
  - [x] Verify 584 tests, typecheck, build, accessibility, and responsive layout

- [x] Trim redundant direct model providers
  - [x] Remove Mistral, DeepSeek, and Cohere from Settings and model selection
  - [x] Remove their unused direct SDK adapters and provider metadata
  - [x] Point users to OpenRouter for those model families
  - [x] Verify 582 tests, typecheck, build, and responsive card sizing

- [x] Clarify subscription and API-key providers in Settings
  - [x] Put Claude and Codex in a distinct coding-subscriptions group
  - [x] Put metered providers in a separate API-key group
  - [x] Explain the Claude and Codex plan behavior on their cards
  - [x] Verify equal card sizing and responsive layout

- [x] Standardize vertical gaps between Settings sections
  - [x] Apply one shared gap from the page intro through Text size
  - [x] Verify every section boundary at desktop and narrow widths

- [x] Remove secondary descriptions from Settings section headings
  - [x] Keep only the five section labels above their controls and cards
  - [x] Verify section spacing at desktop and narrow widths

- [x] Normalize Settings descriptions, rows, and cards
  - [x] Remove the operational provider note from Settings
  - [x] Keep each model setting description concise and single-line
  - [x] Verify equal model-row heights at desktop and narrow widths
  - [x] Render model providers and built-in capabilities through one equal-height card template

- [x] Make the Settings page use its width consistently
  - [x] Let page and section descriptions use the available content width
  - [x] Verify the hierarchy at desktop and narrow widths

- [x] Match AI provider logos to integration-card logos
  - [x] Use the same 24px mark container and 22px glyph size
  - [x] Verify equal card sizing and no overflow at desktop and narrow widths

- [x] Fix first launch without a pre-existing local data directory
  - [x] Create the model-catalog cache directory before opening SQLite
  - [x] Add a regression test for a nested missing cache directory
  - [x] Verify startup from a clean clone with an isolated database and Rivet engine

- [x] Add explicit creation actions to Recipes and Integrations
  - [x] Add an Add recipe button that opens the existing recipe-creation chat
  - [x] Add an Add integration button that opens the existing integration-creation chat
  - [x] Verify both actions with scoped-chat tests and in the running UI at desktop and narrow widths

- [x] Keep one-click connectors visible at the top of Integrations
  - [x] Retain connected providers in the one-click row instead of removing them
  - [x] Mark connected providers with a check and providers requiring re-authentication with an attention badge
  - [x] Prefer a healthy account when a provider has multiple accounts and verify the states in tests and the running UI

- [x] Clarify the integration detail Accounts section
  - [x] Show the connected account identity once and one clear Add another account action
  - [x] Verify the connected Google Drive account at desktop and narrow viewport widths

- [x] Make Google connections one-click and local-only
  - [x] Replace the Web OAuth requirement with a desktop-safe client configuration
  - [x] Keep Gmail, Calendar, and Drive callbacks and tokens on the local app
  - [x] Move hosted Google authorization to the future run-anywhere backlog
  - [x] Verify configuration, authorization, reconnect, and account isolation with 564 tests, typecheck, lint, and production build

- [x] Match Needs attention card sizing to connected integration cards
  - [x] Measure both card groups in the running app
  - [x] Normalize card dimensions without changing the recovery emphasis
  - [x] Verify desktop and narrow layouts
  - [x] Verify typecheck, lint, and production build

- [x] Make expired integration recovery obvious and actionable
  - [x] Put expired accounts in a top-level Needs attention section
  - [x] Show a prominent Reconnect action on the integration detail page
  - [x] Give the agent an exact in-app Markdown link when reauthentication is required
  - [x] Verify the live rendered list and Gmail detail state
  - [x] Verify 563 tests, typecheck, lint, and production build

- [x] Reconcile connected integration status with terminal OAuth refresh failures
  - [x] Confirm Gmail status checks stored credential shape rather than live refresh health
  - [x] Correlate the August 24 sign-in and September 2 failure with Google's seven-day Testing-mode token lifetime
  - [x] Invalidate connection health after a terminal `invalid_grant` without treating transient provider failures as revoked credentials
  - [x] Show Reconnect in Integrations and expose the same state to related agent requests
  - [x] Cover the status transition and reauthentication boundary with regression tests
  - [x] Verify 561 tests, typecheck, lint, and production build

- [x] Prompt for MCP refresh when a related integration is inactive
  - [x] Expose inactive and live-unreachable MCP connection state without exposing credentials
  - [x] Return an actionable reconnect instruction when a request targets that service
  - [x] Cover inactive credentials, failed live discovery, and related-service requests with regression tests
  - [x] Verify 557 tests, typecheck, lint, and production build

- [x] Show model turns beside run tool usage
  - [x] Snapshot the configured turn limit with each run's model selection
  - [x] Add `4/10 turns` to the existing collapsed work facts
  - [x] Verify 555 tests, typecheck, lint, and production build

- [x] Design run-limit and cost-target feedback
  - [x] Separate successful outcome from stopping reason and specify live, collapsed, and expanded boundary details

- [x] Verify the budget boundary against the 2026-09-02 11:00 Google Trends run
  - [x] Confirm the 10-turn step boundary forced wrap-up while accrued cost remained below $0.05, then the reserved synthesis turn brought the final cost to $0.062706

- [x] Verify turn and cost boundaries against the 2026-09-02 10:56 Hacker News run
  - [x] Confirm it finished naturally after 4 model turns and 22 tool calls, at $0.049594 against a $0.05 target

- [x] Verify 10-turn run-limit behavior against the 2026-09-02 10:51 run
  - [x] Confirm `max_steps = 10` was saved before the run and it finished naturally after 4 model turns and 5 tool calls

- [x] Verify the repaired run-limit behavior against the 2026-09-02 10:46 run
  - [x] Confirm the run finished naturally after 18 model turns and 30 tool calls without reaching the 20-turn boundary

- [x] Fix run-limit settings review findings
  - [x] Diagnose 2026-09-02 GitHub run: exactly 20 model turns, 24 tool calls, final tool-free turn returned no acceptable report
  - [x] Restore typecheck by completing the client import and HTTP `AppApi` contract
  - [x] Add a dedicated tool-free evidence-synthesis fallback when the reserved final turn returns no substantive Markdown
  - [x] Persist enough terminal-output diagnostics to distinguish empty, placeholder, detached, and heading-only responses
  - [x] Count model turns across approval continuations
  - [x] Include live tool usage in cost enforcement and handle unavailable pricing honestly
  - [x] Reject a one-turn limit for recipes that require tool evidence
  - [x] Verify 555 tests, typecheck, lint, and production build

- [x] Review run-step and settings changes
  - [x] Trace settings persistence through scheduled-run construction
  - [x] Run focused and full tests, typecheck, lint, and production build
  - [x] Record correctness and enforcement gaps in Backlog

- [x] Enforce run step limits with guaranteed wrap-up and user-configurable turn/budget bounds
  - [x] Add guaranteed wrap-up step on final turn before step limit in task runner
  - [x] Support user-configurable max run steps and budget in settings
  - [x] Terminate and synthesize final report when run hits cost budget

- [x] Show prebuilt Microsoft integrations in the one-click shelf before operator setup
  - [x] Keep unconfigured OAuth connectors visible with an honest setup-required state
  - [x] Preserve Sign in only for connectors whose shared provider app is configured
  - [x] Cover catalog ordering, labels, and actions in regression tests
  - 2026-08-28: 548 tests, typecheck, and production build pass; no connected browser was available for the rendered-page check

- [x] Turn the missing Microsoft 365 placeholders into tested one-click integrations
  - [x] Add native Outlook, OneDrive, Teams, and SharePoint Graph adapters with least-privilege permission ladders
  - [x] Reuse one operator-owned Entra OAuth app while keeping connector consent and accounts independent
  - [x] Cover catalog readiness, OAuth setup, account identity, API requests, and multi-account routing with mocked acceptance tests
  - [x] Document the shortest local operator setup and keep Salesforce tracked until org-specific URL handling is implemented

- [x] Recover recipes when a pinned connector tool schema changes
  - [x] Replace raw `mcp-remote/run_sql` failures with the connection and tool name
  - [x] Offer a reviewed repair-and-run action from the normal recipe flow
  - [x] Repair the affected Neon recipe pins and verify execution preflight

- [x] Implement the opt-in hosted credential escrow boundary
  - [x] Split credential availability from transport portability so remote connectors remain local until explicitly escrowed
  - [x] Define a host-neutral vault interface with authenticated put/get/delete and account-scoped references
  - [x] Add explicit promote, revoke, and status application boundaries without copying secrets automatically
  - [x] Cover independent Gmail accounts, deletion, and hosted-run preflight in regression tests
  - [x] Leave production KMS, device pairing, and Rivet Cloud wiring in Phase 7

- [x] Decide whether to prebuild a broad integration catalog
  - [x] Keep explicit-request LLM research as the default integration acquisition path
  - [x] Limit prebuilt entries to a few high-value, fully tested shortcuts and OAuth applications
  - [x] Defer a broad ranked directory until dogfood and request telemetry justify it

- [x] Define and rank the initial one-click integration catalog
  - [x] Separate user-value ranking from technical one-click readiness
  - [x] Verify leading provider endpoints and distinguish dynamic OAuth from fixed-client and tenant-admin setup
  - [x] Define launch waves, catalog admission gates, and a persistent ask-for-an-integration UI path
  - [x] Use Composio, Claude, Hermes, and the official MCP Registry as candidate feeds rather than trust authorities
  - [x] Compare Grok's native connectors, vendor-hosted MCP catalog, and Grok Bot plugin marketplace

- [x] Research open-source integration approaches in Hermes and OpenClaw
  - [x] Separate open skills and manifests from connector implementations, OAuth applications, and hosted execution
  - [x] Compare Hermes's curated official-MCP catalog with OpenClaw's ClawHub, plugins, and CLI-backed skills
  - [x] Identify Activepieces and direct open-source CLIs as the strongest reusable connector sources
  - [x] Verify explicit multi-account Gmail routing in gog and contrast it with Hermes's profile-scoped Google token

- [x] Evaluate Composio for searchable one-click managed integrations
  - [x] Confirm the MIT SDK/CLI boundary versus the proprietary hosted control plane and commercial enterprise self-hosting
  - [x] Verify multiple accounts per toolkit, aliases, explicit account selection, and custom connection UI support
  - [x] Define one Springroll connection per provider account with exact recipe-level account pinning
  - [x] Audit Springroll's current model: recipe pins are instance-safe, but connector setup and catalog projection still assume one `*-default` instance per manifest

- [x] Research OpenHuman one-click integrations and compare Springroll
  - [x] Confirmed the managed catalog is a Composio-backed OAuth, tool, and trigger proxy rather than 118 bespoke connectors
  - [x] Compared the published desktop/core flow, unpublished backend boundary, privacy implications, and Springroll's existing direct-MCP path

- [x] Make connection-tool discovery schema-efficient
  - [x] Keep authoritative schemas for host validation and execution
  - [x] Return compact contracts during discovery and expose full dereferenced schemas only on activation
  - [x] Cover the search, describe, and activation boundary with regression tests

- [x] Make Gemini tool-call failures recoverable and understandable
  - [x] Preserve valid Gemini thought signatures within a live tool-calling turn without replaying stale encrypted reasoning
  - [x] Start Retry from a clean user turn when persisted tool history lacks valid continuation metadata
  - [x] Replace generic transcript failure copy with the sanitized turn error and explain whether retry can help
  - [x] Resolve the OpenRouter warning by removing invalid reasoning records before they reach the adapter
  - [x] Normalize JSON Schema references in tool results so Gemini does not treat them as function-response parts
  - [x] Prefer OpenRouter's extracted upstream error over its generic nested provider message

- [x] Diagnose opaque provider failures in chat
  - [x] Trace County URL Traffic Analysis to Gemini 3.7 failing on its fourth OpenRouter call after four successful discovery tools
  - [x] Identify stripped and stale reasoning continuation metadata as the retry-poisoning failure mode
  - [x] Confirm the UI hides the turn error behind generic transcript copy and an unactionable provider summary

- [x] Unify runs and chat into one conversation experience
  - [x] Continue a run in place without navigating to a separate chat screen
  - [x] Render follow-up turns directly beneath the run letter
  - [x] Remove user-facing run-versus-chat distinctions from the composer and thread
  - [x] Canonicalize run-linked chat history rows and legacy chat URLs to the run surface
  - [x] Cover run-thread entry, continuation, and navigation state with tests
  - [x] Dogfood the combined run-and-reply layout in the app
  - [x] Delete linked conversations with their run or recipe so history cannot retain orphaned rows

- [x] Revisit the product boundary between runs and chats
  - [x] Keep scheduled occurrences isolated for execution, policy, recovery, and audit
  - [x] Treat runs and chat turns as one conversational surface in the product

- [x] Add image attachments to chat
  - [x] Persist pasted and uploaded images as message-owned attachments
  - [x] Send image parts to vision-capable chat models without silently switching models
  - [x] Add previews, removal, validation, retrieval, and deletion cleanup
  - [x] Let `generate_image` consume attachment and artifact references when supported

- [x] Review the image artifacts implementation plan

- [x] Redesign integration detail page
  - [x] Show connection details (MCP JSON example, endpoints, transport, auth mechanism, runtime environment)
  - [x] Remove lazy-by-default architecture blurb
  - [x] Clean stacked tool list with prominent full-width names, natural descriptions, and quiet policy selects
  - [x] Design study in docs/design/integration-detail-options.html and client UI implementation

- [x] Fix live run detail blank screen
  - [x] Integration-detail import cleanup dropped `EndingActions`; RunLetter threw and unmounted the page

- [x] Put the same Copy and Delete ending on chat and runs
  - [x] Shared ending actions: copy markdown, delete the record
  - [x] Run letters get Copy; chat endings get Delete in the same style
  - [x] Copy and Delete stay on the summary line when Show work expands
  - [x] Quiet divider above the work and ending row on chat and runs

- [x] Make the work fold's expand control obvious
  - [x] Shared Show work / Hide work button on chat and runs, including live

- [x] Match run tool breakouts to chat and keep them expandable live
  - [x] Shared compact result labels (characters / kB / rows) for both surfaces
  - [x] Show work stays open while a turn or run is still working
  - [x] Cost appears in the expanded usage line with input/output/cached

- [x] Stabilize the live work preview so the tick trail does not jump
  - [x] Shared live preview slot is a fixed width, longer, ellipsized
  - [x] Current tool detail fills that slot on both chat and runs

- [x] Collapse turn work to one usage line; expand for detail
  - [x] Shared `TurnUsage` + `TurnWork`: one collapsed line (tokens/cost), details inside the fold
  - [x] Chat and runs both map into that model — no per-surface mechanics footer or meta line

- [x] Make live run work match chat: collapsed, expandable, Stop
  - [x] Live run uses the same collapsed Show work fold as chat, not a full letter placeholder
  - [x] Both surfaces show a longer tool-detail preview (8 lines / 2000 chars) and expand to the full text
  - [x] Stop cancels an in-flight run as well as a chat turn

- [x] Unify run-letter work with chat status and Show work
  - [x] Live run uses the same narrated status line as chat
  - [x] Finished run folds into the same Show work step list (label, detail, result)
  - [x] Tool titles use product language instead of "Using run_sql" / event ledger

- [x] Delete the abandoned integrations.sh spike branch

- [x] Remove the built-in Notion integration

- [x] Add copy markdown button to chat messages and sections
  - [x] Support copying raw markdown from assistant messages and run letters with temporary visual feedback
  - [x] Style quiet copy action alongside message metadata / actions


- [x] Keep local MCP processes warm across chat hops
  - [x] Lazy-start one stdio session per connection
  - [x] Reuse across chats and recipe runs; idle-close after a few minutes
  - [x] Search and approval use the stored catalog instead of spawning every MCP

- [x] Exclude recipes with local-only integrations from hosted runs
  - [x] Derive recipe availableIn from pinned connections
  - [x] Local MCP stays this-Mac-only; remote MCP, API, and Exa can host
  - [x] Cloud enable control explains which integrations block hosting

- [x] Drop the curated Gmail connector so chat researches setup instead
  - [x] Remove Gmail from the curated registry and template matchers

- [x] Let chat offer Gmail and Slack setup instead of blocking on OAuth registration
  - [x] Stop treating unregistered OAuth clients as “unavailable in this build”
  - [x] Agent recommends the real sign-in / token setup instead of a host-policy blocker

- [x] Redesign recipe cards on Recipes page (Option 1: Schedule-First Compact Card)
  - [x] Update Recipe card markup in `TasksPage` to use clean prompt excerpt, timing box, and badges
  - [x] Add and refine CSS styling for schedule timing row, compact prompt excerpt, and integration pills
  - [x] Verify responsive layout, dark/light/glass themes, and tests

- [x] Standardize navigation and naming (Inbox: All/Runs/Chats, Integrations, Models into Settings)
  - [x] Update Inbox source switcher from Scheduled / Asked to Runs / Chats with backwards compatibility
  - [x] Rebrand Connections to Integrations across routes, nav, headers, and chips
  - [x] Consolidate Models into Settings under AI Models & Providers and streamline top nav to 4 tabs
  - [x] Pass all tests, typechecks, and linters

- [x] Restore the Inbox source switch without row-type labels
  - [x] Keep All · Scheduled · Asked for switching between runs and chats
  - [x] Keep per-row Run/Thread markers out of the feed

- [x] Implement label-first Inbox rows without per-row source labels
  - [x] Put recipe/context labels above shorter one-line response receipts
  - [x] Keep the All · Scheduled · Asked source switch
  - [x] Pass focused Inbox tests and the production browser build

- [x] Design label-first Inbox rows with shorter response receipts
  - [x] Build the HTML study at `docs/design/inbox-label-first.html`
  - [x] Keep the source switch and leave per-row run/thread markers unresolved

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

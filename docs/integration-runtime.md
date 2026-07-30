# Integration runtime decision

## Decision

Use direct MCP through the Vercel AI SDK as the standard connector boundary.
Keep native TypeScript tools behind the same kernel interface. Aggregation
providers may implement that interface later, but are not architectural
dependencies.

The first launch connections are Neon through remote MCP and a first-party
read-only Gmail connector. Hacker News remains the no-auth acceptance and
development connector. General public-web tasks use a Web capability with
OpenRouter's provider-executed search tool and a bounded first-party URL
reader; they must not be silently rewritten as Hacker News tasks.

## Runtime rules

- A task stores an exact allowlist of tools rather than exposing an entire
  server catalog to the model.
- Confirmation pins the tool input schema. A later schema change pauses the
  task for review instead of silently changing its authority.
- Every pinned tool has a curated risk classification and approval policy.
  MCP annotations are inputs to review, not trusted enforcement.
- Every connection declares whether it is available locally, hosted, or in
  both locations.
- Remote streamable HTTP is the default MCP transport.
- Arbitrary stdio servers are out of scope for v1 because installing one runs
  third-party code on the user's machine.
- MCP Apps are an optional UI enhancement. Scheduled execution must continue
  to work from text and structured tool results without an iframe.
- A task grants a reviewed set of capabilities. The runtime agent chooses
  whether, when, and in what sequence to call the tools in that set.
- Provider-executed tools are resolved by the selected model connection behind
  the same pinned descriptor boundary as native and MCP tools.

## Kernel boundary

`ToolSource` opens a connection-scoped session that can list tools, call an
allowed tool, and close. The task runner verifies pinned schemas before it
hands executable tools to the model adapter.

The first adapter uses `@ai-sdk/mcp` with streamable HTTP, supports
connection-specific headers or OAuth providers, preserves declared MCP risk
annotations for review, and accepts optional client capabilities for MCP Apps.

The kernel does not own OAuth screens, Keychain access, MCP transports,
database drivers, model providers, or desktop UI. Shell adapters supply those
capabilities.

## Agent and provider runtime

Keep three concerns independent:

1. A model connection resolves a provider, model, and credential reference.
2. `PiAgentRunner` uses that connection to run Pi's provider-neutral agent
   loop.
3. A run event sink persists the provider-neutral record while the run is in
   progress.

Pi is the only agent runner. The local app and hosted worker invoke the same
runner contract with different storage and credential adapters. The Vercel AI
SDK may remain inside connector or UI integrations where useful, but it does
not own the agent loop.

Authentication belongs to model connections, not transcripts. API keys,
OAuth access tokens, refresh tokens, and provider account identifiers must
never appear in run events. Local credentials remain behind Keychain-backed
credential references. A provider adapter may resolve or refresh credentials
for each model call without changing the task, tool, or persistence contracts.

## Provider-neutral run record

The local Turso/SQLite file is the source of truth before an account is
enabled. With run-anywhere enabled, it synchronizes with the user's Turso
Cloud database and both copies represent one logical product database.
`run_events` is an append-only, schema-versioned event log; the columns on
`runs` are a materialized summary for fast lists and notifications.

The canonical event vocabulary must cover:

- run lifecycle: started, completed, failed, and cancelled;
- model steps: requested provider/model, response identity, finish reason,
  user-visible content blocks, citations/sources, and warnings;
- tool lifecycle: call requested, execution started, result or error, and
  duration, joined by a stable tool-call id;
- usage: input, output, reasoning, cache-read, cache-write, and total tokens,
  plus provider-reported or calculated cost when available;
- policy and approval decisions that changed what the runner could do.

Persist normalized semantic data, not serialized AI SDK, Codex SDK, or other
provider objects. Optional provider-specific metadata may be stored under a
namespaced, redacted extension field, but product behavior cannot depend on
it. Do not persist hidden chain-of-thought; only retain user-visible reasoning
summaries when a provider deliberately returns one.

Events are written as steps finish so a multi-minute run remains observable
and recoverable after interruption. The final transcript is a projection of
the event log, not the only durable copy of the interaction.

`PiAgentRunner` must pass a provider matrix using equivalent prompt and tool
fixtures. OpenRouter, direct API providers, and subscription-backed local
providers must produce the same lifecycle, message, tool, usage, and failure
events even when provider-specific metadata differs.

## Pi design reference

Pi's open-source implementation validates this separation:

- its provider layer separates provider identity and model catalogs from API
  wire protocols and authentication;
- its agent loop consumes normalized messages, tool calls, usage, and stream
  events rather than provider SDK responses;
- its credential store is injected and refreshes OAuth credentials behind the
  provider boundary;
- its sessions are versioned append-only entries with storage interfaces and
  both JSONL and SQLite backends.

ShrimpRoll should incorporate those boundaries, not Pi's coding-agent product
surface. It does not need Pi's session branching, filesystem/shell
environment, or coding-specific context machinery for scheduled connector
tasks.

Pi's Codex integration directly implements ChatGPT OAuth and the Codex
Responses transport. ShrimpRoll uses that packaged integration locally
without copying its credentials into ShrimpRoll storage. Subscription-backed
credentials are not synchronized to hosted workers; a hosted task must select
an API-backed model connection that is available there.

`PiAgentRunner` uses in-memory Pi state, all coding tools disabled, and only
ShrimpRoll `ToolSource` adapters enabled. ShrimpRoll adopts Pi's low-level
model and agent runtime without adopting Pi's JSONL sessions, coding UI,
filesystem, or shell.

## Hosted Pi execution

Pi does not require a persistent process. Hosted runs use the same
`PiAgentRunner` on portable Node compute. Turso supplies durable task, run,
event, schedule, and credential-reference storage. Managed Inngest owns only
durable timing, retries, step checkpoints, cancellation, and operational
observability.

The hosted execution path is:

1. A schedule adapter registers the next Turso-backed occurrence with
   Inngest after the task revision has synchronized.
2. The Mac attempts a direct atomic remote claim at the scheduled time.
3. Hosted execution wakes after the local-preference grace period and loads
   the current task revision from Turso.
4. A live local lease causes hosted execution to wait or exit. An unclaimed
   or expired occurrence is claimed with a new owner and fencing token.
5. The worker loads the selected model connection, allowed tools, and
   explicitly escrowed hosted credential references.
6. Pi performs model turns and tool calls in retry-safe steps.
7. Each completed boundary appends canonical ShrimpRoll events to Turso and
   updates the run summary.

Inngest's event history is operational infrastructure, not the product record.
Turso remains the source used by the ShrimpRoll UI, synchronization, local
execution, exports, and future non-Inngest workers.

For the first hosted proof, a complete short Pi run may execute in one
durable step. Before enabling side-effecting or reliably multi-minute tasks,
split execution at model-turn and tool-call boundaries. Reconstruct Pi's
in-memory state from persisted messages after each boundary so a retry does
not repeat completed work.

Every tool call receives a stable idempotency key derived from the run and
Pi tool-call identifiers. A separate heartbeat renews the occurrence lease
while model or tool calls are in flight. Cancellation, ownership fencing, and
per-call timeouts are checked between turns and calls. Provider packages are
imported explicitly and tested in the deployed bundle because lazy imports and
output tracing are the main Pi-specific deployment risk.

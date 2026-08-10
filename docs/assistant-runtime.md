# Springroll assistant runtime

Status: implementation in progress. This document defines the boundary shared
by interactive chat, scheduled agents, the product UI, and Springroll's future
MCP server.

## Decision

Springroll application commands are the internal capability boundary. The
in-app assistant calls those commands in-process through typed tools; it does
not call Springroll through a loopback MCP connection.

The same command implementations may have several adapters:

- normal UI actions;
- tools available to the in-app assistant;
- scheduled task execution;
- the future local and hosted Springroll MCP servers.

An adapter may expose a narrower policy surface, but it must not reimplement
the command. External MCP callers, for example, may draft a task but may not
silently enable it or create credentials.

## Authorization philosophy

Springroll defaults to autonomous execution: an available capability runs
without a human-in-the-loop checkpoint. Risk metadata remains visible for
explanation, auditing, and policy configuration, but a `destructive` label does
not prescribe approval by itself. **Check first** is an explicit user policy,
not an application default.

The connection is the authority boundary for connector capabilities. Its
credentials and provider scopes are the hard technical ceiling; its per-tool
**Allow**, **Check first**, and **Off** settings are the product policy. A recipe
receives a deliberate subset of those tools and can never widen the connection
policy. Recipe memory is passive context rather than a capability, so saving a
safe bounded revision neither asks for approval nor grants new authority.

Native UI confirmations may still help a person avoid an accidental click, and
OAuth or credential entry still requires the person when the provider requires
it. Those interaction needs are distinct from an agent approval policy.

## Product interaction model

A conversation is Springroll's workspace for an ambiguous goal, not a
replacement for every button. Entry points such as **New recipe**, **New
integration**, **Diagnose this run**, and **Change this schedule** create or
resume a durable chat session with typed context:

- an intent such as `connection.create`, `task.create`, or `run.diagnose`;
- the UI origin that opened it;
- stable references to relevant connections, tasks, recipes, or runs;
- any durable proposal, ceremony, approval, or verification currently in
  progress.

That context is server-owned session state. It is not encoded only as prompt
text or URL query parameters, and the model must inspect referenced entities
through application tools before making claims about them.

Deterministic actions remain native controls. **Run now**, **Pause**,
**Approve**, **Delete**, OAuth redirects, API-key entry, and similar actions do
not need an extra model call merely because they appear in a conversation.
They call the same application command boundary, write an audit or workflow
result, and expose only a safe structured outcome to the conversation. The
assistant can then continue from that outcome. This keeps chat agent-first
without making the model a required hop for simple or security-sensitive UI.

The resulting ownership is:

- chat session: user goal, context references, messages, and model calls;
- workflow records: proposals, approvals, ceremonies, and resumable state;
- product entities: the authoritative connection, task, recipe, and run data;
- application commands: the only implementation of reads and mutations;
- adapters: native UI, in-process assistant tools, scheduled execution, and
  MCP exposure.

The first implementation is a transport-neutral application-tool registry. It
owns runtime validation, JSON-schema descriptors, normalized risk and approval
policy, result bounds, and the handlers that call existing connection, task,
run, model-configuration, and non-mutating proposal commands. Interactive chat
uses a thin AI SDK adapter over that registry. Connector mutations inherit the
connection's user-selected policy; native application actions default to direct
execution.

Operational inspection stays deliberately narrower than the product database.
Approval tools expose lifecycle, context, tool name, and risk but omit stored
inputs, reasons, and outputs. Interactive-chat usage tools return aggregate
calls, tokens, search/tool counts, and recorded/actual/estimated cost without
prompts or model content. One spend query combines the interactive
`model_calls` ledger with scheduled-run events and projected run rows without
double-counting. Application state returns only task, run,
configured-connection, and pending-approval counts. These same bounded
contracts are projected to chat and Springroll's MCP adapters.

Provider and connector clients may retry a retryable call within their bounded
invocation policy. Once a one-off **Run now** request reaches a failed terminal
run, Springroll never replays the whole agent automatically: earlier tool calls
may have changed remote state. A retryable one-off failure instead exposes an
explicit **Run again** action, which creates a new idempotent manual-run request.
Scheduled recipes proceed at their next cadence.

Recipe drafting through chat is a single inference boundary. After inspecting
the relevant live connection, the interactive agent submits a structured
title, prompt, cron schedule, timezone, connection ID, tool names, contract,
and catch-up policy. The host re-resolves the connection and live descriptors,
validates the schedule and selected tools, derives their effects, and returns a
durable review proposal. It does not invoke a second proposal model inside the
tool call. The older sentence-based `/api/tasks/propose` path remains available
to the direct composer while that UI is retired into the conversation flow.

Connected capability schemas stay lazy. The assistant first describes one
connection through the common `ToolSource` boundary, optionally filtering its
catalog, then may invoke a generic connection tool. The host opens and closes
the source session, supplies credentials outside model-visible input, bounds
the returned result, and enforces the connection's per-tool policy. Tools
marked **Check first** use the AI SDK approval flow; **Allow** tools run
directly regardless of risk label, and **Off** tools are unavailable. The
browser submits only the stored approval ID and decision; the host resumes the
exact server-persisted tool input. Raw MCP callers cannot assert that approval
context. This path is transport-neutral across shipped, MCP, and OpenAPI
sources.

Connector-provided capabilities enter through the existing `ToolSource`
boundary. Remote MCP, reviewed local MCP, OpenAPI, and shipped native tools all
normalize to `ToolDescriptor` and `ToolRisk`. Cross-connection search returns a
compact ranked catalog without schemas. Describe browses one source, while
activate resolves one to ten exact current tool names and returns only those
input schemas and risks to the conversation. Activation does not execute or
grant authority; every call still goes through connection policy enforcement.
Large catalogs are therefore discovered lazily rather than injecting every
schema into every turn.

Springroll dogfoods its MCP surface without making the production assistant
call the local app over loopback. Tool definitions, schemas, policy metadata,
and command handlers are authored once; the AI SDK and official MCP SDK
adapters project that shared contract. Tests exercise the in-process adapter,
the real stdio entrypoint, and authenticated streamable HTTP. Loopback latency
and another authentication boundary are not part of the normal in-app path.

Application capabilities also use progressive disclosure. Each durable chat
intent starts with a deterministic pack of at most eight relevant application
tools through AI SDK `activeTools`. General conversations start with the shared
registry's application-tool search, describe, and activate capabilities rather
than every command schema. Activation records exact registry names in the tool
result, and the following model step receives those real tools with their
original schemas and policies. This is the same catalog projected through MCP;
the in-app assistant uses it in process rather than through loopback transport.

Connector research follows the same autonomous tool loop as other assistant
work: there are no per-turn registry or source-call counters and duplicate
research calls are not rejected by a rationing policy. Shared per-result size
bounds still apply. Full bounded tool results remain in durable chat, but after
a successful proposal the terminal tool-free model step replaces large
connector evidence with compact 2,500-character representations and asks only
for a short explanation of the native review action.

### Local MCP development surfaces

`bun run --cwd app mcp:stdio` launches the app's MCP server over stdio without
starting the scheduler or browser UI. The normal app can expose streamable HTTP
at `/mcp` by starting it with a `SPRINGROLL_MCP_TOKEN`; that route is disabled
when the variable is absent. The endpoint accepts only loopback host/origin
requests and requires the token in an `Authorization: Bearer` header. The token
is not logged, returned in MCP data, or stored in SQLite.

These development surfaces expose only tools currently present in the shared
registry: bounded inspection, connection-tool discovery/read calls, and
non-mutating proposals. They do not yet expose task mutations, external
approvals, connection creation, autonomy changes, or run-anywhere controls.
One-click client configuration remains a later product surface.

## Conversation persistence

SQLite is the source of truth for local conversation history:

- `chat_sessions` owns title, archive state, timestamps, and the active turn;
  it also owns a validated intent, UI origin, stable entity references, and a
  context key used to resume the active workspace for an existing entity;
- `chat_messages` stores ordered, server-ID-assigned, versioned UI message
  parts and safe metadata;
- `chat_turns` records queued, streaming, waiting, completed, failed, and
  cancelled assistant work;
- `assistant_workflows` stores proposal payloads and their proposed,
  in-progress, waiting, completed, failed, or cancelled lifecycle separately
  from prose, linked to the source message/tool call and any resulting product
  entity;
- `model_calls` is the provider-neutral ledger for interactive model calls;
  scheduled-run usage is stored in `run_events` and projected onto `runs`.
  `SqliteSpendQuery` presents both stores as one aggregate accounting view,
  preferring a run-specific model-call ledger if one is added later and
  otherwise falling back from canonical events to legacy run projections.
  Sentence-based proposal generation does not yet write either ledger.

Recipe acceptance is a native workflow action: the server revalidates the
stored proposal payload, creates a paused task using the workflow ID as its
idempotency identity, records the resulting task reference and safe outcome,
and advances the session context. A browser cannot substitute a different
proposal in that action request. Workflows left in progress by a restart return
to a retryable waiting state.

Connector acceptance follows the same ownership boundary. The browser may
select only a variant that exists in the stored proposal; the server resolves
the manifest, prepares the connector, starts OAuth or requests a credential,
performs discovery and the read-only probe, and records only safe prepared,
retryable, or connected state. Researched proposals retain their validated,
secret-free manifest in durable workflow data so acceptance does not depend on
an in-memory registry result. OAuth callbacks advance the originating workflow
directly. API keys use a credential-only request and pass from the host API to
the credential store and connector call without entering the workflow payload,
chat history, model context, response body, or SQLite.

When the official MCP Registry has no compatible provider-operated remote,
the same conversation may research an official local npm MCP. The agent uses
live web search and direct source fetch, then submits only secret-free install
evidence. The host independently resolves npm's current exact version and
requires its repository metadata to match the cited source before recording a
durable `package-verified` proposal. The proposal tool uses flat credential
metadata (`credentialKind`, environment-variable name, and placeholder) so no
secret-shaped value or ambiguous nested schema is sent through the model.
The proposal also retains reviewed non-secret package arguments and displays
the exact pinned `npx` command. MCP-specific login instructions win over
deprecated or unrelated general-CLI credential paths.
Registry misses and other intermediate acquisition outcomes remain ordinary
tool progress. Only a validated `ready` proposal becomes a durable workflow or
native review card, so a successful local fallback does not leave a misleading
"not verified" warning above it.
MCP initialization plus `tools/list` is reported as connected with live tools
discovered, not as credential-tested. The tested state requires a later safe
read call that exercises the provider account.

Durable UI messages are validated before storage and again before conversion
to AI SDK model messages. Provider-native conversation IDs may be cached as an
optimization, but they are not the source of truth. Raw reasoning, transient
text deltas, credentials, and unbounded tool results are not durable message
content.

The server assigns IDs and remains authoritative for persistence, model and
connection selection, tools, approvals, and policy. Client disconnects do not
implicitly cancel paid work: the server consumes the active model stream,
persists completed boundaries, and lets clients replay or reconnect.

The first server boundary is now available under `/api/chats`: clients create
or list sessions, enter or resume a typed conversation workspace, reload a
session with its durable messages and usage, update context after a reviewed
workflow transition, archive a session, and post one new user message to
`/api/chats/:id/messages`. The message endpoint loads history and session
context from SQLite rather than accepting client-owned history and returns an
AI SDK UI-message SSE stream. The React `useChat` surface sends only the newest
optimistic user message, replaces it with server-assigned durable history after
completion, and polls a turn that is still running after reload. Connection
and recipe proposals render as validated native cards. Interactive connector
mutations render as native approval cards and extend the same durable assistant
message after approve or deny. Scheduled runs use the same policy and ledger:
they pause only when the model proposes an exact consequential call, then
resume from a sanitized durable model-message checkpoint after approve or deny.

## AI SDK boundary

Springroll continues to use AI SDK 7 `ToolLoopAgent` for the interactive agent
loop. AI SDK UI messages are the display/history representation; they are
validated and converted to model messages at invocation time. Typed UI stream
parts carry text, sources, tool state, proposals, approvals, and safe ceremony
state.

Interactive and scheduled work override AI SDK's default fixed step-count stop.
A turn ends when the model returns a terminal answer, waits for an exceptional
approval, is cancelled, fails, or completes a native proposal. Springroll does
not ration searches, fetches, SQL calls, connector calls, total tool calls, or
model turns, and it does not inject host bookkeeping into model instructions.

Context management stays behind the runner boundary. Host and MCP results are
trimmed to 50,000 characters per call before model ingestion. Web research uses
one shared contract in interactive chat and scheduled runs: search returns at
most five ranked URLs with short query-relevant summaries, and the model reads
only promising pages with a stated focus and a default 4,000-character budget.
With a configured Exa key, focused reads use Exa Contents highlights; otherwise
Springroll extracts focused text directly and also uses that path if the reader
fails. Unfocused reads remain available when a genuinely complete page is
needed. Connector validation never treats reader output as authority: the host
re-fetches provider-owned evidence directly before accepting a manifest.

After the first exact page read, superseded search payloads become 1,500-character
source ledgers; after later reads, older page evidence becomes 2,500-character
ledgers while the newest read remains intact. The same compaction runs before
every interactive and scheduled model step. A generic fallback still compacts
older tool results once accumulated evidence exceeds 120,000 characters while
protecting the most recent 100,000 characters. Approval continuations are
compacted before persistence instead of failing at the former 512 KB boundary.

Two deliberately generous emergency fuses protect a runaway process rather
than shape normal work: ten minutes of active execution and two million
cumulative model-input tokens. If either is reached, tools are disabled for one
truthful final response. A compacted checkpoint has a separate 5 MB emergency
storage limit. These safeguards are not presented as a planning budget and do
not vary by connector or tool type.

Interactive AI SDK usage callbacks feed `model_calls`; UI message metadata is a
projection, not the accounting source of truth. Scheduled-run callbacks feed
usage events and terminal aggregates on `runs`. A single spend query now reads
both paths, using run events for per-turn calls and usage and the projected run
row only for older eventless records. Its recorded fields include provider,
model, billing mode, pricing revision, token classes, provider-reported or
estimated cost, hosted-tool usage, timing, finish reason, and failure state when
known.

## Recipe knowledge

A recipe keeps its human-authored instructions separate from a living notes
document: bounded, versioned Markdown that runs revise as they learn. Notes
are passive, optional context. The run system prompt reminds the model the
document exists; during a useful run it may call the recipe-scoped
`update_task_notes` tool with a complete revised document containing reusable
definitions, source-selection rules, interpretation guidance, and recurring
failure lessons; current results and facts that should be fetched fresh do
not qualify.

The revision is capped at 32,000 characters, checked for common credential,
raw-PII, and unbounded-output shapes, and linked to its source run. A valid
revision becomes the active version immediately and supersedes the previous
one — there are only two statuses, active (`ready`) and `superseded` history;
no human-review checkpoint exists. Later scheduled runs
receive it as durable context and are told not to redefine business meaning
silently, while live connector schema and data remain authoritative. The
recipe page renders the document and provenance for inspection. The document
is prose rather than a workflow DSL: new recipe needs do not require new
orchestration fields, migrations, or UI controls.

Runs also receive bounded status and summary context for the three most recent
runs of that recipe. Raw transcripts, database rows, credentials, and prior tool
output are not replayed. When those summaries are insufficient, one
recipe-scoped history tool can list up to ten older runs or retrieve one
selected prior report, capped at 12,000 characters. It cannot read another
recipe's history.

Recipe knowledge is guidance, not authorization. Authorization comes from the
connections and tools the person deliberately enables for the recipe.

## Approval and credentials

Connecting a service and enabling a recipe authorizes the tools allowed by that
connection. A durable approval is created only when the user has configured the
specific connector tool as **Check first**. AI SDK approval requests are mapped
to Springroll's connector policy and resumed only after the stored decision is
applied. Chat
approval IDs, exact non-secret inputs, decisions, and reasons survive refresh
and restart. A separate transport-neutral approval ledger records risk,
pending/approved/denied state, execution start, safe completion state, and an
explicit ambiguous outcome when Springroll restarts during execution; chat UI
parts remain the presentation/checkpoint format rather than the audit source.
Scheduled runs persist only the model messages needed for continuation, with
reasoning and provider metadata removed. A restart before execution can safely
continue the approved call; a restart after execution begins marks the run for
attention with an ambiguous remote outcome and never retries the call.

OAuth, API-key entry, account selection, and local-package review are
host-controlled ceremonies. The chat receives only safe outcomes such as
connected, declined, expired, failed, or retryable. Secret values never become
message content, model input, tool input/output, event payload, log data, or
SQLite state.

## First vertical slices

1. Connect an unfamiliar service. The assistant researches official sources,
   proposes verified install/auth metadata, pauses for review and credentials,
   performs live discovery or a curated safe API probe, diagnoses failures,
   and continues the same session.
2. Create and operate a task. The assistant inspects real connected
   capabilities, creates an inactive proposal, confirms schedule/tools/model
   and autonomy, then can run, stop, explain, or revise it through the same
   application tools.
3. Expose the safe subset externally. The local MCP server wraps the shared
   application-tool registry after the internal command and approval contracts
   are stable.

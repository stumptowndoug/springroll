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
uses a thin AI SDK adapter over that registry. Consequential mutation tools
will remain proposal- and approval-gated so adding ordinary inspection does not
accidentally broaden write authority.

Connected capability schemas stay lazy. The assistant first describes one
connection through the common `ToolSource` boundary, optionally filtering its
catalog, then may invoke a generic connection tool only when Springroll's
normalized `ToolRisk.effect` is explicitly `read`. The host opens and closes
the source session, supplies credentials outside model-visible input, bounds
the returned result, and rejects write or destructive calls until durable
approval exists. This path is transport-neutral across shipped, MCP, and
OpenAPI sources.

Connector-provided capabilities enter through the existing `ToolSource`
boundary. Remote MCP, reviewed local MCP, OpenAPI, and shipped native tools all
normalize to `ToolDescriptor` and `ToolRisk`. The local assistant can search,
describe, and activate connected tools under the same policy without a
provider-specific wrapper. Large catalogs are discovered lazily rather than
injecting every schema into every turn.

Springroll dogfoods its MCP surface without making the production assistant
call the local app over loopback. Tool definitions, schemas, policy metadata,
and command handlers are authored once; the AI SDK and official MCP SDK
adapters project that shared contract. Tests exercise the in-process adapter,
the real stdio entrypoint, and authenticated streamable HTTP. Loopback latency
and another authentication boundary are not part of the normal in-app path.

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
- `model_calls` is a provider-neutral usage ledger shared by chat, proposals,
  and scheduled runs.

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
and recipe proposals now render as validated native cards; broader durable
approval parts remain a later slice.

## AI SDK boundary

Springroll continues to use AI SDK 7 `ToolLoopAgent` for the interactive agent
loop. AI SDK UI messages are the display/history representation; they are
validated and converted to model messages at invocation time. Typed UI stream
parts carry text, sources, tool state, proposals, approvals, and safe ceremony
state.

AI SDK usage callbacks feed `model_calls`; UI message metadata is a projection,
not the accounting source of truth. Every model call records provider, model,
billing mode, pricing revision, token classes, provider-reported or estimated
cost, hosted-tool usage, timing, finish reason, and failure state when known.

## Approval and credentials

Read-only application tools may run automatically when policy allows. Writes
are proposal-first, and destructive or otherwise consequential calls require a
durable approval. AI SDK approval requests are mapped to Springroll's existing
tool-risk policy and resumed only after the stored decision is applied.

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

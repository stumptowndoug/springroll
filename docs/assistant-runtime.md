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

Connector-provided capabilities enter through the existing `ToolSource`
boundary. Remote MCP, reviewed local MCP, OpenAPI, and shipped native tools all
normalize to `ToolDescriptor` and `ToolRisk`. The local assistant can search,
describe, and activate connected tools under the same policy without a
provider-specific wrapper. Large catalogs are discovered lazily rather than
injecting every schema into every turn.

## Conversation persistence

SQLite is the source of truth for local conversation history:

- `chat_sessions` owns title, archive state, timestamps, and the active turn;
- `chat_messages` stores ordered, server-ID-assigned, versioned UI message
  parts and safe metadata;
- `chat_turns` records queued, streaming, waiting, completed, failed, and
  cancelled assistant work;
- `model_calls` is a provider-neutral usage ledger shared by chat, proposals,
  and scheduled runs.

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
or list sessions, reload a session with its durable messages and usage, archive
a session, and post one new user message to `/api/chats/:id/messages`. The
message endpoint loads history from SQLite rather than accepting client-owned
history and returns an AI SDK UI-message SSE stream. React `useChat`, typed
proposal/approval parts, and the visual chat surface remain later slices.

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

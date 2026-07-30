# Integration runtime decision

## Decision

Use direct MCP through the Vercel AI SDK as the standard connector boundary.
Keep native TypeScript tools behind the same kernel interface. Aggregation
providers may implement that interface later, but are not architectural
dependencies.

The first launch connections are Neon through remote MCP and a first-party
read-only Gmail connector. Hacker News remains the no-auth acceptance and
development connector.

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

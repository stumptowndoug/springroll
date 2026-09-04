# Integration runtime decision

## Decision

Use direct MCP through the Vercel AI SDK as the standard connector boundary.
Keep native TypeScript tools behind the same kernel interface. Aggregation
providers may implement that interface later, but are not architectural
dependencies.

The first launch proof is Neon through remote MCP followed by Gmail through a
curated native adapter over the production Gmail REST API once Springroll's
OAuth client is registered. Hacker News remains the no-auth acceptance and
development connector. General public-web tasks use a Web capability with
OpenRouter's provider-executed search tool and a bounded first-party URL
reader; they must not be silently rewritten as Hacker News tasks.

## Curated one-click catalog

The catalog favors provider-operated remote MCP endpoints over a broad proxy
marketplace. The first ready MCP set is Neon, GitHub, Atlassian/Jira, Linear,
Notion, and Stripe. GitHub uses its remote server's one-click OAuth path rather
than asking people to create a personal access token. Linear uses the official
read-write MCP endpoint.

Gmail, Google Calendar, and Google Drive are Springroll-maintained native
connectors over Google's stable APIs, following Grok's built-in Google rail:
separate connectors, one Springroll-owned OAuth client, and a read-then-write
permission ladder. They become actionable when that Google client is present;
the customer sees only Sign in with Google and can add independent accounts.
Slack remains on Slack's official MCP server but stays unavailable until
Springroll's public desktop Slack app is registered. Slack does not support
dynamic client registration, but its PKCE flow lets Springroll exchange and
refresh tokens without shipping a client secret. Operator steps live in
`docs/one-click-connectors.md`.

The Integrations tab separates installed account instances from the ranked
provider catalog. The standard catalog starts with Gmail, Google Calendar,
Google Drive, Outlook Mail & Calendar, OneDrive, Microsoft Teams, SharePoint,
Slack, GitHub, Jira, Linear, Notion, Salesforce, Stripe, and Neon. Microsoft
and Salesforce entries are part of this ranked set. The four Microsoft entries
are native Graph adapters that share one operator-owned Entra app while keeping
service consent and account instances independent. Salesforce remains a
discovery placeholder until Springroll supports its org-specific OAuth API
host; it must not imply that setup already works. Search covers names, providers,
descriptions, and capability tags. A persistent “Ask for an integration” path
hands any unlisted service, API, or MCP server to the existing researched setup
flow.

Catalog manifests describe providers, not accounts. A successful setup creates
an independently credentialed connection instance. OAuth providers can expose
“Add account,” and each instance has its own label, discovery result, tool
policies, audit history, reconnect/revoke lifecycle, and recipe pins. Existing
legacy `*-default` rows remain valid while additional accounts receive opaque
instance IDs.

## Runtime rules

- A task stores an exact allowlist of tools rather than exposing an entire
  server catalog to the model.
- Confirmation pins the tool input schema. A later schema change pauses the
  task for review instead of silently changing its authority.
- Every pinned tool has a curated risk classification and approval policy.
  MCP annotations are inputs to review, not trusted enforcement.
- Every connection declares whether it is available locally, hosted, or in
  both locations.
- Remote-capable transport and hosted credential availability are separate.
  Credentialed connections remain local until the user promotes that exact
  account to the authenticated hosted vault; disconnect, removal, and explicit
  demotion revoke the hosted copy before changing the connection status.
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
2. `AiSdkAgentRunner` uses that connection to run the provider-neutral agent
   loop.
3. A run event sink persists the provider-neutral record while the run is in
   progress.

AI SDK `ToolLoopAgent` is the product runner for both the local app and CLI.
They invoke the same Springroll runner contract with different storage and
credential adapters. Springroll has one agent loop; alternate CLI programs are
not agent runtimes.

A future Codex, Claude, or other local CLI integration may be exposed as a
separately permissioned application tool. AI SDK remains responsible for
deciding when to call it, Springroll supplies its bounded input and execution
policy, and the CLI adapter returns a normal tool result. CLI authentication,
process lifecycle, cancellation, output bounds, and cost attribution belong to
that adapter rather than to the model-provider runtime.

Native and MCP tools run through `AiSdkAgentRunner`.
Provider-hosted web tools remain covered as compatibility adapters, but normal
scheduled and chat research prefers Springroll's portable Exa tools even when
the selected model is on OpenRouter. Portable search returns Exa's compact,
extractive highlights rather than partial full-page text. Live searches force a
fresh crawl, recent searches accept a cache no older than 24 hours, and stable
research uses normal cache fallback. Live queries are dated from the
authoritative host clock, and direct origin fetch remains available when the
model needs deeper or authoritative verification. Provider-hosted search is not
selected again until its freshness controls and mixed-tool behavior are
verified. The task, run result, policy, and event contracts remain shared.

Authentication belongs to model connections, not transcripts. API keys,
OAuth access tokens, refresh tokens, and provider account identifiers must
never appear in run events. Local credentials remain behind Keychain-backed
credential references. A provider adapter may resolve or refresh credentials
for each model call without changing the task, tool, or persistence contracts.
The host-neutral `HostedCredentialVault` addresses every secret by authenticated
Springroll account plus connection-specific credential reference. Plaintext is
never written to SQLite or actor state. Multiple Gmail accounts therefore have
independent promotion, refresh, and revocation lifecycles.

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

OpenRouter and direct API providers must produce the same lifecycle, message,
tool, usage, and failure events even when provider-specific metadata differs.

## Hosted execution

Hosted runs use the same `AgentRunner` contract on portable Node compute.
Turso supplies durable task, run, event, schedule, and credential-reference
storage. Managed Inngest owns only durable timing, retries, step checkpoints,
cancellation, and operational observability.

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
6. The selected product runner performs model turns and tool calls in
   retry-safe steps.
7. Each completed boundary appends canonical Springroll events to Turso and
   updates the run summary.

Inngest's event history is operational infrastructure, not the product record.
Turso remains the source used by the Springroll UI, synchronization, local
execution, exports, and future non-Inngest workers.

For the first hosted proof, a complete short AI SDK run may execute in one
durable step. Before enabling side-effecting or reliably multi-minute tasks,
split execution at model-turn and tool-call boundaries. Reconstruct the model
state from persisted messages after each boundary so a retry does not repeat
completed work.

Every tool call receives a stable idempotency key derived from the run and
AI SDK tool-call identifiers. A separate heartbeat renews the occurrence lease
while model or tool calls are in flight. Cancellation, ownership fencing, and
per-call timeouts are checked between turns and calls. Provider packages are
imported explicitly and tested in the deployed bundle.

# Connector manifests — integrations as installable data

Status: implementation in progress. Simplified 2026-08-03 to follow the
directory + protocol-discovery pattern used by Claude and ChatGPT.

Companion to `integration-runtime.md` (kernel/runtime rules) and the product
brief (`scheduled-agent-app-brief.md`, secrets and where-it-runs).

## Product model

Connections live in one catalog. Small labels explain how each one works:

- **MCP** — a hosted MCP server.
- **Local** — a reviewed MCP package running on this Mac.
- **API** — a small HTTP adapter summarized from documentation or derived from
  OpenAPI.
- **Custom** — supplied by the user rather than Springroll's directory.

Web search belongs in this catalog as a built-in connection, not as a separate
top-level integration category. Models remain separate because they choose the
inference engine; connections describe the capabilities that engine can use.

Each manifest may carry up to six normalized capability tags such as `search`,
`email`, `database`, `planning`, or `analytics`. Curated manifests author these
directly, researched manifests receive host-validated agent suggestions, and
legacy manifests get conservative name/description inference at read time.
Tags organize and filter the catalog; transport labels such as MCP, API, and
Local continue to describe implementation rather than user intent.

These labels are useful context, not separate navigation. The normal path is
still agent-first: describe what to connect, review the verified result, then
sign in or paste one key. An advanced escape hatch accepts a known remote MCP
URL or standard client configuration directly. API setup accepts ordinary
documentation plus the user's goal; OpenAPI is an accelerator, not a
prerequisite.

## The important boundary

For MCP, the manifest describes **how to install and authenticate the
connection**; it does not reproduce the runtime contract. For an ordinary HTTP
API, the accepted manifest is the small runtime adapter reviewed by the user.

The normal input is intentionally small and goal-shaped. The user describes
what they want and supplies a known MCP URL/configuration or ordinary API
documentation when they have it. The agent owns the flexible authoring work:

- identify the intended provider and prefer official sources;
- research missing setup details and populate the generic MCP or API proposal;
- choose a harmless, goal-relevant verification read when the protocol does
  not provide its own discovery handshake;
- explain only the authentication steps the user can actually perform; and
- carry the connected capability into the requested recipe when enough intent
  is already present.

The host owns facts and enforcement rather than provider-specific conversation
scripts. It reports whether a connector is actually connectable, validates
URLs, packages, documented operations, effects, and evidence, keeps secrets out
of model context, executes discovery and probes, and persists only an accepted
definition. A deterministic policy stop is appropriate when a known app
prerequisite makes setup impossible—for example, a missing Springroll OAuth
client registration. In that case the agent gives one concise explanation and
does not ask the user for documentation, credentials, or another server URL.

For MCP, the running server is the source of truth:

1. initialize the connection;
2. authenticate when required;
3. call `tools/list`;
4. normalize the returned names, descriptions, schemas, and annotations to
   `ToolDescriptor`;
5. let the user or task proposal select tools from that observed catalog;
6. pin the selected input-schema hashes through the existing execution layer.

Springroll must not generate tool names, guessed inputs, or provider-specific
"probe" calls from documentation. MCP already provides a standard connection
and discovery protocol. This removes the failure mode where a provider renames
a tool and the connection becomes impossible to establish.

Ordinary APIs take the opposite path: Springroll reads the supplied
documentation, summarizes only the operations needed for the user's goal, and
saves their methods, paths, input mapping, and effects. Later recipe runs use
that accepted definition deterministically and do not reread documentation.

## Kernel shape

```ts
interface ConnectorManifest {
  id: string;
  name: string;
  blurb: string;
  logoSvg?: string;
  logoUrl?: string;
  logoSource?: "github-registry" | "github-repository" | "provider";
  tags?: string[]; // up to six normalized capability tags
  transport:
    | { kind: "mcp-remote"; endpoint: string }
    | {
        kind: "mcp-local";
        package: {
          registry: "npm";
          name: string;
          version: string; // exact version only
        };
        args?: string[];
      }
    | { kind: "openapi"; specUrl: string; baseUrl: string }
    | {
        kind: "http-api";
        baseUrl: string;
        operations: DocumentedApiOperation[];
      };
  credential:
    | { kind: "oauth" }
    | {
        kind: "api-key";
        placeholder: string;
        keyCreationUrl?: string;
        header?: string; // hosted MCP / OpenAPI / documented API
        query?: string;  // documented API only
        env?: string;    // local MCP only
      }
    | { kind: "none" };
  probe?: { tool: string; input: JsonObject }; // explicit safe API test only
  tools?: {
    allow?: string[];
    risk?: Record<string, Partial<ToolRisk>>;
  };
}
```

`availableIn` remains derived:

- `mcp-remote`, `openapi`, and `http-api` → local + hosted;
- `mcp-local` → local only.

The optional tool policy is applied to names actually returned by the source.
Curated manifests may narrow or correct a live catalog, but they do not need to
author one in advance.

## Connection lifecycle

Disconnecting and removing are intentionally different operations:

- **Disconnect / Sign out / Disable** deletes Springroll's saved credential and
  prevents the connector's tools from being opened. The installed manifest and
  last discovered tool metadata remain, so the card stays visible and can be
  reconnected without researching the provider again.
- **Remove connector** deletes a non-curated installed manifest and its
  connection record after confirmation. Removal is refused while a recipe
  still pins one of its tools; Springroll never silently edits those recipes.
- Curated directory entries cannot be removed from the directory. Signing out
  returns them to their normal not-connected catalog state.

Springroll's OAuth disconnect is local sign-out: it removes the local token from
Keychain. Provider-side grant revocation is a separate ceremony when a provider
supports it and must not be implied by the generic action.

## Connector marks

Connector research resolves an exact service or operator match against the
pinned Simple Icons catalog. Springroll reads the packaged SVG host-side,
sanitizes it, and converts its ink to `currentColor` before storing it in the
secret-free manifest. The assistant never authors or returns SVG markup.

Exact matching is deliberate: when no verified mark exists, the UI displays a
theme-aware initial instead of guessing a visually plausible but incorrect
brand. Curated connectors use the same resolver. Full-color or provider-hosted
assets can be added later only with equivalent sanitization and provenance.

## Installation lanes

### Curated and Registry-backed remote MCP

Featured cards remain intentionally small. For the long tail, the agent queries
the official MCP Registry and verifies that the endpoint is provider-operated.
The Registry supplies publisher, endpoint, version, and source provenance.
OAuth metadata supplies the authorization endpoints. No model-generated tool
contract is accepted.

After review, the user selects Connect, completes OAuth, and Springroll reads
the live tool catalog. Servers without dynamic client registration require a
pre-registered Springroll client or user-supplied client configuration; they
must not silently fall back to an unrelated third-party host.

### Manual remote MCP

Users can provide a URL or a standard single-server MCP client configuration
containing:

- an HTTPS MCP endpoint (HTTP is allowed only for localhost development);
- an optional display name;
- OAuth, API key, or no authentication;
- an optional API-key header name.

Springroll validates and saves this as a Custom MCP manifest, then uses the same
authentication and live discovery path. The user is responsible for trusting
the supplied server. Configuration import is host-only and bypasses model
research. Embedded credential values are rejected; environment placeholders
may identify the authentication header, while the actual value is collected
separately.

### Reviewed local MCP packages

Local packages are the equivalent of Claude Desktop extensions. Springroll
accepts a structured, exact npm package identity and version—not an arbitrary
shell command. The host derives a shell-free `npx` invocation and communicates
over stdio.

API keys are read from `CredentialStore` at process launch and injected through
one declared environment variable. They never appear in manifest data, SQLite,
tool input, tool output, or run transcripts. Local packages run only on the Mac.

The agent may research a provider's official package or wrapper, but it must
verify the package publisher/repository and present the executable package for
explicit review before installation. Package discovery and update review are
acquisition concerns; tool discovery still comes from the running MCP server.
Required non-secret package arguments, such as Firebase's `mcp` subcommand,
are part of that reviewed launch definition and appear in the exact pinned
command shown to the user. Credential flags and values are never accepted as
package arguments.

The durable assistant implements that review boundary with a proposal tool,
not an arbitrary install command. After live web research, the agent submits
the service identity, npm package, official repository, credential environment
name, setup guidance, and citations. Springroll reads the package directly from
the npm registry, requires npm's repository to match the cited repository, and
pins the exact current version before it can render a review card. Credential
values are not valid proposal inputs. Accepting the card uses the existing
Keychain-backed local MCP ceremony and live `tools/list` discovery.
Research must use the package's MCP-specific authentication instructions. A
general CLI token is not inferred when the MCP performs its own login or uses
credentials already owned by the provider CLI.

### Direct APIs

The normal API input is a documentation URL and a sentence describing what the
user needs. The assistant extracts a bounded operation set: exact HTTP method
and path, concise description, input schema, path/query/body mapping, semantic
effect, authentication rail, and an optional harmless read test. Springroll
independently confirms that the documented API host appears in the supplied
source, validates the adapter, renders it for review, and persists it only after
acceptance.

The generic documented-API `ToolSource` executes only those saved operations,
keeps requests on the accepted base host, injects credentials host-side,
refuses redirects, bounds responses, and redacts credentials from results and
errors. This is authoring-time model assistance followed by deterministic
runtime execution.

Documented API keys may use exactly one provider-documented header or query
parameter. The credential field is omitted from the operation's model-visible
schema and parameter map; Springroll adds it only inside the host request. Every
operation, credential rail, and key-creation URL must be supported by inspected
provider-owned evidence. Third-party mirrors and aggregators cannot authorize a
saved adapter.

When a provider publishes an official OpenAPI 3.x document, Springroll can use
the generic OpenAPI `ToolSource`. It fetches and caches the spec, normalizes
operations, removes credential fields from tool input, and injects API keys
host-side at call time.

Unlike MCP, OpenAPI has no standard connection handshake. A curated API
manifest may therefore name one explicitly reviewed safe operation to verify a
credential. An agent may submit that operation only when official documentation
supports the exact read-only request; Springroll verifies that it is a live GET
operation, displays it in the native proposal, rejects credential-bearing probe
input, and runs it only after user acceptance. Without one, setup means
"configured" until the first real call proves the credential.

For OpenAPI, Springroll fetches the document independently, derives header
API-key or bearer authentication, normalizes the live operations, and keeps the
resulting secret-free manifest in the durable setup workflow. The Custom form
also accepts a known OpenAPI JSON URL. OpenAPI remains useful for exact schemas
but is never required when ordinary provider documentation describes the
needed request clearly.

Direct CLIs do not become unrestricted tools. They must be exposed through a
reviewed local MCP package or a Springroll-shipped wrapper so the normal schema,
risk, approval, and transcript boundaries still apply.

## Safety and persistence

The existing execution layer remains unchanged:

- `ToolDescriptor` normalizes every source;
- MCP annotations and curated overrides feed `ToolRisk`;
- absent risk information defaults conservatively;
- `PinnedTool.inputSchemaHash` detects later schema drift;
- enabled connections authorize their selected ordinary read and write tools;
- destructive actions retain an explicit approval boundary.

Connection metadata, install manifests, observed tool summaries, and pins live
in SQLite. Credentials remain in macOS Keychain and are resolved only at call or
local-process launch time. A future hosted runner receives explicit secret
references only after separate user consent.

## UI ceremony

1. A supplied MCP URL/config goes directly to host validation; an unknown MCP
   name uses the directory and documentation only to discover its config.
2. Springroll initializes MCP and gets the authoritative tools from
   `tools/list`.
3. A supplied API documentation URL opens a goal-scoped authoring conversation;
   Springroll summarizes a small operation set or derives it from OpenAPI.
4. The proposal shows endpoint/package, authentication, exact operations,
   effects, sources, and any harmless verification request.
5. The user approves, completes OAuth or a host-controlled key field, and
   Springroll performs the transport-appropriate basic test.
6. The card becomes connected; accepted tasks pin the discovered or authored
   schemas.

If discovery cannot find an MCP, the UI asks for its URL or client
configuration. If API authoring lacks enough documentation, it asks for the
missing request detail instead of requiring an OpenAPI document.

## Build order

1. Connector manifest validation and generic remote MCP/OpenAPI sources.
2. Persist manifests and render the connection catalog from data.
3. Curated starter directory and OAuth/Keychain ceremonies.
4. Registry-backed agent lookup plus live MCP tool discovery.
5. Direct remote-MCP URL/config import and visible transport/custom labels.
6. Reviewed local MCP package transport and package-research proposal flow.
7. Documentation-led HTTP API adapters with explicit safe-test semantics.
8. Optional OpenAPI acceleration and credential verification.
9. Hosted-runner CredentialStore split, per-location checks, and explicit run
   payloads.

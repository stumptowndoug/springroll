# Connector manifests — integrations as installable data

Status: implementation in progress. Simplified 2026-08-03 to follow the
directory + protocol-discovery pattern used by Claude and ChatGPT.

Companion to `integration-runtime.md` (kernel/runtime rules) and the product
brief (`scheduled-agent-app-brief.md`, secrets and where-it-runs).

## Product model

Connections live in one catalog. Small labels explain how each one works:

- **MCP** — a hosted MCP server.
- **Local** — a reviewed MCP package running on this Mac.
- **API** — a provider's official OpenAPI description.
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
URL directly.

## The important boundary

The manifest describes **how to install and authenticate a connection**. It
does not reproduce the connector's runtime contract.

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
    | { kind: "openapi"; specUrl: string; baseUrl: string };
  credential:
    | { kind: "oauth" }
    | {
        kind: "api-key";
        placeholder: string;
        keyCreationUrl?: string;
        header?: string; // hosted MCP / OpenAPI
        env?: string;    // local MCP only
      }
    | { kind: "none" };
  probe?: { tool: string; input: JsonObject }; // OpenAPI verification only
  tools?: {
    allow?: string[];
    risk?: Record<string, Partial<ToolRisk>>;
  };
}
```

`availableIn` remains derived:

- `mcp-remote` and `openapi` → local + hosted;
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

Advanced users can provide:

- an HTTPS MCP endpoint (HTTP is allowed only for localhost development);
- an optional display name;
- OAuth, API key, or no authentication;
- an optional API-key header name.

Springroll validates and saves this as a Custom MCP manifest, then uses the same
authentication and live discovery path. The user is responsible for trusting
the supplied server.

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

For official API fallback research, the agent supplies provider documentation
and the exact OpenAPI URL—not a generated runtime contract. Springroll fetches
the document independently, requires the documented server to remain on the
provider, derives header API-key or bearer authentication, normalizes the live
operations, and keeps the resulting secret-free manifest in the durable setup
workflow. The Custom form also accepts a known OpenAPI JSON URL and performs
the same inspection without claiming the credential was tested.

Direct CLIs do not become unrestricted tools. They must be exposed through a
reviewed local MCP package or a Springroll-shipped wrapper so the normal schema,
risk, approval, and transcript boundaries still apply.

## Safety and persistence

The existing execution layer remains unchanged:

- `ToolDescriptor` normalizes every source;
- MCP annotations and curated overrides feed `ToolRisk`;
- absent risk information defaults conservatively;
- `PinnedTool.inputSchemaHash` detects later schema drift;
- `PinnedTool.maxCallsPerRun` bounds each selected connector capability;
- destructive actions retain their normal approval policy.

Connection metadata, install manifests, observed tool summaries, and pins live
in SQLite. Credentials remain in macOS Keychain and are resolved only at call or
local-process launch time. A future hosted runner receives explicit secret
references only after separate user consent.

## UI ceremony

1. User describes the desired service or chooses a featured card.
2. Springroll checks curated entries, official Registry metadata, then official
   OpenAPI descriptions before reviewed local packages and manual setup.
3. The proposal shows operator, endpoint/package, transport label,
   authentication rail, and provenance.
4. User approves the connection definition.
5. Springroll opens OAuth or a host-controlled key field.
6. Springroll initializes the source and discovers the live tools.
7. The card becomes connected and shows the observed tool count and risks.
8. Task proposals choose from those tools; accepted tasks pin their schemas.

If research cannot find a trustworthy option, the UI offers manual remote MCP
or OpenAPI input instead of guessing. Local package and OpenAPI fallbacks remain
reviewable installation proposals, not generated runtime contracts.

## Build order

1. Connector manifest validation and generic remote MCP/OpenAPI sources.
2. Persist manifests and render the connection catalog from data.
3. Curated starter directory and OAuth/Keychain ceremonies.
4. Registry-backed agent lookup plus live MCP tool discovery.
5. Advanced manual remote-MCP URL input and visible transport/custom labels.
6. Reviewed local MCP package transport and package-research proposal flow.
7. Official OpenAPI fallback research with explicit credential-verification
   semantics.
8. Hosted-runner CredentialStore split, per-location checks, and explicit run
   payloads.

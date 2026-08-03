# Connector manifests — integrations as data

Status: design accepted 2026-08-03, not yet implemented.
Companion to `integration-runtime.md` (kernel/runtime rules) and the
brief (`scheduled-agent-app-brief.md`, secrets and where-it-runs).

## Vision

Integrations are essential to the app and must feel flawless. The end-user
experience mirrors recipes: one **"Add integration"** button opens a chat
composer, the user describes what they want ("create a Gmail connection"),
and the AI researches, ranks options (MCP first, plain API as fallback),
and returns a reviewable proposal card. Accepting it creates the
connection, runs the credential ceremony, verifies with a probe, and pins
the tools.

The end goal is absolute simplicity: whatever the transport underneath,
the user only ever performs one of **two ceremonies** — sign in (OAuth) or
paste a key.

## What the kernel already provides

The execution layer is done and should not change:

- `ToolDescriptor` — name + input schema + output schema. Every transport
  normalizes to this one shape (same thesis as executor.sh's gateway).
- `ToolRisk` (read/write/destructive, openWorld, idempotent) +
  `ApprovalPolicy` — semantic safety carried per tool; destructive tools
  default to `before_call`.
- `PinnedTool` with `inputSchemaHash` — per-recipe pins persisted in the
  `task_tools` table; a server changing a schema under us invalidates the
  pin instead of silently running.
- `Connection` rows in SQLite: `{id, source_id, credential_ref,
  available_in, name, config}`. Secrets are **never** in the DB —
  `credential_ref` resolves against macOS Keychain at call time.
- `ToolSource.open({connection, location})` — location already threads
  through the kernel.

The gap is the **acquisition layer**: today a new integration means
shipping a hand-written `ToolSource` in TypeScript. The card catalog on
the Integrations pages is hardcoded in `application.ts`. An AI cannot
safely author code at runtime — but it can author **data**.

## The core move: behavior becomes data

Ship **one generic ToolSource per transport**. Everything
integration-specific becomes a declarative manifest:

```ts
interface ConnectorManifest {
  id: string;
  name: string;
  blurb: string;            // card copy: "<b>lead</b> — sentence"
  logoSvg?: string;         // monochrome currentColor mark
  transport:
    | { kind: "mcp-remote"; endpoint: string }
    | { kind: "mcp-local"; command: string[] }      // later
    | { kind: "openapi"; specUrl: string; baseUrl: string };
  credential:
    | { kind: "oauth" }                              // MCP auth spec
    | { kind: "api-key"; placeholder: string;
        keyCreationUrl: string; header?: string }
    | { kind: "none" };
  probe: { tool: string; input: JsonObject };        // cheap read-only call
  tools?: {                                          // allowlist + overrides
    allow: string[];
    risk?: Record<string, Partial<ToolRisk>>;
  };
  // availableIn is DERIVED, not authored:
  //   mcp-remote / openapi → local + cloud; mcp-local → local only
}
```

Rules that make this work:

1. **Two rails only.** If a proposed integration cannot be expressed as
   OAuth or api-key, the flow rejects it rather than inventing a third
   ceremony. CLIs are wrapped as `mcp-local` stdio servers and still land
   on one of the two rails (env-var key or none).
2. **Manifests are validated, diffed, and revocable.** A manifest can be
   rendered on a proposal card, reviewed, and deleted. Generated code
   cannot, cheaply. A `native` (code-backed) template remains as the
   escape hatch for the long tail, but it ships with the app, not from
   the AI.
3. **Tool allowlists are a feature.** A Gmail connection should expose ~6
   curated tools, not the 40 a server advertises (context economy — the
   executor.sh lesson). The card shows "6 tools" proudly.

## Registry above the AI

The failure mode of "AI researches and finds an MCP server" is handing a
Gmail OAuth grant to a random third-party server. Mitigation: a small
**curated registry** of verified manifests shipped with the app (same
philosophy as the theme roster). Start with ~5: Gmail, GitHub, Notion,
Slack, Linear.

- The composer's research step prefers registry hits.
- Off-registry, AI-generated manifests are visibly badged
  **"unverified — review the tool list"** and show who operates the
  server (the trust line: "hosted by X").

## The chat flow

Reuses the recipe-proposal machinery:

1. User: "Create a gmail connection."
2. Agent: registry lookup first, web research second. Ranks MCP-first,
   API-fallback (portability reinforces this ordering — see below).
3. Proposal card (provider-card grammar): mark + name, tool list preview
   with risk dots, which rail ("Sign in with Google" / "needs an API key
   · get one ↗"), operator trust line, derived where-it-can-run.
4. Accept → manifest saved, credential ceremony (connect popover or OAuth
   redirect), **probe** fires, tools pinned. Card lands in the grid with
   footer telemetry ("Keychain · this Mac · 6 tools").

Closes an existing loop: recipe proposals ending in `needs_integration`
deep-link into this composer with the prompt pre-filled.

## Portability (Modal / Render / hosted runners)

Portability is a **computable property** of the manifest:

- `mcp-remote`, `openapi` → plain HTTPS, run identically from the Mac or
  a cloud runner.
- `mcp-local` → pinned `availableIn: ["local"]` by default (the CLI lives
  on the Mac). Matches the hesitation rule: Mac first, cloud covers.
- The where-it-runs gateway validates at enable time: a recipe set to
  Anywhere that pins a local-only connection is surfaced as a conflict in
  the consent sheet, not a 3 a.m. run failure.

Credentials are the real porting work:

- `CredentialStore` becomes an interface: Keychain locally, a cloud
  secret store (Modal Secrets / Render env groups / own encrypted store)
  hosted. Copy-on-consent, delete-on-disable — the Anywhere consent sheet
  is the ceremony's UI, already designed.
- OAuth tokens get the same treatment; hosting helps this rail (stable
  redirect URI).
- **Probes run per location.** "Works on this Mac" proves nothing about
  a cloud runner's egress or secret wiring. Footer telemetry extends:
  "Keychain · this Mac + cloud".

Runner contract: a run's payload is **explicit** — the run, the manifests
of its pinned connections, and references to consented secrets. Zero
ambient state. Any host that can execute that payload (Modal, Render,
Docker) is interchangeable, and the consent sheet is literally a
rendering of the payload.

## Storage

Three tiers, each in the right place:

| What | Where | Syncs to cloud? |
| --- | --- | --- |
| Registry manifests (curated) | shipped with app, like themes | n/a — ships everywhere |
| Accepted/generated manifests, connections, tool pins | SQLite → Turso | yes — not secrets |
| Credentials | Keychain → cloud secret store | only per Anywhere consent |

Schema direction: keep `connections` as the instance table; add an
`integration_manifests` table (definition) that connection rows
reference — mirroring the model-catalog vs provider-connection split.
`source_id` changes meaning from "which hand-written integration" to
"which transport".

## UI direction

If the two-rail rule holds, MCP-vs-API is implementation vocabulary and
should not be navigation. End state: the **MCPs and Custom tabs collapse
into one Connections tab** — a grid of provider-cards (grammar already
shipped: mark tile, bold-lead blurb, hairline footer, connect popover) —
plus the "Add integration" composer button. Models and Web Search stay
separate because they are routing decisions, not connections. Neon
becomes an ordinary card.

## Build order

1. `ConnectorManifest` type + validation in the kernel; generic `openapi`
   ToolSource (the only missing transport); make `mcp-remote`
   config-driven off the manifest.
2. `integration_manifests` table + migration; connection rows reference
   manifests; catalog cards render from DB + registry instead of the
   hardcoded list.
3. Registry file with ~5 curated manifests; cards + probe-and-pin
   ceremony UI on a unified Connections tab.
4. "Add integration" composer reusing the proposal generator (registry
   lookup → research → proposal card → accept).
5. Hosted-runner groundwork: `CredentialStore` interface split,
   per-location probes, explicit run payload. (Can trail the rest.)

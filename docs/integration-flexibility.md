# Integration flexibility: leave room for custom behavior

Status: proposed direction, 2026-09-05. Documentation only; no new adapter
runtime or installation capability is implemented by this proposal.

## Intent

A user should be able to connect a service even when its API does not fit a
perfect standard. Prefer the existing simple paths, but retain a route to
custom behavior rather than continually expanding a manifest language to
express arbitrary programs. General app customization remains
[a future option](future-customization.md).

## Existing foundation

Springroll already has several integration paths:

- Remote MCP, with tools discovered from the running server.
- Reviewed local MCP packages, with a pinned package and launch definition.
- OpenAPI-backed HTTP operations.
- Small saved HTTP adapters authored from ordinary API documentation; OpenAPI
  is not required.
- Springroll-maintained native tools for behavior requiring application code.

See [connector manifests](connector-manifests.md),
[integration dogfood evidence](integration-dogfood.md), and the current
[source wiring](../app/src/server/sources.ts). The older
[runtime decision](integration-runtime.md) still describes arbitrary stdio
servers as outside v1; the later reviewed local-package path is narrower than
an unrestricted command launcher.

These sources converge on the kernel's `ToolSource` boundary. That is the
useful seam to preserve: recipes and the agent should consume tools without
needing a different execution system for each provider.

## Where more flexibility may be needed

Examples to evaluate against real requests, rather than assumed missing
features: signed requests or unusual authentication; pagination requiring
several calls; asynchronous export jobs with polling and download; multipart
uploads; provider SDKs; local CLI access; and response normalization that cannot
be expressed by a simple request mapping.

Some cases deserve a small reusable improvement to the HTTP adapter. Others
are inherently code. Do not require every provider quirk to become another
special case in the manifest schema or a model-generated sequence reconstructed
on every scheduled run.

## Options, in preferred order

| Path | Use when | Limitation |
| --- | --- | --- |
| Existing MCP or HTTP adapter | The service fits supported discovery, auth, and request mappings. | Limited by that transport and adapter's supported behavior. |
| Improve the generic adapter | Several providers need the same bounded feature. | Avoid turning configuration into a programming language. |
| Custom MCP implementation | Custom code can expose a normal MCP tool contract. | Deployment/package setup and credential ownership still need handling; today's local install flow is not an arbitrary-folder loader. |
| Local code adapter behind `ToolSource` | A real request remains awkward through the other paths. | Requires artifact loading, execution boundaries, versioning, and recovery to be designed. |

The recommendation is to preserve the last option, not build it immediately.
A Springroll-maintained native adapter can prove the contract before exposing
agent-authored code to users. A full frontend plugin SDK is unnecessary.

## Proposed minimum contract for a code adapter

This is a design checklist, not an already-supported manifest format.

- **Identity:** stable adapter ID, exact version or content digest, entry point,
  and compatible runtime version. Store personal artifacts outside the app bundle.
- **Tools:** stable names, descriptions, input schemas, and declared effects,
  exposed through the normal `ToolSource` session. Keep account instances
  separate from the adapter definition.
- **Host services:** connection-scoped credential access, bounded HTTP access,
  cancellation, timeouts, and redacted logs. Make process and filesystem access
  explicit if needed rather than implicit in all adapters.
- **Execution location:** declare local or hosted support. Code portability does
  not imply that a credential is available on the hosted runner.
- **Lifecycle:** validate and test a candidate, activate a specific revision,
  disable it, and restore a previous revision. Define what happens to active
  runs before allowing replacement; never swap behavior midway through a run.
- **Persistence:** keep adapter settings and any durable state separate from
  code. If migrations are allowed, define their recovery limits explicitly.

Execution isolation remains an open decision. In-process JavaScript is trusted
code: a helper API cannot enforce network or filesystem limits if code can
bypass it. A subprocess improves crash containment but is not itself a security
sandbox. Choose an enforceable boundary or clearly declare a trusted local-code
mode before exposing this capability. Do not imply that existing MCP package
review or a schema validator establishes that boundary.

## Keep existing execution guarantees

Custom behavior should still use connection-specific credentials, selected tool
capabilities, configured approval policies, canonical run events, and normal
cancellation/error reporting. Installing an adapter must not silently grant all
its tools to existing recipes or grant access to other accounts.

Schema pins alone cannot detect changed behavior behind an unchanged schema.
Before supporting editable adapters, decide how recipes bind to implementation
revisions and how updates affect existing recipes. Broader authority should be
visible and require the corresponding authorization; routine compatible fixes
should not introduce an unnecessary approval on every execution.

Retry behavior also belongs in the contract. A multi-call export or write must
handle partial completion, idempotency where supported, and resumable state where
needed. Restoring code does not undo writes already made to an external service.

## A useful first experiment, when needed

Choose one requested integration that fails because of a specific limitation
in today's paths. Implement only that missing behavior behind the shared tool
boundary, initially as a maintained adapter or a custom MCP service.

Prove that it can be invoked from chat and a scheduled recipe, keeps secrets out
of transcripts, reports failures, cancels cleanly, and handles retries without
unintended duplicate writes. If evaluating editable code, also prove persistence
across app restart, revision replacement, recovery, and behavior when a recipe
references a disabled or unavailable revision.

Only then decide whether local agent authoring needs a new install path. The
eventual experience could be “connect this service” followed by Springroll
creating a durable adapter, testing it, and presenting the account setup and
capabilities. No plugin marketplace, custom UI, or whole-app rewrite is required.

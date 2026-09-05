# Codebase cleanup review — September 5, 2026

Follow-up: the eight fixes have since been implemented and merged. See `cleanup-branches-2026-09-05.md` for the integration handoff. The findings below describe the pre-fix review state.

Scope: targeted review of local HTTP boundaries, credentials, recipe execution, chat data loading, frontend delivery, and obsolete UI styles. This is not a penetration test or exhaustive dependency audit. No production fixes were made. Recipe card designs remain unapplied.

## Recommended order

### 1. Protect the main local HTTP API (high priority, security)

- Evidence: `app/src/server/http-app.ts:190` constructs the router without host/origin/authentication middleware. Bodyless mutation routes include run cancellation (`:223`) and starting recipes (`:502`). Loopback binding exists at `app/src/server.ts:616`, but request host/origin validation is separate.
- Isolated reproduction: a stubbed cancellation handler returned HTTP 200 with `Origin: https://untrusted.example`, both for a loopback request URL and a foreign-host request URL. No actual runs were changed. This confirms the server-side boundary gap, not an end-to-end browser exploit; browser local-network restrictions affect reachability.
- Proposed change: validate expected hosts and exact permitted origins; reject inappropriate cross-site requests; add a desktop/session authentication boundary where appropriate. Preserve explicit OAuth callback exceptions. The development MCP endpoint already contains useful boundary checks in `app/src/server/application-mcp.ts:200`.
- Tests: rejected foreign/null origins, unexpected hosts, permitted app requests, and OAuth callbacks.

### 2. Stop credential-bearing OpenAPI redirects (high priority, security)

- Evidence: `kernel/src/openapi-tool-source.ts:597` adds credentials, including custom API-key headers, then calls fetch at `:610` without redirect restrictions. Its default transport is native fetch (`:80`).
- Isolated reproduction: two ephemeral loopback servers on different ports showed native Bun fetch forwarding a synthetic `x-api-key` header across a redirect. No real credentials were used. Exposure requires a credential-bearing endpoint to redirect to another origin.
- Proposed change: use manual redirects and reject them, matching `kernel/src/documented-api-tool-source.ts:293`, or explicitly validate every redirect destination before attaching credentials.
- Tests: cross-origin redirects with custom headers and OAuth; redirect chains; no secret in errors.

### 3. Replace the SVG regex sanitizer (high priority, security hardening)

- Evidence: `app/src/server/provider-logos.ts` ends with `sanitizeProviderLogo`, which rejects several strings but is not a static-SVG allowlist. Both `<svg><style>body{display:none}</style></svg>` and an SVG link using `xlink:href` were accepted in an isolated check. The output is inserted into the app DOM in `app/src/client/springroll-app.tsx:2240`.
- Impact: the existing promise of no external references/static-only content is not enforced. Accepted style content can affect the surrounding page. This review did not demonstrate script execution. Network-refreshed logos are the relevant input boundary, not ordinary recipe text.
- Proposed change: use a strict parsed SVG element/attribute allowlist or serve logos as isolated images; reject styles, links, animation and external references unless explicitly required and safely handled.
- Tests: malicious and malformed SVG fixtures plus the actual bundled logos.

### 4. Close the recipe final-response error path (high priority, reliability)

- Evidence: `kernel/src/ai-sdk-agent-runner.ts:618` immediately throws initial stream errors. Report selection and synthesis/fallback occur later, starting around `:813`. Thus provider exceptions can bypass the fallback, unlike an empty successful stream.
- Impact: directly relevant to the earlier Groq “tool choice is none” failure: work may exist but the run still ends without a useful final report. The path is confirmed by code; the original live provider failure was not replayed.
- Proposed change: retain completed evidence and persist an explicitly incomplete host response on eligible failures. Only attempt model synthesis when remaining settings/safety budgets permit. Preserve genuine failed/cancelled status; never turn a fallback report into false success.
- Tests: provider rejection after successful tools; limits exhausted; failed synthesis; user cancellation; failures before any evidence.

### 5. Make deletion checks and conversation cleanup consistent (medium priority, correctness)

- Evidence: `app/src/server/http-app.ts:390` finds a task's runs by filtering `application.listRuns()`, but that method returns only the latest 100 runs globally (`app/src/server/application.ts:1283`). The HTTP handler deletes associated chats before `application.deleteTask()` performs its transactional active-run check (`:1799`). Individual run deletion also removes chats before its final deletion result.
- Impact: older run-linked chats can be missed. An active run outside the latest 100, or a run starting between checks, can cause deletion to be rejected after conversations have already been removed. The transactional check protects the task itself, not earlier chat cleanup.
- Proposed change: move deletion orchestration into one service boundary; query all owned run IDs and coordinate active-state checks and relational cleanup transactionally. Defer nontransactional blob cleanup until success.
- Tests: more than 100 global runs, old run conversations, active-run conflict, and deletion/start concurrency.

### 6. Reduce full-chat polling and repeated queries (medium priority, performance/correctness)

- Evidence: `app/src/client/chat-page.tsx:425` reloads every 750 ms while working, even during streaming. Its loader (`:124`) fetches the entire chat and, for recipe conversations, the run list. `kernel/src/ai-sdk-assistant.ts:295` loads every message and turn plus per-turn usage/tool-call/approval queries. Session lists also load all turns per session just to select the last status (`:1656`).
- Impact: database work, payload size and rendering grow with conversation history. Interval callbacks can overlap and loaders have no stale-response guard; a late response can replace newer state, including after navigation. `useLoad` in `springroll-app.tsx:5241` has the same request-ordering issue.
- Proposed change: first serialize polling, add cancellation/generation guards, and pause when hidden. Then deliver lightweight active-turn deltas through the existing streaming/event mechanism, batch summary queries, and paginate historical messages/session lists.
- Tests: delayed out-of-order responses, rapid navigation, long chats, query counts, and disconnected-stream recovery.

### 7. Split the initial frontend bundle (medium priority, performance)

- Measurement: production build emitted one 4.95 MB minified JavaScript entry, 94.69 KB CSS, and a 17.80 MB source map. These are build sizes, not compressed transfer sizes or measured startup latency.
- Evidence: `app/src/client/rollmark-document.tsx:5` eagerly imports Mermaid; the report component and all main pages are imported by `springroll-app.tsx`. `app/package.json` builds without chunk splitting. Asset responses also use `no-store` (`app/src/server/http-app.ts:1426`).
- Proposed change: measure module contributions, lazy-load report/diagram rendering and page-sized components, enable compatible split output, then use versioned assets with safe caching. Keep HTML freshness and deployment compatibility explicit.
- Verification: compare entry size and cold-start parse/render time; test first diagram/report render offline and after updates. Merely moving code into files will not reduce the bundle.

### 8. Remove obsolete theme-picker styles (low risk, quick cleanup)

- Evidence: old `.theme-rails`, `.theme-option`, and `.theme-preview` families remain in `app/src/client/styles.css:3491`, `:3962`, and related responsive/glass blocks. No current JSX references those class names. A matching obsolete preview rule also remains in `design-system.css:185`.
- Proposed change: remove confirmed unused picker rules and stale documentation references; inspect shared selectors before deletion. Do not broadly delete styles by string matching because some classes are generated dynamically.
- Verification: theme-selector tests and appearance checks across light/dark/glass and narrow layouts.

## Defer broad restructuring until these are addressed

`springroll-app.tsx` has 5,344 lines, `application.ts` 7,846, and `styles.css` 6,038. Extract Settings, recipe management, and connection workflow boundaries as those areas are touched, with existing tests protecting behavior. A large refactor alone is not a performance improvement and should not displace the concrete items above.

## Validation

- Typecheck passed.
- Production build passed; output sizes recorded above.
- Isolated HTTP boundary, SVG acceptance, and synthetic redirect-header checks reproduced the stated gaps without user-data changes.
- Full test suite passed: 637 tests, 0 failures, 4 snapshots across 102 files (78.77 seconds).
- No fixes, package updates, or commits were performed as part of this review.

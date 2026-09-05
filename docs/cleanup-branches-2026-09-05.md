# Cleanup branch handoff — September 5, 2026

Each branch was developed independently from `702f938`. All eight are now merged into `fix/provider-logo-size` (integration tip `b52d615`). Nothing has been pushed. The uncommitted recipe-card design changes remain untouched.

| Item | Branch | Commits |
| --- | --- | --- |
| 1. Local HTTP request boundary | `fix/local-api-boundary` | `ce356e6` |
| 2. Credential-bearing OpenAPI redirects | `fix/openapi-redirect-credentials` | `27c4218` |
| 3. Isolated provider SVG rendering | `fix/isolated-provider-logos` | `7e74c84` |
| 4. Durable incomplete recipe failure reports | `fix/recipe-failure-response` | `690bfdd` |
| 5. Atomic record/conversation deletion | `fix/atomic-record-deletion` | `18e836c`, `0a59865` |
| 6. Lightweight chat progress and stale-request guards | `perf/chat-refresh` | `0abe06b` |
| 7. Deferred report rendering and split JavaScript | `perf/lazy-report-rendering` | `8484210` |
| 8. Obsolete theme-picker CSS removal | `cleanup/obsolete-theme-styles` | `9b38934` |

## Validation

- After merging into the current branch: typecheck and production build passed; the full suite passed again (653 tests, 0 failures, 4 snapshots, 79.24 seconds).

- Current app smoke check: homepage and rebuilt entry/chunks return HTTP 200 at `http://127.0.0.1:4117`; the served entry matches the local build; foreign-origin API requests return HTTP 403. The existing watch-mode server picked up the changes without a manual restart.

- Each branch passed its relevant regression tests and typecheck. Frontend branches also passed production builds.
- All eight initial commits applied together without conflicts in the detached verification worktree at `/tmp/springroll-cleanup.qVAT10/combined`.
- Combined full suite: 653 passed, 0 failed, 4 snapshots across 108 files.
- The deletion-message follow-up passed 98 targeted tests and typecheck separately, then was included in combined verification.
- The JavaScript entry decreased from 4.95 MB to approximately 1.30 MB. This is entry-file size, not total transferred code or a measured startup-time improvement. Report/diagram chunks load when required.
- Removed 249 lines of obsolete picker CSS while keeping current swatches and the actual glass theme background.

## Behavior and boundaries

- The HTTP change is a browser-to-loopback boundary, not remote multi-user authentication. Headerless local CLI clients remain supported. OAuth callbacks retain their existing state validation; development MCP retains bearer authentication.
- OpenAPI operation redirects are rejected. If a provider legitimately redirects, configure its final documented API endpoint rather than forwarding secrets automatically.
- SVG content is rendered through isolated image/mask resources; raw SVG is no longer injected into the application's DOM. Monochrome marks retain theme-aware color through a mask.
- Provider stream errors produce a durable, explicitly incomplete report while the run stays failed. The host report makes no additional paid model calls. Cancellation and approval suspension retain their existing paths.
- Deletion checks associated active chats as well as active runs. Stop an active linked chat before deleting its recipe/run. Chat records and owned task/run deletion share a transaction; blob cleanup follows success.
- Chat progress refreshes run serially every two seconds while visible, omit message history and historical turn details, and perform a full sync on terminal transitions. Initial loads and explicit reloads still include history. General history pagination and broader query batching remain possible follow-up optimizations, not claimed as implemented.
- Asset caching remains unchanged to preserve the current rebuild/update behavior. Lazy chunk loading has build/regression coverage, but no interactive browser visual QA was performed.

Worktrees for each branch remain under `/tmp/springroll-cleanup.qVAT10`. The commits are durable Git branch references even if temporary worktree directories are later removed.

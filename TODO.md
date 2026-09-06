# To-dos

Focus: reliable local scheduling, then an installable Mac alpha. Work through the backlog in order; these five cards replace the previous active roadmap.

Guiding principle: one agent loop, direct capability-scoped tools, and host-enforced boundaries (schemas, credentials, idempotency, audit). If a tool is available, the agent is authorized to use it. Checks are user-configured exceptions, not defaults.

Earlier backlog, partial work, and completed history are preserved in [the September 5 archive](docs/archive/todo-2026-09-05.md). That snapshot is historical, not a second active board. Hosting, scheduled wake, new providers/integrations, and further design exploration are deferred unless needed for the priorities below.

## QA verification — September 5

- [x] QA-001: Display actual Codex dynamic tool names and recognize wrapped connector proposal validation. Verified by two failing-before/passing-after regressions, 687 passing tests, lint/typecheck/build, and the isolated app UI showing “Inspect connections” and “Correct connection proposal.” Packaged deployment remains pending.
- [x] QA-002: Expose connected integration management as a named link. Verified in the isolated app accessibility tree and navigation to the intended account, with 685 passing tests and lint/typecheck/build. Packaged deployment remains pending.

## 📋 Backlog

- [ ] 3. Harden the packaged app lifecycle
  - [ ] Define launch, window-close versus quit, and background scheduling behavior clearly.
  - [ ] Verify restart, forced termination, sleep/wake recovery, and single-instance/sidecar cleanup without duplicate execution.
  - [ ] Add optional idle-sleep prevention during active recipe runs; do not imply this wakes a sleeping Mac.
  - [ ] Show when local scheduling is unavailable and how missed runs will be handled.

- [ ] 4. Validate first-run setup end to end
  - [ ] Test fresh install → API key → model selection → recipe creation → scheduled result from a clean Mac account.
  - [ ] Fix release-blocking setup issues, including valid keys without default-model access and stale model labels after Settings changes.
  - [ ] Verify actionable failures, approval/cancellation flows, and accurate usage/limit disclosures, including search/page-reading costs and runtime-specific limitations.
  - [ ] Resolve blockers in shipped runtimes or clearly mark unsupported paths; defer provider expansion and cosmetic redesign.

- [ ] 5. Prepare a distributable desktop alpha and source release
  - [ ] Sign and notarize the Mac app; verify installation and first launch on a clean account.
  - [ ] Refresh README, screenshots, prerequisites, local-data/security guidance, costs, scheduling limitations, and known issues.
  - Existing foundation: MIT license, contributor/security documents, GitHub templates, Dependabot configuration, and CodeQL workflow are already in place.
  - [ ] Re-scan current Git history and release artifacts for secrets/private data; run tests, typecheck, and production build in required CI.
  - [ ] Verify release-branch integration and applicable GitHub security checks.
  - [ ] Obtain publication approval before making the repository public or distributing the alpha.
  - [ ] Decide the update/distribution path after the initial package is proven; automatic updates are not a prototype prerequisite.

## 🚧 In Progress

- [ ] Fix and interactively verify the bottom chat model selector
  - Reopened after the user confirmed the overflow change did not resolve it. Previous five focused tests and build only covered code/style assertions, not actual popup interaction.
  - Prior attempted fix retained in `prototype-3LY3Ul`; reproduce against the running build before another change. This session has no enabled browser surface and native app control is disabled.

- [ ] Fix desktop integration sign-in completion, duplicate pending accounts, and removal confirmation
  - [x] Preserve the registered OAuth callback URL when the browser returns through a loopback hostname alias (`localhost` vs `127.0.0.1`); keep port/path and state/PKCE checks intact. The reported registration-change failure occurred before token exchange; Chrome's DevTools CSP warning is unrelated.
  - 67 focused tests and explicit registered-URI token-exchange regression pass, along with typecheck/lint/build. Latest bundle: `desktop/dist/prototype-eCrSwZ/Springroll Prototype.app`; real Neon retry remains outstanding.
  - Baseline app work committed as `8da7a83`; unrelated design mockups excluded.
  - [x] Replace integration Remove/Sign out browser confirmations with an app-owned modal; retain explicit confirmation and server-side recipe-use protections.
  - [x] Reuse unfinished OAuth accounts on provider-level retries and coalesce concurrent starts; expose pending sign-in status and refresh integrations on return from the browser.
  - 76 focused tests, typecheck, changed TypeScript lint, and Mac build pass. Pending-account removal, duplicate/concurrent starts, callback validation, and adding a second completed account covered.
  - [ ] Verify actual Neon approval/callback and native confirmation in the rebuilt app. Both saved Neon entries had OAuth starts but no completion audit; the original missing callback is not yet explained. No user connections removed. Follow-up implementation is uncommitted.
  - Updated bundle: `desktop/dist/prototype-Tjn7Ka/Springroll Prototype.app`.
  - [x] Give packaged OAuth a browser completion page and signal the existing native window to navigate back and regain focus. Keep browser-only deployment redirects unchanged; preserve callback errors by returning directly to `/integrations` instead of the obsolete `/connections` alias.
  - User was still running `prototype-txcR85`, which predates the confirmation fix. Latest build: `desktop/dist/prototype-DuICPb/Springroll Prototype.app`; quit the old build fully before opening it. 66 application tests, focused success/error desktop callback regression, two Rust navigation tests, typecheck, and build pass. Real Neon approval remains to be retested in the current build.

- [ ] 2. Build an unsigned Mac app prototype
  - Started on `feat/macos-app-prototype` after PRs #10 and #11 merged into main with passing macOS CI. Real-device scheduling acceptance below remains open, as agreed before moving on.
  - [x] Build a Tauri shell with bundled Bun, production runtime dependencies, assets/migrations, and an explicitly owned Rivet scheduler.
    - `bun run build:mac` creates an unsigned, current-architecture development `.app`; uses the existing logo and a separate prototype workspace/Keychain service. Initial size is about 1.2 GB; not distribution-ready.
  - [x] Separate writable application data and bundled resources from source-checkout paths.
    - Added shared `SPRINGROLL_DATA_DIR` / `SPRINGROLL_RESOURCES_DIR` resolution for launcher/server, migrations, assets, and catalog storage. Existing explicit database/catalog overrides remain supported; catalog defaults alongside the selected database.
    - Shared launcher/server paths, package builds, 675 application tests, Rust navigation test, typecheck, and changed-file lint pass. Work is uncommitted on the prototype branch.
  - [ ] Launch successfully on a clean Mac account without a terminal or development tools.
    - Packaged startup, assets, empty API, quit, and relaunch smoke passed using a temporary workspace, `/tmp` working directory, and `/usr/bin:/bin` PATH on this account. Verified bundled dependency symlinks stay inside the package. A different clean account and native visual review remain outstanding.
  - [ ] Verify application-support storage, Keychain access, and loopback OAuth callbacks.
  - [x] Record packaging constraints and acceptance checks in [desktop/README.md](desktop/README.md).
    - Native signing/notarization, size optimization, real Keychain/OAuth setup, sleep/wake, startup cancellation, forced-termination/orphan recovery, and unexpected-child-exit handling remain open. Do not present this as a public release.

- [ ] 1. Make missed-run behavior predictable and verify Mac sleep/wake recovery
  - [x] Match the existing two policies to their labels: skip missed work or catch up once; neither replays the backlog. Allow 60 seconds for ordinary delivery jitter and retain the existing default.
  - [x] Correct admission/cursor handling and add regression coverage, including persisted recovery receipts in recipe details.
  - [x] Verify 671 tests, typecheck, production build, and changed-file lint; real-engine tests cover multi-day recovery and a second restart without duplicate catch-up.
  - [ ] Test overnight/weekend sleep, multiple missed occurrences, quit/relaunch, unavailable networking, paused recipes, approval-waiting runs, and timezone/DST changes.
    - Automated coverage includes multi-day downtime, disabled recipes, all active-run states, DST, database reopen, and engine/registry restart. Real Mac sleep/wake and network-restoration acceptance still need a deliberate test session; no power settings or system clock were changed.
  - [ ] Verify explicit late/skipped reporting, no unintended duplicate side effects, and the correct next scheduled run.
    - Latest recovery receipt and future cursor verified in SQLite/API tests; visual and real-device acceptance remain. No claim of exactly-once external side effects.
  - Policy and acceptance handoff: [docs/missed-run-policy.md](docs/missed-run-policy.md). Keep this card open until device acceptance; do not silently treat simulated downtime as Mac sleep verification.

## ✅ Done

- [x] Restore setup cards and durable workflows for wrapped subscription tool results, including existing conversations
  - Shared normalization handles dynamic tool names and structured results in both UI projection and workflow persistence/backfill. Existing Clarity conversation parses as a ready proposal without repeating research; live setup still requires user approval and credentials.
  - 83 focused tests, changed-file lint, typecheck, and Mac build pass. Bundle: `desktop/dist/prototype-Ar42J5/Springroll Prototype.app`.

- [x] Make the chat stop control neutral grey and icon-only
  - Chat composer uses the square stop icon with neutral theme colors, including hover/focus; accessible label and tooltip retained. Run controls unchanged.
  - Two component tests, changed TypeScript lint, typecheck, and Mac build pass. Bundle: `desktop/dist/prototype-LA7QJF/Springroll Prototype.app`.

- [x] Hide unavailable one-click shortcuts while preserving in-app integration setup and installed accounts
  - Shortcuts requiring operator OAuth registration are hidden; ready providers and installed accounts remain. Add integration continues into the existing in-app setup conversation. Removed disabled shortcut styling and clarified empty-state guidance.
  - 76 focused tests, typecheck, changed TypeScript lint, and Mac build pass. Updated bundle: `desktop/dist/prototype-txcR85/Springroll Prototype.app`; native visual review remains with the user.

- [x] Default recipe turn limits to Off without changing saved limits or chat safeguards
  - Updated execution/configuration/UI fallbacks and SQLite default to zero; migration preserves saved turn and cost limits. Chat safeguards unchanged.
  - 68 focused tests, typecheck, changed-file lint, and Mac build pass. Updated bundle: `desktop/dist/prototype-93RCLf/Springroll Prototype.app`.

- [x] Keep the setup reminder visible through provider and default-model setup with an accented action link
  - Reminder says to add a provider key, then switches to selecting a default model; clears only when both are ready. Preserve the last status on refresh errors. Only the action link uses the theme accent.
  - Four readiness tests, typecheck, changed-file lint, and Mac build pass. Updated bundle: `desktop/dist/prototype-iqS4Il/Springroll Prototype.app`; visual review remains with the user.

- [x] Replace the setup wizard with Settings-first startup and a quiet setup reminder
  - Removed the standalone flow and launcher setup card. Startup opens AI providers or Models & limits when needed; a compact header reminder links to the remaining setting and disappears when ready. Browsing is not repeatedly redirected.
  - 12 focused readiness/navigation tests, typecheck, and Mac build pass. Updated bundle: `desktop/dist/prototype-a5imD3/Springroll Prototype.app`. Native visual review remains with the user.

- [x] Guide first-run model setup and gate chat until a connected default is ready
  - Added `/setup` using secure provider controls and the existing model picker, explicit default confirmation, and chat/recipe entry points. Launcher, composer, pending sends, and retries respect readiness; Settings/provider changes refresh the shared model state.
  - 677 tests, typecheck, changed TypeScript lint, rebuilt Mac app, and packaged launch/relaunch smoke passed. Native visual review and real provider onboarding remain part of the open acceptance work.
  - Updated prototype: `desktop/dist/prototype-kKcuY0/Springroll Prototype.app`; earlier bundles are unchanged.

- [x] Refocus the board on the five desktop-alpha priorities and archive earlier work
  - Preserved the previous backlog, partially completed work, and full Done history in [the September 5 archive](docs/archive/todo-2026-09-05.md).

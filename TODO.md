# To-dos

Focus: reliable local scheduling, then an installable Mac alpha. Work through the backlog in order; these five cards replace the previous active roadmap.

Guiding principle: one agent loop, direct capability-scoped tools, and host-enforced boundaries (schemas, credentials, idempotency, audit). If a tool is available, the agent is authorized to use it. Checks are user-configured exceptions, not defaults.

Earlier backlog, partial work, and completed history are preserved in [the September 5 archive](docs/archive/todo-2026-09-05.md). That snapshot is historical, not a second active board. Hosting, scheduled wake, new providers/integrations, and further design exploration are deferred unless needed for the priorities below.

## 📋 Backlog

- [ ] 2. Build an unsigned Mac app prototype
  - [ ] Confirm the Tauri shell architecture and bundle the Bun application and Rivet scheduler.
  - [ ] Launch successfully on a clean Mac account without a terminal or development tools.
  - [ ] Verify application-support storage, Keychain access, and loopback OAuth callbacks.
  - [ ] Record packaging constraints before committing to the distributable build.

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

- [x] Refocus the board on the five desktop-alpha priorities and archive earlier work
  - Preserved the previous backlog, partially completed work, and full Done history in [the September 5 archive](docs/archive/todo-2026-09-05.md).

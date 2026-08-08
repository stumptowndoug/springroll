# Rivet implementation status

Last updated: 2026-08-08

## What we are doing and why

Springroll is moving its scheduling and durable-run host to [Rivet Actors](https://rivet.dev). Locally, RivetKit actors will replace the polling tick loop: one actor represents one task, owns that task's schedule, and wakes when work is due. The future paid tier will run the same actor code on Rivet Cloud. The agent runner, tools, connectors, and credential boundaries remain ordinary Springroll kernel code; Rivet decides where and when a run lives, not what the run is allowed to do.

This replaces the previously planned split between local execution and a Turso + Inngest hosted runtime. Sharing the actor host between local and cloud removes database synchronization and distributed occurrence-claiming from the critical path. It also gives each hosted task a single writer for run-time state. Local SQLite remains authoritative for the task catalog, task editing, chats, and the cross-task ledger; actor-owned cloud history will be mirrored into it through a cursor-based, append-only catch-up action.

The transition is deliberately contained. RivetKit imports belong only in a host layer such as `kernel/src/host/`. The pure runner contract and the kernel's tool and credential internals must not depend on Rivet. That keeps local execution testable and leaves the scheduling substrate replaceable if Rivet Cloud, the self-hosted engine, or Springroll's needs change.

## How the R0 actor works

The proof in `spikes/rivet-r0/src/task-actor.ts` defines a `taskActor` whose actions are the only client-facing read/write surface. `fireOccurrence` and `approve` durably enqueue typed requests and return quickly. The actor's `run` handler consumes that queue and wraps each complete `runTask` + `AiSdkAgentRunner` execution in `c.keepAwake()`. This is the adopted long-run shape: action RPCs are admission and inspection boundaries, not containers for multi-minute model work.

Each actor has embedded SQLite configured through `rivetkit/db/drizzle`. The actor writes runs, checkpoints, and a monotonically cursored event stream there. At an approval boundary it first commits the serialized model messages and waiting status, then updates `pendingApproval` and calls `c.saveState({ immediate: true })`. The same immediate save is used when a run becomes active or terminal. This matters because ordinary actor-state persistence is throttled: a returned action must not claim a durable boundary that can disappear in a crash.

Live events are broadcast for connected clients, but they are not the record. `eventsSince(cursor)` returns the ordered durable rows missed while a client was disconnected. That is the small-scale proof of the planned local mirror protocol. `setCron` registers the recurring occurrence with `cron.set`; `scheduleIn` uses `schedule.after` for one-shot work and recovery tests. Rivet owns wake-up and overlap serialization, while Springroll continues to own checkpoint/resume and failure policy because Rivet schedules do not retry failed runs.

## Mapping to kernel seams

- `kernel/src/run-task.ts` is the pure execution boundary. It resolves pinned tools, opens and closes tool-source sessions, and invokes the selected `AgentRunner`. R0 called it unmodified from an actor, which is the strongest evidence that Rivet can remain outside the substrate.
- `kernel/src/storage/agent-run-executor.ts` joins the local ledger to `runTask`: it loads task configuration, creates the event sink, persists run status, approvals, and recipe knowledge, and resumes checkpoints. The R2 actor host invokes this executor through the narrow `ScheduledRunExecutor` contract. Its claim-to-running transition is idempotent so a replayed actor-queue message cannot execute a terminal run twice; Rivet logic does not enter `runTask` or the agent runner.
- `kernel/src/storage/sqlite-run-checkpoint-store.ts` is the authoritative local, synchronous `bun:sqlite` checkpoint implementation. Actor SQLite uses RivetKit's asynchronous SQLite-proxy Drizzle client, so actor-owned checkpoints need an async sibling behind the same conceptual boundary. The local store should not be made Rivet-aware.
- The former `kernel/src/tick.ts` and `kernel/src/local-tick-loop.ts` polling scheduler has been retired. Its occurrence claiming, overlap exclusion, catch-up/skip cursor behavior, and restart-persistence tests now target the actor host's local SQLite occurrence boundary.

## Current status

Phase R0 passed on 2026-08-08 with RivetKit 2.3.10, and the Rivet transition is adopted. The real Springroll `runTask` and `AiSdkAgentRunner` executed under Bun inside an actor; the real Hacker News connector ran; an approval checkpoint survived kill, restart, and resume; a one-shot schedule missed during downtime fired after restart; cron registration reported the expected next run; and cursor catch-up returned missed durable events.

The adoption decision rests on the handleable wake race and the proven host boundary. A transient restart/wake race produced `SQLite transaction coordinator is closed` once and succeeded on retry. Action calls now have a bounded retry restricted to that error, covered by tests, and the race is reported as [rivet-dev/rivet#5554](https://github.com/rivet-dev/rivet/issues/5554). Long-run hosting uses the queue-driven run handler: a proof action returned in 0.22 seconds, the run stayed active past the default 60-second action timeout, reached a real approval checkpoint, and resumed successfully. The spike defaults to an isolated engine directory and port. The app, kernel, spike, and RivetKit share `drizzle-orm@0.44.7`; the convergence required no source changes and passed the full typecheck and test suite. The real-provider call remains outstanding. Actor schema upgrades, multi-hour sleep behavior, large actor state, Rivet Cloud deployment, cloud pricing, hosted secret handling, and self-hosted authentication remain later risks rather than R0 proofs.

Phase R2 is underway. `kernel/src/host/rivet-local-task-host.ts` is the only production module that imports RivetKit. It creates one actor per local task; durable one-shot schedules mirror the task's authoritative `nextRunAt`, actor actions admit manual runs and synchronize edits, and the actor `run` handler serially consumes run messages under `c.keepAwake()`. Scheduled claims and cursor advancement happen atomically in the existing local database. A real isolated-engine smoke run started the application, reconciled a due task after restart, advanced its local schedule, and completed the run through the unchanged executor. The polling implementation and its public exports are now removed.

An opt-in `run-real` path now selects the OpenAI Responses provider through `@ai-sdk/openai` while reusing the same runner and actor host. It reads `OPENAI_API_KEY` only from the host process and refuses admission before creating a run if the key is absent. The implementation path is ready, but the live proof remains incomplete because no OpenAI key was available in the environment, root `.env`, or Springroll's Keychain on 2026-08-08.

## Local engine lifecycle

The R0 spike now defaults `RIVETKIT_STORAGE_PATH` to `spikes/rivet-r0/.data` and uses the isolated loopback endpoint `127.0.0.1:16420`. RivetKit appends `.rivetkit`, so engine data and logs live below `spikes/rivet-r0/.data/.rivetkit` rather than the shared `~/.rivetkit`. The registry uses `startAndWait()` so its host does not announce readiness before its envoy has registered with the engine.

The R2 application host similarly defaults to an engine root beside the selected Springroll database and loopback port `16421`; both are overrideable through the Rivet environment variables. This is an interim Bun-host lifecycle for development. The Tauri ownership requirements below still apply before packaging.

RivetKit's spawned `rivet-engine` is intentionally orphaned: stopping or crashing the Bun registry does not stop the Rust engine. That is useful for development restarts, but the packaged app must not treat it as an incidental child. The future Tauri shell should explicitly own one engine process and one application-support data root. Startup must acquire a single-instance guard, start or reattach to the matching engine, wait for engine health, then wait for registry readiness before serving the UI. A Bun-sidecar restart may reattach to the still-healthy engine; an engine restart must complete before the registry is considered ready.

On normal app quit, Tauri should stop admissions, call `registry.shutdown()` and await actor drain, then send the owned engine a graceful termination and confirm exit. On forced termination, the next launch must detect the recorded engine PID/endpoint, verify that the process is the bundled engine before reusing or terminating it, and never start two engines against the same directory. App updates must preserve the data root, stop the old registry and engine before replacing binaries, reject engine-version rollback unless Rivet explicitly supports it, and exercise backup/schema migration plus missed-schedule wake in packaging tests. macOS sleep suspends both sidecars; wake must follow the same health/readiness path and allow persisted missed schedules to fire.

## Next steps

- [x] Add and test a narrow retry wrapper around actor action calls for transient startup/wake failures; track the upstream race in [rivet-dev/rivet#5554](https://github.com/rivet-dev/rivet/issues/5554).
- [x] Use queue-driven `run`-handler-hosted execution with `c.keepAwake()`; prove it with a successful run delayed 61 seconds beyond RivetKit's default action timeout.
- [x] Give the spike an isolated engine data directory and port; document start, readiness, restart, shutdown, sleep/wake, and upgrade responsibilities for the future Tauri sidecar.
- [ ] Run the wired `run-real` path once with `OPENAI_API_KEY` through `@ai-sdk/openai` and record the result without persisting the key (currently blocked: no key is available locally).
- [x] Converge the app, kernel, spike, and RivetKit on one `drizzle-orm@0.44.7` instance after the complete typecheck and 276-test suite passed without source changes.
- [x] Record the R0 adoption decision in `docs/rivet-transition.md` and replace the Turso + Inngest roadmap with the actor ownership model.
- [x] Begin Phase R2 with a Rivet-only host layer, one actor per local task, and local SQLite still authoritative for catalog, editing, chats, and ledger data.
- [x] Route task create/update/delete and manual run admission through the actor host; prove scheduled reconciliation and execution against an isolated real engine.
- [x] Remove the now-unused polling tick loop and migrate its remaining policy tests to the actor occurrence boundary.
- [ ] Add automated engine-level recovery coverage for queue replay, restart reconciliation, missed alarms, and graceful drain.
- [ ] Define the no-retry recovery policy, actor database migration tests, and packaged-engine lifecycle tests before Phase R2 is considered complete.

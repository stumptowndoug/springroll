# Rivet implementation status

Last updated: 2026-08-08

## What we are doing and why

Springroll is moving its scheduling and durable-run host to [Rivet Actors](https://rivet.dev). Locally, RivetKit actors will replace the polling tick loop: one actor represents one task, owns that task's schedule, and wakes when work is due. The future paid tier will run the same actor code on Rivet Cloud. The agent runner, tools, connectors, and credential boundaries remain ordinary Springroll kernel code; Rivet decides where and when a run lives, not what the run is allowed to do.

This replaces the previously planned split between local execution and a Turso + Inngest hosted runtime. Sharing the actor host between local and cloud removes database synchronization and distributed occurrence-claiming from the critical path. It also gives each hosted task a single writer for run-time state. Local SQLite remains authoritative for the task catalog, task editing, chats, and the cross-task ledger; actor-owned cloud history will be mirrored into it through a cursor-based, append-only catch-up action.

The transition is deliberately contained. RivetKit imports belong only in a host layer such as `kernel/src/host/`. The pure runner contract and the kernel's tool and credential internals must not depend on Rivet. That keeps local execution testable and leaves the scheduling substrate replaceable if Rivet Cloud, the self-hosted engine, or Springroll's needs change.

## How the R0 actor works

The proof in `spikes/rivet-r0/src/task-actor.ts` defines a `taskActor` whose actions are the only client-facing read/write surface. `fireOccurrence` creates an actor-local run row and hosts the complete `runTask` + `AiSdkAgentRunner` call. `approve` loads the durable checkpoint and resumes the same run. The spike currently executes long work inside actions with an explicitly raised `actionTimeout`; whether production keeps that shape or uses the actor `run` handler with `c.keepAwake()` is an open R0 follow-up.

Each actor has embedded SQLite configured through `rivetkit/db/drizzle`. The actor writes runs, checkpoints, and a monotonically cursored event stream there. At an approval boundary it first commits the serialized model messages and waiting status, then updates `pendingApproval` and calls `c.saveState({ immediate: true })`. The same immediate save is used when a run becomes active or terminal. This matters because ordinary actor-state persistence is throttled: a returned action must not claim a durable boundary that can disappear in a crash.

Live events are broadcast for connected clients, but they are not the record. `eventsSince(cursor)` returns the ordered durable rows missed while a client was disconnected. That is the small-scale proof of the planned local mirror protocol. `setCron` registers the recurring occurrence with `cron.set`; `scheduleIn` uses `schedule.after` for one-shot work and recovery tests. Rivet owns wake-up and overlap serialization, while Springroll continues to own checkpoint/resume and failure policy because Rivet schedules do not retry failed runs.

## Mapping to kernel seams

- `kernel/src/run-task.ts` is the pure execution boundary. It resolves pinned tools, opens and closes tool-source sessions, and invokes the selected `AgentRunner`. R0 called it unmodified from an actor, which is the strongest evidence that Rivet can remain outside the substrate.
- `kernel/src/storage/agent-run-executor.ts` currently joins the local ledger to `runTask`: it loads task configuration, creates the event sink, persists run status, approvals, and recipe knowledge, and resumes checkpoints. Phase R2 needs an actor-hosted sibling or adapter at this seam, not Rivet logic inside `runTask` or the agent runner.
- `kernel/src/storage/sqlite-run-checkpoint-store.ts` is the authoritative local, synchronous `bun:sqlite` checkpoint implementation. Actor SQLite uses RivetKit's asynchronous SQLite-proxy Drizzle client, so actor-owned checkpoints need an async sibling behind the same conceptual boundary. The local store should not be made Rivet-aware.
- `kernel/src/tick.ts` and `kernel/src/local-tick-loop.ts` are the polling scheduler to retire in Phase R2. Their useful occurrence, catch-up, and executor behavior must either map to actor schedule/actions or remain as substrate-neutral policy; the interval loop itself goes away.

## Current status

Phase R0 passed on 2026-08-08 with RivetKit 2.3.10. The real Springroll `runTask` and `AiSdkAgentRunner` executed under Bun inside an actor; the real Hacker News connector ran; an approval checkpoint survived kill, restart, and resume; a one-shot schedule missed during downtime fired after restart; cron registration reported the expected next run; and cursor catch-up returned missed durable events.

The result supports adoption, but the decision is not recorded yet. A transient restart/wake race produced `SQLite transaction coordinator is closed` once and succeeded on retry. Long-run hosting has only been proven by raising `actionTimeout`, not by a run longer than the default. The engine still uses its per-user global data directory, the model has been scripted, and the workspace currently resolves Drizzle 0.45.2 for the kernel alongside RivetKit's 0.44.x line. Actor schema upgrades, multi-hour sleep behavior, large actor state, Rivet Cloud deployment, cloud pricing, hosted secret handling, and self-hosted authentication remain later risks rather than R0 proofs.

## Next steps

- [ ] Add and test a narrow retry wrapper around actor action calls for transient startup/wake failures; search `rivet-dev/rivet` for an existing report and link or file one when warranted.
- [ ] Choose action-hosted or `run`-handler-hosted execution and prove the chosen shape with a run longer than RivetKit's default action timeout.
- [ ] Give Springroll an isolated engine data directory and document start, readiness, restart, shutdown, and upgrade responsibilities for the future Tauri sidecar.
- [ ] Run the spike once with `OPENAI_API_KEY` through `@ai-sdk/openai` and record the result without persisting the key.
- [ ] Evaluate and, if safe, converge the kernel and RivetKit Drizzle versions.
- [ ] Record the R0 adopt/reject decision in `docs/rivet-transition.md` and update the roadmap accordingly.
- [ ] Begin Phase R2 with a Rivet-only host layer, one actor per local task, and local SQLite still authoritative for catalog, editing, chats, and ledger data.
- [ ] Define the no-retry recovery policy, actor database migration tests, and packaged-engine lifecycle tests before Phase R2 is considered complete.

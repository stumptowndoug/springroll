# Rivet R0 spike

Phase R0 of `docs/rivet-transition.md`: prove the real Springroll agent runner
executes inside a RivetKit actor under Bun, with resumable checkpoints in the
actor's embedded SQLite and schedules that survive a dead process.

The spike hosts the kernel's `runTask` + `AiSdkAgentRunner` inside a
`taskActor`. The model is scripted (`MockLanguageModelV4`) so runs are
deterministic and offline except for one real network call: the kernel's
actual Hacker News connector fetches live stories. The scripted run always
requests the destructive `publish_digest` tool, forcing the approval pause —
the checkpoint boundary under test.

## Running it

```sh
bun src/main.ts serve          # terminal 1: registry + local engine
bun src/main.ts run            # fire an occurrence → pauses for approval
bun src/main.ts runs           # run rows from the actor's embedded SQLite
# kill and restart serve here to test durability
bun src/main.ts approve        # resume from checkpoint → completes
bun src/main.ts events 0       # cursor catch-up (the mirror protocol)
bun src/main.ts schedule-in 12000
bun src/main.ts cron "0 7 * * *"
bun src/main.ts inspect
```

## Findings (2026-08-08, rivetkit 2.3.10)

Validated:

- **Full agent run inside an action.** `runTask` with the kernel's
  `AiSdkAgentRunner`, real HN tool source, event sink, and approval flow runs
  unmodified inside an actor action. No kernel changes were needed.
- **Checkpoint → kill → restart → resume.** `AgentRunApprovalRequiredError`
  messages persisted to the actor's embedded SQLite, `pendingApproval` state
  saved with `saveState({ immediate: true })`, process killed, restarted, and
  `approve` resumed the continuation to completion. Twice (run-1 manual,
  run-2 via missed alarm).
- **Schedules survive a dead process.** A `schedule.after` one-shot whose fire
  time passed while the process was down fired on restart. Cron registration
  (`cron.set`, 5-field, timezone-aware) reports correct `nextRunAt`.
- **Embedded SQLite + Drizzle.** `rivetkit/db/drizzle` with our table style
  works; migrations via raw `execute` in `onMigrate`. Note the client is the
  *async* sqlite-proxy flavor — kernel stores written against sync `bun:sqlite`
  (e.g. `SqliteRunCheckpointStore`) need async siblings, not reuse.
- **Cursor catch-up.** A monotonic `cursor` column plus one `eventsSince`
  action implements the local↔cloud mirror read from the transition doc.

Caveats and open items:

- **`actionTimeout` matters.** Defaults would kill a long run mid-action; the
  spike raises it to 10 min. For production, either size it to the runner's
  `maxActiveRunDurationMs` or move run execution to the `run` handler with
  `c.keepAwake()`.
- **Transient engine error on wake (handled).** Right after a restart, one
  action call failed and the engine logged
  `sqlite transaction coordinator is closed` (generation sync race); the
  retry succeeded. Spike action calls now use a bounded retry limited to that
  exact transient error. No existing report was found, so this is tracked
  upstream as [rivet-dev/rivet#5554](https://github.com/rivet-dev/rivet/issues/5554).
- **Engine state is per-user global** (`~/.rivetkit/var/engine/`), managed by
  a spawned `rivet-engine` Rust binary from `@rivetkit/engine-cli`. A packaged
  Springroll must configure an isolated data directory and own the engine
  lifecycle (Tauri sidecar implications).
- **drizzle-orm versions.** rivetkit peers `^0.44.x`; kernel uses `0.45.2`.
  They coexist as separate instances, but converging versions before Phase R2
  would avoid subtle operator-instance issues.
- Not yet exercised: real-model runs (wire a provider key through
  `buildDigestTask`/runner), multi-hour runs vs. sleep, `c.state` size
  behavior with large histories, actor upgrade/schema migration across
  deploys, and Rivet Cloud deployment.

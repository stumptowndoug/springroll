# Rivet R0 spike

Phase R0 of `docs/rivet-transition.md`: prove the real Springroll agent runner
executes inside a RivetKit actor under Bun, with resumable checkpoints in the
actor's embedded SQLite and schedules that survive a dead process.

The spike hosts the kernel's `runTask` + `AiSdkAgentRunner` inside a
`taskActor`. Actions and schedules durably enqueue run requests; the actor's
`run` handler consumes them and holds the actor awake during execution. The
model is scripted (`MockLanguageModelV4`) so runs are
deterministic and offline except for one real network call: the kernel's
actual Hacker News connector fetches live stories. The scripted run always
requests the destructive `publish_digest` tool, forcing the approval pause —
the checkpoint boundary under test.

## Running it

The spike defaults `RIVETKIT_STORAGE_PATH` to `spikes/rivet-r0/.data` and the
engine endpoint to `127.0.0.1:16420`. RivetKit appends its own `.rivetkit`
directory beneath that storage root, keeping both the native engine database
and launcher logs separate from the default `~/.rivetkit`. Explicit
environment variables still override these settings. The storage root affects
a newly spawned engine; it cannot relocate an orphaned engine already serving
the selected port.

```sh
bun run spike serve          # terminal 1: registry + local engine
bun run spike run            # fire an occurrence → pauses for approval
bun run spike run-long 61000 # prove execution past the 60s action timeout
bun run spike run-real       # OPENAI_API_KEY via @ai-sdk/openai
bun run spike runs           # run rows from the actor's embedded SQLite
# kill and restart serve here to test durability
bun run spike approve        # resume from checkpoint → completes
bun run spike events 0       # cursor catch-up (the mirror protocol)
bun run spike schedule-in 12000
bun run spike cron "0 7 * * *"
bun run spike inspect
```

## Findings (2026-08-08, rivetkit 2.3.10)

Validated:

- **Full agent run inside an action.** `runTask` with the kernel's
  `AiSdkAgentRunner`, real HN tool source, event sink, and approval flow runs
  unmodified inside an actor action. No kernel changes were needed.
- **Long-run shape: queue + `run` handler.** The follow-up removed the raised
  `actionTimeout`. Actions and alarms now enqueue a typed run request and
  return; the actor `run` handler consumes requests and scopes each execution
  with `c.keepAwake()`. A `run-long 61000` request returned in 0.22 seconds,
  remained active past RivetKit's default 60-second action timeout, reached
  the real runner's approval checkpoint, and resumed to success. The recorded
  run started at `15:15:53.974Z` and finished at `15:17:25.928Z`.
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

- **Queue recovery policy still matters.** The chosen run-handler shape avoids
  holding an action RPC open, but Phase R2 still needs an explicit policy for
  a process crash after a queue item is consumed and before the next kernel
  checkpoint.
- **Transient engine error on wake (handled).** Right after a restart, one
  action call failed and the engine logged
  `sqlite transaction coordinator is closed` (generation sync race); the
  retry succeeded. Spike action calls now use a bounded retry limited to that
  exact transient error. No existing report was found, so this is tracked
  upstream as [rivet-dev/rivet#5554](https://github.com/rivet-dev/rivet/issues/5554).
- **Engine isolation is configured.** The spike stores its engine data and
  logs under `spikes/rivet-r0/.data/.rivetkit` and uses port 16420 instead of
  attaching to the product engine. A smoke run confirmed that
  `RIVETKIT_STORAGE_PATH` drives the spawned native engine's RocksDB path.
  Because RivetKit intentionally orphans that engine, the setting cannot move
  an engine that is already listening; lifecycle ownership must prevent stale
  reattachment. `serve` waits for envoy registration through
  `registry.startAndWait()` before reporting readiness. The future Tauri
  lifecycle contract is recorded in `docs/rivet-implementation-status.md`.
- **Drizzle versions are converged.** The app, kernel, spike, and RivetKit now
  resolve one `drizzle-orm@0.44.7` instance. Downgrading the product packages
  from 0.45.2 required no source changes and passed the complete typecheck and
  276-test suite, removing the cross-instance operator risk before Phase R2.
- **A real-model actor run passed through the product's existing OpenRouter
  connection.** This confirms that the scripted R0 model was not load-bearing
  for the actor boundary. The spike's `run-real` command remains available as
  an optional direct-provider cross-check through `@ai-sdk/openai`; its key is
  read only from the actor host process and is never queued or persisted.
- Not yet exercised: multi-hour runs vs. sleep, `c.state` size behavior with
  large histories, actor upgrade/schema migration across deploys, and Rivet
  Cloud deployment.

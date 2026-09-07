# Rivet usage in Springroll's local app

## What runs today

The production integration is concentrated in
`kernel/src/host/rivet-local-task-host.ts`. It defines one actor type, with an
instance keyed by each recipe ID. Its responsibilities are:

| Rivet capability | Springroll use |
| --- | --- |
| Actor lifecycle and persistent state | Store the next alarm identifier/time and pending execute/resume messages per recipe |
| Queue | Serialize execution/resume messages for a recipe |
| Scheduled actions | Deliver a timestamped `fireScheduled` alarm; cancel/reschedule when a recipe changes |
| Actions and local client | Sync recipes, enqueue work, remove alarms, and resume approved runs across the local engine boundary |
| Actor migration/restart | Replay pending messages and reconcile runs already claimed in Springroll's SQLite database |
| Actor keep-awake and shutdown | Keep an actor alive during execution and drain it on app shutdown |

`keepAwake` refers to actor lifecycle; it does not prevent macOS sleep or wake a
sleeping Mac. The desktop launcher runs a local Rivet engine on loopback ports.
This app currently uses `rivetkit` and `rivetkit/client`, not `rivetkit/agent-os`.

## What Springroll owns

Springroll's SQLite database holds recipe definitions, authoritative next-run
cursors, run history, approval state, and results. `local-task-occurrence.ts`
implements atomic occurrence claiming, cron/timezone advancement, duplicate and
active-run handling, and missed-run policies. The executor owns model calls,
tool calls, reports, and approvals. Those are not provided by Rivet.

Rivet currently provides durable dispatch and actor execution, not the whole
application backend. This is a narrow feature surface with meaningful recovery
responsibilities; it is not just a timer. The existing real-engine tests exercise
process-kill recovery, replay of consumed messages, overdue alarms, multi-day
coalescing, graceful drain, and actor-state/database migration.

## What the dependency footprint does not tell us

The shipped native engine and actor module total about 122 MB. That cannot be
partitioned reliably into percentages for individual features from file sizes.
The package also installs the agent-OS dependency family, including sandbox and
Python support. Springroll does not directly use that API. We should trace runtime
reachability and test a feature-specific package before assuming the whole branch
is removable. A dependency being installed is not evidence we use all its features.

The local app currently does not deploy to Rivet Cloud or use a distributed
multi-machine execution topology. Future hosted execution can still retain a
Rivet adapter even if local execution changes.

## Decision

Keep the scheduler unchanged for the first packaging reductions. Maps, obsolete
browser chunks, and duplicate Mermaid packages already yield substantial savings.
The owner subsequently asked to treat Rivet as fixed. Keep its dependency tree
unchanged and limit the current cleanup to independently verified browser assets
and other files outside that tree.

If the remaining footprint still exceeds the desired budget, prototype a local
SQLite-backed implementation of `LocalTaskRunHost`. Preserve the same externally
observable queue, alarm, approval/resume, missed-run, and crash-recovery behavior;
use the existing recovery scenarios as acceptance criteria. That would be a
contained scheduler replacement, though still more involved than package pruning.
Removing Bun would be a broader backend change and is not the first recommendation.

# Rivet transition plan

Status: adopted (2026-08-08). Supersedes the Turso + Inngest hosted-infrastructure plan formerly recorded in TODO.md Phases 6–7. Companion to `scheduled-agent-app-brief.md` (product rationale), `assistant-runtime.md` (thin agent host boundary), and `rivet-implementation-status.md` (working implementation record).

## Summary

Adopt [Rivet](https://rivet.dev) Actors as the durability and scheduling substrate for Springroll — in-process locally via the RivetKit library, and on Rivet Cloud (under our org, invisible to users) for the paid hosted tier. The same actor code runs in both places, which collapses the two-runtime problem the Turso-sync plan was designed to solve, and deletes the hardest planned work: the lease/fencing-token occurrence-claiming design, the Inngest integration, and the `@tursodatabase/sync` layer.

What Rivet is **not** for us: we do not use agentOS (its WASM sandbox for bash/Python/filesystem). Runs remain pure I/O per the product brief. Rivet is where a run *lives*, not what a run *is*.

## Adoption decision

Springroll adopts Rivet Actors based on the R0 evidence recorded in `spikes/rivet-r0/README.md`. The kernel's unmodified `runTask` + `AiSdkAgentRunner` completed inside an actor; actor SQLite and immediate state saves preserved an approval checkpoint across kill/restart/resume; a missed schedule fired after restart; and cursor catch-up recovered durable events. The chosen long-run shape admits work through actions and executes it from a durable queue in the actor `run` handler under `c.keepAwake()`. A measured run stayed active beyond the default 60-second action timeout and resumed to success.

The transient closed-SQLite-coordinator wake race is handleable with a narrow bounded retry and is tracked upstream as [rivet-dev/rivet#5554](https://github.com/rivet-dev/rivet/issues/5554). Engine storage and endpoints are isolated, the future desktop lifecycle contract is documented, and all packages now share one compatible Drizzle instance. These results remove the architectural reasons to retain Turso sync, distributed lease/fencing claims, or Inngest.

Adoption does not mean every production risk is closed. A real-model run through the existing OpenRouter connection passed; the opt-in direct OpenAI path remains optional cross-provider coverage. Actor upgrade migrations, crash recovery after queue consumption, multi-hour behavior, Rivet Cloud deployment/pricing, hosted secrets, and tenancy guards remain explicit R2/R3 work. None changes the selected host boundary; failure in a later proof can still use Rivet's self-hosted engine or replace the isolated host layer without changing the runner.

## Rivet primitives (as of 2026-08)

- **Package**: `rivetkit` (npm). Actors are plain TypeScript:

  ```ts
  export const taskActor = actor({
    state: { /* durable, auto-persisted on ~1s throttle */ },
    actions: { /* RPC surface; the ONLY way clients read/write */ },
  });

  export const registry = setup({ use: { taskActor, accountActor } });
  registry.start(); // local dev: in-process, file-system persistence, inspector at localhost:6420
  ```

- **State**: `c.state` for small durable values (force-persist with `c.saveState({ immediate: true })`); embedded per-actor SQLite `c.db` for queryable/large data, **with Drizzle ORM support** — our existing ORM.
- **Scheduling**: `cron.set()` (5-field cron, timezone-aware), `schedule.at()/after()` one-shots. Schedules survive sleep, restarts, upgrades, and crashes; Rivet wakes the actor when due. Overlapping recurring runs are skipped (single-threaded actors → double-fire protection is free). **Failed runs are not retried** — our checkpoint/resume machinery remains load-bearing.
- **Events**: broadcast to *currently connected* clients only. Transient by design — the live view, never the record.
- **Auth**: `createConnState`/`onBeforeConnect` hooks; clients pass tokens via `getParams`. Rivet Cloud actors are private by default. (Self-hosted actors are **public by default** — must implement auth before ever exercising the self-host escape hatch.)
- **Deployment**: same code → local process, Rivet Cloud, or self-hosted engine (single Rust binary; Vercel/Railway/K8s/bare metal also supported). Open source, so the vendor exit is real.

## Concept mapping

| Springroll today | Under Rivet |
| --- | --- |
| Task + schedule (`cron-schedule-engine.ts`, `next_run_at`) | One actor per task, `cron.set()` / `schedule.at()` |
| Tick loop (`tick.ts`, `local-tick-loop.ts`) | Deleted — Rivet wakes actors on alarms |
| Planned lease/fencing occurrence claiming (TODO Phase 6) | Deleted — single-threaded actors + overlap-skip |
| Planned Inngest durable scheduling | Deleted — actor alarms |
| Planned Turso per-user DB + sync | Deleted — actor-owned state + mirror protocol (below) |
| `runs` / `runCheckpoints` / `runEvents` for a task | Task actor's embedded SQLite (`c.db`, Drizzle schemas) |
| Live run view in the app | Actor events over `.connect()` while the app is open |
| `taskRecipeKnowledge` | Task actor's SQLite — runs mutate it, so it lives with the executor |
| Cross-task ledger (`modelCalls`, `credentialAuditEvents`) | Per-user **account actor** (hosted); local SQLite stays authoritative for local tasks |
| `chatSessions` / assistant | Stays local, unchanged (revisit only for cross-device chat) |
| Agent runner (`ai-sdk-agent-runner.ts`), tool registry, connectors | Unchanged — invoked from inside the actor instead of the tick loop |
| Keychain credentials | Unchanged locally; hosted adds KMS-backed secret store (already planned) |

## Data ownership: one writer per row

Rivet provides no database sync. Instead we enforce an ownership discipline that makes sync trivial because conflicts are impossible by construction:

1. **The executor owns the run-time data.** A local task's rows live in local SQLite as today. A cloud task's `runs`/`runCheckpoints`/`runEvents`/`taskRecipeKnowledge` live in its actor's embedded SQLite. Local SQLite holds read-only *mirror* rows for cloud tasks. Never both-ways writable.
2. **Config flows one way, on edit.** The app is the editor; the actor is the executor. Task definition, pinned tools, model settings are pushed to the actor via an action at promote-time and on each edit.
3. **History flows one way, on demand.** Each task actor exposes `getHistorySince(cursor)`. The app calls it on launch/reconnect and appends the results to local mirror rows. Append-only + single writer + monotonic cursor = no conflict handling needed. Live events (`.connect()`) are only for watching a run in real time; missing them costs nothing.
4. **The account actor aggregates.** One per hosted user: usage/cost entries reported by that user's task actors, credential audit events, the index of cloud tasks, and subscription state. The app mirrors one actor for the ledger instead of fanning out to N.

The laptop-closed scenario, end to end: cron fires → Rivet wakes the task actor → it runs the agent loop (pure I/O works identically from cloud) writing events/checkpoints/costs to its own SQLite → actor sleeps. Nothing contacted the user's machine; nothing is out of sync. Next app launch calls `getHistorySince` and the run appears in local history.

## Multi-tenancy, auth, and the trust model

- **One Rivet org: ours.** Users never see Rivet, the same way app users never see AWS. Actor keys are namespaced: `account:{userId}`, `task:{userId}:{taskId}`.
- **Only our code runs in actors** — the same thin agent host. Users supply config and credentials, never code. Multi-tenant risk is therefore data isolation (per-actor by construction) and credential handling, not code isolation. No sandbox required, consistent with the brief.
- **Auth = device pairing (already planned, better-auth).** Pairing issues a token the menubar app holds; connections pass it via `getParams`; `createConnState` verifies and stamps `{userId, plan}`. Every action checks connection `userId` against the actor's key through one shared guard helper — this two-line check is the tenancy boundary; no action skips it.

## Secrets (hosted)

Unchanged in difficulty by Rivet; the planned KMS work item is the answer. At promote-time the app uploads the task's connector credentials (and BYOK LLM keys) encrypted to our KMS-backed secret store. The actor fetches at run start, holds plaintext in memory only, never writes it to `c.state`/`c.db`, and appends an audit entry to the account actor per access. Open product decision: hosted stays BYOK (we meter their spend — `modelCalls` already does) vs. bundled model access (simpler UX, but we resell tokens and need per-user spend caps). BYOK-first is the smaller step and matches the cost-transparency philosophy.

## Billing and plan lifecycle

The account actor is the Stripe meter: subscription state lives on it, usage line items read from it.

- **Subscribe** → account actor created; promote unlocks.
- **Promote** → export task rows from local SQLite → create actor → import into its SQLite → mark local rows as mirrors. An explicit, atomic-feeling migration with a single owner at every moment — not a boolean on the task row.
- **Payment failure** → account actor clears each task actor's cron. State kept (cheap at rest), runs paused gracefully.
- **Demote / cancel** → reverse migration: actor state exported back into local SQLite, actor destroyed. "Leave the paid tier with all your data" falls out of the promote/demote design — a first-class feature for a local-first product, and the answer to data portability.
- **Delete account** → destroy actors, purge secret store.

COGS is roughly proportional to run minutes (actors sleep at idle, scale to zero) plus small resident-state cost.

## Fitting Springroll to Rivet's specs — and where not to

Adopt Rivet's shapes wholesale where they are good discipline regardless of vendor:

- Action-based reads (no direct state access) — matches the existing "everything through the application-tool registry" instinct.
- Transient events + durable per-actor store — the live-TV/DVR split; design the UI around catch-up-by-action, not event replay.
- Cron overlap-skip and no-retry semantics — lean on our checkpoint/resume for recovery rather than expecting the scheduler to retry.
- Single-writer data ownership — worth enforcing even if we never ship hosted.

Keep abstracted (the vendor-coupling firewall):

- The agent runner stays a pure function: (task config, checkpoint in) → (events out, checkpoint out). Actors host it; they must not seep into it.
- The checkpoint store stays behind its existing interface; the actor-SQLite implementation is a sibling of `sqlite-run-checkpoint-store.ts`, not a replacement of the interface.
- `ToolSource`, connectors, credential store: no Rivet imports, ever.
- Confine `rivetkit` imports to a `kernel/src/host/` (or similar) layer so the exit — self-hosted engine or a different substrate — is a host-layer swap.

## Transition phases

**Phase R0 — spike (1 week, before touching the roadmap).** Prove the risky unknown: a long AI SDK tool loop inside an actor under Bun. Validate: `c.db` + Drizzle migrations; `saveState({ immediate: true })` at checkpoint boundaries (default persistence throttles ~1s — a crash must not lose a checkpoint); cron wake after process restart; RivetKit coexisting with `Bun.serve` + bun:sqlite in one process; behavior when a run outlives typical action timeouts. Exit criteria: an HN-digest run executes to completion inside a local actor with resumable checkpoints.

**Phase R1 — seam hardening.** Make the runner's purity contract explicit; freeze tick-loop investment. Mostly verification work — the seams largely exist.

**Phase R2 — local adoption.** Replace the tick loop with RivetKit in-process: task actors own scheduling and run-time state locally. One codepath for local and (future) cloud. Local SQLite remains authoritative for the ledger, catalog, chats, and task editing. Same local limitation as today — schedules fire only while the app runs — until Phase R3.

**Phase R3 — hosted enablement.** Deploy the registry to Rivet Cloud under our org. Build: account actor, auth hooks + tenancy guard, `getHistorySince` catch-up, promote/demote migration, KMS secret store, device pairing. (Better-auth, KMS were already planned; they attach to the account actor instead of a synced DB.)

**Phase R4 — billing.** Stripe on the account actor; lifecycle wiring per above. Resend for lifecycle email as planned.

## Impact on TODO.md Phases 6–7

Retired: Turso Cloud per-user DB, `@tursodatabase/sync`, lease/fencing-token occurrence claiming, Inngest. Kept, re-homed onto the account actor: better-auth device pairing, Stripe, Resend, cloud KMS/managed secret store.

## Risks and open questions

- **Queue-consumption recovery**: long work runs outside action RPCs in the actor `run` handler under `c.keepAwake()`. R2 must define recovery when a process dies after consuming a queued occurrence but before the next kernel checkpoint.
- **No scheduler retry**: crashed occurrences wait for the next cadence unless we schedule a one-shot resume ourselves. Decide policy in R2.
- **Rivet maturity/pricing**: Rivet Cloud pricing not yet modeled; company is young. Mitigations: open source + self-host escape hatch, and the host-layer firewall above.
- **stdio MCP connectors are local-only** in the cloud tier (no process spawning by design). Task promote eligibility must be explicit in the model.
- **BYOK vs bundled models for hosted** — product decision, not blocking.
- **Actor upgrade mechanics**: docs say schedules survive upgrades; verify state-schema migration story for `c.db` across deploys during R0/R3.

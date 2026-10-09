---
name: sprites
description: Run heavy or long work on Fly Sprites (cloud Linux computers that sleep when idle) instead of this machine: set up a project's Sprite, run batch jobs and builds there, check on them, keep costs down. Use when work needs lots of memory/CPU or hours of runtime, when the owner says "run it on a Sprite" / "in the cloud", or for a project whose LOCAL.md entry says it lives on a Sprite. Needs the Fly Sprites connection.
---

# Sprites: heavy work on cloud computers

This machine is small and always on; it holds the Desk, chats and data. Heavy
work (a batch over thousands of items, a big build, several browsers) goes to
a **Sprite**: a Linux computer at Fly.io with 8 vCPUs, memory that grows under
load (8 GB by default, 16 GB on request), 100 GB disk. It sleeps ~30 s after
nothing is running (compute billing stops; files stay) and wakes in about a
second. You stay here and drive it.

Check it's connected: `sprite list`. If `sprite` is missing or unauthorized,
the owner connects **Fly Sprites** in the Desk (Connections → Compute).

## One Sprite per project, not per task

Name it after the project (`carrot`, not `carrot-run-12`). Set it up once and
reuse it: the repo, dependencies, browser and sign-ins stay installed.

    sprite create carrot
    sprite exec -s carrot -- bash -lc 'git clone https://github.com/<owner>/<repo> ~/carrot-extract'

Private repos: pass a token for the clone only and don't leave it in the
remote URL, e.g. `git clone https://x-access-token:$(gh auth token)@github.com/…`
then `git -C ~/repo remote set-url origin https://github.com/…`. For pushes,
set up `gh` inside the Sprite (`gh auth login --with-token` from `gh auth token`)
after asking the owner.

Install what the project needs (`uv sync`, `npm ci`, `playwright install --with-deps chromium`),
copy its secrets (`.env`) with `sprite exec --file local:remote` (never echo
them), then save the ready state: `sprite checkpoint create --comment "ready"`.

CLIs that need an interactive sign-in inside the Sprite (Cursor `agent login`,
others): tell the owner to open the Desk's Terminal and run
`sprite console -s carrot`, then the login command. One time per Sprite.

Record it in `~/home/LOCAL.md` ("carrot-extract runs on Sprite `carrot`: repo at
~/carrot-extract, refresh with `make refresh`") so other agents and jobs find it.

## Running work

Short commands (seconds to a few minutes): `sprite exec -s carrot --dir ~/carrot-extract -- make test`.

Anything longer: **always `sprite-job`**. A plain `exec` dies when your session
ends or the Sprite pauses; `sprite-job` runs detached and holds the Sprite awake
until the work finishes (Sprites Tasks API).

    sprite-job start  carrot refresh --dir ~/carrot-extract -- make refresh
    sprite-job status carrot             # all jobs: running/done, exit code, duration
    sprite-job logs   carrot refresh 80  # tail the log
    sprite-job wait   carrot refresh 300 # block (checks each minute) up to 300 min; exits with its code
    sprite-job stop   carrot refresh

From a scheduled job here: start it, `wait` for it (or check back with
`status` and `logs`), then report the outcome from the log: what ran, how long,
what changed, failures. Results that matter belong where the project keeps them
(its database, storage, a PR), not on this machine.

Several independent pieces: start several jobs (different names) or several
Sprites; they run in parallel.

## Memory and failures

- A job that dies with exit 137 or "Killed" ran out of memory. Reduce
  parallelism (fewer workers, `--max-old-space-size`, smaller batches) and
  retry; if it needs more than 8 GB, the owner can ask Fly support for 16 GB.
- `status` says "lost": the Sprite restarted mid-run; start it again (make the
  work resumable where the project supports it).
- Before risky changes: `sprite checkpoint create --comment "before X"`;
  undo with `sprite restore <version>` (`sprite checkpoint list`).

## Costs and housekeeping

You pay per CPU-hour and GB-hour only while a Sprite is active, plus disk.
Don't hold one awake without work running. `sprite list` shows what exists;
delete what's no longer used (`sprite destroy <name>`, ask first: it deletes
its files). Mention the run time in your report so the owner can see cost.

## Other things Sprites do

- Every Sprite has a URL (`sprite url`), private by default. A web app running
  there can be opened with `sprite proxy <port>` or made public (ask first).
- Services restart processes after a cold wake (`docs.fly.io/sprites/concepts/services`).
- Docs: `curl -s https://docs.fly.io/llms.txt | grep -i sprites`.

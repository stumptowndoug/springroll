---
name: timeline
description: How Springroll's Timeline works and how to put things on it - Needs you (waiting on the owner), Worth knowing, Running - with the `signal` command and the /signals API, and how to connect an outside source of to-dos (PRs, tickets, invoices) with `signal sync`. Use when something should reach the owner, when connecting a source, or when changing the Timeline.
---

# Timeline

Springroll's first page (the Timeline, `#/`) is everything that happens on the box, in one feed,
newest first, with no sections. **Today starts with what waits on the owner** (Needs you): rows
marked by an amber icon, ranked by a model (`views/desk/needs.mjs`; agent, model, reasoning, how
often and its instructions in Settings → Needs you). It reads the signals, failed runs, reports and
triaged mail of the last 36 hours, merges what belongs together, ranks it, and writes one line on
why each matters and a starter prompt (what Chat opens with). 👍/👎 and the owner's instructions in
`~/data/desk/needs/preferences.md` steer the next read. Approvals, sign-ins, key requests and setup
keep their own rows and buttons, and a flagged item the read hasn't covered yet shows as is.
Clicking a waiting row opens its chat; Chat / View / 👍 / 👎 / Done show on hover. Then what's
**running**, then **every job run** (its report) and every **Worth knowing** item, by day, each
tagged with where it came from (the job, or the signal's `source`). A job's fine runs fold into one
line per day once there are three. Search and filters (All / Reports / Failed, one source) hide
behind icons in the heading (`#/?from=job:<name>` or `#/?from=src:<Source>` links straight to one
source). The calendar icon switches the feed to **Upcoming**: every scheduled run in the next week
by day (`GET localhost:8000/api/upcoming?days=7`), a job that runs more than three times a day
folded to one line. No morning brief: the owner turned it off. Jobs has no run list of its own:
runs live here.

## Signals

**Needs you is Springroll's inbox**: anything that's waiting on the owner, from anywhere (a job, an
agent, an app, a connector to GitHub, Jira, Linear, a bank). Each item is a pointer plus a
conversation: the owner reads the title, presses **Chat** (an agent gets the item and your `note`
on how to act on it), **View** (your `href`: a Springroll route or a URL) or **Done**. Worth knowing
is the same for things they'd want to know today but needn't act on; it sits in the day's feed at
its time. Not "the job ran fine": the run is already there. Give every signal a `source`: it's the
tag the owner filters by.

    signal --needs "Approve the vendor quote?" "€1,200, expires Friday"   # waiting on the owner
    signal "Hetzner invoice: €18.40" "Matches last month."                 # worth knowing (3 days)
    signal --needs --key price:tv --icon tag --url https://… \
      --note "Buy with the saved card only if the owner says so" "TV dropped to $899"
    signal --clear price:tv                             # handled: take it back
    signal --running --key import:crm "CRM import" "12k of 40k rows"   # long work outside a job run
                                                        # (Running section; post again to update, --clear at the end)
    signal list [prefix]                                # what's showing

Item fields: `title`, `body` (one or two lines), `key` (stable id; posting the same key replaces the
item), `source` ("GitHub"), `icon` (a Lucide name), `href`, `note` (what an agent needs to act: ids,
commands, limits), `rev` (what it looks like upstream, e.g. its updated time), `hours` (expiry). A
`--needs` item pings the owner's phone once, when it's new; posting it again unchanged does nothing.
Run from a chat or job, a signal links back to it.

## Connecting a source

For PRs to review, tickets assigned, invoices due: a command job that asks the service for what's
open now and syncs the whole list:

    gh search prs --review-requested=@me --state=open --json … \
      | jq -c '.[] | {key: "github:review:\(.repository.nameWithOwner)#\(.number)", title, href: .url, rev: .updatedAt, note: "…"}' \
      | signal sync github:review: --source GitHub --icon git-pull-request --needs

`signal sync <prefix>` takes the items on stdin (JSON lines or an array): new ones appear (one
notification for all of them), ones no longer listed come off the Timeline, and ones the owner
marked **Done stay done until their `rev` changes**. Give each source its own prefix. Schedule it
every 15 minutes with `"keep": "failures"` (good runs aren't kept as chats) and an `onlyIf` that
checks the service is connected. `jobs/github-reviews/` is the example to copy. Use a command job
when the service has an API or CLI (no AI needed to list things); use an agent job only when
deciding what matters takes judgment.

## From an app

Its server POSTs to `localhost:8090/signals` (or `/signals/sync`); its page can call
`desk.signal({...})` / `desk.syncSignals(prefix, items, {source, icon, level})`. API:
`GET/POST localhost:8090/signals`, `POST /signals/sync`, `POST /signals/clear {key}`,
`POST /signals/<id>/dismiss`.

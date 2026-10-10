---
name: update
description: Update this machine's Springroll from upstream by merging the `upstream` branch into ~/home with judgment, respecting the owner's changes (LOCAL.md, DESIGN.md). Used by the weekly springroll-update job, or when the owner asks to "update Springroll" / "check for updates".
---

# Update: merge upstream Springroll into this machine

This machine is the owner's own version of Springroll. Upstream (the public
Springroll) keeps improving; you bring those improvements in like a maintainer
merging an upstream project: take what fits, adapt what conflicts with the
owner's choices, skip what they've replaced or rejected, and say what you did.
The owner's changes always win over upstream's.

## 1. See what's new

    springroll-upstream

It refreshes the `upstream` branch and lists unmerged upstream commits, the
files involved (marked "also changed here" when the owner changed them too),
and the new CHANGELOG.md entries. If it says "Up to date", stop and report
that in one line.

Read: the new CHANGELOG entries (what, why, migrations, "If you changed
this"), `LOCAL.md` (how this machine differs and why), and `DESIGN.md` (the
owner's taste, which may differ from stock).

## 2. Prepare

- Commit anything uncommitted in ~/home first ("Owner changes before update").
- Take a backup: `backup --keep 7`.
- Work on a branch: `git switch -c update-$(date +%F)`.

## 3. Merge

    git merge upstream --no-commit --no-ff

Then go through every file the merge touched (`git status`, `git diff --cached`):

- **Clean and the owner never touched it:** keep upstream's version.
- **Conflict, or the owner replaced this area** (LOCAL.md says so, or the file
  is "also changed here"): resolve by intent. Keep the owner's version and
  carry upstream's idea into it when it fits (the changelog's "If you changed
  this" says how). Match the owner's design rules, not stock ones.
- **The owner removed or rejected it** (deleted a View, opted out of a
  feature in LOCAL.md): keep it removed (`git rm` / `git checkout --ours`).
- **Big or risky for this owner** (it would remove something they use,
  migrate their data, or change how they work): don't apply it; list it
  under "Needs you" with a one-line question.

Run each changelog **Migration** that applies (packages, data). Keep notes of
what you took, adapted, skipped and why.

## 4. Check before keeping it

- `node --check` changed .mjs/.js; restart Springroll (`systemctl --user restart desk`),
  then `curl -fsS localhost:8000/`, `/api/views`, `/api/agent/threads`, and
  every View: `curl -fsS localhost:8000/v/<name>/`.
- For visible changes, screenshot Home, a chat, and any app you touched with
  Playwright (DESIGN.md "Before you say a View is done") and look at them.
- If something is broken and you can't fix it quickly: `git merge --abort` or
  `git switch main && git branch -D update-…`, restart Springroll, and report
  what failed. The owner's machine must end up working.

## 5. Keep it

    git commit -m "Update from Springroll upstream <version>: <took>, <adapted>, <skipped>"
    git switch main && git merge --ff-only update-<date> && git branch -d update-<date>

Update `LOCAL.md` if you adapted or skipped something (so the next update
knows), and add a line to `notes/log.md`.

Link any new skills for every agent:
`for d in ~/.claude/skills ~/.codex/skills ~/.pi/agent/skills; do mkdir -p $d; for s in ~/home/skills/*/; do ln -sfn "$s" "$d/$(basename "$s")"; done; done`

**Restart agentd last, and not directly:** you are probably running inside it.
If agentd/ changed, schedule it only after the merge into `main` above and
everything else in this step (a restart scheduled earlier, e.g. while checking
on the update branch, starts the old code and nothing restarts it again):
`systemd-run --user --on-active=60 systemctl --user restart agentd`.
It should be the last command you run before your report.

## 6. Report (what the owner reads, and what reaches their phone)

Publish it with `report` (see `skills/report/SKILL.md`), then end the run with one short
line, not a recap: the report already shows at the end of the chat. Lead with the
outcome, then four short lists, empty ones left out:

- **Took:** what's new for the owner, in their words ("Chat no longer flashes").
- **Adapted:** what you fit to their version and how.
- **Skipped:** what you left out and why.
- **Needs you:** questions, each answerable with yes/no.

Undo is one revert: `git revert -m 1 <merge commit>` (mention it only if
something looks off).

---
name: orchestrate
description: Plan a piece of work, delegate the implementation to a different agent CLI running headless (Codex, Claude Code, OpenCode, Pi), review its diff, then get a fresh-context audit from a third. Use when the owner asks to "have codex do it", "get a second opinion", "delegate", or "orchestrate". Don't self-select for ordinary tasks; suggest it instead.
---

# Orchestrate: plan → delegate → review → audit

You are the planner and reviewer. A **worker** (another agent CLI, headless)
edits files. An **auditor** with fresh context reviews the result. You own the
plan, git, and the verdict.

## Who does what

Read `~/home/agents/agents.json` for the installed harnesses and their
`headless` / `headlessContinue` commands (check `command -v <bin>`). Prefer a
worker from a different model family than yours, and an auditor from a third
when available: cross-model review catches uncorrelated blind spots. Use each
CLI's default model unless the owner pins one. Flags drift between versions:
on failure, check `--help` once, adapt, then fall back to the next CLI and say
so in your report.

## Steps

1. **Plan.** Explore enough to be concrete. Write `.orchestrate/<slug>/plan.md`
   and one self-contained spec per task (goal, files to touch and not touch,
   acceptance checklist, a verify command, and "Do not commit."). The worker
   sees only the spec and the repo. Keep `.orchestrate/` out of git.
2. **Dispatch** one task at a time in the background (parallel only with a
   separate git worktree per worker).
3. **Review** the diff against the spec. Run the verify command yourself; never
   trust a claimed pass. Fix small issues yourself; send substantive misses back
   with `headlessContinue` (at most two rounds, then take it over).
4. **Audit** with a fresh headless run told to only read: give it the goal and
   the full diff, ask for bugs, missed requirements and convention violations.
   Fix real findings, dismiss false positives with a reason.
5. **Report**: what was built, verification output, who did what, audit
   findings and resolutions, substitutions, open items.

You own git: workers never commit, branch or push. Ask the owner before
anything scope-changing, destructive or outward-facing.

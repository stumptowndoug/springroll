#!/usr/bin/env bash
# Pull requests waiting on the owner's review → Home's "Needs you", kept in step every 15 minutes.
# A connector in one pipe: ask the service for its open items, shape each as a signal, and
# `signal sync` the whole list (new ones appear and ping once, finished ones disappear, ones the
# owner marked done stay done until the PR changes). Copy this for any other source.
set -euo pipefail
gh search prs --review-requested=@me --state=open --limit 50 \
    --json number,title,repository,url,updatedAt,author,isDraft \
  | jq -c '.[] | select(.isDraft | not) | {
      key: "github:review:\(.repository.nameWithOwner)#\(.number)",
      title: .title,
      body: "\(.repository.nameWithOwner)#\(.number) · by \(.author.login)",
      href: .url,
      rev: .updatedAt,
      note: "A pull request waiting on the owner'"'"'s review. Read it with `gh pr view \(.number) -R \(.repository.nameWithOwner)` and `gh pr diff \(.number) -R \(.repository.nameWithOwner)`. Summarize what changes and anything risky. Submit a review (`gh pr review \(.number) -R \(.repository.nameWithOwner) --approve|--comment|--request-changes -b ...`) only when the owner says what it should say."
    }' \
  | signal sync github:review: --source GitHub --icon git-pull-request --needs

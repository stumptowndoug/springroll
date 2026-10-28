#!/usr/bin/env bash
# Lists git worktrees of ~/projects repos and says which are finished: clean, merged, untouched
# for a day, and not used by a job, a dev recipe or a running process. --remove removes those
# (git worktree remove, never --force; the branch stays). Everything else is listed with why it stays.
set -uo pipefail
remove=0; [ "${1:-}" = "--remove" ] && remove=1
now=$(date +%s)
refs=$(cat ~/home/jobs/*/job.json ~/home/jobs/*/NOTES.md ~/home/views/dev/recipes/*.json 2>/dev/null)
cwds=$(for p in /proc/[0-9]*; do readlink "$p/cwd" 2>/dev/null; done | sort -u)

for gitdir in ~/projects/*/.git; do
  [ -d "$gitdir" ] || continue
  repo=$(dirname "$gitdir"); name=$(basename "$repo")
  git -C "$repo" worktree prune
  git -C "$repo" worktree list --porcelain | awk '/^worktree /{print substr($0,10)}' | tail -n +2 |
  while read -r wt; do
    short=${wt/#$HOME/\~}
    why=""
    if grep -qF -e "$wt" -e "$short" <<<"$refs"; then why="used by a job or dev recipe"
    elif grep -qE "^$wt(/|$)" <<<"$cwds"; then why="a process is running in it"
    elif [ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ]; then why="uncommitted changes"
    else
      log="$(git -C "$wt" rev-parse --git-dir)/logs/HEAD"
      age=$(( (now - $(stat -c %Y "$log" 2>/dev/null || stat -c %Y "$wt")) / 3600 ))
      git -C "$repo" fetch -q origin 2>/dev/null
      def=$(git -C "$repo" symbolic-ref -q --short refs/remotes/origin/HEAD || echo origin/main)
      branch=$(git -C "$wt" branch --show-current)
      merged=""
      git -C "$wt" merge-base --is-ancestor HEAD "$def" 2>/dev/null && merged=yes
      if [ -z "$merged" ] && [ -n "$branch" ]; then  # squash-merged PRs aren't ancestors
        state=$(cd "$repo" && gh pr list --head "$branch" --state merged --json number -q 'length' 2>/dev/null)
        [ "${state:-0}" -gt 0 ] && [ -z "$(git -C "$wt" log --oneline "@{u}..HEAD" 2>/dev/null)" ] && merged=yes
      fi
      if [ -z "$merged" ]; then why="not merged into $def"
      elif [ "$age" -lt 24 ]; then why="touched ${age}h ago"
      fi
    fi
    size=$(du -sm "$wt" 2>/dev/null | cut -f1)
    if [ -n "$why" ]; then
      echo "keep    $short (${size} MB): $why"
    elif [ $remove = 1 ]; then
      if git -C "$repo" worktree remove "$wt" 2>/dev/null; then
        echo "removed $short (${size} MB, ${branch:-detached}, merged)"
      else echo "keep    $short (${size} MB): git refused to remove it"; fi
    else
      echo "done    $short (${size} MB, ${branch:-detached}, merged): removable"
    fi
  done
done

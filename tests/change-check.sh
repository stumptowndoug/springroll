#!/usr/bin/env bash
# The change flow on a throwaway Springroll, run as the agent user (tests/fresh-install.sh runs it):
# page code is served as committed, a change runs as a copy and merges once, tidy and shots work.
# It commits to ~/home: never run it on a machine someone uses.
set -uo pipefail
[ "${1:-}" = --throwaway ] || { echo "usage: change-check.sh --throwaway   (it commits to ~/home)" >&2; exit 2; }
. ~/.config/springroll/env 2>/dev/null
export PATH="$HOME/home/bin:$HOME/.npm-global/bin:$PATH"
pass=0 fail=0
ok() { if eval "$2" >/dev/null 2>&1; then echo "  ✓ $1"; pass=$((pass+1)); else echo "  ✗ $1"; fail=$((fail+1)); fi; }
cd ~/home || exit 1
P=views/desk/public/app/main.js W=~/work/home-probe
echo '// probe-uncommitted' >> "$P"; sleep 3
ok "an uncommitted edit to page code isn't served" "! curl -fsS localhost:8000/app/main.js | grep -q probe-uncommitted"
git checkout -q "$P"
ok "change start makes a worktree" "change start probe && test -d $W"
echo '// probe-change' >> "$W/$P"; git -C "$W" commit -qam probe
ok "change up runs a copy" "change up probe"
ok "the copy serves its edit" "curl -fsS localhost:\$(sed -n 's/^DESK_PORT=//p' ~/work/.changes/probe.env)/app/main.js | grep -q probe-change"
ok "the live desk doesn't" "! curl -fsS localhost:8000/app/main.js | grep -q probe-change"
ok "change merge" "change merge probe"
sleep 3
ok "after the merge the live desk serves it" "curl -fsS localhost:8000/app/main.js | grep -q probe-change"
ok "the merge removed the worktree, branch and copy" "test ! -d $W && ! git rev-parse -q --verify change/probe && ! systemctl --user is-active change-probe-desk"
ok "change tidy has nothing to do" "change tidy | grep -q 'nothing to tidy'"
ok "shots takes screenshots" "shots /v/settings/ --widths 375 --themes springroll-dark --out /tmp/probe-shots && test -s /tmp/probe-shots/springroll-dark-375.png"
echo "change-check: $pass passed, $fail failed"
[ "$fail" = 0 ]

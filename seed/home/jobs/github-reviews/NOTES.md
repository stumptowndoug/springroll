# GitHub reviews

Puts pull requests waiting on the owner's review on Home (Needs you) with `signal sync github:review:`.
Runs only when `gh` is signed in. To change what counts (also the owner's own PRs with failing checks,
issues assigned to them), edit `sync.sh`; keep every key under `github:review:` or give the new kind its
own prefix and its own `signal sync`.

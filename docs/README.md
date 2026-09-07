# Springroll documentation

Start with the [product README](../README.md) or [friends-beta instructions](friends-beta.md).

| Topic | Guide |
| --- | --- |
| Security model and data flow | [security-and-data.md](security-and-data.md) |
| Pre-release security review | [security-review-2026-09-06.md](security-review-2026-09-06.md) |
| Mac bundle size and optional runtimes | [mac-bundle-size.md](mac-bundle-size.md) |
| Mac development and packaging | [desktop README](../desktop/README.md) |
| Publishing a release | [releasing.md](releasing.md) |
| Release acceptance | [launch-readiness.md](launch-readiness.md) |
| OAuth availability | [oauth-setup-status.md](oauth-setup-status.md) |
| Contributor OAuth configuration | [one-click-connectors.md](one-click-connectors.md) |
| Models and subscriptions | [model-providers.md](model-providers.md) |
| Web research | [web-research.md](web-research.md) |
| Integration architecture | [integration-runtime.md](integration-runtime.md) |
| Missed scheduled runs | [missed-run-policy.md](missed-run-policy.md) |
| Active work | [TODO.md](../TODO.md) |

Architecture and planning documents describe design rationale; the current code,
active board, and release acceptance notes take precedence over historical plans.
`archive/` contains dated records. Most superseded HTML mockups and the obsolete
integration screenshot were removed from the current tree during the September 6
cleanup; earlier commits retain them. References in historical board entries are
historical paths, not current setup instructions. Current design guidance remains
in `design/`; shipped assets live in `desktop/icons` and the application source.

Local account details, recordings, build artifacts, logs, and editor state are not
public documentation and belong outside Git. Removing a file from the current tree
does not remove it from Git history; this cleanup did not rewrite history.

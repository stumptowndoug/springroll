# Mac bundle size and optional runtimes

Measured from the published v0.1.0 ZIP (candidate 3) on September 6, 2026.
The download is 461.2 MB (439.9 MiB). Uncompressed archive entries total about
1.238 GB. Finder, disk usage tools, and ZIP entry totals differ because of units,
filesystem allocation, metadata, compression, and symlinks.

| Group | Uncompressed MB | Compressed entry MB |
| --- | ---: | ---: |
| Codex packages | 286.6 | 110.3 |
| Claude packages | 203.3 | 86.5 |
| Rivet engine/packages | 219.9 | 80.4 |
| Bun runtime | 61.9 | 25.4 |
| Secure-execution/other agent packages | 59.6 | 15.4 |
| Browser UI, including source maps | 55.2 | 12.4 |
| Other app/dependencies | 351.4 | 102.4 |

Compressed entries exclude ZIP headers and other archive overhead; their sum is
not the final download size. In MiB, Codex contributes about 105 and Claude 83.
The Rivet engine appears twice (runtime/bin plus its package), each about
83.8 MB uncompressed / 32.4 MB compressed. There is useful cleanup beyond the
two optional subscription runtimes.

## On-demand subscription support

Desktop builds now omit the Codex and Claude native payloads while keeping the
SDK/control code. Settings checks for a compatible CLI on PATH and common Mac
installation paths first. Otherwise the user explicitly clicks **Download Codex
support** or **Download Claude support**, then signs in after installation.
Startup, status checks, and recipe execution never initiate downloads.

The committed `kernel/src/subscription-runtime-manifest.json` pins official npm
native packages for Intel and Apple Silicon Macs, their SHA-512 checksums, and
vendor Apple signing identities. Downloaded archives retain their license files;
Springroll checks the complete checksum, rejects archive links/traversal, verifies
the native signature and CLI version, then atomically installs a versioned cache
beside the workspace database. There is no unpinned package-manager install.
Settings shows progress, cancellation, errors, and retry. Installer locks prevent
concurrent writes. Interrupted staging directories are never treated as installed.

Compatibility currently means the tested major/minor family and at least the
pinned patch: Codex 0.153.2+ within 0.153, Claude 2.1.260+ within 2.1. Other version
families use the pinned download until tested. Locally installed CLIs are trusted
user software; managed downloads additionally require vendor signature checks.
Springroll keeps its own Codex/Claude authentication directories regardless of
which executable it uses. It does not borrow or modify terminal login state.

The duplicate Rivet executable is replaced with a relative link to its packaged
copy. Other dependency assets and browser source maps are unchanged. Automated
checks cover explicit-only downloads, reuse, checksum/signature rejection,
archive links, cancellation/retry, and concurrent requests. Real Apple Silicon
Codex and Claude downloads passed vendor signature and version verification;
Codex app-server initialization and Claude auth status also passed with fresh
isolated authentication directories.
Fresh-workspace packaged launch/relaunch checks pass; different-Mac sign-in and
scheduled subscription runs remain release acceptance checks.

The Apple Silicon development ZIP measured 243,664,888 bytes (243.7 MB /
232.4 MiB), versus the original release ZIP at 461.2 MB: about 47% smaller.
This is a development-build comparison, not a new signed-release measurement.

## Rivet and hosted execution

Today's Rivet scheduler runs locally, so it uses these local executables and
Springroll's isolated sign-ins. Moving execution to a hosted worker would require
compatible executables on that worker (preinstalled or provisioned into a durable
cache), plus a separately designed per-user authentication lifecycle. A runtime
on a user's Mac does not authenticate a remote worker. Remote scheduling that
dispatches execution back to the Mac would still require that Mac to be available.
Hosted subscription execution is not implemented by this packaging change.

## Installer format

The initial ZIP lacked the normal Mac installation window. A DMG now provides
Springroll.app beside an Applications shortcut, with a saved Finder icon layout.
This wraps the existing notarized app; it does not implement optional downloads
or change the application's runtime footprint. The DMG compresses differently
and is about 425 MB before its small signing/notarization metadata additions.

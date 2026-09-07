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

## Preferred next change: install subscription runtimes on demand

When the user clicks Connect for Codex or Claude, show download progress before
opening sign-in. Ordinary API-key users should not download either runtime.
Once installed, subsequent connections and runs reuse the local copy.

Implementation work still required:

1. Separate optional executable payloads from always-loaded SDK/control code.
   Status checks and application startup must tolerate a missing runtime; they
   must not silently trigger downloads. Current path resolution assumes bundled
   packages, so removing dependencies alone would break startup/sign-in.
2. Publish versioned, platform-specific runtime archives with the same signing,
   notarization, and license preservation used for bundled binaries. Verify a
   pinned manifest/checksum and expected code-signing identity before execution.
   Do not shell out to an unpinned package installer on the user's machine.
3. Download into a temporary directory under Application Support, with a single
   installer lock, cancellation, retry, and an atomic rename into the versioned
   cache. A failed download must leave the app and prior working runtime usable.
4. Resolve each runtime from that cache and retain per-provider authentication
   directories separately. Updating/removing an executable must not erase login
   state. Show installed version and an uninstall option later if useful.
5. Test fresh/offline setup, interrupted downloads, corrupted archives, wrong
   architecture/signature, concurrent connections, and version upgrades on a
   clean Mac account before changing the main app distribution.

Removing the two payload groups could eliminate roughly 197 MB of compressed
entries; that is an estimate, not a measured future installer size. SDK/shared
code may still be needed. Separately remove the duplicate Rivet engine and audit
unused dependency assets/source maps without stripping required runtime files
or license notices.

## Installer format

The initial ZIP lacked the normal Mac installation window. A DMG now provides
Springroll.app beside an Applications shortcut, with a saved Finder icon layout.
This wraps the existing notarized app; it does not implement optional downloads
or change the application's runtime footprint. The DMG compresses differently
and is about 425 MB before its small signing/notarization metadata additions.

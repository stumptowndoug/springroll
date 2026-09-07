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

## v0.1.1 release dependency breakdown

The final signed ZIP is 236,189,322 bytes (236.2 MB / 225.2 MiB), down 48.8%
from v0.1.0. The signed DMG is about 200.4 MB, down about 52.9% from the
original 425.2 MB installer. DMG and ZIP compression differ; use the DMG for the
smallest download and the standard Applications installation window.

The signed Apple Silicon build contains about 675 MB of regular files before
compression (symlinks are counted separately). Approximate compressed ZIP-entry
contributions are:

| Group | Compressed MB |
| --- | ---: |
| Rivet scheduler and actor libraries | 48.1 |
| Bun | 25.4 |
| Browser interface, including source maps | 15.1 |
| Diagram-library dependency copies | 20.3 |
| Secure-execution libraries | 13.1 |
| Native Mac shell | 3.8 |
| Other dependencies and application files | 82.1 |

These are archive-entry measurements, not DMG proportions; ZIP metadata and
resource-fork entries add overhead. No AI model weights are included. Optional
Codex/Claude downloads add their own disk usage only when installed.

Across dependencies and the browser bundle, 7,038 source-map files contribute
145.5 MB unpacked / 30.8 MB compressed. That is a concrete follow-up target,
subject to checking support/debugging needs and any runtime file references.

Further reductions should audit duplicate diagram-library assets, source maps,
and build-time/transitive tools retained by production installation. Do not
remove whole dependency groups based on size alone: packaged chat, reports,
connectors, and scheduled execution must remain functional.

## Installed-size audit: packaging first, architecture second

The owner's 675 MB Finder reading is correct. Compression explains the 200 MB
DMG; it does not reduce installed storage. The measured v0.1.1 app contains
675,235,288 bytes across 31,759 regular files. The following categories are
mutually exclusive (unlike per-package and source-map examples elsewhere):

| Installed files | MB |
| --- | ---: |
| Native Mac executable | 12.6 |
| Built browser interface, without maps | 15.3 |
| Bun executable | 61.9 |
| Rivet engine plus native actor binary | 121.8 |
| Source maps across all directories | 144.9 |
| Remaining dependencies/application files, without maps | 318.8 |

Archive-entry source-map totals above are slightly higher because the ZIP also
contains resource metadata. Use these filesystem figures for installed-size
planning. There is no bundled Chromium browser or AI model-weight payload;
the desktop shell uses Tauri's system webview.

### Evidence of overpackaging

`desktop/package.ts` builds the browser interface, then copies workspace manifests
and runs a production install into the app. That still installs frontend packages
and broad transitive dependencies alongside the generated browser assets.

- Mermaid alone occupies 83.5 MB, of which 57.7 MB is source maps. Its parser adds
  12.3 MB (8.4 MB maps). Springroll's Mermaid import is in the browser component;
  the compiled browser assets already contain diagram code. Do not add these
  package totals to the source-map total when estimating savings.
- Four esbuild native versions total about 40.2 MB. Drizzle Kit occupies another
  10.3 MB, and the napi build CLI 5.6 MB. Their presence in a production install
  does not prove they are needed in a running app; establish runtime reachability
  before removal.
- RivetKit declares `@rivet-dev/agent-os-core` as a dependency. Its agent-OS export
  imports that package, which brings in secure-exec and Python support. Examples
  include a 37.5 MB V8 executable, 10.6 MB secure-exec core, and 12.6 MB Pyodide.
  Springroll currently imports actor/queue/setup and the Rivet client, not the
  agent-OS entry point. This makes feature-specific pruning worth investigating;
  it is not yet proof that every transitive package can be removed.
- Simple Icons (16.1 MB) is read dynamically by the server for provider logos.
  Removing its whole package because it looks like frontend data would break
  behavior. Native SDK loaders and migration files also need explicit handling.

A compile-only experiment bundled `app/src/server.ts` (505 modules) into 2.10 MB
of minified Bun-target JavaScript, leaving RivetKit, Keychain, Claude Agent SDK,
and Codex SDK external. Output is ignored under `.local/size-audit/server`.
This demonstrates a small first-party/backend bundle, not a complete runnable
2 MB backend: external libraries, dynamic file paths, native loading, startup,
and shutdown still need packaging changes and validation.

### Recommended sequence

1. **Build a dedicated production payload.** Keep source maps outside the shipped
   app for debugging; ship compiled frontend/backend output, a deliberate native
   dependency set, required data/migrations, and licenses. Avoid carrying the
   frontend installation and unused build tools into the desktop runtime.
2. **Trim unused Rivet features without replacing scheduling.** Trace and isolate
   the agent-OS/sandbox/Python dependency branch and test omission in an experimental
   bundle. Preserve the real-engine queue, retry, alarm, restart, and recovery tests.
3. **Measure before selecting a new architecture.** A 250–350 MB installed target
   is a useful engineering target for the first two steps, not a measured result
   or promise. With the current Bun, Rivet binaries, shell, and built UI unchanged,
   those four components alone occupy about 212 MB.
4. **If a much smaller target is required, reconsider the local scheduler.** A
   lightweight SQLite-backed local scheduler with a separate Rivet hosted adapter
   could avoid the 122 MB local Rivet binary pair and related dependencies. That
   requires replacing durable queue/alarm/recovery behavior, not simply swapping
   a timer. Removing Bun would entail a wider backend rewrite for another 62 MB.

Downloading always-needed components after installation would mostly relocate
the same storage cost; it is not a reduction in total installed footprint. Keep
optional subscription runtimes optional, but prioritize eliminating unused files.

For the next candidate, report both compressed download and total installed size,
including any downloaded support. Add an explicit installed-size budget/check to
packaging after a realistic target has been measured. Validate normal startup,
logos, Markdown/diagrams, OAuth, subscription setup, and real scheduled execution
before signing or publishing. The audited v0.1.1 artifacts remain unchanged.

## First cleanup implemented after v0.1.1

Desktop packaging now clears `app/dist` before building: Bun's hashed browser
chunks otherwise accumulate across builds. It removes known JavaScript/CSS/TS
source-map files from the packaged copy and removes the redundant Mermaid/parser
package copies after compiling the browser assets. Their licenses are preserved
under `runtime/third-party-licenses`. Workspace links into removed packages are
also removed. Development source/dependency maps remain outside the packaged app.

Measured comparable development apps fell from 683.4 MB to 498.3 MB. A signed
production-mode candidate measures **488,075,014 bytes (488.1 MB)** versus the
published v0.1.1 app at **675,235,288 bytes (675.2 MB)**: 187.2 MB / 27.7% smaller.
Candidate: `desktop/dist/release-8Cu1RR/Springroll.app`. This candidate is signed
and signature-verified, but not notarized or published. Its version remains
0.1.1/build 5 for sizing; assign a new release version before publication.

The fresh browser output is 4.76 MB, compared with 67.1 MB of accumulated output
including maps in the earlier package. These savings overlap the map/package
figures above; use the whole-app measurements rather than adding them together.

Validation: packaged native startup/restart/shutdown, 12 focused frontend/report
and real-engine recovery tests, desktop-script typechecks, and lint passed.
A browser rendered a Mermaid flowchart using only the cleaned packaged chunks.
The 1,749 remaining development-bundle links are valid and contained, and both
removed packages' licenses are retained. The signed runtime is checked separately
with fresh data, provider configuration, and subscription setup endpoints.

Rivet, its agent-OS dependencies, esbuild, and other runtime dependencies are
unchanged in this first pass. See [actual Rivet usage](rivet-usage.md) for the
feature boundary and next options. Published v0.1.1 artifacts are unchanged.

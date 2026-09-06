# Mac app prototype

This is a local, unsigned development `.app`, not a distributable release.
The existing UI runs in a Tauri webview; the native shell owns a bundled Bun
application and a separately owned Rivet engine. The unified 54px title bar
keeps native traffic lights, centered navigation, and the logo on the right.
Only window dragging and title-bar double-click zoom are exposed to the main
webview, scoped at runtime to the exact local server origin and port. External HTTPS navigation opens the default browser, while the
app window stays on its own loopback origin.

## Build and smoke-test

For everyday development, run `bun run dev:mac` from the repository root,
or double-click `desktop/Start Springroll.command` in Finder. Each invocation
builds current source, gracefully quits desktop builds running from this
checkout, and opens `desktop/dist/dev/Springroll Prototype.app`. Wait for
ongoing work to finish before updating. This is an explicit rebuild/restart,
not automatic hot reload. It uses the same prototype workspace and Keychain.

The launcher keeps one previous development build in `desktop/dist/dev-previous`.
Build failures leave the running app and last good build intact. If an update
process is interrupted and leaves `desktop/dist/.dev-update-lock`, check that
no update is running before removing that directory and retrying.

Use the command or double-click launcher to pick up code changes; opening the
`.app` directly only launches its existing compiled version. Older numbered
prototype folders are standalone snapshots created by the packaging command
below; they are no longer needed for the everyday development loop.

On a Mac with the project's Bun version, Rust/Cargo, and Xcode tooling:

```sh
bun install --frozen-lockfile
bun run build:mac
bun desktop/smoke.ts '/absolute/path/from/build/Springroll Prototype.app'
```

Each standalone `build:mac` creates a new directory inside `desktop/dist`; it never overwrites
a previous app. The first prototype uses the current Mac architecture and a
debug Rust build. Production dependencies are installed with a frozen lockfile
and lifecycle scripts disabled. The bundle is deliberately large (roughly 1.2 GB
in the initial arm64 build). Dependency pruning, release optimization, universal
builds, signing, notarization, and updates are follow-up work.

The package is assembled from an explicit allowlist of application/kernel
sources, assets, migrations, package manifests, lockfile, and license. It does
not copy `.env`, `.local`, Git history, or design studies. Runtime dependencies
are installed inside the package; symlinks must resolve within that directory.
Both Bun and the engine are copied into the package. Native modules and agent
executables remain in their installed package layouts.

## Data and lifecycle

- Data lives in `~/Library/Application Support/com.springroll.desktop.prototype`.
- The prototype uses its own Keychain service, with legacy credential adoption
  disabled. It does not import development recipes, credentials, or history.
- `runtime.log` contains startup/provider diagnostics. Treat it as private; do
  not include it in a public issue without reviewing it for sensitive content.
- A filesystem lock prevents a second instance from opening the same workspace.
  The second instance currently shows an explanation rather than focusing the
  first window.
- The HTTP server binds to a dynamically assigned loopback port. The shell waits
  for its child process to announce readiness before navigating the window.
- Scheduler ports are selected from a separate local range. Port reservation
  races and crash/orphan recovery need further lifecycle hardening.
- Quit/termination drains the app before stopping the engine, with bounded
  cleanup. This is not a guarantee against interrupted external side effects.
- The debug-only `SPRINGROLL_DESKTOP_TEST_DATA_DIR` override lets the smoke script
  create an isolated temporary workspace. Smoke data is retained for diagnosis.

## Acceptance still required

- Visual review of the native window, menus, dialogs, external links, and icon.
- A separate clean Mac account: Keychain prompts, provider sign-in, OAuth return,
  native modules, and a real harmless scheduled recipe.
- Sleep/wake, network restoration, closing the window versus Quit, force kill,
  startup cancellation, unexpected child death, and no orphaned processes.
- Confirm security posture of the loopback API and signing of every nested
  executable before distributing outside a development environment.
- Local MCP integrations may require user-installed tools. Packaging the core
  app does not make every user-supplied integration self-contained.

Tauri resource conventions: https://v2.tauri.app/develop/resources/

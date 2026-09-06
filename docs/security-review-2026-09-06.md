# Pre-publication security review — September 6, 2026

This is a source review and automated audit of the local working tree based on
`f34e88e`, not an independent penetration test or a certification. The repository
was still private at review time. No repository publication, history rewrite,
release upload, or production-data migration was performed.

## Decision

The public-source cleanup and initial audit are complete. Do not treat the app as
cleared for public distribution: the DNS/connection gap below has been fixed; review
remaining dependency warnings and complete the existing clean-account acceptance
checks. Google policy/verification and real Microsoft connector sign-in remain
separate release work; this review does not establish provider-policy compliance.

## Scope and changes

Reviewed tracked files and local Git history, dependency manifests/locks, loopback
HTTP access, OAuth state/redirect boundaries, credential storage, public URL reads,
Markdown/artifact rendering, and the desktop packaging allowlist.

| Area | Result |
| --- | --- |
| Secrets | Gitleaks 8.30.1, redacted output: no findings in 352 scanned commits or the current tracked/nonignored file snapshot. Ignored local credentials were excluded from the public-tree scan. Pattern detection cannot prove absence of secrets or personal data. |
| Dependencies | Updated Drizzle ORM to 0.45.2, Hono to 4.12.34, fast-uri to 3.1.6, and qs to 6.16.0. Root overrides keep transitive copies patched, including Rivet's Drizzle dependency; removing these requires re-auditing. |
| Private response caching | Report artifacts previously advertised a year of public immutable caching. API/artifact responses now use `no-store`. Existing caches are not retrospectively erased. |
| Browser rendering | Added anti-framing, no-referrer, nosniff, base/object restrictions, and an image source allowlist. This prevents automatic arbitrary external image loads in Markdown. GitHub logo hosts remain allowed. Existing artifact sandbox policy is preserved. |
| Filesystem | New app/SDK workspace directories use 0700; the primary SQLite database uses 0600 on open. Existing directories are not recursively migrated. Smoke workspace/database permissions verified as 0700/0600. |
| Build runtime | Homebrew Bun upgraded from 1.3.14 to 1.4.2; project and CI use the same pin. Release packaging rejects a mismatched runtime. The packaged runtime, not the user's globally installed Bun, runs an installed app. |
| Automation | CI now fails on high/critical Bun advisories; lower-severity findings still require manual review. Added weekly Cargo dependency updates alongside Bun and Actions updates. |
| Public content | Rewrote README around the product, added a documentation index, updated data/security and development guidance, removed personal setup examples, and explicitly ignored local editor/project-manager state. |
| Obsolete files | Retired 64 superseded mockup/screenshot files from the current tree. Local backup is under `.local/repo-cleanup-2026-09-06/`; Git history retains them. Kept current design guidance, migrations, source assets, and recovery experiments/tests. |

Bun 1.4.2 is the stable release published September 5. Its notes include an
AsyncLocalStorage memory-leak fix, a rare long-running JavaScript crash fix, and
JavaScriptCore improvements. Compatibility was checked here; no Springroll
performance benchmark was performed. [Official release notes](https://bun.com/blog/bun-v1.4.2).

## Remaining findings

### Fixed after checkpoint: DNS validation was separate from the outgoing connection

`kernel/src/connectors/exa-web.ts`, `fetchPublicUrlDirectly`, calls
`assertPublicUrl` to resolve/check the hostname, then calls ordinary `fetch` with
the hostname. The transport can resolve again. An attacker-controlled DNS answer
could change from a permitted public address to a private address between these
steps. Redirects are individually validated, but that does not close this gap.

This is a source-identified SSRF design gap; no live DNS-rebinding exploit or
third-party target was used. Pin every direct connection to a validated address
while preserving HTTPS hostname/certificate checks, and test rebinding, redirects,
IPv4/IPv6, timeouts, cancellation, and response limits. An alternative is removing
direct local fetch until a safe transport is available. This fix is now implemented as described below. This restriction concerns the built-in public-web reader;
user-approved private HTTP/MCP integrations need a different access policy.

Follow-up implementation: direct web reads now use `pinned-web-fetch.ts` to open
an HTTP(S) connection to the checked literal IP with a fresh connection, original
Host header, TLS server name, and explicit certificate hostname verification.
Automatic redirects are disabled; each redirect is validated by the caller.
Direct reads request identity encoding and reject unsolicited compression. The
existing 30-second cancellation and 50 KB body limit still apply; rejected and
redirected bodies are cancelled. Test-only injected fetch implementations retain
the existing deterministic provider/policy tests; production supplies no override.

Five local transport tests cover an unresolvable hostname with a checked IP,
redirects, aborts/compression rejection, IPv6, and trusted/untrusted/mismatched TLS
certificates. A public HTTPS read of example.com also succeeded. The transport
currently tries the first validated address only; unreachable addresses surface
an error rather than triggering another unvalidated lookup.

### Residual JavaScript dependency advisories

The final full Bun audit reports three advisories across two package families:

- `elliptic` 6.6.1: low-severity risky cryptographic primitive implementation;
  no patched version in the advisory. Reached through Rivet → secure-exec →
  node-stdlib-browser/crypto-browserify. Production bundling includes this
  dependency tree; reachability to the affected primitive was not fully proven.
  Track an upstream replacement or demonstrate/remove the affected execution path.
  [Advisory](https://github.com/advisories/GHSA-848j-6mx2-7j84).
- Older `esbuild` copies: moderate development-server cross-origin read and low
  Windows development-server file read. Drizzle tooling and secure-exec retain
  different copies. Springroll uses Bun to build and does not explicitly start an
  esbuild development server; the shipped target is macOS. Keep tracking upstream
  upgrades instead of forcing incompatible versions across the dependency tree.
  [Cross-origin advisory](https://github.com/advisories/GHSA-67mh-4wv8-2f99),
  [Windows advisory](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr).

The high-severity audit gate passes; this is not a zero-advisory result.

### Rust maintenance and unsoundness warnings

Cargo Audit 0.22.2 reports zero vulnerability entries, but 16 unmaintained-package
warnings and one `glib` unsoundness warning. These include legacy GTK packages,
`proc-macro-error`, and the `unic-*` family. `cargo tree` for the shipped
`aarch64-apple-darwin` target shows no `glib` dependency path; the lock includes
other-platform dependencies. Track upstream Tauri/Wry updates and reassess the
warnings before adding other platforms. Zero vulnerability entries does not mean
all dependency maintenance risks are resolved.

### Trust and coverage limits

- The loopback API is not authenticated against other local processes. Host/Origin
  validation protects against browser cross-origin requests, not malicious local
  software or a hostile shared-machine user. Do not expose the service remotely.
- Springroll-managed connector/model keys use Keychain; subscription SDKs manage
  their own local authentication state. User-approved local MCP packages execute
  third-party code. Model/tool content can leave the Mac through selected providers.
- The new CSP restricts images and framing, but is not a comprehensive script CSP.
  Arbitrary external report images will now be blocked. Full interactive rendering
  coverage and provider end-to-end sign-in were not part of this pass.
- Git history still contains historical planning and account/owner metadata.
  Removing current files does not purge history. No credential rotation was
  triggered by the zero-match scans; a future discovered secret requires rotation,
  not merely deleting its current file.
- The new package is an isolated unsigned development smoke build. Prior notarized
  release candidates do not contain these changes. Build and inspect a fresh signed
  release, then test installation and updates on a clean Mac/account.

## Verification

- `bun run check` under Bun 1.4.2: lint/typecheck pass and 703 tests
  pass; existing nonfatal style warnings remain.
- `bun audit --audit-level high`: passes, with three lower-severity advisories.
- Native Rust tests: 2 pass.
- `bun run build:mac`: frontend and native compilation plus frozen production
  dependency installation pass with Bun 1.4.2.
- `desktop/smoke.ts`: launch, relaunch, assets/API, paused starter recipe, and
  termination pass using an isolated temporary workspace and minimal PATH.
- Redacted Gitleaks history and public-tree scans: no findings.

Follow-up work is tracked in [TODO.md](../TODO.md); this dated report records the
scope of this pass and should not be read as evidence for later builds.

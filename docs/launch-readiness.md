# Launch readiness

Reviewed 2026-09-06. The active checklist is [TODO.md](../TODO.md); this note
explains sequencing and dependencies. Open board items are unverified, not
proof that every underlying behavior is broken.

## Google one-click is a launch priority

The native Gmail, Calendar, and Drive adapters and application-owned Desktop
OAuth configuration path exist. Google Cloud configuration and real account
acceptance have not been verified by this review. Follow
[one-click connectors](one-click-connectors.md) for the technical setup.

Two milestones should be separate:

1. **Dogfood sign-in:** configure the Google project, APIs, Desktop client,
   scopes, and named test users; get a real Google recipe working in the packaged
   app. This can proceed while the public website is prepared. External Testing
   authorizations and offline refresh tokens for these data scopes expire after
   seven days, so this is not a durable production scheduling test.
2. **Public availability:** ship consistent branding and public product/legal
   pages, verify domain ownership, provide scope justification/demo evidence,
   and complete applicable Google verification. Publishing status and verification
   are distinct; do not treat a website or a production toggle as approval.

The website should explain the product and link to privacy, terms, support,
and data-deletion instructions. The privacy disclosures must reflect actual
behavior: what Google data is accessed, what reaches the selected model provider,
where results/logs are retained, and how disconnect and deletion differ. Do not
describe all Google data as staying on the Mac merely because credentials are
stored locally. Audit model-provider processing and Google's Limited Use
requirements before writing final claims.

Review the minimum scopes for the first release. Gmail read/modify and broad
Drive access introduce restricted-scope concerns; access to restricted data
through third-party servers can require an annual security assessment. Establish
applicability for Springroll's actual model-provider and hosting flows with the
verification process rather than assuming a desktop exemption. If necessary,
evaluate launching a narrower Google capability first without dropping the
broader integration goal.

The packager deliberately excludes `.env`, while the connector configuration
currently reads application-owned OAuth values from its environment. A release
must supply the intended desktop client configuration deliberately, not depend
on the developer's shell. Installed-app client values are not confidential
server secrets; user credentials and unrelated development secrets must remain
out of the bundle.

Official references checked for this review:

- [OAuth policies: homepage, terms/privacy, and domain requirements](https://developers.google.com/identity/protocols/oauth2/policies)
- [Sensitive-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [Restricted-scope verification and security assessment](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Testing audience and seven-day token expiry](https://support.google.com/cloud/answer/15549945?hl=en)

## Other release gates

- **Scheduling on a real Mac:** sleep overnight, restore networking, quit/reopen,
  and force termination; verify skip/catch-up behavior and no unintended duplicate
  writes. Automated recovery tests already exist; device acceptance remains open.
- **Desktop lifecycle:** define window close versus Quit, background execution,
  startup failure handling, single-instance behavior, and child-process cleanup.
  Decide how users can see that scheduling is active or unavailable.
- **Clean installation:** test on a separate Mac account without development
  tools, including Keychain, model setup, first recipe, actual scheduled result,
  and Google OAuth. Finish the outstanding Neon callback acceptance as well.
- **Known UI issues:** reproduce and close the open bottom model-selector issue
  in the current app. Older board entries identify historical builds; they do
  not establish the current build's outcome.
- **Distribution:** produce an optimized release build, sign/notarize the app
  and nested executables, choose supported architectures, and test installation.
  Choose a download/update process; automatic updates need not block an alpha.
- **Release review:** run release checks, scan artifacts/history for secrets,
  document supported runtimes, costs, local scheduling limitations, and recovery,
  and obtain publication approval before distribution or making the repo public.

Broad UI plugins, arbitrary app customization, additional connector expansion,
and hosted scheduling are not prerequisites for a local desktop alpha.

## Dock icon versus menu-bar icon

The current package copies `desktop/icons/icon.icns` and sets `CFBundleIconFile`
to that asset. The selected artwork now places the green leaf on a pale sage
`#DCE8D9` rounded tile, with transparency outside the tile. The background is
part of the artwork, not a debug-mode effect. Regenerate the PNG and ICNS from
`desktop/icons/icon.svg` with `swift desktop/icons/generate.swift`.

There is no separate tray/menu-bar implementation in the current desktop source.
The app's Dock icon and a future menu-bar status icon are separate assets and
behaviors. The user selected the sage Dock background after comparing three
previews. If background scheduling warrants a
menu-bar control, design a small monochrome transparent status mark plus useful
Open/Status/Quit behavior separately.

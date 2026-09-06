# Launch readiness

Reviewed 2026-09-06. The active checklist is [TODO.md](../TODO.md); this note
explains sequencing and dependencies. Open board items are unverified, not
proof that every underlying behavior is broken.

## Current Mac candidate

September 6: `desktop/dist/release-yWUrs8/Springroll.app` is an optimized Apple
silicon candidate signed with the existing Shep Developer ID account. Apple
notarization submission `c5d5fcee-04fa-40ef-9fdc-a8fe308a038c` was Accepted.
Stapling, ticket validation, and Gatekeeper assessment passed. The final artifact
is `desktop/dist/release-yWUrs8/Springroll-0.1.0-arm64.zip`. Installation on
another Mac and persistence across a subsequent release update remain unverified.

Signed runtime launch/relaunch/shutdown, OAuth return-page response, native
Keychain module loading, packaged configuration, and native first-run Settings
were checked on this Mac with a fresh release workspace. This is not a substitute
for real account sign-in and scheduled-recipe acceptance on another Mac.
Instructions are in [desktop README](../desktop/README.md#signed-friends-beta-build)
and [friends beta](friends-beta.md). Source changes and the artifact are not yet
published or committed as a release.

## Friends-beta release sequence

The immediate target is a small invite-only beta, not a broad public launch.
Google and Microsoft registration setup is complete for this milestone. The
website is live; Google website ownership and branding are verified. Google
data-access verification was last confirmed saved at its final questionnaire,
not submitted. Microsoft publisher verification remains open. See
[OAuth setup status](oauth-setup-status.md) for registration details.

1. **Set up Apple distribution.** Confirm the existing Apple Developer membership
   used for Shep, signing access, and a stable Springroll bundle identifier.
2. **Build the distributable app.** Replace prototype/debug packaging with a
   release configuration. Decide prototype data and Keychain migration versus
   separation. Supply application-owned Google and Microsoft OAuth configuration
   without relying on a developer shell or bundling a developer `.env`. Sign
   shipped executables, notarize, and test the downloaded artifact under Gatekeeper.
3. **Run clean-machine acceptance.** Install without development tools, connect a
   model, test Google Gmail/Calendar/Drive and Microsoft Outlook/OneDrive, create
   a recipe, and receive a scheduled result. Verify restart, credentials,
   disconnect/reconnect, sleep recovery, and close-versus-quit behavior. Resolve
   the open model-selector issue and verify connector callback fixes in the
   current build; earlier test results do not replace these acceptance checks.
4. **Distribute the approved friends beta.** Provide a private download, short
   installation instructions, known scheduling/account restrictions, clear
   disclosure of content sent to model providers, and a feedback route. Choose
   a simple manual update process for the initial beta.

Source publication is a separate milestone: refresh README/screenshots, review
history and artifacts for secrets/private examples, reconcile the release branch,
and run release checks before making the repository public. Public Google
verification and Microsoft publisher identity remain follow-ups; do not describe
either as approved. Optional wake-from-sleep features, a menu-bar control,
automatic updates, and more integrations need not block the friends beta.

“Official app” here means a signed/notarized direct Mac download; Mac App Store
submission is not part of this plan. See
[Apple's direct distribution guidance](https://help.apple.com/xcode/mac/current/en.lproj/dev033e997ca.html).

## Google prerequisites

The native Gmail, Calendar, and Drive adapters and application-owned Desktop
OAuth configuration path exist. Google Cloud registration and demo account flows
have been verified; clean-machine packaged acceptance remains open. Follow
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

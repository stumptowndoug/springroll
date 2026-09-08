# Google verification handoff

Updated September 7, 2026. Website ownership and branding are verified; data
access is **not verified**. The original read-only request was submitted. Google
replied requesting stronger scope demonstrations and AI-provider/data-use details.

The owner chose to resume the shared Google connection. Personal-credential setup
is preserved on `feat/google-personal-oauth-setup` at `d1d6798`. The active
`feat/google-shared-oauth-launch` branch starts from the original shared-auth
version, `5970090`. Switching branches does not migrate existing personal-account
tokens or change installed releases; reconnect affected development accounts via
the shared client if necessary. No stored credentials were deleted.

## Saved Google scope request

Google Console confirmed “Data access changes saved!” after warning that saving
would update the pending verification request. The configured scopes are:

| Scope suffix (all use `https://www.googleapis.com/auth/`) | Intended feature |
| --- | --- |
| `userinfo.email` | Identify connected accounts |
| `gmail.readonly` | Search/read emails, threads, drafts, and labels |
| `gmail.send` | Optional sending, replies, and forwards without draft management |
| `gmail.compose` | Optional Gmail drafts; Google also permits sending with this scope |
| `calendar.readonly` | Discover calendars and read events |
| `calendar.events` | Optional event creation, updates, RSVP, and deletion |
| `drive.readonly` | Search/read/download/export existing Drive documents |

Sensitive and restricted scope justifications were updated to explain granular
permissions, actual data flows to user-selected remote model providers, and the
need for a replacement demo. The existing video remains historical read-only
evidence, not proof of the newly requested actions. No new video was uploaded,
review email sent, or compliance attestation made.

## Required before the new demo and release

- Gmail drafts now use a separate `drafts` permission with `gmail.compose`;
  sending remains gated by the separate `send` choice. Inbox trashing was removed.
  Existing `organize` grants do not automatically enable the new drafts choice;
  reconnect/authorize Save drafts. This does not revoke previously issued broad
  Google tokens; revoke the old Google grant before reconnecting to remove them.
- Drive still offers `drive` for writes, outside this revised request. Defer that
  option before the staging demo and release.
- Keep default account connections read-only. Show optional sending, drafts, and
  event-management upgrades separately. OAuth scope overlaps must be disclosed:
  app-level action choices do not narrow the Google token's capabilities.
- Follow Google's review instruction: trigger new unverified scopes only in
  staging/hidden test routes; do not deploy them to production traffic. Keep the
  shared project's publishing status In production.
- Record full readable consent and every requested feature. Show messages in
  Gmail Sent, saved drafts in Gmail, and changed events in Google Calendar.
  Demonstrate Drive document reading/export, not only folder listing.
- Inventory every AI provider, tier, gateway, upstream endpoint, and training
  restriction used for Google data. Audit actual behavior before affirming
  compliance. Relevant content can leave the Mac for remote model processing.
- Complete the Limited Use disclosure and determine applicable restricted-scope
  security-assessment obligations; local credential storage is not an exemption
  for remote processing.
- Reply to the existing Google review thread with the new evidence when ready.

Private reviewer evidence, account identifiers, and recording details stay outside
Git. See [OAuth setup status](oauth-setup-status.md).

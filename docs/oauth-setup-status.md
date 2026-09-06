# OAuth setup status

Reviewed September 6, 2026. Provider registrations are configured for the friends
beta; packaged-app sign-in acceptance remains open.

- **Google:** Desktop OAuth client and required APIs configured; website ownership
  and branding verified. Audience is External/In production. Read-only Gmail,
  Calendar, Drive, and email identity are prepared for data-access verification.
  The last confirmed application was saved at the final questionnaire, not
  submitted. Restricted-scope assessment and provider-policy/disclosure review
  remain open. Optional write capabilities are outside this review.
- **Microsoft:** Desktop callbacks, branding, and delegated Graph permissions
  configured. Publisher verification and real connector sign-in remain open.
  No tenant-wide administrator consent granted. SharePoint is excluded from
  one-click shortcuts.
- **GitHub:** Remote MCP does not support dynamic client registration. One-click
  stays hidden until a Springroll-owned OAuth client is configured and verified.

Private account identifiers and verification evidence are maintained locally,
outside Git. Public homepage, privacy, and terms are at https://tryspringroll.com/.
See [launch readiness](launch-readiness.md) and [one-click setup](one-click-connectors.md).

# OAuth setup status

Reviewed September 7, 2026. Provider registrations are configured for the friends
beta; packaged-app sign-in acceptance remains open.

- **Google:** Desktop OAuth client and required APIs configured; website ownership
  and branding verified. Audience is External/In production. The original
  read-only request was submitted and Google requested more evidence. The pending
  request now includes Gmail send/compose and Calendar event management alongside
  existing Gmail/Calendar/Drive reading and email identity. Data access remains
  unverified. Staging permission alignment, a replacement demo, AI-provider
  disclosures, and applicable assessment obligations remain open. No new scopes
  were deployed to production. Personal setup is preserved on its feature branch;
  the active branch restores the original shared-client connection.
- **Microsoft:** Desktop callbacks, branding, and delegated Graph permissions
  configured. Publisher verification and real connector sign-in remain open.
  No tenant-wide administrator consent granted. SharePoint is excluded from
  one-click shortcuts.
- **GitHub:** Remote MCP does not support dynamic client registration. One-click
  stays hidden until a Springroll-owned OAuth client is configured and verified.

Private account identifiers and verification evidence are maintained locally,
outside Git. Public homepage, privacy, and terms are at https://tryspringroll.com/.
See [launch readiness](launch-readiness.md) and [one-click setup](one-click-connectors.md).

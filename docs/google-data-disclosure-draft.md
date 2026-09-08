# Google data disclosure draft

Prepared September 7, 2026. This is review copy, not a published compliance
attestation. Do not publish the affirmative statement until the
[AI-data audit](google-ai-data-audit.md) gaps are resolved. The current in-app
Google account page now discloses remote processing and that account-level
training settings are not verified.

## Website Google-data section replacement

Springroll connects Gmail, Google Calendar, and Google Drive using a shared Google
OAuth client. Sign-in returns to a local listener on your Mac. Google access is
not yet verified. Normal connections request reading access; optional Gmail
sending/drafts and Calendar event changes are currently limited to verification
staging. Drive access is read-only.

When you use Google data in a chat or recipe, relevant emails, events, files, and
metadata are included in requests to your selected AI provider. The app stores
credentials locally and can retain Google-derived reports, conversation history,
and tool activity on your Mac. Selecting another model or using another tool
with those results can send relevant content to another service. Local execution
of Springroll does not mean AI inference stays on your Mac.

Supported model connections include OpenAI API, Anthropic API, Google Gemini API,
xAI API, Groq, OpenRouter, Claude subscription, and Codex/ChatGPT subscription.
OpenRouter can route requests to downstream inference providers. These services
have different training and retention policies; account tiers and opt-ins matter.
Springroll currently does not verify those settings or isolate Google-derived
content from every other model/tool route. Do not use Google data with services
that train generalized models on the data. A no-retention option and a no-training
policy are separate controls.

Google access does not authorize generalized-model training. Springroll does not
sell Google data or use it for advertising. Disconnecting an account stops future
access through that connection; use Google's account controls to revoke existing
grants. Deleting local reports does not delete copies previously processed or
retained by an external service.

## Affirmative statement to publish after remediation

Springroll's use of raw or derived user data received from Google Workspace APIs
will adhere to the Google API Services User Data Policy and the Google Workspace
API User Data and Developer Policy, including the Limited Use requirements.
Springroll will not use or transfer this data to create, train, or improve
foundational or generalized AI/ML models, or to services that use it for those
purposes.

## Publication checklist

- Replace the older Gmail “Drafts and organize” and Drive write descriptions.
- Confirm eligible provider accounts/routes and their actual training settings.
- Enforce restrictions across Google-derived history, tool results, and secondary
  model calls; verify the controls with tests and runtime evidence.
- Confirm retention/deletion statements for each allowed route.
- Publish the accurate final version at the privacy-policy URL and add the
  affirmative statement in-app or on the website, as Google's reviewer requested.
- Include the exact live URL and provider inventory in the reviewer reply.

No self-hosted/offline disclosure is appropriate for the currently supported
model routes: local CLI launch and local credential storage do not make their
inference offline.

# Security policy

Springroll is experimental local-first software. Only the current `main`
branch is supported, and no security response time is guaranteed during the
beta.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability or include
secrets, personal data, exploit details, or account content in a report.

Use **Report a vulnerability** in the repository's Security tab to send a
private report. If private reporting is not available, contact the repository
owner through their GitHub profile before sharing technical details.

Include, when safe:

- the affected commit and macOS version;
- the feature, connection type, and minimum reproduction steps;
- the security impact and whether it has been observed in the wild;
- logs or screenshots only after removing credentials and personal data.

Do not access another person's data, disrupt third-party services, or incur
provider charges while researching a report.

## Security model

The current trust boundaries and known limitations are documented in
[Security and data flow](docs/security-and-data.md). The short version is:
Springroll-managed credentials use macOS Keychain, application data stays local by default,
and task content can be sent to the model and integration providers the user
selects.

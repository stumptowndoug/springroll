# Security and data flow

Springroll is local-first software, not offline software. This document
describes the current source alpha so users can decide which accounts and data
are appropriate to connect.

## What stays on the Mac

Springroll's local HTTP server binds to `127.0.0.1`. By default it stores the
recipe catalog, schedules, chats, run history, usage ledger, and artifact
metadata in `.local/springroll.sqlite`; generated artifacts are written under
`.local/artifacts`. Rivet's local execution engine also stores state under
`.local/`. These paths are ignored by Git.

API keys, OAuth access tokens, and OAuth refresh tokens are stored through
macOS Keychain. SQLite records opaque credential references rather than secret
values. OAuth client configuration supplied in `.env` belongs to the app
developer and is loaded into the local process; it is not an end-user account
token.

There is currently no Springroll-hosted account, synchronization service, or
remote scheduler. Closing the local process stops future recipe execution.

## What can leave the Mac

A run sends its instructions and conversation context to the model provider
selected in Settings. When a tool is used, the information needed for that
operation is sent to its service. Relevant tool output is normally returned to
the model so it can decide what to do next and write the report.

That means the following may leave the Mac:

- recipe instructions, chat messages, and conversation context;
- search terms, URLs, email or calendar queries, document identifiers, and
  other tool arguments;
- content returned by a connector when it is needed for reasoning or a report;
- files or images explicitly supplied to a model or integration;
- provider telemetry needed to report model usage and cost.

Data may be handled by the selected model provider, the connected service, an
MCP operator, and any subprocess backing a reviewed local MCP package. Their
terms, retention policies, workspace rules, and administrator controls still
apply. A model can only call tools made available to the recipe or chat, but a
read tool can still expose sensitive content to that model.

Codex subscription chats and recipes are different from ordinary model API calls. They
run through the official local Codex app server, which manages a separate
Springroll ChatGPT sign-in under the application's local data directory.
Springroll does not read or reuse the normal Codex CLI session.

## Credential boundary

Springroll is designed to resolve credentials in the host immediately before
an outbound call. Credential values should not appear in model messages, tool
results, SQLite, run events, citations, artifacts, or normal application logs.
OAuth refresh happens locally and updated tokens return to Keychain.

Do not paste secrets into chat, recipe instructions, issue reports, screenshots,
or test fixtures. Use the secure connection forms. Disconnecting an integration
removes Springroll's stored credential; use the provider's account settings to
revoke access independently when needed.

## Consequential actions

Connector manifests distinguish reads from consequential writes. The UI asks
for explicit permission upgrades for write scopes where supported, and the
runtime can require confirmation before actions such as sending, deleting, or
changing shared data. Treat this as an experimental guardrail, not a security
guarantee. Review the proposed recipe, connected account, granted scopes, and
any confirmation prompt before approval.

## Costs and limits

Model and integration providers bill the connected accounts directly.
Springroll records provider-reported or catalog-estimated model cost when it is
available. The optional cost budget is checked between model turns and can be
exceeded by a request already in flight or by the reserved wrap-up call. The
turn limit bounds model turns, not tool calls: one model turn can issue several
tool calls. Neither limit replaces a spending limit configured with the
provider.

The current Codex subscription runner reports token usage but not an API cost.
Its turn setting is guidance rather than a host-enforced boundary, and the
ordinary cost budget does not apply. Approval-required Springroll tools are
rejected because continuation after user approval is not implemented for this
runtime yet.

## Current security posture

This is experimental software and has not received an independent security
audit. It currently assumes a trusted person running it on their own Mac. In
particular:

- the browser interface is a local development UI, not an internet-facing
  multi-user boundary;
- installing a local MCP integration can execute reviewed third-party package
  code on the Mac;
- remote MCP servers and HTTP APIs are separate trust boundaries;
- model output and external content are untrusted input even when rendered in
  the app;
- local databases and artifacts are protected by the Mac account and disk
  security, not by application-level encryption.

Use test or least-privilege accounts during the alpha. Do not connect data for
which a model provider, integration provider, or local package would be an
unacceptable processor.

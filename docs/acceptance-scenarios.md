# V1 acceptance scenarios

These scenarios define the first useful local product. They describe outcomes,
not implementation details.

## Create and try a task

Given the user writes “Summarize Hacker News every morning,” the app proposes a
schedule, the required web capability, and a plain-language contract. Nothing
is scheduled before confirmation.

The user can run the proposal once immediately. The run produces a readable
letter, after which the user can revise the sentence or confirm the schedule.

## Deliver an HN digest

An enabled morning digest produces no more than one run for each scheduled
occurrence. It uses only an allowlisted read-only web tool, records its tool
calls, and produces a concise transcript even when no stories are notable.

After a restart or wake from sleep, the task follows its configured catch-up
policy.

## Inspect a Neon project through MCP

The user connects a Neon MCP server and selects the exact tools a task may
use. Confirmation pins those tool schemas and shows their capability contract.

A scheduled database check can read only through the selected tools. A schema
change pauses the task for review, and write or destructive capabilities
cannot run without an explicit approval policy.

## Triage unread Gmail

The user is asked to connect Gmail only when confirming a task that requires
it. The contract states that the task can read messages and cannot send,
delete, move, or mark them read.

An hourly run notifies the user only when it finds something plausibly urgent
or when the connection needs attention. Quiet runs remain visible in Runs but
do not generate notifications.

Revoking the Gmail connection prevents future access and leaves prior run
letters intact.

## Use more than one account for the same service

After connecting personal Gmail, the user can choose “Add another account” and
connect work Gmail without replacing the personal credential. The connections
have distinct provider-derived labels that the user can rename.

When creating a task while several Gmail accounts are available, Springroll
uses an account explicitly named in the request or asks the user to choose. A
confirmed task pins that exact connection. Adding, renaming, signing out of, or
revoking a different Gmail account does not reroute the task.

The same behavior applies to Microsoft accounts, Slack workspaces, GitHub
accounts, Linear and Notion workspaces, Atlassian sites, Stripe accounts, and
other provider or tenant-scoped connections. Each instance has independent
credentials, discovered tools, permissions, reconnect state, and run-anywhere
consent.

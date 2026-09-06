# Future customization options

Status: exploratory notes, 2026-09-05. This is not an implementation roadmap.

## Direction

Springroll could eventually let a person ask the app to personalize itself.
For now, broad app extensibility is deferred. Integration flexibility is the
exception: the architecture should leave room for services and operations that
do not fit the current connector formats. See
[integration flexibility](integration-flexibility.md) for that narrower proposal.

There is no current commitment to a plugin marketplace, a public SDK, arbitrary
UI scripts, or an app that rewrites its own installed source.

## Options to revisit when demand appears

| Option | Example request | Smallest useful approach | Revisit when |
| --- | --- | --- | --- |
| More preferences | “Make recipe results more compact.” | Persist explicit settings through the existing settings path. | A recurring preference deserves a supported control. |
| Saved views | “Show failed recipes first.” | Store filters, ordering, and presentation choices as data. | Users repeatedly reconstruct the same view. |
| Custom pages | “Give me an Exa usage dashboard.” | Register a page that reads approved Springroll data and integration results. | Reports in conversations or the inbox are insufficient. |
| UI extensions | “Add this action beside each recipe.” | Introduce a specific contribution point with a lifecycle. | Several concrete requests share that location or behavior. |
| Arbitrary UI customization | “Reorganize the whole workspace.” | Evaluate a trusted code extension or a maintained fork. | Narrower options demonstrably cannot meet demand. |

These options need not arrive together. A saved view does not require a plugin
runtime. An integration adapter does not require custom pages. Native window
changes may still require rebuilding and restarting the desktop app.

If executable customization becomes worthwhile, keep artifacts separate from
the installed app, identify their versions, and provide disable/recovery paths.
The user should be able to recover from a broken customization without first
getting its agent or UI to work.

## What BB demonstrates

Research reference: [get-bb/bb](https://github.com/get-bb/bb), inspected at commit
`6cdb4ba6125514b7660332cf311037bc09c82b0e`. Findings are from source and
documentation inspection, not a local execution test.

- Agents can author local TypeScript/React plugins with backend functionality,
  UI, and agent instructions, then install and reload them. The app supplies
  authoring guidance and current SDK types.
  [Authoring quickstart](https://github.com/get-bb/bb/blob/6cdb4ba6125514b7660332cf311037bc09c82b0e/apps/server/src/services/skills/builtin-skills/bb-plugin-authoring/references/quickstart.md)
- Structured UI slots coexist with content scripts that can modify the app's
  existing DOM. These scripts share the app's origin and are explicitly trusted
  code, not a security sandbox.
  [Frontend extension points](https://github.com/get-bb/bb/blob/6cdb4ba6125514b7660332cf311037bc09c82b0e/apps/server/src/services/skills/builtin-skills/bb-plugin-authoring/references/frontend-core-slots.md)
- Reloading has cleanup and failure handling. A backend replacement that fails
  during initialization can leave the previous instance running; this is not a
  guarantee that external side effects are undone.
  [Plugin runtime](https://github.com/get-bb/bb/blob/6cdb4ba6125514b7660332cf311037bc09c82b0e/apps/server/src/services/plugins/plugin-runtime.ts)
- Its GitHub plugin combines panels, agent dispatch, background refresh, and
  CLI commands around the existing GitHub CLI.
  [GitHub plugin](https://github.com/get-bb/bb/tree/6cdb4ba6125514b7660332cf311037bc09c82b0e/plugins/github)

The useful lesson for Springroll is that ordinary code can fill gaps in a
declarative framework. BB's entire extension surface and full-trust execution
model are not prerequisites for adopting that idea for integrations.

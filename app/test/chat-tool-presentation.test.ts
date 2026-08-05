import { describe, expect, test } from "bun:test";
import {
  connectionResearchOutcomeFromToolPart,
  describeChatToolPart,
  taskProposalOutcomeFromToolPart,
  taskToolRepairProposalOutcomeFromToolPart,
  taskUpdateProposalOutcomeFromToolPart,
  visibleConnectionResearchOutcomeFromToolPart,
} from "../src/client/chat-tool-presentation.ts";

describe("describeChatToolPart", () => {
  test("shows the underlying connection tool and useful input", () => {
    expect(
      describeChatToolPart({
        type: "tool-springroll_call_read_connection_tool",
        toolCallId: "call-1",
        state: "output-available",
        input: {
          connectionId: "web-search",
          toolName: "search_web",
          input: { query: "weather today in Redmond Oregon" },
        },
      }),
    ).toEqual({
      label: "Web search · Search web",
      detail: "weather today in Redmond Oregon",
    });
  });

  test("describes catalog discovery without exposing raw results", () => {
    expect(
      describeChatToolPart({
        type: "tool-springroll_describe_connection_tools",
        toolCallId: "call-2",
        state: "output-available",
        input: { connectionId: "neon" },
      }),
    ).toEqual({ label: "Neon · Inspect tools" });
  });

  test("describes connector research using the user's intent", () => {
    expect(
      describeChatToolPart({
        type: "tool-springroll_research_connection",
        toolCallId: "call-3",
        state: "output-available",
        input: { intent: "Connect Microsoft Clarity" },
      }),
    ).toEqual({
      label: "Research connection",
      detail: "Connect Microsoft Clarity",
    });
  });

  test("accepts a complete verified connection proposal for native rendering", () => {
    expect(
      connectionResearchOutcomeFromToolPart({
        type: "tool-springroll_research_connection",
        state: "output-available",
        output: {
          status: "ready",
          proposal: {
            templateId: "neon",
            name: "Neon",
            description: "Neon databases",
            operator: "Neon",
            trust: "curated",
            variants: [
              {
                id: "oauth",
                label: "Sign in with Neon",
                recommended: true,
                credentialKind: "oauth",
                guidance: {
                  summary: "Use your Neon account.",
                  steps: ["Review access", "Sign in"],
                  docsUrl: "https://neon.com/docs/ai/neon-mcp-server",
                },
              },
            ],
          },
        },
      }),
    ).toEqual({
      status: "ready",
      proposal: {
        templateId: "neon",
        name: "Neon",
        description: "Neon databases",
        operator: "Neon",
        trust: "curated",
        variants: [
          {
            id: "oauth",
            label: "Sign in with Neon",
            recommended: true,
            credentialKind: "oauth",
            guidance: {
              summary: "Use your Neon account.",
              steps: ["Review access", "Sign in"],
              docsUrl: "https://neon.com/docs/ai/neon-mcp-server",
            },
          },
        ],
      },
    });
  });

  test("renders a host-verified local package proposal without its manifest", () => {
    const outcome = connectionResearchOutcomeFromToolPart({
      type: "tool-springroll_propose_local_mcp",
      state: "output-available",
      output: {
        status: "ready",
        proposal: {
          templateId: "research-clarity",
          name: "Microsoft Clarity",
          description: "Read Clarity analytics from this Mac.",
          operator: "Microsoft",
          trust: "package-verified",
          packageName: "@microsoft/clarity-mcp-server",
          packageVersion: "2.0.1",
          packageArgs: ["mcp"],
          manifest: {
            id: "microsoft-clarity",
            transport: { kind: "mcp-local" },
            credential: { kind: "api-key" },
          },
          sources: [
            {
              title: "Microsoft Learn",
              url: "https://learn.microsoft.com/clarity",
            },
          ],
          variants: [
            {
              id: "researched",
              label: "Connect Microsoft Clarity",
              recommended: true,
              credentialKind: "api-key",
              guidance: {
                summary: "Generate a Data Export API token.",
                steps: ["Open Settings, then Data Export."],
                docsUrl: "https://learn.microsoft.com/clarity",
              },
            },
          ],
        },
      },
    });

    expect(outcome).toMatchObject({
      status: "ready",
      proposal: {
        trust: "package-verified",
        packageName: "@microsoft/clarity-mcp-server",
        packageVersion: "2.0.1",
        packageArgs: ["mcp"],
      },
    });
    expect(JSON.stringify(outcome)).not.toContain("mcp-local");
    expect(
      describeChatToolPart({
        type: "tool-springroll_propose_local_mcp",
        state: "output-available",
        input: { packageName: "@microsoft/clarity-mcp-server" },
      }),
    ).toEqual({
      label: "Verify local MCP package",
      detail: "@microsoft/clarity-mcp-server",
    });
  });

  test("renders a host-verified OpenAPI proposal with operations and metering", () => {
    const outcome = connectionResearchOutcomeFromToolPart({
      type: "tool-springroll_propose_openapi_connection",
      state: "output-available",
      output: {
        status: "ready",
        proposal: {
          templateId: "research-assessor-search",
          name: "Assessor Search",
          description: "Read public property records.",
          operator: "AssessorSearch",
          trust: "openapi-verified",
          api: {
            specUrl:
              "https://assessorsearch.com/property-data-api/openapi.json",
            baseUrl: "https://api.assessorsearch.com/",
            operationCount: 2,
            verification: {
              tool: "lookup_property_v1_properties_get",
              note: "A non-match uses zero credits.",
            },
            notes: ["Matched records consume credits."],
          },
          tools: [
            {
              name: "lookup_property_v1_properties_get",
              description: "Look up a property",
              effect: "read",
            },
          ],
          variants: [
            {
              id: "researched",
              label: "Connect Assessor Search",
              recommended: true,
              credentialKind: "api-key",
              guidance: {
                summary: "Use an API key.",
                steps: ["Create a key."],
                docsUrl: "https://assessorsearch.com/property-data-api/docs",
              },
            },
          ],
        },
      },
    });

    expect(outcome).toMatchObject({
      status: "ready",
      proposal: {
        trust: "openapi-verified",
        api: {
          operationCount: 2,
          verification: {
            tool: "lookup_property_v1_properties_get",
          },
        },
        tools: [
          {
            name: "lookup_property_v1_properties_get",
            description: "Look up a property",
            effect: "read",
          },
        ],
      },
    });
    expect(
      describeChatToolPart({
        type: "tool-springroll_propose_openapi_connection",
        input: {
          name: "Assessor Search",
          specUrl: "https://assessorsearch.com/property-data-api/openapi.json",
        },
      }),
    ).toEqual({ label: "Verify official API", detail: "Assessor Search" });
  });

  test("rejects malformed research output instead of rendering setup controls", () => {
    expect(
      connectionResearchOutcomeFromToolPart({
        type: "tool-springroll_research_connection",
        state: "output-available",
        output: {
          status: "ready",
          proposal: {
            templateId: "unsafe",
            name: "Unsafe",
            description: "Missing a credential rail",
            operator: "Unknown",
            variants: [{ id: "bad" }],
          },
        },
      }),
    ).toBeUndefined();
  });

  test("hides an intermediate registry miss when local research succeeds", () => {
    const miss = {
      type: "tool-springroll_research_connection",
      state: "output-available",
      output: {
        status: "not_found",
        title: "No official remote connector",
        explanation: "Checking reviewed local packages next.",
      },
    };
    const ready = {
      type: "tool-springroll_propose_local_mcp",
      state: "output-available",
      output: {
        status: "ready",
        proposal: {
          templateId: "research-firebase",
          name: "Firebase MCP",
          description: "Local Firebase tools",
          operator: "Google Firebase",
          variants: [
            {
              id: "researched",
              label: "Connect Firebase MCP",
              recommended: true,
              credentialKind: "api-key",
              guidance: {
                summary: "Use a Firebase token.",
                steps: ["Generate the token."],
                docsUrl: "https://firebase.google.com/docs/cli/mcp-server",
              },
            },
          ],
        },
      },
    };

    expect(
      visibleConnectionResearchOutcomeFromToolPart(miss, [miss], true),
    ).toBeUndefined();
    expect(
      visibleConnectionResearchOutcomeFromToolPart(miss, [miss, ready], false),
    ).toBeUndefined();
    expect(
      visibleConnectionResearchOutcomeFromToolPart(miss, [miss], false),
    ).toMatchObject({ status: "not_found" });
    expect(
      visibleConnectionResearchOutcomeFromToolPart(ready, [miss, ready], false),
    ).toMatchObject({ status: "ready" });
  });

  test("accepts a validated recipe proposal for native review", () => {
    expect(
      taskProposalOutcomeFromToolPart({
        type: "tool-springroll_propose_task",
        state: "output-available",
        output: {
          status: "ready",
          proposal: {
            title: "Morning digest",
            prompt: "Summarize Hacker News",
            schedule: "0 8 * * *",
            scheduleLabel: "Daily at 8:00 AM",
            timezone: "America/Los_Angeles",
            connectionId: "hacker-news",
            connectionName: "Hacker News",
            toolNames: ["top_stories"],
            tools: [
              {
                name: "top_stories",
                description: "Read top stories",
                effect: "read",
              },
            ],
            contract: "Read stories and write a digest.",
            executionMode: "local",
            catchUpPolicy: "skip_to_next",
          },
        },
      }),
    ).toMatchObject({
      status: "ready",
      proposal: {
        title: "Morning digest",
        connectionName: "Hacker News",
        tools: [{ name: "top_stories", effect: "read" }],
      },
    });
  });

  test("rejects malformed recipe proposal output", () => {
    expect(
      taskProposalOutcomeFromToolPart({
        type: "tool-springroll_propose_task",
        state: "output-available",
        output: {
          status: "ready",
          proposal: { title: "Missing everything else" },
        },
      }),
    ).toBeUndefined();
  });

  test("accepts a validated recipe update for native review", () => {
    const before = {
      name: "Weather",
      prompt: "Check Rapid City, North Dakota",
      schedule: "0 8 * * *",
      timezone: "America/Los_Angeles",
      catchUpPolicy: "skip_to_next",
    };
    expect(
      taskUpdateProposalOutcomeFromToolPart({
        type: "tool-springroll_propose_task_update",
        state: "output-available",
        output: {
          status: "ready",
          proposal: {
            taskId: "task-weather",
            expectedUpdatedAt: "2026-08-05T12:00:00.000Z",
            before,
            after: {
              ...before,
              prompt: "Check Rapid City, South Dakota",
            },
            changes: [
              {
                field: "prompt",
                label: "Instructions",
                before: before.prompt,
                after: "Check Rapid City, South Dakota",
              },
            ],
          },
        },
      }),
    ).toMatchObject({
      status: "ready",
      proposal: {
        taskId: "task-weather",
        changes: [{ field: "prompt" }],
      },
    });
    expect(
      describeChatToolPart({
        type: "tool-springroll_propose_task_update",
        input: { taskId: "task-weather", prompt: "Correct the city" },
      }),
    ).toEqual({ label: "Draft recipe update", detail: "task-weather" });
  });

  test("accepts a validated tool repair for native review", () => {
    expect(
      taskToolRepairProposalOutcomeFromToolPart({
        type: "tool-springroll_propose_task_tool_repair",
        state: "output-available",
        output: {
          status: "ready",
          proposal: {
            taskId: "task-weather",
            taskName: "Weather",
            changes: [
              {
                connectionId: "web-search",
                connectionName: "Web",
                sourceId: "native.web",
                toolName: "search_web",
                description: "Search public sources",
                previousInputSchemaHash: "old-hash",
                proposedInputSchemaHash: "new-hash",
                inputSchema: { type: "object", properties: {} },
                previousRisk: {
                  effect: "read",
                  openWorld: true,
                  idempotent: true,
                },
                proposedRisk: {
                  effect: "read",
                  openWorld: true,
                  idempotent: true,
                },
              },
            ],
          },
        },
      }),
    ).toMatchObject({
      status: "ready",
      proposal: {
        taskId: "task-weather",
        changes: [{ toolName: "search_web" }],
      },
    });
    expect(
      describeChatToolPart({
        type: "tool-springroll_propose_task_tool_repair",
        input: { taskId: "task-weather" },
      }),
    ).toEqual({ label: "Review recipe tools", detail: "task-weather" });
  });
});

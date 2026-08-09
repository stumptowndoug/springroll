import { describe, expect, test } from "bun:test";
import type { ModelMessage, ToolSet } from "ai";
import {
  connectorSourceInspectionTool,
  connectorSourceSearchTool,
  openApiDiscoveryTool,
  prepareAssistantStep,
} from "../src/assistant-step-policy.ts";

const catalogTools = [
  "springroll_search_application_tools",
  "springroll_describe_application_tools",
  "springroll_activate_application_tools",
  "springroll_get_application_state",
  "springroll_list_connections",
  "springroll_research_connection",
  connectorSourceSearchTool,
  connectorSourceInspectionTool,
  openApiDiscoveryTool,
  "springroll_propose_connection",
  "springroll_propose_connection_action",
  "springroll_list_tasks",
  "springroll_get_task",
  "springroll_get_usage_summary",
  "springroll_custom_activated_tool",
] as const;

describe("interactive assistant step policy", () => {
  test("scopes tools by intent while preserving explicit activation", () => {
    const result = prepareAssistantStep({
      context: {
        version: 1,
        intent: "task.manage",
        origin: "recipes",
        subjects: [],
      },
      tools: tools(...catalogTools, "non_springroll_tool"),
      steps: [
        {
          toolResults: [
            {
              toolName: "springroll_activate_application_tools",
              output: {
                activatedToolNames: ["springroll_custom_activated_tool"],
              },
            },
          ],
        },
      ],
      history: [],
      messages: [],
      stepNumber: 1,
      instructions: "system",
    });

    expect(result.activeTools).toEqual([
      "springroll_search_application_tools",
      "springroll_activate_application_tools",
      "springroll_list_tasks",
      "springroll_get_task",
      "springroll_custom_activated_tool",
      "non_springroll_tool",
    ]);
    expect(result.activeTools).not.toContain("springroll_get_usage_summary");
  });

  test("forces application-tool activation after catalog search", () => {
    const result = prepareAssistantStep({
      context: null,
      tools: tools(...catalogTools),
      steps: [
        {
          toolResults: [
            {
              toolName: "springroll_search_application_tools",
              output: {
                query: "research NASA APOD",
                matches: [{ name: "springroll_research_connection" }],
              },
            },
          ],
        },
      ],
      history: [],
      messages: [],
      stepNumber: 1,
      instructions: "system",
    });

    expect(result.toolChoice).toEqual({
      type: "tool",
      toolName: "springroll_activate_application_tools",
    });
    expect(result.instructions).toContain("never connection IDs");
    expect(result.instructions).toContain("springroll_call_*_connection_tool");
  });

  test("forces inspection of a user-supplied source on the first step", () => {
    const result = prepareAssistantStep({
      context: {
        version: 1,
        intent: "connection.create",
        origin: "connections",
        subjects: [],
      },
      tools: tools(...catalogTools),
      steps: [],
      history: [],
      messages: [],
      stepNumber: 0,
      connectorSourceUrl: "https://provider.example/mcp",
      instructions: "system",
    });

    expect(result.toolChoice).toEqual({
      type: "tool",
      toolName: connectorSourceInspectionTool,
    });
    expect(result.activeTools).toEqual(
      expect.arrayContaining([
        "springroll_search_connector_sources",
        "springroll_propose_connection_action",
      ]),
    );
  });

  test("forces inspection of an uninspected registry repository", () => {
    const result = prepareAssistantStep({
      context: {
        version: 1,
        intent: "connection.create",
        origin: "connections",
        subjects: [],
      },
      tools: tools(...catalogTools),
      steps: [
        {
          toolResults: [
            {
              toolName: "springroll_research_connection",
              output: {
                status: "candidate",
                candidate: {
                  kind: "local-mcp",
                  repositoryUrl: "https://github.com/provider/mcp",
                },
              },
            },
          ],
        },
      ],
      history: [],
      messages: [],
      stepNumber: 1,
      instructions: "system",
    });

    expect(result.toolChoice).toEqual({
      type: "tool",
      toolName: connectorSourceInspectionTool,
    });
    expect(result.instructions).toContain("https://github.com/provider/mcp");
  });

  test("forces inspection after public connector discovery", () => {
    const result = prepareAssistantStep({
      context: {
        version: 1,
        intent: "connection.create",
        origin: "connections",
        subjects: [],
      },
      tools: tools(...catalogTools),
      steps: [
        {
          toolResults: [
            {
              toolName: connectorSourceSearchTool,
              output: {
                query: "Stripe official MCP documentation",
                content:
                  "Stripe docs: https://docs.stripe.com/mcp (provider-owned)",
              },
            },
          ],
        },
      ],
      history: [],
      messages: [],
      stepNumber: 1,
      instructions: "system",
    });

    expect(result.toolChoice).toEqual({
      type: "tool",
      toolName: connectorSourceInspectionTool,
    });
    expect(result.instructions).toContain("provider-owned");
    expect(result.instructions).toContain("Do not re-inspect");
    expect(result.instructions).toContain("Do not propose, reconnect");
  });

  test("does not accept a repeated pre-search page as new provider evidence", () => {
    const repeatedUrl = "https://api.provider.test/";
    const result = prepareAssistantStep({
      context: {
        version: 1,
        intent: "connection.create",
        origin: "connections",
        subjects: [],
      },
      tools: tools(...catalogTools),
      steps: [
        {
          toolResults: [
            {
              toolName: connectorSourceInspectionTool,
              output: { requestedUrl: repeatedUrl, content: "Landing page" },
            },
          ],
        },
        {
          toolResults: [
            {
              toolName: connectorSourceSearchTool,
              output: {
                content: "Official repository https://github.com/provider/api",
              },
            },
          ],
        },
        {
          toolResults: [
            {
              toolName: connectorSourceInspectionTool,
              output: { requestedUrl: repeatedUrl, content: "Landing page" },
            },
          ],
        },
      ],
      history: [],
      messages: [],
      stepNumber: 3,
      instructions: "system",
    });

    expect(result.toolChoice).toEqual({
      type: "tool",
      toolName: connectorSourceInspectionTool,
    });
    expect(result.instructions).toContain("new exact provider-owned");
  });

  test("forces host discovery after inspecting an OpenAPI document", () => {
    const specUrl = "https://api.example.test/openapi.json";
    const result = prepareAssistantStep({
      context: {
        version: 1,
        intent: "connection.create",
        origin: "connections",
        subjects: [],
      },
      tools: tools(...catalogTools),
      steps: [
        {
          toolResults: [
            {
              toolName: connectorSourceInspectionTool,
              output: {
                requestedUrl: specUrl,
                content: '{"openapi":"3.1.2","paths":{}}',
              },
            },
          ],
        },
      ],
      history: [],
      messages: [],
      stepNumber: 1,
      instructions: "system",
    });

    expect(result.toolChoice).toEqual({
      type: "tool",
      toolName: openApiDiscoveryTool,
    });
    expect(result.instructions).toContain(specUrl);
    expect(result.instructions).toContain("Do not guess an operation name");
  });

  test("gives general chat direct access to effect-appropriate connected tool calls", () => {
    const result = prepareAssistantStep({
      context: {
        version: 1,
        intent: "general",
        origin: "chat",
        subjects: [],
      },
      tools: tools(
        ...catalogTools,
        "springroll_search_connection_tools",
        "springroll_describe_connection_tools",
        "springroll_call_read_connection_tool",
        "springroll_call_connection_tool",
      ),
      steps: [],
      history: [],
      messages: [],
      stepNumber: 0,
      instructions: "system",
    });

    expect(result.activeTools).toEqual(
      expect.arrayContaining([
        "springroll_list_connections",
        "springroll_search_connection_tools",
        "springroll_describe_connection_tools",
        "springroll_call_read_connection_tool",
        "springroll_call_connection_tool",
      ]),
    );
  });

  test("forces exact schema and effect inspection after connection-tool search", () => {
    const result = prepareAssistantStep({
      context: {
        version: 1,
        intent: "general",
        origin: "chat",
        subjects: [],
      },
      tools: tools(
        ...catalogTools,
        "springroll_search_connection_tools",
        "springroll_describe_connection_tools",
        "springroll_call_read_connection_tool",
        "springroll_call_connection_tool",
      ),
      steps: [
        {
          toolResults: [
            {
              toolName: "springroll_search_connection_tools",
              output: {
                matches: [
                  {
                    connectionId: "shopify-dev-mcp-default",
                    toolName: "learn_shopify_api",
                    effect: "write",
                  },
                ],
              },
            },
          ],
        },
      ],
      history: [],
      messages: [],
      stepNumber: 1,
      instructions: "system",
    });

    expect(result.toolChoice).toEqual({
      type: "tool",
      toolName: "springroll_describe_connection_tools",
    });
    expect(result.instructions).toContain("authoritative input schema");
    expect(result.instructions).toContain("claim an approval exists");
  });

  test("forces public-source search after a recoverable registry miss", () => {
    const result = prepareAssistantStep({
      context: {
        version: 1,
        intent: "connection.create",
        origin: "connections",
        subjects: [],
      },
      tools: tools(...catalogTools),
      steps: [
        {
          toolResults: [
            {
              toolName: "springroll_research_connection",
              output: {
                status: "not_found",
                explanation:
                  "Continue with official provider documentation or reviewed package research.",
              },
            },
          ],
        },
      ],
      history: [],
      messages: [],
      stepNumber: 1,
      instructions: "system",
    });

    expect(result.toolChoice).toEqual({
      type: "tool",
      toolName: connectorSourceSearchTool,
    });
    expect(result.instructions).toContain("Do not ask the user");
  });

  test("forces public-source search when an official page yields no connector configuration", () => {
    const result = prepareAssistantStep({
      context: {
        version: 1,
        intent: "connection.create",
        origin: "connections",
        subjects: [],
      },
      tools: tools(...catalogTools),
      steps: [
        {
          toolResults: [
            {
              toolName: connectorSourceInspectionTool,
              output: {
                requestedUrl: "https://shop.example/docs/ai",
                content: "AI toolkit Skip to main content",
                npmPackages: [],
                repositoryUrls: [],
              },
            },
          ],
        },
      ],
      history: [],
      messages: [],
      stepNumber: 1,
      instructions: "system",
    });

    expect(result.toolChoice).toEqual({
      type: "tool",
      toolName: connectorSourceSearchTool,
    });
    expect(result.instructions).toContain("could not extract");
    expect(result.instructions).toContain("Do not ask the user");
  });

  test("does not search again when inspected source contains a remote MCP endpoint", () => {
    const result = prepareAssistantStep({
      context: {
        version: 1,
        intent: "connection.create",
        origin: "connections",
        subjects: [],
      },
      tools: tools(...catalogTools),
      steps: [
        {
          toolResults: [
            {
              toolName: connectorSourceInspectionTool,
              output: {
                requestedUrl: "https://docs.example.test/mcp",
                content:
                  "Connect to https://mcp.example.test/mcp with no authentication.",
                npmPackages: [],
                repositoryUrls: [],
              },
            },
          ],
        },
      ],
      history: [],
      messages: [],
      stepNumber: 1,
      instructions: "system",
    });

    expect(result.toolChoice).toBeUndefined();
  });

  test("does not search past a provider-registration blocker", () => {
    const result = prepareAssistantStep({
      context: {
        version: 1,
        intent: "connection.create",
        origin: "connections",
        subjects: [],
      },
      tools: tools(...catalogTools),
      steps: [
        {
          toolResults: [
            {
              toolName: "springroll_research_connection",
              output: {
                status: "unavailable",
                explanation:
                  "Gmail requires a Springroll OAuth client registration before sign-in can be offered.",
              },
            },
          ],
        },
      ],
      history: [],
      messages: [],
      stepNumber: 1,
      instructions: "system",
    });

    expect(result.toolChoice).toBeUndefined();
  });

  test("ends immediately on a focused unavailable OAuth connection", () => {
    const result = prepareAssistantStep({
      context: {
        version: 1,
        intent: "connection.create",
        origin: "connections",
        subjects: [],
      },
      tools: tools(...catalogTools),
      steps: [
        {
          toolResults: [
            {
              toolName: "springroll_list_connections",
              output: {
                query: "I want to connect to Gmail",
                filtered: true,
                connections: [
                  {
                    id: "gmail",
                    name: "Gmail",
                    status: "coming_soon",
                    setup: "unavailable",
                    oauthReady: false,
                    blocker:
                      "Springroll OAuth client registration is not configured.",
                  },
                ],
              },
            },
          ],
        },
      ],
      history: [],
      messages: [],
      stepNumber: 1,
      instructions: "system",
    });

    expect(result.activeTools).toEqual([]);
    expect(result.toolChoice).toBe("none");
    expect(result.instructions).toContain(
      "this is a Springroll release prerequisite",
    );
    expect(result.instructions).toContain("Do not call reconnect, research");
  });

  test("stops after two rejected proposal steps and after a ready proposal", () => {
    const invalidStep = {
      toolResults: [
        {
          toolName: "springroll_propose_connection",
          output: { status: "invalid_input" },
        },
      ],
    };
    const rejected = prepareAssistantStep({
      context: null,
      tools: tools(...catalogTools),
      steps: [invalidStep, invalidStep],
      history: [],
      messages: [],
      stepNumber: 2,
      instructions: "system",
    });
    expect(rejected.toolChoice).toBe("none");
    expect(rejected.instructions).toContain("Two connector proposal attempts");

    const ready = prepareAssistantStep({
      context: null,
      tools: tools(...catalogTools),
      steps: [
        {
          toolResults: [
            {
              toolName: "springroll_propose_task",
              output: { status: "ready", proposal: { id: "proposal-1" } },
            },
          ],
        },
      ],
      history: [],
      messages: [] as ModelMessage[],
      stepNumber: 1,
      instructions: "system",
    });
    expect(ready.activeTools).toEqual([]);
    expect(ready.toolChoice).toBe("none");
    expect(ready.instructions).toContain("native review proposal");
    expect(ready.instructions).toContain("already rendered in this chat");
    expect(ready.instructions).toContain("another page");
  });
});

function tools(...names: readonly string[]): ToolSet {
  return Object.fromEntries(names.map((name) => [name, {}])) as ToolSet;
}

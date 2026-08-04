import { describe, expect, test } from "bun:test";
import {
  connectionResearchOutcomeFromToolPart,
  describeChatToolPart,
  taskProposalOutcomeFromToolPart,
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
});

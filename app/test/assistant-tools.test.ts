import { describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import {
  createSpringrollApplicationTools,
  hasReachedWebSearchLimit,
  type SpringrollApplicationReadApi,
} from "../src/server/assistant-tools.ts";

describe("assistant application tools", () => {
  test("stops a third indexed search while leaving direct fetch available", () => {
    const messages: ModelMessage[] = [
      { role: "user", content: "What is the weather right now?" },
      searchCall("search-1", "web", "current weather Redmond Oregon"),
      searchCall("search-2", "web", "Redmond Oregon official weather"),
    ];

    expect(hasReachedWebSearchLimit(messages, "web")).toBe(true);
    expect(hasReachedWebSearchLimit(messages.slice(0, 2), "web")).toBe(false);
    expect(hasReachedWebSearchLimit(messages, "another-web")).toBe(false);
  });

  test("drafts but does not save a recipe through the shared application boundary", async () => {
    const calls: unknown[] = [];
    const application = {
      async proposeTask(request: string, timezone: string) {
        calls.push({ request, timezone });
        return {
          status: "unsupported" as const,
          title: "Not available",
          explanation: "No matching connection",
        };
      },
    } as unknown as SpringrollApplicationReadApi;
    const tools = createSpringrollApplicationTools(application);
    const proposalTool = tools.springroll_propose_task as unknown as {
      execute(
        input: { readonly request: string; readonly timezone?: string },
        options: {
          readonly toolCallId: string;
          readonly messages: readonly ModelMessage[];
        },
      ): Promise<unknown>;
    };
    if (!proposalTool?.execute)
      throw new Error("Expected recipe proposal tool");

    const result = await proposalTool.execute(
      { request: "Summarize Hacker News", timezone: "UTC" },
      {
        toolCallId: "proposal-call",
        messages: [],
      },
    );

    expect(calls).toEqual([
      { request: "Summarize Hacker News", timezone: "UTC" },
    ]);
    expect(result).toMatchObject({
      status: "unsupported",
      title: "Not available",
    });
  });
});

function searchCall(
  toolCallId: string,
  connectionId: string,
  query: string,
): ModelMessage {
  return {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId,
        toolName: "springroll_call_read_connection_tool",
        input: {
          connectionId,
          toolName: "search_web",
          input: { query, freshness: "live" },
        },
      },
    ],
  };
}

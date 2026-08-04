import { describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import { hasReachedWebSearchLimit } from "../src/server/assistant-tools.ts";

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

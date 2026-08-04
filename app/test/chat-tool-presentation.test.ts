import { describe, expect, test } from "bun:test";
import { describeChatToolPart } from "../src/client/chat-tool-presentation.ts";

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
});

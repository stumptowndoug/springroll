import { expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import { compactSupersededWebResearchMessages } from "../src/web-research-context.ts";

test("compacts search leads and older reads after focused web research advances", () => {
  const messages = [
    toolMessage(
      "search",
      "search_web",
      `https://one.test ${"s".repeat(5_000)}`,
    ),
    toolMessage(
      "read-one",
      "fetch_public_url",
      `https://one.test ${"a".repeat(5_000)}`,
    ),
    toolMessage(
      "read-two",
      "fetch_public_url",
      `https://two.test ${"b".repeat(5_000)}`,
    ),
  ];

  const compacted = compactSupersededWebResearchMessages(messages);
  const encoded = JSON.stringify(compacted);
  expect(compacted).toBeDefined();
  expect(encoded).toContain("superseded search_web");
  expect(encoded).toContain("superseded fetch_public_url");
  expect(encoded).toContain("https://one.test");
  expect(encoded).toContain("b".repeat(4_000));
  expect(encoded.length).toBeLessThan(JSON.stringify(messages).length);
});

test("does not compact search leads before an exact page is read", () => {
  const messages = [
    toolMessage(
      "search",
      "search_web",
      `https://one.test ${"s".repeat(5_000)}`,
    ),
  ];
  expect(compactSupersededWebResearchMessages(messages)).toBeUndefined();
});

function toolMessage(
  toolCallId: string,
  toolName: string,
  value: string,
): ModelMessage {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId,
        toolName,
        output: { type: "text", value },
      },
    ],
  };
}

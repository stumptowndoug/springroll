import { expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import {
  compactSupersededConnectorProposalMessages,
  compactSupersededWebResearchMessages,
} from "../src/web-research-context.ts";

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

test("compacts abandoned connector proposal drafts while preserving the latest", () => {
  const oldInput = {
    name: "DataForSEO",
    transport: {
      kind: "http-api",
      operations: [{ description: "x".repeat(8_000) }],
    },
  };
  const latestInput = {
    name: "DataForSEO",
    transport: { kind: "http-api", baseUrl: "https://api.dataforseo.com" },
  };
  const messages: ModelMessage[] = [
    proposalCallMessage("old", oldInput),
    toolMessage("old", "propose_connection", "host validation failed"),
    proposalCallMessage("latest", latestInput),
    toolMessage("latest", "propose_connection", "ready"),
  ];

  const compacted = compactSupersededConnectorProposalMessages(messages);
  const encoded = JSON.stringify(compacted);
  expect(compacted).toBeDefined();
  expect(encoded).toContain('"superseded":true');
  expect(encoded).toContain("An earlier connector proposal was replaced");
  expect(encoded).not.toContain("x".repeat(1_000));
  expect(encoded).toContain("https://api.dataforseo.com");
  expect(encoded).toContain("ready");
});

function proposalCallMessage(
  toolCallId: string,
  input: Record<string, unknown>,
): ModelMessage {
  return {
    role: "assistant",
    content: [
      {
        type: "tool-call",
        toolCallId,
        toolName: "propose_connection",
        input,
      },
    ],
  };
}

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

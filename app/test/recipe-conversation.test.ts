import { describe, expect, test } from "bun:test";
import { recipeConversationTimeline } from "../src/client/recipe-conversation.ts";
import type { AssistantMessageDto, RunDetailDto } from "../src/shared.ts";

describe("recipe conversation presentation", () => {
  test("interleaves run results without adding them to durable chat messages", () => {
    const messages = [
      {
        id: "message-before",
        role: "user",
        parts: [{ type: "text", text: "Run this recipe" }],
        metadata: { createdAt: "2026-08-09T16:00:00.000Z" },
      },
      {
        id: "message-after",
        role: "assistant",
        parts: [{ type: "text", text: "It is scheduled." }],
        metadata: { createdAt: "2026-08-09T18:00:00.000Z" },
      },
    ] satisfies readonly AssistantMessageDto[];
    const runs = [
      {
        id: "run-between",
        taskId: "task-1",
        taskName: "Daily digest",
        status: "succeeded",
        scheduledTime: "2026-08-09T17:00:00.000Z",
        needsAttention: false,
        executionLocation: "local",
        toolCalls: 0,
        approvals: [],
        requiredApprovalIds: [],
        canRetry: false,
      },
    ] satisfies readonly RunDetailDto[];

    expect(
      recipeConversationTimeline(messages, runs).map(({ kind, id }) => ({
        kind,
        id,
      })),
    ).toEqual([
      { kind: "message", id: "message-before" },
      { kind: "run", id: "run-between" },
      { kind: "message", id: "message-after" },
    ]);
    expect(messages).toHaveLength(2);
  });
});

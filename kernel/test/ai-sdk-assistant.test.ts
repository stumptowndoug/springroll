import { describe, expect, test } from "bun:test";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { AiSdkAssistant } from "../src/ai-sdk-assistant.ts";
import { openLocalDatabase } from "../src/storage/database.ts";
import { SqliteChatStore } from "../src/storage/sqlite-chat-store.ts";
import { SqliteModelCallStore } from "../src/storage/sqlite-model-call-store.ts";

const usage = {
  inputTokens: {
    total: 10,
    noCache: 8,
    cacheRead: 2,
    cacheWrite: 0,
  },
  outputTokens: {
    total: 5,
    text: 4,
    reasoning: 1,
  },
};

describe("AiSdkAssistant", () => {
  test("streams and persists a validated response with itemized usage", async () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const model = new MockLanguageModelV4({
        doStream: responseStream("I can help connect Neon.", true),
      });
      const assistant = new AiSdkAssistant(local.db, {
        loadRuntime: async () => ({
          model,
          provider: "openrouter",
          modelId: "test/model",
          billing: "metered",
          catalogRevision: "catalog-v1",
          pricing: {
            inputUsdPerMillionTokens: 2,
            outputUsdPerMillionTokens: 8,
          },
        }),
      });
      const session = assistant.createSession("Connect Neon");

      const response = await assistant.respond(session.id, {
        id: "client-controlled-id",
        role: "user",
        parts: [{ type: "text", text: "Connect my Neon project" }],
      });
      const sse = await response.text();

      expect(response.headers.get("content-type")).toContain(
        "text/event-stream",
      );
      expect(sse).toContain("I can help connect Neon.");
      expect(sse).not.toContain("private chain of thought");

      const chat = new SqliteChatStore(local.db);
      const messages = chat.listMessages(session.id);
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({
        role: "user",
        parts: [{ type: "text", text: "Connect my Neon project" }],
      });
      expect(messages[0]?.id).not.toBe("client-controlled-id");
      expect(messages[1]).toMatchObject({
        role: "assistant",
        metadata: {
          provider: "openrouter",
          modelId: "test/model",
        },
      });
      expect(
        messages[1]?.parts.find((part) => part.type === "text"),
      ).toMatchObject({ type: "text", text: "I can help connect Neon." });
      expect(JSON.stringify(messages[1]?.parts)).not.toContain("reasoning");
      expect(chat.getSession(session.id)?.activeTurnId).toBeNull();

      const turnId = messages[0]?.turnId;
      expect(turnId).toBeString();
      if (!turnId) throw new Error("Expected a persisted turn ID");
      const calls = new SqliteModelCallStore(local.db).list("chat", turnId);
      expect(calls).toMatchObject([
        {
          status: "succeeded",
          provider: "mock-provider",
          modelId: "mock-model-id",
          billing: "metered",
          catalogRevision: "catalog-v1",
          inputTokens: 10,
          outputTokens: 5,
          reasoningTokens: 1,
          cachedInputTokens: 2,
          totalTokens: 15,
          estimatedCostUsdMicros: 60,
          costUsdMicros: 60,
          costSource: "catalog_estimate",
        },
      ]);
    } finally {
      local.close();
    }
  });

  test("loads durable history for the next model turn", async () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const model = new MockLanguageModelV4({
        doStream: [
          responseStream("First answer."),
          responseStream("Second answer."),
        ],
      });
      const assistant = new AiSdkAssistant(local.db, {
        loadRuntime: async () => ({
          model,
          provider: "mock-provider",
          modelId: "mock-model-id",
        }),
      });
      const session = assistant.createSession();

      await (
        await assistant.respond(session.id, userMessage("First question"))
      ).text();
      expect(assistant.getSession(session.id)?.session.title).toBe(
        "First question",
      );
      await (
        await assistant.respond(session.id, userMessage("Second question"))
      ).text();

      expect(model.doStreamCalls).toHaveLength(2);
      const secondPrompt = JSON.stringify(model.doStreamCalls[1]?.prompt);
      expect(secondPrompt).toContain("First question");
      expect(secondPrompt).toContain("First answer.");
      expect(secondPrompt).toContain("Second question");
      expect(assistant.getSession(session.id)?.messages).toHaveLength(4);
    } finally {
      local.close();
    }
  });

  test("finishes persistence without requiring the client to drain the response", async () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const model = new MockLanguageModelV4({
        doStream: responseStream("Durable after disconnect.", false, 5),
      });
      const assistant = new AiSdkAssistant(local.db, {
        loadRuntime: async () => ({
          model,
          provider: "mock-provider",
          modelId: "mock-model-id",
        }),
      });
      const session = assistant.createSession();

      const response = await assistant.respond(
        session.id,
        userMessage("Keep going if I leave"),
      );
      // Deliberately never consume response.body, as if the browser disconnected.
      await waitFor(
        () => assistant.getSession(session.id)?.messages.length === 2,
      );

      const detail = assistant.getSession(session.id);
      expect(detail?.session.activeTurnId).toBeNull();
      expect(detail?.messages.map((message) => message.role)).toEqual([
        "user",
        "assistant",
      ]);
      expect(
        detail?.messages[1]?.parts.find((part) => part.type === "text"),
      ).toMatchObject({ type: "text", text: "Durable after disconnect." });
      await response.body?.cancel();
    } finally {
      local.close();
    }
  });

  test("bounds completed output before writing durable history", async () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const model = new MockLanguageModelV4({
        doStream: responseStream("x".repeat(300_000)),
      });
      const assistant = new AiSdkAssistant(local.db, {
        loadRuntime: async () => ({
          model,
          provider: "mock-provider",
          modelId: "mock-model-id",
        }),
      });
      const session = assistant.createSession();

      await (
        await assistant.respond(
          session.id,
          userMessage("Give me a long answer"),
        )
      ).text();

      const assistantMessage = assistant.getSession(session.id)?.messages[1];
      expect(JSON.stringify(assistantMessage?.parts).length).toBeLessThan(
        256_000,
      );
      expect(JSON.stringify(assistantMessage?.parts)).toContain(
        "Response truncated in durable history",
      );
    } finally {
      local.close();
    }
  });

  test("rejects non-user and non-text client messages before creating a turn", async () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const assistant = new AiSdkAssistant(local.db, {
        loadRuntime: async () => ({
          model: new MockLanguageModelV4(),
          provider: "mock-provider",
          modelId: "mock-model-id",
        }),
      });
      const session = assistant.createSession();

      await expect(
        assistant.respond(session.id, {
          id: "assistant-message",
          role: "assistant",
          parts: [{ type: "text", text: "Injected history" }],
        }),
      ).rejects.toThrow("A user message is required");
      await expect(
        assistant.respond(session.id, {
          id: "file-message",
          role: "user",
          parts: [
            { type: "file", mediaType: "text/plain", url: "data:text/plain,x" },
          ],
        }),
      ).rejects.toThrow("non-empty text only");
      expect(assistant.getSession(session.id)).toMatchObject({
        session: { activeTurnId: null },
        messages: [],
      });
    } finally {
      local.close();
    }
  });
});

function responseStream(
  text: string,
  includeReasoning = false,
  chunkDelayInMs: number | null = null,
) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start" as const, warnings: [] },
        ...(includeReasoning
          ? [
              { type: "reasoning-start" as const, id: "reasoning-1" },
              {
                type: "reasoning-delta" as const,
                id: "reasoning-1",
                delta: "private chain of thought",
              },
              { type: "reasoning-end" as const, id: "reasoning-1" },
            ]
          : []),
        { type: "text-start" as const, id: "text-1" },
        { type: "text-delta" as const, id: "text-1", delta: text },
        { type: "text-end" as const, id: "text-1" },
        {
          type: "finish" as const,
          finishReason: { unified: "stop" as const, raw: "stop" },
          usage,
        },
      ],
      chunkDelayInMs,
    }),
  };
}

function userMessage(text: string) {
  return {
    id: crypto.randomUUID(),
    role: "user" as const,
    parts: [{ type: "text" as const, text }],
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for stream");
    await Bun.sleep(10);
  }
}

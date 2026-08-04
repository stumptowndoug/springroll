import { describe, expect, test } from "bun:test";
import { openLocalDatabase } from "../src/storage/database.ts";
import { SqliteChatStore } from "../src/storage/sqlite-chat-store.ts";
import { SqliteModelCallStore } from "../src/storage/sqlite-model-call-store.ts";

describe("SQLite chat persistence", () => {
  test("persists ordered history and resumable turn state", () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const chat = new SqliteChatStore(local.db);
      const createdAt = new Date("2026-08-04T17:00:00.000Z");
      const session = chat.createSession({
        id: "chat-1",
        title: "Connect Microsoft Clarity",
        now: createdAt,
      });
      const turn = chat.createTurn(
        session.id,
        "turn-1",
        new Date("2026-08-04T17:00:01.000Z"),
      );

      chat.appendMessage({
        id: "message-user",
        sessionId: session.id,
        turnId: turn.id,
        role: "user",
        parts: [{ type: "text", text: "Connect Microsoft Clarity" }],
        createdAt: new Date("2026-08-04T17:00:02.000Z"),
      });
      chat.appendMessage({
        id: "message-assistant",
        sessionId: session.id,
        turnId: turn.id,
        role: "assistant",
        parts: [
          {
            type: "data-connection-proposal",
            data: { status: "researched", provider: "Microsoft Clarity" },
          },
        ],
        metadata: { model: "test/model" },
        createdAt: new Date("2026-08-04T17:00:03.000Z"),
      });

      const streaming = chat.setTurnStatus(turn.id, "streaming", {
        now: new Date("2026-08-04T17:00:04.000Z"),
      });
      const waiting = chat.setTurnStatus(turn.id, "waiting_for_user", {
        now: new Date("2026-08-04T17:00:05.000Z"),
      });

      expect(streaming.startedAt?.toISOString()).toBe(
        "2026-08-04T17:00:04.000Z",
      );
      expect(waiting).toMatchObject({
        id: "turn-1",
        status: "waiting_for_user",
        finishedAt: null,
      });
      expect(chat.getSession(session.id)?.activeTurnId).toBe(turn.id);
      expect(chat.listMessages(session.id)).toMatchObject([
        {
          id: "message-user",
          sequence: 0,
          role: "user",
          schemaVersion: 1,
          parts: [{ type: "text", text: "Connect Microsoft Clarity" }],
        },
        {
          id: "message-assistant",
          sequence: 1,
          role: "assistant",
          metadata: { model: "test/model" },
        },
      ]);

      const completed = chat.setTurnStatus(turn.id, "completed", {
        now: new Date("2026-08-04T17:00:06.000Z"),
      });
      expect(completed.finishedAt?.toISOString()).toBe(
        "2026-08-04T17:00:06.000Z",
      );
      expect(chat.getSession(session.id)?.activeTurnId).toBeNull();
      expect(() => chat.setTurnStatus(turn.id, "streaming")).toThrow(
        "Invalid chat turn transition: completed -> streaming",
      );
    } finally {
      local.close();
    }
  });

  test("records itemized model calls and aggregates chat usage", () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const chat = new SqliteChatStore(local.db);
      const calls = new SqliteModelCallStore(local.db);
      const session = chat.createSession({ id: "chat-usage" });
      const firstTurn = chat.createTurn(session.id, "turn-usage-1");
      chat.setTurnStatus(firstTurn.id, "completed");
      const secondTurn = chat.createTurn(session.id, "turn-usage-2");

      calls.record({
        id: "call-1",
        contextKind: "chat",
        contextId: firstTurn.id,
        status: "succeeded",
        provider: "openrouter",
        modelId: "openai/gpt-5",
        billing: "metered",
        inputTokens: 100,
        outputTokens: 20,
        reasoningTokens: 5,
        cachedInputTokens: 10,
        totalTokens: 125,
        actualCostUsdMicros: 150,
        costUsdMicros: 150,
        costSource: "provider_reported",
        webSearchRequests: 1,
        providerToolCalls: 1,
        startedAt: new Date("2026-08-04T18:00:00.000Z"),
        finishedAt: new Date("2026-08-04T18:00:01.250Z"),
      });
      calls.record({
        id: "call-2",
        contextKind: "chat",
        contextId: secondTurn.id,
        status: "started",
        provider: "openrouter",
        modelId: "openai/gpt-5",
        startedAt: new Date("2026-08-04T18:01:00.000Z"),
      });
      calls.finish("call-2", {
        status: "succeeded",
        inputTokens: 50,
        outputTokens: 10,
        totalTokens: 60,
        estimatedCostUsdMicros: 40,
        costUsdMicros: 40,
        costSource: "catalog_estimate",
        providerToolCalls: 2,
        finishedAt: new Date("2026-08-04T18:01:00.500Z"),
      });

      expect(calls.list("chat", firstTurn.id)).toMatchObject([
        {
          id: "call-1",
          sequence: 0,
          durationMs: 1_250,
          actualCostUsdMicros: 150,
        },
      ]);
      expect(chat.usage(session.id)).toEqual({
        inputTokens: 150,
        outputTokens: 30,
        reasoningTokens: 5,
        cachedInputTokens: 10,
        totalTokens: 185,
        actualCostUsdMicros: 150,
        estimatedCostUsdMicros: 40,
        webSearchRequests: 1,
        providerToolCalls: 3,
      });
    } finally {
      local.close();
    }
  });

  test("recovers an interrupted turn and model call after restart", () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const chat = new SqliteChatStore(local.db);
      const calls = new SqliteModelCallStore(local.db);
      const session = chat.createSession({ id: "chat-restart" });
      const turn = chat.createTurn(
        session.id,
        "turn-restart",
        new Date("2026-08-04T18:00:00.000Z"),
      );
      chat.setTurnStatus(turn.id, "streaming", {
        now: new Date("2026-08-04T18:00:01.000Z"),
      });
      calls.record({
        id: "call-restart",
        contextKind: "chat",
        contextId: turn.id,
        status: "started",
        provider: "openrouter",
        modelId: "openai/gpt-5",
        startedAt: new Date("2026-08-04T18:00:02.000Z"),
      });

      expect(
        chat.recoverInterruptedTurns(new Date("2026-08-04T18:00:05.000Z")),
      ).toBe(1);

      expect(chat.getSession(session.id)?.activeTurnId).toBeNull();
      expect(chat.listTurns(session.id)).toMatchObject([
        {
          status: "failed",
          error:
            "Springroll restarted before this response finished. Try again to continue.",
          finishedAt: new Date("2026-08-04T18:00:05.000Z"),
        },
      ]);
      expect(calls.list("chat", turn.id)).toMatchObject([
        {
          status: "failed",
          error: "Springroll restarted during this model call",
          durationMs: 3_000,
        },
      ]);
      expect(chat.recoverInterruptedTurns()).toBe(0);
    } finally {
      local.close();
    }
  });

  test("rejects raw reasoning, invalid model usage, and writes to archived chats", () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const chat = new SqliteChatStore(local.db);
      const calls = new SqliteModelCallStore(local.db);
      const session = chat.createSession({ id: "chat-safe" });

      expect(() =>
        chat.appendMessage({
          sessionId: session.id,
          role: "assistant",
          parts: [{ type: "reasoning", text: "private chain of thought" }],
        }),
      ).toThrow("Raw reasoning parts are not durable chat content");
      expect(() =>
        calls.record({
          contextKind: "chat",
          contextId: "turn-safe",
          status: "failed",
          inputTokens: -1,
          startedAt: new Date(),
        }),
      ).toThrow("inputTokens must be a non-negative integer");

      chat.archiveSession(session.id);
      expect(() => chat.createTurn(session.id)).toThrow(
        "Chat session is archived",
      );
      expect(() =>
        chat.appendMessage({
          sessionId: session.id,
          role: "user",
          parts: [{ type: "text", text: "hello" }],
        }),
      ).toThrow("Chat session is archived");
    } finally {
      local.close();
    }
  });
});

import { describe, expect, test } from "bun:test";
import { simulateReadableStream, tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { AiSdkAssistant } from "../src/ai-sdk-assistant.ts";
import { toDurableChatParts } from "../src/durable-chat-persistence.ts";
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
  test("injects server-owned intent and subject references into the model context", async () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const model = new MockLanguageModelV4({
        doStream: responseStream("I inspected the referenced run."),
      });
      const assistant = new AiSdkAssistant(local.db, {
        loadRuntime: async () => ({
          model,
          provider: "mock-provider",
          modelId: "mock-model",
        }),
      });
      const session = assistant.createOrResumeSession({
        context: {
          version: 1,
          intent: "run.diagnose",
          origin: "runs",
          subjects: [{ kind: "run", id: "run-context-1" }],
          suggestedPrompt: "Help me with this run.",
        },
      });

      const response = await assistant.respond(session.id, {
        id: "context-message",
        role: "user",
        parts: [{ type: "text", text: "What happened?" }],
      });
      await response.text();

      const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);
      expect(prompt).toContain("Current conversation intent: run.diagnose");
      expect(prompt).toContain('run \\"run-context-1\\"');
      expect(prompt).not.toContain("Help me with this run.");
      expect(prompt).toContain("Never guess a package name");
      expect(prompt).toContain(
        "ask whether the user has an official documentation, setup-instructions, repository, package, OpenAPI, or MCP-server URL",
      );
    } finally {
      local.close();
    }
  });

  test("forces inspection of a user-supplied connector source before proposals", async () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const inspected: string[] = [];
      const sourceUrl =
        "https://clarity.microsoft.com/blog/introducing-the-microsoft-clarity-mcp-server/";
      const model = new MockLanguageModelV4({
        doStream: [
          toolCallStream(
            "springroll_inspect_connector_source",
            "inspect-source-1",
            JSON.stringify({ url: sourceUrl }),
          ),
          responseStream("The official source identifies the package."),
        ],
      });
      const assistant = new AiSdkAssistant(local.db, {
        maxSteps: 3,
        loadRuntime: async () => ({
          model,
          provider: "mock-provider",
          modelId: "mock-model-id",
          tools: {
            springroll_inspect_connector_source: tool({
              description: "Inspect official connector documentation.",
              inputSchema: z.object({ url: z.url() }),
              execute: async ({ url }) => {
                inspected.push(url);
                return { npmPackages: ["@microsoft/clarity-mcp-server"] };
              },
            }),
          },
        }),
      });
      const session = assistant.createOrResumeSession({
        context: {
          version: 1,
          intent: "connection.create",
          origin: "connections",
          subjects: [],
        },
      });
      const chat = new SqliteChatStore(local.db);
      chat.appendMessage({
        id: "legacy-source-message",
        sessionId: session.id,
        role: "user",
        parts: [
          { type: "text", text: `Take a look at these docs ${sourceUrl}` },
        ],
      });
      chat.appendMessage({
        id: "legacy-source-failure",
        sessionId: session.id,
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "I could not verify the package. Can you provide its name?",
          },
        ],
      });

      await (
        await assistant.respond(
          session.id,
          userMessage("Try the official documentation again."),
        )
      ).text();

      expect(model.doStreamCalls[0]?.toolChoice).toEqual({
        type: "tool",
        toolName: "springroll_inspect_connector_source",
      });
      expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain(
        sourceUrl,
      );
      expect(inspected).toEqual([sourceUrl]);
    } finally {
      local.close();
    }
  });

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
      expect(assistant.getSession(session.id)?.turns).toMatchObject([
        {
          usage: {
            inputTokens: 10,
            outputTokens: 5,
            reasoningTokens: 1,
            cachedInputTokens: 2,
            totalTokens: 15,
            estimatedCostUsdMicros: 60,
          },
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

  test("continues a broader goal after connector setup without persisting a synthetic user message", async () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const model = new MockLanguageModelV4({
        doStream: [
          responseStream("Use the connection card to finish setup."),
          responseStream(
            "The connection is ready, so I can finish the recipe.",
          ),
        ],
      });
      const assistant = new AiSdkAssistant(local.db, {
        loadRuntime: async () => ({
          model,
          provider: "mock-provider",
          modelId: "mock-model-id",
        }),
      });
      const session = assistant.createOrResumeSession({
        context: {
          version: 1,
          intent: "task.create",
          origin: "recipes",
          subjects: [],
        },
      });
      await (
        await assistant.respond(
          session.id,
          userMessage("Create a recipe that needs Fixture API"),
        )
      ).text();
      const sourceMessage = assistant.getSession(session.id)?.messages.at(-1);
      if (!sourceMessage) throw new Error("Expected a source message");
      const workflow = assistant.recordWorkflow(session.id, {
        sourceMessageId: sourceMessage.id,
        sourceToolCallId: "connection-proposal-1",
        kind: "connection_setup",
        payload: { status: "ready", proposal: { name: "Fixture API" } },
      });
      assistant.updateWorkflow(session.id, workflow.id, {
        status: "completed",
        subject: { kind: "connection", id: "fixture-api" },
        outcome: { connected: true, toolsDiscovered: true, toolCount: 3 },
      });

      const continuation = await assistant.continueConnectionWorkflow(
        session.id,
        workflow.id,
      );
      expect(continuation).toBeDefined();
      await continuation?.text();

      const prompt = JSON.stringify(model.doStreamCalls[1]?.prompt);
      expect(prompt).toContain("Springroll host event");
      expect(prompt).toContain("fixture-api");
      expect(prompt).toContain("3 live tools were discovered");
      const detail = assistant.getSession(session.id);
      expect(detail?.messages.map((message) => message.role)).toEqual([
        "user",
        "assistant",
        "assistant",
      ]);
      expect(JSON.stringify(detail?.messages)).not.toContain(
        "Springroll host event",
      );
      expect(detail?.turns).toHaveLength(2);
    } finally {
      local.close();
    }
  });

  test("does not spend a model call after a connection-only ceremony", async () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const model = new MockLanguageModelV4({
        doStream: responseStream("Use the card to connect."),
      });
      const assistant = new AiSdkAssistant(local.db, {
        loadRuntime: async () => ({
          model,
          provider: "mock-provider",
          modelId: "mock-model-id",
        }),
      });
      const session = assistant.createOrResumeSession({
        context: {
          version: 1,
          intent: "connection.create",
          origin: "connections",
          subjects: [],
        },
      });
      await (
        await assistant.respond(session.id, userMessage("Connect Fixture"))
      ).text();
      const sourceMessage = assistant.getSession(session.id)?.messages.at(-1);
      if (!sourceMessage) throw new Error("Expected a source message");
      const workflow = assistant.recordWorkflow(session.id, {
        sourceMessageId: sourceMessage.id,
        sourceToolCallId: "connection-proposal-2",
        kind: "connection_setup",
        payload: { status: "ready", proposal: { name: "Fixture" } },
      });
      assistant.updateWorkflow(session.id, workflow.id, {
        status: "completed",
        subject: { kind: "connection", id: "fixture" },
        outcome: { connected: true, toolsDiscovered: true, toolCount: 1 },
      });

      expect(
        await assistant.continueConnectionWorkflow(session.id, workflow.id),
      ).toBeUndefined();
      expect(model.doStreamCalls).toHaveLength(1);
      expect(assistant.getSession(session.id)?.turns).toHaveLength(1);
    } finally {
      local.close();
    }
  });

  test("continues a broader goal with a safe declined-connection event", async () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const model = new MockLanguageModelV4({
        doStream: [
          responseStream("Use the card to connect."),
          responseStream("I can offer an alternative."),
        ],
      });
      const assistant = new AiSdkAssistant(local.db, {
        loadRuntime: async () => ({
          model,
          provider: "mock-provider",
          modelId: "mock-model-id",
        }),
      });
      const session = assistant.createOrResumeSession({
        context: {
          version: 1,
          intent: "task.create",
          origin: "recipes",
          subjects: [],
        },
      });
      await (
        await assistant.respond(
          session.id,
          userMessage("Create a recipe that could use Fixture API"),
        )
      ).text();
      const sourceMessage = assistant.getSession(session.id)?.messages.at(-1);
      if (!sourceMessage) throw new Error("Expected a source message");
      const workflow = assistant.recordWorkflow(session.id, {
        sourceMessageId: sourceMessage.id,
        sourceToolCallId: "connection-proposal-declined",
        kind: "connection_setup",
        payload: { status: "ready", proposal: { name: "Fixture API" } },
      });
      assistant.updateWorkflow(session.id, workflow.id, {
        status: "cancelled",
        outcome: { state: "declined", retryable: true },
      });

      const continuation = await assistant.continueConnectionWorkflow(
        session.id,
        workflow.id,
      );
      expect(continuation).toBeDefined();
      await continuation?.text();

      const prompt = JSON.stringify(model.doStreamCalls[1]?.prompt);
      expect(prompt).toContain("user declined connector setup");
      expect(prompt).toContain("No credential value is included");
      expect(prompt).toContain("without claiming this capability is available");
      const detail = assistant.getSession(session.id);
      expect(detail?.messages.map((message) => message.role)).toEqual([
        "user",
        "assistant",
        "assistant",
      ]);
      expect(JSON.stringify(detail?.messages)).not.toContain(
        "Springroll host event",
      );
    } finally {
      local.close();
    }
  });

  test("exposes only normalized retryable connection failure state on a later turn", async () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const secret = "secret-provider-detail";
      const model = new MockLanguageModelV4({
        doStream: [
          responseStream("Use the connection card."),
          responseStream("The setup failed and can be retried."),
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
        await assistant.respond(session.id, userMessage("Connect Fixture API"))
      ).text();
      const sourceMessage = assistant.getSession(session.id)?.messages.at(-1);
      if (!sourceMessage) throw new Error("Expected a source message");
      const workflow = assistant.recordWorkflow(session.id, {
        sourceMessageId: sourceMessage.id,
        sourceToolCallId: "connection-proposal-failed",
        kind: "connection_setup",
        payload: { status: "ready", proposal: { name: "Fixture API" } },
      });
      assistant.updateWorkflow(session.id, workflow.id, {
        status: "waiting_for_user",
        subject: { kind: "connection", id: "fixture-api" },
        outcome: {
          phase: "prepared",
          connectorId: "fixture-api",
          variantId: "api-key",
          credentialKind: "api-key",
          ceremony: { state: "failed", retryable: true },
        },
        error: `Provider rejected ${secret}`,
      });

      await (
        await assistant.respond(session.id, userMessage("What should I do?"))
      ).text();

      const prompt = JSON.stringify(model.doStreamCalls[1]?.prompt);
      expect(prompt).toContain("connector workflow state: failed");
      expect(prompt).toContain("Retryable: yes");
      expect(prompt).toContain("fixture-api");
      expect(prompt).not.toContain(secret);
      expect(prompt).not.toContain("Provider rejected");
    } finally {
      local.close();
    }
  });

  test("keeps full durable history while bounding recent model context by turn", async () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const model = new MockLanguageModelV4({
        doStream: [
          responseStream("answer-alpha"),
          responseStream("answer-beta"),
          responseStream("answer-gamma"),
          responseStream("answer-delta"),
        ],
      });
      const assistant = new AiSdkAssistant(local.db, {
        maxContextMessages: 3,
        loadRuntime: async () => ({
          model,
          provider: "mock-provider",
          modelId: "mock-model-id",
        }),
      });
      const session = assistant.createSession();

      for (const question of [
        "question-alpha",
        "question-beta",
        "question-gamma",
        "question-delta",
      ]) {
        await (
          await assistant.respond(session.id, userMessage(question))
        ).text();
      }

      const fourthPrompt = JSON.stringify(model.doStreamCalls[3]?.prompt);
      expect(fourthPrompt).not.toContain("question-alpha");
      expect(fourthPrompt).not.toContain("question-beta");
      expect(fourthPrompt).toContain("question-gamma");
      expect(fourthPrompt).toContain("answer-gamma");
      expect(fourthPrompt).toContain("question-delta");
      expect(assistant.getSession(session.id)?.messages).toHaveLength(8);
    } finally {
      local.close();
    }
  });

  test("rejects a concurrent send without creating another durable turn", async () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const assistant = new AiSdkAssistant(local.db, {
        loadRuntime: async () => ({
          model: new MockLanguageModelV4({
            doStream: responseStream("Only one answer.", false, 20),
          }),
          provider: "mock-provider",
          modelId: "mock-model-id",
        }),
      });
      const session = assistant.createSession();
      const firstResponse = await assistant.respond(
        session.id,
        userMessage("First request"),
      );

      await expect(
        assistant.respond(session.id, userMessage("Concurrent request")),
      ).rejects.toThrow("A response is already in progress");
      await firstResponse.text();

      expect(assistant.getSession(session.id)).toMatchObject({
        session: { activeTurnId: null },
        turns: [{ status: "completed" }],
      });
      expect(assistant.getSession(session.id)?.messages).toHaveLength(2);
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

  test("aborts active work and persists a user cancellation", async () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const assistant = new AiSdkAssistant(local.db, {
        loadRuntime: async () => ({
          model: new MockLanguageModelV4({
            doStream: responseStream("This should be interrupted.", false, 50),
          }),
          provider: "mock-provider",
          modelId: "mock-model-id",
        }),
      });
      const session = assistant.createSession();
      const response = await assistant.respond(
        session.id,
        userMessage("Stop this response"),
      );

      await waitFor(
        () =>
          new SqliteModelCallStore(local.db).list(
            "chat",
            assistant.getSession(session.id)?.turns[0]?.id ?? "missing",
          ).length === 1,
      );
      expect(assistant.cancelSession(session.id)).toBe(true);
      await response.text().catch(() => "aborted");
      await waitFor(
        () =>
          assistant.getSession(session.id)?.turns[0]?.status === "cancelled",
      );

      const detail = assistant.getSession(session.id);
      const turnId = detail?.turns[0]?.id;
      expect(detail).toMatchObject({
        session: { activeTurnId: null },
        turns: [{ status: "cancelled", error: null }],
      });
      expect(turnId).toBeString();
      if (!turnId) throw new Error("Expected a cancelled turn ID");
      expect(
        new SqliteModelCallStore(local.db).list("chat", turnId),
      ).toMatchObject([
        { status: "cancelled", error: "Assistant model call cancelled" },
      ]);
      expect(assistant.cancelSession(session.id)).toBe(false);
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

  test("reserves the final model step for a text answer", async () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const model = new MockLanguageModelV4({
        doStream: [
          toolCallStream("lookup", "lookup-1"),
          toolCallStream("lookup", "lookup-2"),
          responseStream("The final answer uses the gathered results."),
        ],
      });
      const assistant = new AiSdkAssistant(local.db, {
        maxSteps: 3,
        loadRuntime: async () => ({
          model,
          provider: "mock-provider",
          modelId: "mock-model-id",
          tools: {
            lookup: tool({
              description: "Look up a fact.",
              inputSchema: z.object({}),
              execute: async () => ({ fact: "enough information" }),
            }),
          },
        }),
      });
      const session = assistant.createSession();

      const response = await assistant.respond(
        session.id,
        userMessage("Look this up and answer"),
      );

      expect(await response.text()).toContain(
        "The final answer uses the gathered results.",
      );
      expect(model.doStreamCalls).toHaveLength(3);
      expect(model.doStreamCalls[2]?.toolChoice).toEqual({ type: "none" });
      expect(assistant.getSession(session.id)?.turns).toMatchObject([
        { status: "completed", error: null },
      ]);
    } finally {
      local.close();
    }
  });

  test("stops connector proposal tools after two validation rejections", async () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const model = new MockLanguageModelV4({
        doStream: [
          toolCallStream("springroll_propose_local_mcp", "invalid-proposal-1"),
          toolCallStream("springroll_propose_local_mcp", "invalid-proposal-2"),
          responseStream(
            "The proposal was not created because validation remains unresolved.",
          ),
        ],
      });
      const assistant = new AiSdkAssistant(local.db, {
        maxSteps: 5,
        loadRuntime: async () => ({
          model,
          provider: "mock-provider",
          modelId: "mock-model-id",
          tools: {
            springroll_propose_local_mcp: tool({
              description: "Propose a local MCP connector.",
              inputSchema: z.object({}),
              execute: async () => ({
                status: "invalid_input",
                issues: [{ path: "sources", message: "Required" }],
              }),
            }),
          },
        }),
      });
      const session = assistant.createSession();

      const response = await assistant.respond(
        session.id,
        userMessage("Connect Microsoft Clarity"),
      );

      expect(await response.text()).toContain("proposal was not created");
      expect(model.doStreamCalls).toHaveLength(3);
      expect(model.doStreamCalls[2]?.toolChoice).toEqual({ type: "none" });
      expect(JSON.stringify(model.doStreamCalls[2]?.prompt)).toContain(
        "Two connector proposal attempts failed host validation",
      );
    } finally {
      local.close();
    }
  });

  test("projects proposal tool output into durable workflow state", async () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const model = new MockLanguageModelV4({
        doStream: [
          toolCallStream("springroll_propose_task", "proposal-call-1"),
          responseStream("Review the recipe proposal below."),
        ],
      });
      const assistant = new AiSdkAssistant(local.db, {
        workflowTools: { springroll_propose_task: "task_proposal" },
        loadRuntime: async () => ({
          model,
          provider: "mock-provider",
          modelId: "mock-model-id",
          tools: {
            springroll_propose_task: tool({
              description: "Draft a recipe.",
              inputSchema: z.object({}),
              execute: async () => ({
                status: "ready",
                proposal: { title: "Morning briefing" },
              }),
            }),
          },
        }),
      });
      const session = assistant.createSession();

      await (
        await assistant.respond(session.id, userMessage("Draft a briefing"))
      ).text();

      expect(assistant.getSession(session.id)?.workflows).toMatchObject([
        {
          sessionId: session.id,
          sourceToolCallId: "proposal-call-1",
          kind: "task_proposal",
          status: "proposed",
          payload: {
            status: "ready",
            proposal: { title: "Morning briefing" },
          },
        },
      ]);
    } finally {
      local.close();
    }
  });

  test("backfills workflow state from durable proposal messages", () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const chat = new SqliteChatStore(local.db);
      const session = chat.createSession({ id: "chat-before-workflows" });
      chat.appendMessage({
        id: "proposal-message",
        sessionId: session.id,
        role: "assistant",
        parts: [
          {
            type: "tool-springroll_research_connection",
            toolCallId: "connection-miss-1",
            state: "output-available",
            input: { intent: "Connect Neon" },
            output: {
              status: "not_found",
              title: "No remote connector",
              explanation: "Continue researching.",
            },
          },
          {
            type: "tool-springroll_propose_local_mcp",
            toolCallId: "connection-call-1",
            state: "output-available",
            input: { intent: "Connect Neon" },
            output: { status: "ready", proposal: { name: "Neon" } },
          },
        ],
      });

      const assistant = new AiSdkAssistant(local.db, {
        workflowTools: {
          springroll_research_connection: "connection_setup",
          springroll_propose_local_mcp: "connection_setup",
        },
        loadRuntime: async () => ({
          model: new MockLanguageModelV4(),
          provider: "mock-provider",
          modelId: "mock-model-id",
        }),
      });

      expect(assistant.getSession(session.id)?.workflows).toMatchObject([
        {
          sourceMessageId: "proposal-message",
          sourceToolCallId: "connection-call-1",
          kind: "connection_setup",
          status: "proposed",
          payload: { status: "ready", proposal: { name: "Neon" } },
        },
      ]);
    } finally {
      local.close();
    }
  });

  test("strips every AI SDK provider metadata rail from durable tool parts", () => {
    const parts = toDurableChatParts([
      {
        type: "tool-example",
        toolCallId: "call-1",
        state: "output-available",
        input: { query: "weather" },
        output: { content: ["safe result"] },
        providerMetadata: { openrouter: { reasoning: "private-1" } },
        callProviderMetadata: { openrouter: { reasoning: "private-2" } },
        resultProviderMetadata: { openrouter: { reasoning: "private-3" } },
        providerOptions: { openrouter: { reasoning_details: ["private-4"] } },
      },
    ]);

    const encoded = JSON.stringify(parts);
    expect(encoded).toContain("safe result");
    expect(encoded).not.toContain("ProviderMetadata");
    expect(encoded).not.toContain("providerMetadata");
    expect(encoded).not.toContain("providerOptions");
    expect(encoded).not.toContain("private-");
  });

  test("scrubs legacy provider metadata already stored in chat history", () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const chat = new SqliteChatStore(local.db);
      const session = chat.createSession();
      const turn = chat.createTurn(session.id);
      chat.appendMessage({
        sessionId: session.id,
        turnId: turn.id,
        role: "assistant",
        parts: [
          {
            type: "tool-example",
            callProviderMetadata: {
              openrouter: { reasoning: "legacy private reasoning" },
            },
          },
        ],
      });
      expect(JSON.stringify(chat.listMessages(session.id))).toContain(
        "legacy private reasoning",
      );

      new AiSdkAssistant(local.db, {
        loadRuntime: async () => ({
          model: new MockLanguageModelV4(),
          provider: "mock-provider",
          modelId: "mock-model-id",
        }),
      });

      expect(JSON.stringify(chat.listMessages(session.id))).not.toContain(
        "ProviderMetadata",
      );
      expect(JSON.stringify(chat.listMessages(session.id))).not.toContain(
        "legacy private reasoning",
      );
    } finally {
      local.close();
    }
  });

  test("persists a visible failure when a model stops without text", async () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const assistant = new AiSdkAssistant(local.db, {
        loadRuntime: async () => ({
          model: new MockLanguageModelV4({ doStream: emptyResponseStream() }),
          provider: "mock-provider",
          modelId: "mock-model-id",
        }),
      });
      const session = assistant.createSession();

      await (
        await assistant.respond(session.id, userMessage("Please answer"))
      ).text();

      const detail = assistant.getSession(session.id);
      expect(detail?.turns).toMatchObject([
        {
          status: "failed",
          error: "Assistant stopped without an answer (stop)",
        },
      ]);
      expect(JSON.stringify(detail?.messages)).toContain(
        "I stopped before producing an answer. Please try again.",
      );
    } finally {
      local.close();
    }
  });

  test("completes a turn when the model recovers from a failed tool", async () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const model = new MockLanguageModelV4({
        doStream: [
          toolCallStream("unreliable_lookup", "lookup-1"),
          responseStream("The lookup failed, but here is what I can tell you."),
        ],
      });
      const assistant = new AiSdkAssistant(local.db, {
        maxSteps: 3,
        loadRuntime: async () => ({
          model,
          provider: "mock-provider",
          modelId: "mock-model-id",
          tools: {
            unreliable_lookup: tool({
              description: "A lookup that may fail.",
              inputSchema: z.object({}),
              execute: async (): Promise<{ ok: boolean }> => {
                throw new Error("Remote lookup unavailable");
              },
            }),
          },
        }),
      });
      const session = assistant.createSession();

      const response = await assistant.respond(
        session.id,
        userMessage("Try the lookup"),
      );

      expect(await response.text()).toContain(
        "The lookup failed, but here is what I can tell you.",
      );
      expect(assistant.getSession(session.id)?.turns).toMatchObject([
        { status: "completed", error: null },
      ]);
    } finally {
      local.close();
    }
  });

  test("persists an approval request across restart and resumes the exact tool call", async () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      const executed: unknown[] = [];
      const model = new MockLanguageModelV4({
        doStream: [
          toolCallStream(
            "change_record",
            "change-1",
            JSON.stringify({ value: "server-owned-input" }),
          ),
          responseStream("The approved change completed."),
        ],
      });
      const loadRuntime = async () => ({
        model,
        provider: "mock-provider",
        modelId: "mock-model-id",
        tools: {
          change_record: tool({
            description: "Change a remote record.",
            inputSchema: z.object({ value: z.string() }),
            needsApproval: true,
            execute: async (input: { value: string }) => {
              executed.push(input);
              return { changed: true };
            },
          }),
        },
        approvalPolicies: {
          change_record: { riskEffect: "write" as const },
        },
      });
      const assistant = new AiSdkAssistant(local.db, {
        maxSteps: 3,
        loadRuntime,
      });
      const session = assistant.createSession();

      await (
        await assistant.respond(session.id, userMessage("Change the record"))
      ).text();
      const pending = assistant.getSession(session.id);
      const approvalPart = pending?.messages
        .at(-1)
        ?.parts.find(
          (part) => "state" in part && part.state === "approval-requested",
        );
      const approvalId =
        approvalPart &&
        "approval" in approvalPart &&
        typeof approvalPart.approval?.id === "string"
          ? approvalPart.approval.id
          : undefined;
      expect(approvalId).toBeString();
      expect(pending).toMatchObject({
        session: { activeTurnId: expect.any(String) },
        turns: [{ status: "waiting_for_user" }],
        approvals: [
          {
            id: approvalId,
            status: "pending",
            toolCallId: "change-1",
            toolName: "change_record",
            input: { value: "server-owned-input" },
            riskEffect: "write",
          },
        ],
      });
      expect(executed).toHaveLength(0);

      const restored = new AiSdkAssistant(local.db, {
        maxSteps: 3,
        loadRuntime,
      });
      expect(restored.getSession(session.id)?.turns).toMatchObject([
        { status: "waiting_for_user" },
      ]);
      await expect(
        restored.respond(session.id, {
          approvals: [{ id: "not-the-persisted-id", approved: true }],
        }),
      ).rejects.toThrow("Unknown pending assistant approval");
      if (!approvalId) throw new Error("Expected a durable approval ID");

      const response = await restored.respond(session.id, {
        approvals: [{ id: approvalId, approved: true }],
      });
      expect(await response.text()).toContain("approved change completed");
      const completed = restored.getSession(session.id);
      expect(executed).toEqual([{ value: "server-owned-input" }]);
      expect(completed?.messages).toHaveLength(2);
      expect(completed).toMatchObject({
        session: { activeTurnId: null },
        turns: [{ status: "completed" }],
        approvals: [
          {
            id: approvalId,
            status: "succeeded",
            outcome: { state: "output-available" },
          },
        ],
      });
      expect(JSON.stringify(completed?.messages)).toContain('"approved":true');
    } finally {
      local.close();
    }
  });

  test("persists denial and continues without executing the tool", async () => {
    const local = openLocalDatabase({ filename: ":memory:" });
    try {
      let executions = 0;
      const model = new MockLanguageModelV4({
        doStream: [
          toolCallStream("delete_record", "delete-1"),
          responseStream("I did not delete the record."),
        ],
      });
      const assistant = new AiSdkAssistant(local.db, {
        maxSteps: 3,
        loadRuntime: async () => ({
          model,
          provider: "mock-provider",
          modelId: "mock-model-id",
          tools: {
            delete_record: tool({
              description: "Delete a remote record.",
              inputSchema: z.object({}),
              needsApproval: true,
              execute: async () => {
                executions += 1;
                return { deleted: true };
              },
            }),
          },
        }),
      });
      const session = assistant.createSession();
      await (
        await assistant.respond(session.id, userMessage("Delete the record"))
      ).text();
      const part = assistant
        .getSession(session.id)
        ?.messages.at(-1)
        ?.parts.find(
          (candidate) =>
            "state" in candidate && candidate.state === "approval-requested",
        );
      const approvalId =
        part && "approval" in part && typeof part.approval?.id === "string"
          ? part.approval.id
          : undefined;
      if (!approvalId) throw new Error("Expected a durable approval ID");

      await (
        await assistant.respond(session.id, {
          approvals: [
            { id: approvalId, approved: false, reason: "Keep the record" },
          ],
        })
      ).text();

      expect(executions).toBe(0);
      expect(
        JSON.stringify(assistant.getSession(session.id)?.messages),
      ).toContain("Keep the record");
      expect(assistant.getSession(session.id)?.turns).toMatchObject([
        { status: "completed" },
      ]);
      expect(assistant.getSession(session.id)?.approvals).toMatchObject([
        {
          id: approvalId,
          status: "denied",
          reason: "Keep the record",
        },
      ]);
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

function toolCallStream(toolName: string, toolCallId: string, input = "{}") {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start" as const, warnings: [] },
        {
          type: "tool-call" as const,
          toolCallId,
          toolName,
          input,
        },
        {
          type: "finish" as const,
          finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
          usage,
        },
      ],
    }),
  };
}

function emptyResponseStream() {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start" as const, warnings: [] },
        {
          type: "finish" as const,
          finishReason: { unified: "stop" as const, raw: "stop" },
          usage,
        },
      ],
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

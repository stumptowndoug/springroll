import { describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import { createSpringrollApplicationToolRegistry } from "../src/server/application-tool-registry.ts";
import {
  createAiSdkApplicationTools,
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
      async proposeTaskDraft(draft: unknown) {
        calls.push(draft);
        return {
          status: "ready" as const,
          proposal: {
            title: "Morning Hacker News digest",
            prompt: "Summarize Hacker News every morning.",
            schedule: "0 8 * * *",
            scheduleLabel: "Daily at 8:00 AM",
            timezone: "UTC",
            connectionId: "hacker-news",
            connectionName: "Hacker News",
            toolNames: ["get_hacker_news_top_stories"],
            tools: [
              {
                name: "get_hacker_news_top_stories",
                description: "Read top stories.",
                effect: "read" as const,
              },
            ],
            contract: "Read public stories without changing anything.",
            executionMode: "local" as const,
            catchUpPolicy: "skip_to_next" as const,
          },
        };
      },
    } as unknown as SpringrollApplicationReadApi;
    const tools = createSpringrollApplicationTools(application);
    const proposalTool = tools.springroll_propose_task as unknown as {
      execute(
        input: {
          readonly title: string;
          readonly prompt: string;
          readonly schedule: string;
          readonly scheduleLabel: string;
          readonly timezone?: string;
          readonly connectionId: string;
          readonly toolNames: readonly string[];
          readonly contract: string;
          readonly catchUpPolicy?: "catch_up" | "skip_to_next";
        },
        options: {
          readonly toolCallId: string;
          readonly messages: readonly ModelMessage[];
        },
      ): Promise<unknown>;
    };
    if (!proposalTool?.execute)
      throw new Error("Expected recipe proposal tool");

    const result = await proposalTool.execute(
      {
        title: "Morning Hacker News digest",
        prompt: "Summarize Hacker News every morning.",
        schedule: "0 8 * * *",
        scheduleLabel: "Daily at 8:00 AM",
        timezone: "UTC",
        connectionId: "hacker-news",
        toolNames: ["get_hacker_news_top_stories"],
        contract: "Read public stories without changing anything.",
      },
      {
        toolCallId: "proposal-call",
        messages: [],
      },
    );

    expect(calls).toEqual([
      {
        title: "Morning Hacker News digest",
        prompt: "Summarize Hacker News every morning.",
        schedule: "0 8 * * *",
        scheduleLabel: "Daily at 8:00 AM",
        timezone: "UTC",
        connectionId: "hacker-news",
        toolNames: ["get_hacker_news_top_stories"],
        contract: "Read public stories without changing anything.",
        catchUpPolicy: "skip_to_next",
      },
    ]);
    expect(result).toMatchObject({
      status: "ready",
      proposal: {
        connectionId: "hacker-news",
        toolNames: ["get_hacker_news_top_stories"],
      },
    });
  });

  test("authors schemas and policy once in the transport-neutral registry", () => {
    const registry = createSpringrollApplicationToolRegistry(
      {} as SpringrollApplicationReadApi,
    );

    expect(registry.definitions.map(({ name }) => name)).toEqual([
      "springroll_list_connections",
      "springroll_list_tasks",
      "springroll_get_task",
      "springroll_list_runs",
      "springroll_get_run",
      "springroll_get_model_configuration",
      "springroll_research_connection",
      "springroll_propose_local_mcp",
      "springroll_propose_openapi_connection",
      "springroll_discover_openapi",
      "springroll_propose_task",
      "springroll_propose_task_update",
      "springroll_propose_task_tool_repair",
      "springroll_propose_task_action",
      "springroll_describe_connection_tools",
      "springroll_call_read_connection_tool",
    ]);
    for (const definition of registry.definitions) {
      expect(definition.descriptor.name).toBe(definition.name);
      expect(definition.descriptor.inputSchema.type).toBe("object");
      expect(definition.descriptor.declaredRisk).toEqual(
        definition.policy.risk,
      );
      expect(definition.policy.approval).toBe("never");
      expect(definition.policy.risk.effect).toBe("read");
    }
    expect(registry.get("springroll_propose_task")?.policy.workflow).toBe(
      "proposal",
    );
    const taskProposalSchema = registry.get("springroll_propose_task")
      ?.descriptor.inputSchema;
    expect(taskProposalSchema).toMatchObject({
      required: expect.arrayContaining([
        "title",
        "prompt",
        "schedule",
        "scheduleLabel",
        "connectionId",
        "toolNames",
        "contract",
      ]),
    });
    expect(
      (taskProposalSchema?.properties as Record<string, unknown> | undefined)
        ?.request,
    ).toBeUndefined();
    expect(
      registry.get("springroll_propose_task_update")?.policy.workflow,
    ).toBe("proposal");
    expect(
      registry.get("springroll_propose_task_action")?.policy.workflow,
    ).toBe("proposal");
    expect(registry.get("springroll_propose_local_mcp")?.policy).toMatchObject({
      workflow: "proposal",
      risk: { effect: "read", openWorld: true },
    });
    expect(
      registry.get("springroll_call_read_connection_tool")?.policy.risk,
    ).toEqual({ effect: "read", openWorld: true, idempotent: true });
  });

  test("drafts recipe actions without executing them", async () => {
    const calls: unknown[] = [];
    const application = {
      async proposeTaskAction(taskId: string, action: string) {
        calls.push({ taskId, action });
        return {
          status: "ready" as const,
          proposal: { taskId, taskName: "Weather", action },
        };
      },
    } as unknown as SpringrollApplicationReadApi;
    const registry = createSpringrollApplicationToolRegistry(application);

    expect(
      await registry.execute(
        "springroll_propose_task_action",
        { taskId: "task-weather", action: "run_now" },
        callContext(),
      ),
    ).toMatchObject({
      status: "ready",
      proposal: { taskId: "task-weather", action: "run_now" },
    });
    expect(calls).toEqual([{ taskId: "task-weather", action: "run_now" }]);
    await expect(
      registry.execute(
        "springroll_propose_task_action",
        { taskId: "task-weather", action: "delete" },
        callContext(),
      ),
    ).rejects.toMatchObject({ name: "ZodError" });
    expect(calls).toHaveLength(1);
  });

  test("filters run history to the recipe being diagnosed", async () => {
    const application = {
      async listRuns() {
        return [
          { id: "run-1", taskId: "task-weather", status: "failed" },
          { id: "run-2", taskId: "task-news", status: "succeeded" },
          { id: "run-3", taskId: "task-weather", status: "succeeded" },
        ];
      },
    } as unknown as SpringrollApplicationReadApi;
    const registry = createSpringrollApplicationToolRegistry(application);

    expect(
      await registry.execute(
        "springroll_list_runs",
        { taskId: "task-weather", limit: 1 },
        callContext(),
      ),
    ).toEqual({
      runs: [{ id: "run-1", taskId: "task-weather", status: "failed" }],
    });
  });

  test("validates and defaults inputs before invoking application commands", async () => {
    const limits: number[] = [];
    const application = {
      async listTasks() {
        limits.push(1);
        return [{ id: "task-1" }, { id: "task-2" }];
      },
    } as unknown as SpringrollApplicationReadApi;
    const registry = createSpringrollApplicationToolRegistry(application);

    await expect(
      registry.execute("springroll_list_tasks", { limit: 101 }, callContext()),
    ).rejects.toMatchObject({ name: "ZodError" });
    expect(limits).toEqual([]);
    expect(
      await registry.execute("springroll_list_tasks", {}, callContext()),
    ).toEqual({ tasks: [{ id: "task-1" }, { id: "task-2" }] });
    expect(limits).toEqual([1]);
    await expect(
      registry.execute("not_a_tool", {}, callContext()),
    ).rejects.toThrow("Unknown Springroll application tool: not_a_tool");
  });

  test("keeps the connection list compact and leaves descriptions for lazy inspection", async () => {
    const application = {
      async listConnections() {
        return [
          {
            id: "fixture",
            name: "Fixture",
            description: "Fixture connection",
            status: "connected" as const,
            tools: [
              {
                name: "read_fixture",
                description: "A detailed connector-supplied description",
                effect: "read" as const,
              },
            ],
          },
        ];
      },
    } as unknown as SpringrollApplicationReadApi;
    const registry = createSpringrollApplicationToolRegistry(application);

    expect(
      await registry.execute("springroll_list_connections", {}, callContext()),
    ).toEqual({
      connections: [
        {
          id: "fixture",
          name: "Fixture",
          description: "Fixture connection",
          status: "connected",
          toolCount: 1,
          toolEffects: { read: 1, write: 0, destructive: 0 },
        },
      ],
    });
  });

  test("keeps local package credentials flat and secret-free", async () => {
    const calls: unknown[] = [];
    const application = {
      async proposeLocalMcpIntegration(input: unknown) {
        calls.push(input);
        return {
          status: "not_found",
          title: "fixture",
          explanation: "fixture",
        };
      },
    } as unknown as SpringrollApplicationReadApi;
    const registry = createSpringrollApplicationToolRegistry(application);
    const base = {
      name: "Microsoft Clarity",
      operator: "Microsoft",
      description: "Read Clarity analytics.",
      packageName: "@microsoft/clarity-mcp-server",
      repositoryUrl: "https://github.com/microsoft/clarity-mcp-server",
      guidance: {
        summary: "Generate a Data Export token.",
        steps: ["Open Settings, then Data Export."],
        docsUrl: "https://learn.microsoft.com/clarity",
      },
      sources: [
        {
          title: "Microsoft Learn",
          url: "https://learn.microsoft.com/clarity",
        },
        {
          title: "Microsoft source",
          url: "https://github.com/microsoft/clarity-mcp-server",
        },
      ],
    };

    await expect(
      registry.execute(
        "springroll_propose_local_mcp",
        { ...base, credentialKind: "api-key" },
        callContext(),
      ),
    ).rejects.toMatchObject({ name: "ZodError" });
    await registry.execute(
      "springroll_propose_local_mcp",
      {
        ...base,
        credentialKind: "api-key",
        credentialEnv: "CLARITY_API_TOKEN",
        credentialPlaceholder: "Clarity Data Export API token",
      },
      callContext(),
    );
    expect(calls).toEqual([
      {
        ...base,
        credential: {
          kind: "api-key",
          env: "CLARITY_API_TOKEN",
          placeholder: "Clarity Data Export API token",
        },
      },
    ]);
  });

  test("AI SDK adapter conforms to direct registry execution", async () => {
    const application = {
      async getTask(taskId: string) {
        return { id: taskId, name: "Morning briefing", enabled: false };
      },
    } as unknown as SpringrollApplicationReadApi;
    const registry = createSpringrollApplicationToolRegistry(application);
    const direct = await registry.execute(
      "springroll_get_task",
      { taskId: "task-1" },
      callContext(),
    );
    const tools = createAiSdkApplicationTools(registry);
    const getTaskTool = tools.springroll_get_task as unknown as {
      execute(
        input: { readonly taskId: string },
        options: {
          readonly toolCallId: string;
          readonly messages: readonly ModelMessage[];
        },
      ): Promise<unknown>;
    };

    expect(
      await getTaskTool.execute(
        { taskId: "task-1" },
        { toolCallId: "call-1", messages: [] },
      ),
    ).toEqual(direct);
    expect(getTaskTool).toMatchObject({
      description: registry.get("springroll_get_task")?.descriptor.description,
    });
  });
});

function callContext() {
  return { callId: "test-call", priorCalls: [] } as const;
}

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

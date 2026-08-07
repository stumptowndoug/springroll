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
      "springroll_list_approvals",
      "springroll_get_usage",
      "springroll_get_application_state",
      "springroll_get_model_configuration",
      "springroll_research_connection",
      "springroll_inspect_connector_source",
      "springroll_propose_connection",
      "springroll_propose_local_mcp",
      "springroll_propose_openapi_connection",
      "springroll_discover_openapi",
      "springroll_propose_task",
      "springroll_propose_task_update",
      "springroll_propose_task_tool_repair",
      "springroll_propose_connection_action",
      "springroll_propose_task_action",
      "springroll_search_connection_tools",
      "springroll_describe_connection_tools",
      "springroll_activate_connection_tools",
      "springroll_call_read_connection_tool",
      "springroll_call_connection_tool",
    ]);
    for (const definition of registry.definitions) {
      expect(definition.descriptor.name).toBe(definition.name);
      expect(definition.descriptor.inputSchema.type).toBe("object");
      expect(definition.descriptor.declaredRisk).toEqual(
        definition.policy.risk,
      );
      if (definition.name === "springroll_call_connection_tool") {
        expect(definition.policy).toMatchObject({
          approval: "before_call",
          risk: { effect: "destructive" },
        });
      } else {
        expect(definition.policy.approval).toBe("never");
        expect(definition.policy.risk.effect).toBe("read");
      }
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
    expect(
      registry.get("springroll_propose_connection_action")?.policy.workflow,
    ).toBe("proposal");
    expect(registry.get("springroll_propose_local_mcp")?.policy).toMatchObject({
      workflow: "proposal",
      risk: { effect: "read", openWorld: true },
    });
    expect(registry.get("springroll_propose_connection")?.policy).toMatchObject(
      {
        workflow: "proposal",
        risk: { effect: "read", openWorld: true },
      },
    );
    expect(
      registry.get("springroll_call_read_connection_tool")?.policy.risk,
    ).toEqual({ effect: "read", openWorld: true, idempotent: true });
  });

  test("lets chat submit one remote MCP candidate without host metadata", async () => {
    const calls: unknown[] = [];
    const application = {
      async proposeRemoteMcpIntegration(input: unknown, context: unknown) {
        calls.push({ input, context });
        return {
          status: "ready" as const,
          proposal: {
            templateId: "clerk",
            name: "Clerk",
            description: "Clerk SDK documentation tools.",
            operator: "Clerk",
            trust: "provider-verified" as const,
            variants: [],
          },
        };
      },
    } as unknown as SpringrollApplicationReadApi;
    const registry = createSpringrollApplicationToolRegistry(application);

    const result = await registry.execute(
      "springroll_propose_connection",
      {
        name: "Clerk",
        operator: "Clerk",
        description: "Clerk SDK documentation tools.",
        tags: ["authentication", "developer-tools"],
        docsUrl: "https://clerk.com/docs/guides/ai/mcp/clerk-mcp-server",
        transport: {
          kind: "mcp-remote",
          endpoint: "https://mcp.clerk.com/mcp",
          credential: { kind: "none" },
        },
      },
      {
        ...callContext(),
        callId: "clerk-proposal",
        priorCalls: [
          {
            name: "springroll_inspect_connector_source",
            input: {
              url: "https://clerk.com/docs/guides/ai/mcp/clerk-mcp-server",
            },
          },
        ],
      },
    );

    expect(result).toMatchObject({
      status: "ready",
      proposal: { name: "Clerk", trust: "provider-verified" },
    });
    expect(calls).toEqual([
      {
        input: {
          name: "Clerk",
          operator: "Clerk",
          description: "Clerk SDK documentation tools.",
          tags: ["authentication", "developer-tools"],
          endpoint: "https://mcp.clerk.com/mcp",
          docsUrl: "https://clerk.com/docs/guides/ai/mcp/clerk-mcp-server",
          credential: { kind: "none" },
        },
        context: { runId: "clerk-proposal" },
      },
    ]);
  });

  test("shows chat only the generic connector proposal tool", () => {
    const tools = createSpringrollApplicationTools(
      {} as SpringrollApplicationReadApi,
    );

    expect(tools.springroll_propose_connection).toBeDefined();
    expect(tools.springroll_propose_local_mcp).toBeUndefined();
    expect(tools.springroll_propose_openapi_connection).toBeUndefined();
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

  test("drafts connector actions without changing credentials", async () => {
    const calls: unknown[] = [];
    const application = {
      async proposeConnectionAction(connectionId: string, action: string) {
        calls.push({ connectionId, action });
        return {
          status: "ready" as const,
          proposal: { connectionId, connectionName: "Neon", action },
        };
      },
    } as unknown as SpringrollApplicationReadApi;
    const registry = createSpringrollApplicationToolRegistry(application);

    await expect(
      registry.execute(
        "springroll_propose_connection_action",
        { connectionId: "neon", action: "disconnect" },
        callContext(),
      ),
    ).resolves.toMatchObject({
      status: "ready",
      proposal: { connectionId: "neon", action: "disconnect" },
    });
    await expect(
      registry.execute(
        "springroll_propose_connection_action",
        { connectionId: "neon", action: "delete" },
        callContext(),
      ),
    ).rejects.toMatchObject({ name: "ZodError" });
    expect(calls).toEqual([{ connectionId: "neon", action: "disconnect" }]);
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

  test("projects bounded operational inspection through shared handlers", async () => {
    const calls: unknown[] = [];
    const application = {
      async listApprovalSummaries(status: string | undefined, limit: number) {
        calls.push({ approvals: { status, limit } });
        return { approvals: [], truncated: false };
      },
      usageSummary(contextKind: string | undefined) {
        calls.push({ usage: { contextKind } });
        return { contextKind, calls: { total: 0 }, tokens: { total: 0 } };
      },
      async applicationState() {
        calls.push({ state: true });
        return { tasks: { total: 0 }, pendingApprovals: 0 };
      },
    } as unknown as SpringrollApplicationReadApi;
    const registry = createSpringrollApplicationToolRegistry(application);

    expect(
      await registry.execute(
        "springroll_list_approvals",
        { status: "pending" },
        callContext(),
      ),
    ).toEqual({ approvals: [], truncated: false });
    expect(
      await registry.execute(
        "springroll_get_usage",
        { contextKind: "chat" },
        callContext(),
      ),
    ).toMatchObject({ contextKind: "chat", calls: { total: 0 } });
    expect(
      await registry.execute(
        "springroll_get_application_state",
        {},
        callContext(),
      ),
    ).toMatchObject({ tasks: { total: 0 }, pendingApprovals: 0 });
    expect(calls).toEqual([
      { approvals: { status: "pending", limit: 25 } },
      { usage: { contextKind: "chat" } },
      { state: true },
    ]);
    await expect(
      registry.execute(
        "springroll_list_approvals",
        { status: "unknown" },
        callContext(),
      ),
    ).rejects.toMatchObject({ name: "ZodError" });
    expect(calls).toHaveLength(3);
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

  test("searches compactly and activates only exact bounded connection tools", async () => {
    const calls: unknown[] = [];
    const application = {
      async searchConnectionTools(query: string, limit: number) {
        calls.push({ search: { query, limit } });
        return {
          query,
          searchedConnections: 2,
          unavailableConnections: 0,
          matches: [
            {
              connectionId: "crm",
              connectionName: "CRM",
              toolName: "find_contact",
              description: "Find a contact.",
              effect: "read",
            },
          ],
        };
      },
      async activateConnectionTools(
        connectionId: string,
        toolNames: readonly string[],
      ) {
        calls.push({ activate: { connectionId, toolNames } });
        return {
          connectionId,
          connectionName: "CRM",
          tools: toolNames.map((name) => ({
            name,
            description: "Find a contact.",
            inputSchema: { type: "object" },
            risk: { effect: "read", openWorld: true, idempotent: true },
          })),
        };
      },
    } as unknown as SpringrollApplicationReadApi;
    const registry = createSpringrollApplicationToolRegistry(application);

    expect(
      await registry.execute(
        "springroll_search_connection_tools",
        { query: "find contact" },
        callContext(),
      ),
    ).toMatchObject({
      matches: [{ connectionId: "crm", toolName: "find_contact" }],
    });
    expect(
      await registry.execute(
        "springroll_activate_connection_tools",
        { connectionId: "crm", toolNames: ["find_contact"] },
        callContext(),
      ),
    ).toMatchObject({
      connectionId: "crm",
      tools: [{ name: "find_contact", inputSchema: { type: "object" } }],
    });
    expect(calls).toEqual([
      { search: { query: "find contact", limit: 10 } },
      {
        activate: {
          connectionId: "crm",
          toolNames: ["find_contact"],
        },
      },
    ]);
    await expect(
      registry.execute(
        "springroll_activate_connection_tools",
        {
          connectionId: "crm",
          toolNames: ["find_contact", "find_contact"],
        },
        callContext(),
      ),
    ).rejects.toMatchObject({ name: "ZodError" });
    expect(calls).toHaveLength(2);
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
      logoUrl:
        "https://raw.githubusercontent.com/microsoft/clarity-mcp-server/main/icon.png",
      logoSource: "github-repository" as const,
      guidanceSummary: "Generate a Data Export token.",
      guidanceSteps: ["Open Settings, then Data Export."],
      docsUrl: "https://learn.microsoft.com/clarity",
      sourceUrls: [
        "https://learn.microsoft.com/clarity",
        "https://github.com/microsoft/clarity-mcp-server",
      ],
    };

    await expect(
      registry.execute(
        "springroll_propose_local_mcp",
        { ...base, credentialKind: "api-key" },
        callContext(),
      ),
    ).rejects.toMatchObject({ name: "ZodError" });
    await expect(
      registry.execute(
        "springroll_propose_local_mcp",
        {
          ...base,
          logoUrl: "https://example.com/unverified-icon.png",
          credentialKind: "api-key",
          credentialEnv: "CLARITY_API_TOKEN",
          credentialPlaceholder: "Clarity Data Export API token",
        },
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
        name: "Microsoft Clarity",
        operator: "Microsoft",
        description: "Read Clarity analytics.",
        packageName: "@microsoft/clarity-mcp-server",
        repositoryUrl: "https://github.com/microsoft/clarity-mcp-server",
        logo: {
          url: "https://raw.githubusercontent.com/microsoft/clarity-mcp-server/main/icon.png",
          source: "github-repository",
          kind: "asset",
          format: "raster",
        },
        credential: {
          kind: "api-key",
          env: "CLARITY_API_TOKEN",
          placeholder: "Clarity Data Export API token",
        },
        guidance: {
          summary: "Generate a Data Export token.",
          steps: ["Open Settings, then Data Export."],
          docsUrl: "https://learn.microsoft.com/clarity",
        },
        sources: [
          {
            title: "learn.microsoft.com/clarity",
            url: "https://learn.microsoft.com/clarity",
          },
          {
            title: "github.com/microsoft/clarity-mcp-server",
            url: "https://github.com/microsoft/clarity-mcp-server",
          },
        ],
      },
    ]);
  });

  test("derives local package review metadata from previously inspected official sources", async () => {
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

    await registry.execute(
      "springroll_propose_local_mcp",
      {
        name: "Microsoft Clarity",
        operator: "Microsoft",
        description: "Read Clarity analytics.",
        packageName: "@microsoft/clarity-mcp-server",
        repositoryUrl: "https://github.com/microsoft/clarity-mcp-server",
        credentialKind: "api-key",
        credentialEnv: "CLARITY_API_TOKEN",
        credentialPlaceholder: "Clarity Data Export API token",
        keyCreationUrl: "https://clarity.microsoft.com/",
      },
      {
        callId: "clarity-proposal",
        priorCalls: [
          {
            name: "springroll_inspect_connector_source",
            input: {
              url: "https://github.com/microsoft/clarity-mcp-server",
            },
          },
          {
            name: "springroll_inspect_connector_source",
            input: {
              url: "https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api",
            },
          },
          {
            name: "springroll_inspect_connector_source",
            input: {
              url: "https://raw.githubusercontent.com/microsoft/clarity-mcp-server/main/manifest.json",
            },
          },
        ],
      },
    );

    expect(calls).toEqual([
      expect.objectContaining({
        guidance: {
          summary: expect.stringContaining(
            "verified @microsoft/clarity-mcp-server package",
          ),
          steps: expect.arrayContaining([
            expect.stringContaining("secure credential control"),
          ]),
          docsUrl:
            "https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api",
        },
        sources: expect.arrayContaining([
          expect.objectContaining({
            url: "https://github.com/microsoft/clarity-mcp-server",
          }),
          expect.objectContaining({
            url: "https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api",
          }),
        ]),
      }),
    ]);
  });

  test("derives Clarity review fields behind the generic proposal boundary", async () => {
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

    await registry.execute(
      "springroll_propose_connection",
      {
        name: "Microsoft Clarity",
        operator: "Microsoft",
        description: "Read Clarity analytics.",
        docsUrl:
          "https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api",
        transport: {
          kind: "mcp-local",
          packageName: "@microsoft/clarity-mcp-server",
          repositoryUrl: "https://github.com/microsoft/clarity-mcp-server",
          credential: {
            kind: "api-key",
            env: "CLARITY_API_TOKEN",
            placeholder: "Clarity Data Export API token",
            keyCreationUrl: "https://clarity.microsoft.com/",
          },
        },
      },
      callContext(),
    );

    expect(calls).toEqual([
      expect.objectContaining({
        packageName: "@microsoft/clarity-mcp-server",
        credential: {
          kind: "api-key",
          env: "CLARITY_API_TOKEN",
          placeholder: "Clarity Data Export API token",
          keyCreationUrl: "https://clarity.microsoft.com/",
        },
        guidance: {
          summary: expect.stringContaining(
            "verified @microsoft/clarity-mcp-server package",
          ),
          steps: expect.arrayContaining([
            expect.stringContaining("secure credential control"),
          ]),
          docsUrl:
            "https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api",
        },
        sources: expect.arrayContaining([
          expect.objectContaining({
            url: "https://github.com/microsoft/clarity-mcp-server",
          }),
          expect.objectContaining({
            url: "https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-data-export-api",
          }),
        ]),
      }),
    ]);
  });

  test("returns actionable proposal validation without failing the model turn", async () => {
    const registry = createSpringrollApplicationToolRegistry(
      {} as SpringrollApplicationReadApi,
    );
    const tools = createAiSdkApplicationTools(registry);
    const proposal = tools.springroll_propose_local_mcp as unknown as {
      execute(
        input: unknown,
        options: {
          readonly toolCallId: string;
          readonly messages: readonly ModelMessage[];
        },
      ): Promise<unknown>;
    };

    await expect(
      proposal.execute(
        {
          name: "Microsoft Clarity",
          operator: "Microsoft",
          description: "Read Clarity analytics.",
          packageName: "@microsoft/clarity-mcp-server",
          repositoryUrl: "https://github.com/microsoft/clarity-mcp-server",
          credentialKind: "api-key",
          credentialEnv: "CLARITY_API_TOKEN",
          credentialPlaceholder: "Clarity Data Export API token",
        },
        { toolCallId: "invalid-proposal", messages: [] },
      ),
    ).resolves.toMatchObject({
      status: "invalid_input",
      tool: "springroll_propose_local_mcp",
      issues: expect.arrayContaining([
        { path: "guidanceSummary", message: expect.any(String) },
        { path: "guidanceSteps", message: expect.any(String) },
        { path: "docsUrl", message: expect.any(String) },
        { path: "sourceUrls", message: expect.any(String) },
      ]),
      instruction: expect.stringContaining("retry once"),
    });
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

  test("keeps mutation tools behind AI SDK approval and explicit host context", async () => {
    const calls: unknown[] = [];
    const application = {
      async callConnectionTool(...args: unknown[]) {
        calls.push(args);
        return { content: [{ type: "text", text: "updated" }] };
      },
    } as unknown as SpringrollApplicationReadApi;
    const registry = createSpringrollApplicationToolRegistry(application);
    const tools = createAiSdkApplicationTools(registry);
    const mutation = tools.springroll_call_connection_tool as unknown as {
      readonly needsApproval: boolean;
      execute(
        input: unknown,
        options: {
          readonly toolCallId: string;
          readonly messages: readonly ModelMessage[];
        },
      ): Promise<unknown>;
    };
    const input = {
      connectionId: "crm",
      toolName: "delete_contact",
      input: { contactId: "contact-1" },
    };

    expect(mutation.needsApproval).toBe(true);
    await expect(
      registry.execute("springroll_call_connection_tool", input, callContext()),
    ).rejects.toThrow("host-controlled approval");
    expect(calls).toHaveLength(0);

    await mutation.execute(input, {
      toolCallId: "approved-call",
      messages: [],
    });
    expect(calls).toMatchObject([
      [
        "crm",
        "delete_contact",
        { contactId: "contact-1" },
        { runId: "approved-call" },
      ],
    ]);
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

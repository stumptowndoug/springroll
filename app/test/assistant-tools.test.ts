import { describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import { createSpringrollApplicationToolRegistry } from "../src/server/application-tool-registry.ts";
import {
  createAiSdkApplicationTools,
  createSpringrollApplicationTools,
  type SpringrollApplicationReadApi,
} from "../src/server/assistant-tools.ts";

describe("assistant application tools", () => {
  test("creates a recipe directly through the shared application boundary", async () => {
    const drafts: unknown[] = [];
    const creates: unknown[] = [];
    const application = {
      async proposeTaskDraft(draft: unknown) {
        drafts.push(draft);
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
      async createTask(proposal: unknown, enabled: boolean, options: unknown) {
        creates.push({ proposal, enabled, options });
        return {
          id: "create-call",
          name: "Morning Hacker News digest",
          enabled,
        };
      },
    } as unknown as SpringrollApplicationReadApi;
    const tools = createSpringrollApplicationTools(application);
    const createTool = tools.create_task as unknown as {
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
          readonly enabled: boolean;
        },
        options: {
          readonly toolCallId: string;
          readonly messages: readonly ModelMessage[];
        },
      ): Promise<unknown>;
    };
    if (!createTool?.execute) throw new Error("Expected create recipe tool");

    const result = await createTool.execute(
      {
        title: "Morning Hacker News digest",
        prompt: "Summarize Hacker News every morning.",
        schedule: "0 8 * * *",
        scheduleLabel: "Daily at 8:00 AM",
        timezone: "UTC",
        connectionId: "hacker-news",
        toolNames: ["get_hacker_news_top_stories"],
        contract: "Read public stories without changing anything.",
        enabled: true,
      },
      {
        toolCallId: "create-call",
        messages: [],
      },
    );

    expect(drafts).toEqual([
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
    expect(creates).toEqual([
      {
        proposal: expect.objectContaining({
          title: "Morning Hacker News digest",
          connectionId: "hacker-news",
          toolNames: ["get_hacker_news_top_stories"],
        }),
        enabled: true,
        options: { id: "create-call" },
      },
    ]);
    expect(result).toMatchObject({
      id: "create-call",
      enabled: true,
    });
  });

  test("authors schemas and policy once in the transport-neutral registry", () => {
    const registry = createSpringrollApplicationToolRegistry(
      {} as SpringrollApplicationReadApi,
    );

    expect(registry.definitions.map(({ name }) => name)).toEqual([
      "springroll_search_application_tools",
      "springroll_describe_application_tools",
      "springroll_activate_application_tools",
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
      "springroll_search_connector_sources",
      "springroll_inspect_connector_source",
      "springroll_propose_connection",
      "springroll_propose_local_mcp",
      "springroll_propose_openapi_connection",
      "springroll_discover_openapi",
      "create_task",
      "update_task",
      "repair_task_tools",
      "reconnect_connection",
      "disconnect_connection",
      "remove_connection",
      "run_task_now",
      "pause_task",
      "resume_task",
      "delete_task",
      "springroll_search_connection_tools",
      "springroll_describe_connection_tools",
      "springroll_activate_connection_tools",
      "springroll_call_read_connection_tool",
      "springroll_call_connection_tool",
      "springroll_call_destructive_connection_tool",
    ]);
    for (const definition of registry.definitions) {
      expect(definition.descriptor.name).toBe(definition.name);
      expect(definition.descriptor.inputSchema.type).toBe("object");
      expect(definition.descriptor.declaredRisk).toEqual(
        definition.policy.risk,
      );
      if (
        ["create_task", "update_task", "pause_task", "resume_task"].includes(
          definition.name,
        )
      ) {
        expect(definition.policy).toMatchObject({
          approval: "never",
          workflow: "inspect",
          risk: {
            effect: "write",
            openWorld: false,
            idempotent: true,
          },
        });
      } else if (
        [
          "repair_task_tools",
          "run_task_now",
          "springroll_call_connection_tool",
        ].includes(definition.name)
      ) {
        expect(definition.policy).toMatchObject({
          approval: "never",
          risk: { effect: "write" },
        });
      } else if (
        [
          "delete_task",
          "disconnect_connection",
          "remove_connection",
          "springroll_call_destructive_connection_tool",
        ].includes(definition.name)
      ) {
        expect(definition.policy).toMatchObject({
          approval: "before_call",
          risk: { effect: "destructive" },
        });
      } else {
        expect(definition.policy.approval).toBe("never");
        expect(definition.policy.risk.effect).toBe("read");
      }
    }
    expect(registry.get("create_task")?.policy.workflow).toBe("inspect");
    const taskProposalSchema =
      registry.get("create_task")?.descriptor.inputSchema;
    expect(taskProposalSchema).toMatchObject({
      required: expect.arrayContaining([
        "title",
        "prompt",
        "schedule",
        "scheduleLabel",
        "connectionId",
        "toolNames",
        "contract",
        "enabled",
      ]),
    });
    expect(
      (taskProposalSchema?.properties as Record<string, unknown> | undefined)
        ?.request,
    ).toBeUndefined();
    expect(registry.get("update_task")?.policy.workflow).toBe("inspect");
    expect(registry.get("run_task_now")?.policy.workflow).toBe("inspect");
    expect(registry.get("reconnect_connection")?.policy.workflow).toBe(
      "inspect",
    );
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

  test("compacts large OpenAPI discovery catalogs around the safe probe", async () => {
    const largeDescription = "Documented operation. ".repeat(100);
    const tools = Array.from({ length: 40 }, (_, index) => ({
      name: `operation_${index}`,
      description: largeDescription,
      effect: "read" as const,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: largeDescription },
          limit: { type: "number", description: largeDescription },
        },
        required: ["query"],
        additionalProperties: false,
      },
    }));
    const application = {
      async discoverOpenApi() {
        return {
          status: "found" as const,
          title: "Large API",
          specUrl: "https://api.example.test/openapi.json",
          baseUrl: "https://api.example.test/",
          credential: { kind: "none" as const },
          documentationCandidates: ["https://example.test/docs"],
          verification: {
            tool: "operation_39",
            input: { query: "springroll-verification" },
            note: "Use a harmless lookup.",
          },
          tools,
        };
      },
    } as unknown as SpringrollApplicationReadApi;
    const registry = createSpringrollApplicationToolRegistry(application);

    const result = (await registry.execute(
      "springroll_discover_openapi",
      { providerUrl: "https://example.test/docs" },
      callContext(),
    )) as {
      readonly operationCount: number;
      readonly tools: readonly Record<string, unknown>[];
      readonly catalog: { readonly shown: number; readonly total: number };
    };

    expect(result.operationCount).toBe(40);
    expect(result.catalog).toEqual(
      expect.objectContaining({ shown: 17, total: 40, truncated: true }),
    );
    expect(result.tools).toHaveLength(17);
    expect(result.tools.at(-1)).toMatchObject({
      name: "operation_39",
      inputs: ["query", "limit"],
      requiredInputs: ["query"],
    });
    expect(result.tools[0]).not.toHaveProperty("inputSchema");
    expect(JSON.stringify(result).length).toBeLessThan(10_000);
  });

  test("searches public connector sources without treating results as verified", async () => {
    const calls: unknown[] = [];
    const application = {
      async searchConnectorSources(query: string, context: unknown) {
        calls.push({ query, context });
        return {
          query,
          content: "Stripe API documentation https://docs.stripe.com/api",
          instruction: "Inspect the provider-owned result before proposing.",
        };
      },
    } as unknown as SpringrollApplicationReadApi;
    const registry = createSpringrollApplicationToolRegistry(application);

    await expect(
      registry.execute(
        "springroll_search_connector_sources",
        { query: "Stripe official API OpenAPI documentation" },
        { callId: "connector-search", priorCalls: [] },
      ),
    ).resolves.toMatchObject({
      query: "Stripe official API OpenAPI documentation",
      content: expect.stringContaining("docs.stripe.com"),
      instruction: expect.stringContaining("Inspect"),
    });
    expect(calls).toEqual([
      {
        query: "Stripe official API OpenAPI documentation",
        context: { runId: "connector-search" },
      },
    ]);
  });

  test("exposes prepared connector state in the compact connection catalog", async () => {
    const application = {
      async listConnections() {
        return [
          {
            id: "firebase-mcp",
            name: "Firebase",
            description: "Firebase project tools.",
            category: "connector" as const,
            connectionType: "local" as const,
            status: "not_connected" as const,
            custom: true,
            installed: false,
            removable: false,
            credentialKind: "api-key" as const,
          },
        ];
      },
    } as unknown as SpringrollApplicationReadApi;
    const registry = createSpringrollApplicationToolRegistry(application);

    await expect(
      registry.execute("springroll_list_connections", {}, callContext()),
    ).resolves.toMatchObject({
      connections: [
        {
          id: "firebase-mcp",
          custom: true,
          installed: false,
          credentialKind: "api-key",
          setup: "reconnect",
        },
      ],
    });
  });

  test("searches, describes, and activates application tools from the shared registry", async () => {
    const registry = createSpringrollApplicationToolRegistry(
      {} as SpringrollApplicationReadApi,
    );

    await expect(
      registry.execute(
        "springroll_search_application_tools",
        { query: "diagnose failed run", limit: 4 },
        callContext(),
      ),
    ).resolves.toMatchObject({
      instruction: expect.stringContaining("not connection IDs"),
      matches: expect.arrayContaining([
        expect.objectContaining({ name: "springroll_get_run" }),
      ]),
    });
    await expect(
      registry.execute(
        "springroll_describe_application_tools",
        { toolNames: ["springroll_get_run"] },
        callContext(),
      ),
    ).resolves.toMatchObject({
      tools: [
        expect.objectContaining({
          name: "springroll_get_run",
          inputSchema: expect.objectContaining({ type: "object" }),
        }),
      ],
    });
    await expect(
      registry.execute(
        "springroll_activate_application_tools",
        { toolNames: ["springroll_get_run"] },
        callContext(),
      ),
    ).resolves.toMatchObject({
      activatedToolNames: ["springroll_get_run"],
    });
    await expect(
      registry.execute(
        "springroll_activate_application_tools",
        { toolNames: ["springroll_propose_local_mcp"] },
        callContext(),
      ),
    ).rejects.toThrow(
      "Unknown discoverable Springroll application tool: springroll_propose_local_mcp",
    );
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

  test("runs, pauses, resumes, and deletes recipes directly", async () => {
    const calls: unknown[] = [];
    const application = {
      async getTask(taskId: string) {
        return { id: taskId, enabled: true };
      },
      async updateTask(taskId: string, input: unknown) {
        calls.push({ method: "update", taskId, input });
        return { id: taskId, enabled: false };
      },
      async runTaskNow(taskId: string, requestId: string) {
        calls.push({ method: "run", taskId, requestId });
        return { id: "run-weather" };
      },
      async deleteTask(taskId: string) {
        calls.push({ method: "delete", taskId });
        return "deleted" as const;
      },
    } as unknown as SpringrollApplicationReadApi;
    const registry = createSpringrollApplicationToolRegistry(application);

    expect(
      await registry.execute(
        "run_task_now",
        { taskId: "task-weather" },
        { ...callContext(), callId: "run-call" },
      ),
    ).toEqual({ id: "run-weather" });
    expect(
      await registry.execute(
        "pause_task",
        { taskId: "task-weather" },
        callContext(),
      ),
    ).toMatchObject({ id: "task-weather", enabled: false });
    await expect(
      registry.execute(
        "delete_task",
        { taskId: "task-weather" },
        callContext(),
      ),
    ).rejects.toThrow("requires explicit approval");
    expect(
      await registry.execute(
        "delete_task",
        { taskId: "task-weather" },
        { ...callContext(), approved: true },
      ),
    ).toEqual({ deleted: true, taskId: "task-weather" });
    expect(calls).toEqual([
      { method: "run", taskId: "task-weather", requestId: "run-call" },
      { method: "update", taskId: "task-weather", input: { enabled: false } },
      { method: "delete", taskId: "task-weather" },
    ]);
  });

  test("hands reconnect to native controls and approves destructive connection actions", async () => {
    const calls: unknown[] = [];
    const application = {
      async proposeConnectionAction(connectionId: string, action: string) {
        calls.push({ connectionId, action });
        return {
          status: "ready" as const,
          proposal: {
            connectionId,
            connectionName: "Neon",
            action,
            credentialKind: "oauth" as const,
          },
        };
      },
      async disconnectConnector(connectionId: string) {
        calls.push({ connectionId, action: "disconnect-executed" });
      },
      async removeConnector(connectionId: string) {
        calls.push({ connectionId, action: "remove-executed" });
      },
    } as unknown as SpringrollApplicationReadApi;
    const registry = createSpringrollApplicationToolRegistry(application);

    await expect(
      registry.execute(
        "reconnect_connection",
        { connectionId: "neon" },
        callContext(),
      ),
    ).resolves.toMatchObject({
      status: "requires_user_action",
      connectionId: "neon",
      credentialKind: "oauth",
      path: "/connections/neon",
    });
    await expect(
      registry.execute(
        "disconnect_connection",
        { connectionId: "neon" },
        callContext(),
      ),
    ).rejects.toThrow("requires explicit approval");
    await expect(
      registry.execute(
        "disconnect_connection",
        { connectionId: "neon" },
        { ...callContext(), approved: true },
      ),
    ).resolves.toEqual({ disconnected: true, connectionId: "neon" });
    expect(calls).toEqual([
      { connectionId: "neon", action: "reconnect" },
      { connectionId: "neon", action: "disconnect" },
      { connectionId: "neon", action: "disconnect-executed" },
    ]);
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
          status: "connected",
          setup: "connected",
          toolCount: 1,
          toolEffects: { read: 1, write: 0, destructive: 0 },
        },
      ],
    });
  });

  test("focuses connection lookup on the user's requested provider", async () => {
    const application = {
      async listConnections() {
        return [
          {
            id: "gmail",
            name: "Gmail",
            description: "Search Google mail.",
            tags: ["email"],
            status: "coming_soon" as const,
            connectionType: "mcp" as const,
            custom: false,
            installed: false,
            actionable: false,
            credentialKind: "oauth" as const,
            credentialConfigured: false,
            oauthReady: false,
          },
          {
            id: "jira",
            name: "Jira",
            description: "Work with Jira issues.",
            tags: ["planning"],
            status: "not_connected" as const,
            connectionType: "mcp" as const,
            custom: false,
            installed: false,
            actionable: true,
            credentialKind: "oauth" as const,
            credentialConfigured: false,
            oauthReady: true,
          },
        ];
      },
    } as unknown as SpringrollApplicationReadApi;
    const tools = createSpringrollApplicationTools(application);
    const listConnections = tools.springroll_list_connections as unknown as {
      execute(
        input: unknown,
        options: {
          readonly toolCallId: string;
          readonly messages: readonly ModelMessage[];
        },
      ): Promise<unknown>;
    };

    await expect(
      listConnections.execute(
        {},
        {
          toolCallId: "focused-gmail-catalog",
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "I want to connect to Gmail" }],
            },
          ],
        },
      ),
    ).resolves.toEqual({
      query: "I want to connect to Gmail",
      filtered: true,
      matchCount: 1,
      connections: [
        {
          id: "gmail",
          name: "Gmail",
          status: "coming_soon",
          setup: "unavailable",
          connectionType: "mcp",
          custom: false,
          installed: false,
          credentialKind: "oauth",
          credentialConfigured: false,
          oauthReady: false,
          actionable: false,
          blocker:
            "Springroll OAuth client registration is not configured. This is an app release prerequisite, not a user setup step.",
          toolCount: 0,
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

  test("turns ordinary API documentation into a small saved-operation proposal", async () => {
    const calls: unknown[] = [];
    const application = {
      async proposeDocumentedApiIntegration(input: unknown) {
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
        name: "Rates",
        operator: "Rates Example",
        description: "Read current exchange rates.",
        docsUrl: "https://rates.example.test/docs",
        transport: {
          kind: "http-api",
          baseUrl: "https://api.rates.example.test/v1",
          credential: { kind: "none" },
          operations: [
            {
              name: "get_latest_rates",
              description: "Read the latest rates.",
              method: "GET",
              path: "/rates/latest",
              inputSchema: {
                type: "object",
                properties: { base: { type: "string" } },
                required: ["base"],
                additionalProperties: false,
              },
              parameters: [
                {
                  input: "base",
                  name: "base",
                  location: "query",
                  required: true,
                },
              ],
              effect: "read",
            },
          ],
          probe: {
            tool: "get_latest_rates",
            input: { base: "USD" },
            note: "Read one public rate.",
          },
        },
      },
      callContext(),
    );

    expect(calls).toEqual([
      {
        name: "Rates",
        operator: "Rates Example",
        description: "Read current exchange rates.",
        docsUrl: "https://rates.example.test/docs",
        sourceUrls: ["https://rates.example.test/docs"],
        baseUrl: "https://api.rates.example.test/v1",
        credential: { kind: "none" },
        operations: [
          expect.objectContaining({
            name: "get_latest_rates",
            method: "GET",
            effect: "read",
          }),
        ],
        probe: {
          tool: "get_latest_rates",
          input: { base: "USD" },
          note: "Read one public rate.",
        },
      },
    ]);
  });

  test("does not silently drop a documented API verification request", async () => {
    const registry = createSpringrollApplicationToolRegistry(
      {} as SpringrollApplicationReadApi,
    );
    const tools = createAiSdkApplicationTools(registry);
    const proposal = tools.springroll_propose_connection as unknown as {
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
          name: "Rates",
          operator: "Rates Example",
          description: "Read exchange rates.",
          docsUrl: "https://rates.example.test/docs",
          transport: {
            kind: "http-api",
            baseUrl: "https://api.rates.example.test/v1",
            credential: { kind: "none" },
            operations: [
              {
                name: "get_rates",
                description: "Read rates.",
                method: "GET",
                path: "/rates",
                inputSchema: {
                  type: "object",
                  properties: {},
                  additionalProperties: false,
                },
                effect: "read",
              },
            ],
          },
          probe: {
            tool: "get_rates",
            input: {},
            note: "Read public rates.",
          },
        },
        { toolCallId: "misplaced-api-probe", messages: [] },
      ),
    ).resolves.toMatchObject({
      status: "invalid_input",
      tool: "springroll_propose_connection",
      issues: expect.arrayContaining([
        { path: "transport.probe", message: expect.any(String) },
        { path: "input", message: expect.stringContaining("probe") },
      ]),
    });
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

  test("returns host proposal validation without an opaque tool failure", async () => {
    const application = {
      async proposeOpenApiIntegration() {
        throw new TypeError(
          "Verification operation is not in the OpenAPI document: /latest",
        );
      },
    } as unknown as SpringrollApplicationReadApi;
    const registry = createSpringrollApplicationToolRegistry(application);
    const tools = createAiSdkApplicationTools(registry);
    const proposal = tools.springroll_propose_openapi_connection as unknown as {
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
          name: "Frankfurter",
          operator: "Frankfurter",
          description: "Free exchange rates.",
          specUrl: "https://api.frankfurter.dev/v1/openapi.json",
          docsUrl: "https://frankfurter.dev/",
          probe: { tool: "/latest", input: {}, note: "Read rates." },
          sources: [
            { title: "Frankfurter", url: "https://frankfurter.dev/" },
            {
              title: "OpenAPI",
              url: "https://api.frankfurter.dev/v1/openapi.json",
            },
          ],
        },
        { toolCallId: "bad-frankfurter-probe", messages: [] },
      ),
    ).resolves.toMatchObject({
      status: "invalid_input",
      issues: [
        {
          path: "proposal",
          message: expect.stringContaining("Verification operation"),
        },
      ],
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

  test("runs ordinary writes directly and reserves approval for destructive tools", async () => {
    const calls: unknown[] = [];
    const application = {
      async callWriteConnectionTool(...args: unknown[]) {
        calls.push(args);
        return { content: [{ type: "text", text: "updated" }] };
      },
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

    expect(mutation.needsApproval).toBe(false);
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
    expect(
      (
        tools.springroll_call_destructive_connection_tool as unknown as {
          readonly needsApproval: boolean;
        }
      ).needsApproval,
    ).toBe(true);
  });
});

function callContext() {
  return { callId: "test-call", priorCalls: [] } as const;
}

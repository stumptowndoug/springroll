import {
  type AiSdkAssistant,
  AssistantSessionNotFoundError,
  AssistantTurnConflictError,
  type ChatSessionContext,
  chatSessionContextSchema,
  chatSessionEntryModeSchema,
  connectorManifestSchema,
} from "@springroll/kernel";
import { type Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type {
  ConnectionCardDto,
  ConnectionWorkflowActionDto,
  TaskProposalDto,
  TaskUpdateProposalDto,
} from "../shared.ts";
import type { LocalApplication, UpdateTaskInput } from "./application.ts";
import type { SpringrollMcpHttpEndpoint } from "./application-mcp.ts";

export type AppApi = Pick<
  LocalApplication,
  | "snapshot"
  | "listRuns"
  | "getRun"
  | "deleteRun"
  | "listRunEvents"
  | "listTasks"
  | "getTask"
  | "deleteTask"
  | "getTaskExecution"
  | "proposeTask"
  | "proposeTaskUpdate"
  | "createTask"
  | "applyTaskUpdateProposal"
  | "updateTask"
  | "runTaskNow"
  | "listConnections"
  | "getConnectionDetail"
  | "proposeIntegration"
  | "prepareIntegrationVariant"
  | "prepareCustomRemoteMcp"
  | "modelConfiguration"
  | "connectModelProvider"
  | "disconnectModelProvider"
  | "updateDefaultModel"
  | "connectOpenRouter"
  | "disconnectOpenRouter"
  | "connectWebSearch"
  | "disconnectWebSearch"
  | "connectConnector"
  | "disconnectConnector"
  | "removeConnector"
  | "startConnectorOAuth"
  | "completeConnectorOAuth"
  | "connectNeon"
  | "disconnectNeon"
>;

export interface HttpAppAssets {
  readonly indexHtml: string;
  read(path: string): Promise<Response | undefined>;
}

export type AssistantApi = Pick<
  AiSdkAssistant,
  | "createSession"
  | "createOrResumeSession"
  | "listSessions"
  | "getSession"
  | "archiveSession"
  | "cancelSession"
  | "deleteSession"
  | "renameSession"
  | "updateSessionContext"
  | "getWorkflow"
  | "updateWorkflow"
  | "restoreSession"
  | "respond"
>;

const proposalSchema = z.object({
  title: z.string(),
  prompt: z.string(),
  schedule: z.string(),
  scheduleLabel: z.string(),
  timezone: z.string(),
  connectionId: z.string(),
  connectionName: z.string(),
  toolNames: z.array(z.string()),
  tools: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      effect: z.enum(["read", "write", "destructive"]),
    }),
  ),
  contract: z.string(),
  executionMode: z.literal("local"),
  catchUpPolicy: z.enum(["catch_up", "skip_to_next"]),
});
const taskProposalWorkflowSchema = z.object({
  status: z.literal("ready"),
  proposal: proposalSchema,
});
const taskUpdateRecipeSchema = z.object({
  name: z.string().trim().min(2).max(80),
  prompt: z.string().trim().min(3).max(2_000),
  schedule: z.string().trim().min(5).max(100),
  timezone: z.string().trim().min(1).max(100),
  catchUpPolicy: z.enum(["catch_up", "skip_to_next"]),
});
const taskUpdateProposalSchema = z.object({
  taskId: z.string().trim().min(1).max(200),
  expectedUpdatedAt: z.string().datetime(),
  before: taskUpdateRecipeSchema,
  after: taskUpdateRecipeSchema,
  changes: z
    .array(
      z.object({
        field: z.enum([
          "name",
          "prompt",
          "schedule",
          "timezone",
          "catchUpPolicy",
        ]),
        label: z.string().min(1).max(80),
        before: z.string(),
        after: z.string(),
      }),
    )
    .min(1)
    .max(5),
});
const taskUpdateWorkflowSchema = z.object({
  status: z.literal("ready"),
  proposal: taskUpdateProposalSchema,
});
const connectionProposalWorkflowSchema = z.object({
  status: z.literal("ready"),
  proposal: z.object({
    templateId: z.string().min(1),
    name: z.string().min(1),
    manifest: connectorManifestSchema.optional(),
    variants: z.array(
      z.object({
        id: z.string().min(1),
        credentialKind: z.enum(["oauth", "api-key", "none"]),
      }),
    ),
  }),
});
const preparedConnectionWorkflowOutcomeSchema = z.object({
  phase: z.literal("prepared"),
  connectorId: z.string().min(1),
  variantId: z.string().min(1),
  credentialKind: z.enum(["oauth", "api-key", "none"]),
});

const modelProviderSchema = z.enum(["openrouter", "openai", "xai"]);
const modelSelectionSchema = z.object({
  providerId: modelProviderSchema,
  modelId: z.string().min(1),
});

export function createHttpApp(
  application: AppApi,
  assets?: HttpAppAssets,
  assistant?: AssistantApi,
  mcp?: SpringrollMcpHttpEndpoint,
): Hono {
  const app = new Hono();

  app.get("/api/snapshot", async (context) =>
    context.json(await application.snapshot()),
  );
  app.get("/api/runs", async (context) =>
    context.json(await application.listRuns()),
  );
  app.get("/api/runs/:id", async (context) => {
    const run = await application.getRun(context.req.param("id"));
    return run
      ? context.json(run)
      : context.json({ error: "Run not found" }, 404);
  });
  app.delete("/api/runs/:id", async (context) => {
    const result = await application.deleteRun(context.req.param("id"));
    if (result === "not_found") {
      return context.json({ error: "Run not found" }, 404);
    }
    if (result === "active") {
      return context.json(
        { error: "A run cannot be deleted while it is still active" },
        409,
      );
    }
    return context.body(null, 204);
  });
  app.get("/api/runs/:id/events", async (context) => {
    const query = z
      .object({
        after: z.coerce.number().int().min(-1).optional().default(-1),
        limit: z.coerce.number().int().min(1).max(100).optional().default(100),
      })
      .parse(context.req.query());
    const page = await application.listRunEvents(
      context.req.param("id"),
      query.after,
      query.limit,
    );
    return page
      ? context.json(page)
      : context.json({ error: "Run not found" }, 404);
  });
  app.get("/api/runs/:id/events/stream", async (context) => {
    const queryAfter = z.coerce
      .number()
      .int()
      .min(-1)
      .optional()
      .parse(context.req.query("after"));
    const headerAfter = parseEventCursor(context.req.header("last-event-id"));
    let cursor = headerAfter ?? queryAfter ?? -1;
    let page = await application.listRunEvents(context.req.param("id"), cursor);
    if (!page) {
      return context.json({ error: "Run not found" }, 404);
    }

    return streamSSE(context, async (stream) => {
      let lastWriteAt = Date.now();
      while (!stream.aborted && page) {
        for (const event of page.events) {
          await stream.writeSSE({
            id: String(event.sequence),
            event: "run_event",
            data: JSON.stringify(event),
            retry: 1_000,
          });
          lastWriteAt = Date.now();
        }
        cursor = page.nextCursor;
        if (
          !page.hasMore &&
          (page.runStatus === "succeeded" || page.runStatus === "failed")
        ) {
          await stream.writeSSE({
            id: String(cursor),
            event: "run_complete",
            data: JSON.stringify({ status: page.runStatus }),
          });
          return;
        }
        if (!page.hasMore) {
          await stream.sleep(350);
        }
        page = await application.listRunEvents(context.req.param("id"), cursor);
        if (Date.now() - lastWriteAt >= 15_000) {
          await stream.write(": keepalive\n\n");
          lastWriteAt = Date.now();
        }
      }
    });
  });
  app.get("/api/tasks", async (context) =>
    context.json(await application.listTasks()),
  );
  app.get("/api/tasks/:id", async (context) => {
    const task = await application.getTask(context.req.param("id"));
    return task
      ? context.json(task)
      : context.json({ error: "Task not found" }, 404);
  });
  app.delete("/api/tasks/:id", async (context) => {
    const result = await application.deleteTask(context.req.param("id"));
    if (result === "not_found") {
      return context.json({ error: "Task not found" }, 404);
    }
    if (result === "active") {
      return context.json(
        { error: "A task cannot be deleted while one of its runs is active" },
        409,
      );
    }
    return context.body(null, 204);
  });
  app.get("/api/tasks/:id/execution", async (context) =>
    context.json(await application.getTaskExecution(context.req.param("id"))),
  );
  app.post("/api/tasks/propose", async (context) => {
    const input = z
      .object({
        sentence: z.string(),
        timezone: z.string().min(1),
      })
      .parse(await context.req.json());

    return context.json(
      await application.proposeTask(input.sentence, input.timezone),
    );
  });
  app.post("/api/tasks", async (context) => {
    const input = z
      .object({
        proposal: proposalSchema,
        enabled: z.boolean(),
      })
      .parse(await context.req.json());

    return context.json(
      await application.createTask(
        input.proposal as TaskProposalDto,
        input.enabled,
      ),
      201,
    );
  });
  app.patch("/api/tasks/:id", async (context) => {
    const parsed = z
      .object({
        name: z.string().trim().min(2).max(80).optional(),
        prompt: z.string().trim().min(3).max(2_000).optional(),
        schedule: z.string().trim().min(5).max(100).optional(),
        timezone: z.string().trim().min(1).max(100).optional(),
        enabled: z.boolean().optional(),
        tag: z.string().max(60).nullable().optional(),
        catchUpPolicy: z.enum(["catch_up", "skip_to_next"]).optional(),
        modelSelection: modelSelectionSchema.nullable().optional(),
      })
      .parse(await context.req.json());
    const input: UpdateTaskInput = {
      ...(parsed.name === undefined ? undefined : { name: parsed.name }),
      ...(parsed.prompt === undefined ? undefined : { prompt: parsed.prompt }),
      ...(parsed.schedule === undefined
        ? undefined
        : { schedule: parsed.schedule }),
      ...(parsed.timezone === undefined
        ? undefined
        : { timezone: parsed.timezone }),
      ...(parsed.enabled === undefined
        ? undefined
        : { enabled: parsed.enabled }),
      ...(parsed.tag === undefined ? undefined : { tag: parsed.tag }),
      ...(parsed.catchUpPolicy === undefined
        ? undefined
        : { catchUpPolicy: parsed.catchUpPolicy }),
      ...(parsed.modelSelection === undefined
        ? undefined
        : { modelSelection: parsed.modelSelection }),
    };
    const task = await application.updateTask(context.req.param("id"), input);

    return task
      ? context.json(task)
      : context.json({ error: "Task not found" }, 404);
  });
  app.post("/api/tasks/:id/run", async (context) => {
    const manualRequestId = z
      .string()
      .min(1)
      .max(200)
      .optional()
      .parse(context.req.header("idempotency-key"));
    return context.json(
      await application.runTaskNow(context.req.param("id"), manualRequestId),
      202,
    );
  });
  app.get("/api/connections", async (context) =>
    context.json(await application.listConnections()),
  );
  app.get("/api/connections/:id", async (context) => {
    const connection = await application.getConnectionDetail(
      context.req.param("id"),
    );
    return connection
      ? context.json(connection)
      : context.json({ error: "Connection not found" }, 404);
  });
  app.post("/api/integrations/propose", async (context) => {
    const input = z
      .object({ sentence: z.string().trim().min(1).max(500) })
      .parse(await context.req.json());
    return context.json(await application.proposeIntegration(input.sentence));
  });
  app.post("/api/integrations/:id/select", async (context) => {
    const input = z
      .object({ variantId: z.string().min(1).max(100) })
      .parse(await context.req.json());
    return context.json(
      await application.prepareIntegrationVariant(
        context.req.param("id"),
        input.variantId,
      ),
    );
  });
  app.get("/api/models", async (context) =>
    context.json(await application.modelConfiguration()),
  );
  app.put("/api/models/default", async (context) => {
    const input = z
      .object({ selection: modelSelectionSchema.nullable() })
      .parse(await context.req.json());
    return context.json(await application.updateDefaultModel(input.selection));
  });
  app.post("/api/model-providers/:id", async (context) => {
    const providerId = modelProviderSchema.parse(context.req.param("id"));
    const input = z
      .object({ apiKey: z.string().min(1) })
      .parse(await context.req.json());
    return context.json(
      await application.connectModelProvider(providerId, input.apiKey),
    );
  });
  app.delete("/api/model-providers/:id", async (context) => {
    const providerId = modelProviderSchema.parse(context.req.param("id"));
    await application.disconnectModelProvider(providerId);
    return context.body(null, 204);
  });
  app.post("/api/connections/openrouter", async (context) => {
    const input = z
      .object({ apiKey: z.string().min(1) })
      .parse(await context.req.json());
    return context.json(await application.connectOpenRouter(input.apiKey));
  });
  app.delete("/api/connections/openrouter", async (context) => {
    await application.disconnectOpenRouter();
    return context.body(null, 204);
  });
  app.post("/api/connections/web-search", async (context) => {
    const input = z
      .object({ apiKey: z.string().min(1) })
      .parse(await context.req.json());
    return context.json(await application.connectWebSearch(input.apiKey));
  });
  app.delete("/api/connections/web-search", async (context) => {
    await application.disconnectWebSearch();
    return context.body(null, 204);
  });
  app.post("/api/connectors/custom", async (context) => {
    const input = z
      .object({
        name: z.string().optional(),
        endpoint: z.string().url(),
        credentialKind: z.enum(["oauth", "api-key", "none"]),
        header: z.string().optional(),
      })
      .parse(await context.req.json());
    return context.json(
      await application.prepareCustomRemoteMcp({
        endpoint: input.endpoint,
        credentialKind: input.credentialKind,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.header === undefined ? {} : { header: input.header }),
      }),
    );
  });
  app.post("/api/connectors/:id", async (context) => {
    const input = z
      .object({ apiKey: z.string().optional() })
      .parse(await context.req.json());
    return context.json(
      await application.connectConnector(context.req.param("id"), {
        ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
      }),
    );
  });
  app.post("/api/connectors/:id/disconnect", async (context) => {
    await application.disconnectConnector(context.req.param("id"));
    return context.body(null, 204);
  });
  app.delete("/api/connectors/:id", async (context) => {
    await application.removeConnector(context.req.param("id"));
    return context.body(null, 204);
  });
  app.post("/api/connectors/:id/oauth", async (context) => {
    const manifestId = context.req.param("id");
    const input = z
      .object({ returnTo: z.string().max(1_000).optional() })
      .parse(await context.req.json().catch(() => ({})));
    const returnTo = normalizeChatReturnPath(input.returnTo);
    if (input.returnTo && !returnTo) {
      throw new TypeError("OAuth can return only to a Springroll chat");
    }
    const redirectUrl = new URL(
      `/api/connectors/${encodeURIComponent(manifestId)}/oauth/callback`,
      context.req.url,
    );
    if (returnTo) redirectUrl.searchParams.set("returnTo", returnTo);
    return context.json(
      await application.startConnectorOAuth(manifestId, redirectUrl.toString()),
    );
  });
  app.get("/api/connectors/:id/oauth/callback", async (context) => {
    const manifestId = context.req.param("id");
    const returnTo = normalizeChatReturnPath(context.req.query("returnTo"));
    const workflowReference = connectionWorkflowReference(returnTo);
    const error = context.req.query("error");
    if (error) {
      const description = boundedWorkflowError(
        context.req.query("error_description") ?? error,
        "OAuth sign-in failed. Try again.",
      );
      updateConnectionWorkflowAfterOAuthError(
        assistant,
        workflowReference,
        manifestId,
        description,
      );
      return context.redirect(connectorOAuthResultPath(returnTo, description));
    }
    const code = z.string().min(1).parse(context.req.query("code"));
    const state = context.req.query("state");
    const redirectUrl = new URL(context.req.url);
    redirectUrl.search = "";
    if (returnTo) redirectUrl.searchParams.set("returnTo", returnTo);
    try {
      const connection = await application.completeConnectorOAuth(manifestId, {
        code,
        ...(state === undefined ? {} : { state }),
        redirectUrl: redirectUrl.toString(),
      });
      if (assistant && workflowReference) {
        const workflow = assistant.getWorkflow(
          workflowReference.sessionId,
          workflowReference.workflowId,
        );
        if (
          isPreparedOAuthConnectionWorkflow(workflow, manifestId) &&
          workflow?.status !== "completed"
        ) {
          completeConnectionWorkflow(
            assistant,
            workflowReference.sessionId,
            workflowReference.workflowId,
            connection,
          );
        }
      }
      return context.redirect(connectorOAuthResultPath(returnTo));
    } catch (caught) {
      const message = boundedWorkflowError(
        caught instanceof Error ? caught.message : String(caught),
        "OAuth sign-in failed. Try again.",
      );
      updateConnectionWorkflowAfterOAuthError(
        assistant,
        workflowReference,
        manifestId,
        message,
      );
      return context.redirect(connectorOAuthResultPath(returnTo, message));
    }
  });
  app.post("/api/connections/neon", async (context) => {
    const input = z
      .object({
        url: z.string().url(),
        token: z.string().optional(),
      })
      .parse(await context.req.json());
    return context.json(
      await application.connectNeon({
        url: input.url,
        ...(input.token === undefined ? undefined : { token: input.token }),
      }),
    );
  });
  app.delete("/api/connections/neon", async (context) => {
    await application.disconnectNeon();
    return context.body(null, 204);
  });

  app.post("/api/chats", async (context) => {
    if (!assistant) return assistantUnavailable(context);
    const input = z
      .object({ title: z.string().min(1).max(200).optional() })
      .strict()
      .parse(await context.req.json());
    return context.json(assistant.createSession(input.title), 201);
  });
  app.post("/api/chats/entry", async (context) => {
    if (!assistant) return assistantUnavailable(context);
    const input = z
      .object({
        title: z.string().trim().min(1).max(200).optional(),
        mode: chatSessionEntryModeSchema.optional().default("resume"),
        context: chatSessionContextSchema,
      })
      .strict()
      .parse(await context.req.json());
    await validateChatEntry(application, input.context);
    return context.json(
      assistant.createOrResumeSession({
        ...(input.title ? { title: input.title } : undefined),
        mode: input.mode,
        context: input.context,
      }),
      201,
    );
  });
  app.get("/api/chats", (context) => {
    if (!assistant) return assistantUnavailable(context);
    const includeArchived = z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true")
      .parse(context.req.query("includeArchived"));
    return context.json(assistant.listSessions(includeArchived));
  });
  app.get("/api/chats/:id", (context) => {
    if (!assistant) return assistantUnavailable(context);
    const detail = assistant.getSession(context.req.param("id"));
    return detail
      ? context.json(detail)
      : context.json({ error: "Chat session not found" }, 404);
  });
  app.patch("/api/chats/:id", async (context) => {
    if (!assistant) return assistantUnavailable(context);
    const input = z
      .object({
        title: z.string().trim().min(1).max(200).optional(),
        status: z.literal("active").optional(),
      })
      .strict()
      .refine(
        (value) => value.title !== undefined || value.status !== undefined,
        {
          message: "A title or status update is required",
        },
      )
      .parse(await context.req.json());
    try {
      if (input.title !== undefined) {
        assistant.renameSession(context.req.param("id"), input.title);
      }
      if (input.status === "active") {
        assistant.restoreSession(context.req.param("id"));
      }
      return context.json(
        assistant.getSession(context.req.param("id"))?.session,
      );
    } catch (error) {
      if (error instanceof AssistantSessionNotFoundError) {
        return context.json({ error: "Chat session not found" }, 404);
      }
      throw error;
    }
  });
  app.put("/api/chats/:id/context", async (context) => {
    if (!assistant) return assistantUnavailable(context);
    const sessionContext = chatSessionContextSchema.parse(
      await context.req.json(),
    );
    await validateChatEntry(application, sessionContext);
    try {
      return context.json(
        assistant.updateSessionContext(context.req.param("id"), sessionContext),
      );
    } catch (error) {
      if (error instanceof AssistantSessionNotFoundError) {
        return context.json({ error: "Chat session not found" }, 404);
      }
      throw error;
    }
  });
  app.delete("/api/chats/:id", (context) => {
    if (!assistant) return assistantUnavailable(context);
    try {
      assistant.archiveSession(context.req.param("id"));
      return context.body(null, 204);
    } catch (error) {
      if (isUnknownChatSession(error)) {
        return context.json({ error: "Chat session not found" }, 404);
      }
      throw error;
    }
  });
  app.delete("/api/chats/:id/permanent", (context) => {
    if (!assistant) return assistantUnavailable(context);
    try {
      assistant.deleteSession(context.req.param("id"));
      return context.body(null, 204);
    } catch (error) {
      if (error instanceof AssistantSessionNotFoundError) {
        return context.json({ error: "Chat session not found" }, 404);
      }
      throw error;
    }
  });
  app.post("/api/chats/:id/cancel", (context) => {
    if (!assistant) return assistantUnavailable(context);
    try {
      return context.json({
        cancelled: assistant.cancelSession(context.req.param("id")),
      });
    } catch (error) {
      if (error instanceof AssistantSessionNotFoundError) {
        return context.json({ error: "Chat session not found" }, 404);
      }
      throw error;
    }
  });
  app.post(
    "/api/chats/:id/workflows/:workflowId/accept-task",
    async (context) => {
      if (!assistant) return assistantUnavailable(context);
      const sessionId = context.req.param("id");
      const workflowId = context.req.param("workflowId");
      const workflow = assistant.getWorkflow(sessionId, workflowId);
      if (!workflow) {
        return context.json({ error: "Chat workflow not found" }, 404);
      }
      if (workflow.kind !== "task_proposal") {
        return context.json(
          { error: "This workflow is not a recipe proposal" },
          409,
        );
      }
      if (
        workflow.status === "completed" &&
        workflow.subjectKind === "task" &&
        workflow.subjectId
      ) {
        const existing = await application.getTask(workflow.subjectId);
        if (existing) return context.json(existing);
      }
      if (
        workflow.status !== "proposed" &&
        workflow.status !== "waiting_for_user"
      ) {
        return context.json(
          { error: `Recipe workflow is ${workflow.status}` },
          409,
        );
      }
      const payload = taskProposalWorkflowSchema.parse(workflow.payload);
      assistant.updateWorkflow(sessionId, workflowId, {
        status: "in_progress",
      });
      try {
        const task = await application.createTask(
          payload.proposal as TaskProposalDto,
          false,
          { id: workflow.id },
        );
        assistant.updateWorkflow(sessionId, workflowId, {
          status: "completed",
          subject: { kind: "task", id: task.id },
          outcome: { created: true, enabled: false },
        });
        assistant.updateSessionContext(sessionId, {
          version: 1,
          intent: "task.manage",
          origin: "recipes",
          subjects: [{ kind: "task", id: task.id }],
        });
        return context.json(task, 201);
      } catch (error) {
        assistant.updateWorkflow(sessionId, workflowId, {
          status: "waiting_for_user",
          error:
            error instanceof TypeError
              ? error.message
              : "Springroll could not create the recipe. Try again.",
        });
        throw error;
      }
    },
  );
  app.post(
    "/api/chats/:id/workflows/:workflowId/accept-task-update",
    async (context) => {
      if (!assistant) return assistantUnavailable(context);
      const sessionId = context.req.param("id");
      const workflowId = context.req.param("workflowId");
      const workflow = assistant.getWorkflow(sessionId, workflowId);
      if (!workflow) {
        return context.json({ error: "Chat workflow not found" }, 404);
      }
      if (workflow.kind !== "task_update") {
        return context.json(
          { error: "This workflow is not a recipe update" },
          409,
        );
      }
      if (
        workflow.status === "completed" &&
        workflow.subjectKind === "task" &&
        workflow.subjectId
      ) {
        const existing = await application.getTask(workflow.subjectId);
        if (existing) return context.json(existing);
      }
      if (
        workflow.status !== "proposed" &&
        workflow.status !== "waiting_for_user"
      ) {
        return context.json(
          { error: `Recipe update workflow is ${workflow.status}` },
          409,
        );
      }
      const payload = taskUpdateWorkflowSchema.parse(workflow.payload);
      assistant.updateWorkflow(sessionId, workflowId, {
        status: "in_progress",
      });
      try {
        const task = await application.applyTaskUpdateProposal(
          payload.proposal as TaskUpdateProposalDto,
        );
        assistant.updateWorkflow(sessionId, workflowId, {
          status: "completed",
          subject: { kind: "task", id: task.id },
          outcome: {
            updated: true,
            fields: payload.proposal.changes.map((change) => change.field),
          },
        });
        assistant.updateSessionContext(sessionId, {
          version: 1,
          intent: "task.manage",
          origin: "recipes",
          subjects: [{ kind: "task", id: task.id }],
        });
        return context.json(task);
      } catch (error) {
        assistant.updateWorkflow(sessionId, workflowId, {
          status: "waiting_for_user",
          error:
            error instanceof TypeError
              ? error.message
              : "Springroll could not update the recipe. Review a fresh proposal.",
        });
        throw error;
      }
    },
  );
  app.post(
    "/api/chats/:id/workflows/:workflowId/prepare-connection",
    async (context) => {
      if (!assistant) return assistantUnavailable(context);
      const sessionId = context.req.param("id");
      const workflowId = context.req.param("workflowId");
      const workflow = assistant.getWorkflow(sessionId, workflowId);
      if (!workflow) {
        return context.json({ error: "Chat workflow not found" }, 404);
      }
      if (workflow.kind !== "connection_setup") {
        return context.json(
          { error: "This workflow is not a connection proposal" },
          409,
        );
      }
      if (
        workflow.status === "completed" &&
        workflow.subjectKind === "connection" &&
        workflow.subjectId
      ) {
        const existing = await findConnectedConnection(
          application,
          workflow.subjectId,
        );
        if (existing) {
          return context.json({ status: "connected", connection: existing });
        }
      }
      if (
        workflow.status !== "proposed" &&
        workflow.status !== "waiting_for_user"
      ) {
        return context.json(
          { error: `Connection workflow is ${workflow.status}` },
          409,
        );
      }
      const input = z
        .object({ variantId: z.string().min(1).max(100) })
        .parse(await context.req.json());
      const payload = connectionProposalWorkflowSchema.parse(workflow.payload);
      const variant = payload.proposal.variants.find(
        (candidate) => candidate.id === input.variantId,
      );
      if (!variant) {
        throw new TypeError("That connection setup option was not proposed");
      }
      assistant.updateWorkflow(sessionId, workflowId, {
        status: "in_progress",
      });
      try {
        const connection = await application.prepareIntegrationVariant(
          payload.proposal.templateId,
          variant.id,
          payload.proposal.manifest,
        );
        const preparedOutcome = {
          phase: "prepared" as const,
          connectorId: connection.id,
          variantId: variant.id,
          credentialKind: variant.credentialKind,
        };
        if (variant.credentialKind === "api-key") {
          assistant.updateWorkflow(sessionId, workflowId, {
            status: "waiting_for_user",
            subject: { kind: "connection", id: connection.id },
            outcome: preparedOutcome,
          });
          return context.json({
            status: "awaiting_api_key",
            connection,
          } satisfies ConnectionWorkflowActionDto);
        }
        if (variant.credentialKind === "none") {
          const connected = await application.connectConnector(
            connection.id,
            {},
          );
          completeConnectionWorkflow(
            assistant,
            sessionId,
            workflowId,
            connected,
          );
          return context.json({
            status: "connected",
            connection: connected,
          } satisfies ConnectionWorkflowActionDto);
        }

        const returnTo = connectionWorkflowReturnPath(
          sessionId,
          workflowId,
          connection.id,
        );
        const redirectUrl = connectorOAuthCallbackUrl(
          context.req.url,
          connection.id,
          returnTo,
        );
        const oauth = await application.startConnectorOAuth(
          connection.id,
          redirectUrl,
        );
        if (oauth.status === "connected") {
          completeConnectionWorkflow(
            assistant,
            sessionId,
            workflowId,
            oauth.connection,
          );
          return context.json(oauth satisfies ConnectionWorkflowActionDto);
        }
        assistant.updateWorkflow(sessionId, workflowId, {
          status: "waiting_for_user",
          subject: { kind: "connection", id: connection.id },
          outcome: preparedOutcome,
        });
        return context.json({
          ...oauth,
          connection,
        } satisfies ConnectionWorkflowActionDto);
      } catch (error) {
        assistant.updateWorkflow(sessionId, workflowId, {
          status: "waiting_for_user",
          error: safeWorkflowError(
            error,
            "Connection setup failed. Try again.",
          ),
        });
        throw error;
      }
    },
  );
  app.post(
    "/api/chats/:id/workflows/:workflowId/connect-key",
    async (context) => {
      if (!assistant) return assistantUnavailable(context);
      const sessionId = context.req.param("id");
      const workflowId = context.req.param("workflowId");
      const workflow = assistant.getWorkflow(sessionId, workflowId);
      if (!workflow) {
        return context.json({ error: "Chat workflow not found" }, 404);
      }
      if (
        workflow.kind !== "connection_setup" ||
        workflow.status !== "waiting_for_user"
      ) {
        return context.json({ error: "Connection workflow is not ready" }, 409);
      }
      const prepared = preparedConnectionWorkflowOutcomeSchema.parse(
        workflow.outcome,
      );
      if (prepared.credentialKind !== "api-key") {
        return context.json(
          { error: "This connection does not use an API key" },
          409,
        );
      }
      const input = z
        .object({ apiKey: z.string().trim().min(1).max(20_000) })
        .parse(await context.req.json());
      assistant.updateWorkflow(sessionId, workflowId, {
        status: "in_progress",
      });
      try {
        const connected = await application.connectConnector(
          prepared.connectorId,
          { apiKey: input.apiKey },
        );
        completeConnectionWorkflow(assistant, sessionId, workflowId, connected);
        return context.json({
          status: "connected",
          connection: connected,
        } satisfies ConnectionWorkflowActionDto);
      } catch (error) {
        const message = safeCredentialWorkflowError(
          error,
          input.apiKey,
          "Connection test failed. Check the credential and try again.",
        );
        assistant.updateWorkflow(sessionId, workflowId, {
          status: "waiting_for_user",
          error: message,
        });
        return context.json(
          { error: message },
          error instanceof TypeError ? 400 : 500,
        );
      }
    },
  );
  app.post("/api/chats/:id/messages", async (context) => {
    if (!assistant) return assistantUnavailable(context);
    const input = z
      .object({ message: z.unknown() })
      .strict()
      .parse(await context.req.json());
    try {
      return await assistant.respond(context.req.param("id"), input.message);
    } catch (error) {
      if (error instanceof AssistantSessionNotFoundError) {
        return context.json({ error: "Chat session not found" }, 404);
      }
      if (error instanceof AssistantTurnConflictError) {
        return context.json(
          { error: "A response is already in progress" },
          409,
        );
      }
      if (error instanceof TypeError || error instanceof z.ZodError) {
        throw error;
      }
      return context.json({ error: "Assistant response failed" }, 500);
    }
  });

  if (mcp) {
    app.all("/mcp", (context) => mcp.fetch(context.req.raw));
  }

  app.onError((error, context) => {
    const message =
      error instanceof z.ZodError
        ? (error.issues[0]?.message ?? "Invalid request")
        : error instanceof Error
          ? error.message
          : String(error);
    const status =
      error instanceof z.ZodError || error instanceof TypeError ? 400 : 500;

    return context.json({ error: message }, status);
  });

  if (assets) {
    app.get("/assets/:file", async (context) => {
      const response = await assets.read(context.req.param("file"));
      if (!response) {
        return context.notFound();
      }
      const headers = new Headers(response.headers);
      headers.set("cache-control", "no-store");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    });
    app.get("*", (context) =>
      context.html(assets.indexHtml, 200, {
        "cache-control": "no-store",
      }),
    );
  }

  return app;
}

function assistantUnavailable(context: Context) {
  return context.json({ error: "Assistant is unavailable" }, 503);
}

async function validateChatEntry(
  application: AppApi,
  context: ChatSessionContext,
): Promise<void> {
  const expectedSubject =
    context.intent === "run.diagnose"
      ? "run"
      : context.intent === "task.manage"
        ? "task"
        : context.intent === "connection.manage"
          ? "connection"
          : undefined;
  if (
    expectedSubject &&
    (context.subjects.length !== 1 ||
      context.subjects[0]?.kind !== expectedSubject)
  ) {
    throw new TypeError(
      `${context.intent} requires exactly one ${expectedSubject} reference`,
    );
  }
  if (
    !expectedSubject &&
    (context.intent === "general" || context.intent.endsWith(".create")) &&
    context.subjects.length > 0
  ) {
    throw new TypeError(`${context.intent} does not accept entity references`);
  }

  let connectionIds: Set<string> | undefined;
  for (const subject of context.subjects) {
    if (subject.kind === "run" && !(await application.getRun(subject.id))) {
      throw new TypeError(`Unknown run: ${subject.id}`);
    }
    if (subject.kind === "task" && !(await application.getTask(subject.id))) {
      throw new TypeError(`Unknown task: ${subject.id}`);
    }
    if (subject.kind === "connection") {
      connectionIds ??= new Set(
        (await application.listConnections()).map(
          (connection) => connection.id,
        ),
      );
      if (!connectionIds.has(subject.id)) {
        throw new TypeError(`Unknown connection: ${subject.id}`);
      }
    }
  }
}

function normalizeChatReturnPath(
  value: string | undefined,
): string | undefined {
  if (!value?.startsWith("/") || value.startsWith("//")) {
    return undefined;
  }
  try {
    const url = new URL(value, "http://springroll.local");
    if (
      url.origin !== "http://springroll.local" ||
      !/^\/chat\/[^/]+$/.test(url.pathname) ||
      url.hash
    ) {
      return undefined;
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return undefined;
  }
}

async function findConnectedConnection(
  application: AppApi,
  id: string,
): Promise<ConnectionCardDto | undefined> {
  return (await application.listConnections()).find(
    (connection) => connection.id === id && connection.status === "connected",
  );
}

function completeConnectionWorkflow(
  assistant: AssistantApi,
  sessionId: string,
  workflowId: string,
  connection: ConnectionCardDto,
): void {
  assistant.updateWorkflow(sessionId, workflowId, {
    status: "completed",
    subject: { kind: "connection", id: connection.id },
    outcome: {
      connected: true,
      toolsDiscovered: true,
      connectorId: connection.id,
      toolCount: connection.toolCount ?? connection.tools?.length ?? 0,
    },
  });
  assistant.updateSessionContext(sessionId, {
    version: 1,
    intent: "connection.manage",
    origin: "connections",
    subjects: [{ kind: "connection", id: connection.id }],
  });
}

function connectionWorkflowReturnPath(
  sessionId: string,
  workflowId: string,
  connectorId: string,
): string {
  const params = new URLSearchParams({
    workflow: workflowId,
    connector: connectorId,
  });
  return `/chat/${encodeURIComponent(sessionId)}?${params.toString()}`;
}

function connectorOAuthCallbackUrl(
  requestUrl: string,
  manifestId: string,
  returnTo: string,
): string {
  const url = new URL(
    `/api/connectors/${encodeURIComponent(manifestId)}/oauth/callback`,
    requestUrl,
  );
  url.searchParams.set("returnTo", returnTo);
  return url.toString();
}

function safeWorkflowError(error: unknown, fallback: string): string {
  return boundedWorkflowError(
    error instanceof TypeError ? error.message : "",
    fallback,
  );
}

function safeCredentialWorkflowError(
  error: unknown,
  credential: string,
  fallback: string,
): string {
  const message = safeWorkflowError(error, fallback);
  return message.includes(credential)
    ? message.split(credential).join("[redacted]")
    : message;
}

function boundedWorkflowError(value: string, fallback: string): string {
  return value.trim().slice(0, 1_000) || fallback;
}

function connectionWorkflowReference(
  returnTo: string | undefined,
): { readonly sessionId: string; readonly workflowId: string } | undefined {
  if (!returnTo) return undefined;
  try {
    const url = new URL(returnTo, "http://springroll.local");
    const match = /^\/chat\/([^/]+)$/.exec(url.pathname);
    const workflowId = url.searchParams.get("workflow")?.trim();
    if (!match?.[1] || !workflowId || workflowId.length > 100) return undefined;
    return {
      sessionId: decodeURIComponent(match[1]),
      workflowId,
    };
  } catch {
    return undefined;
  }
}

function updateConnectionWorkflowAfterOAuthError(
  assistant: AssistantApi | undefined,
  reference:
    | { readonly sessionId: string; readonly workflowId: string }
    | undefined,
  manifestId: string,
  error: string,
): void {
  if (!assistant || !reference) return;
  const workflow = assistant.getWorkflow(
    reference.sessionId,
    reference.workflowId,
  );
  if (
    !isPreparedOAuthConnectionWorkflow(workflow, manifestId) ||
    workflow?.status === "completed" ||
    workflow?.status === "failed" ||
    workflow?.status === "cancelled"
  ) {
    return;
  }
  assistant.updateWorkflow(reference.sessionId, reference.workflowId, {
    status: "waiting_for_user",
    error,
  });
}

function isPreparedOAuthConnectionWorkflow(
  workflow: ReturnType<AssistantApi["getWorkflow"]>,
  manifestId: string,
): boolean {
  if (
    workflow?.kind !== "connection_setup" ||
    workflow.subjectKind !== "connection" ||
    workflow.subjectId !== manifestId
  ) {
    return false;
  }
  const prepared = preparedConnectionWorkflowOutcomeSchema.safeParse(
    workflow.outcome,
  );
  return (
    prepared.success &&
    prepared.data.credentialKind === "oauth" &&
    prepared.data.connectorId === manifestId
  );
}

function connectorOAuthResultPath(
  returnTo: string | undefined,
  error?: string,
): string {
  const target = new URL(returnTo ?? "/connections", "http://springroll.local");
  if (error) target.searchParams.set("oauthError", error);
  else target.searchParams.set("oauth", "connected");
  return `${target.pathname}${target.search}`;
}

function isUnknownChatSession(error: unknown): boolean {
  return (
    error instanceof Error && error.message.startsWith("Unknown chat session:")
  );
}

function parseEventCursor(value: string | undefined): number | undefined {
  if (value === undefined || !/^(0|[1-9]\d*)$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

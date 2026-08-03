import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { TaskProposalDto } from "../shared.ts";
import type { LocalApplication, UpdateTaskInput } from "./application.ts";

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
  | "createTask"
  | "updateTask"
  | "runTaskNow"
  | "listConnections"
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
  | "startConnectorOAuth"
  | "completeConnectorOAuth"
  | "connectNeon"
  | "disconnectNeon"
>;

export interface HttpAppAssets {
  readonly indexHtml: string;
  read(path: string): Promise<Response | undefined>;
}

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

const modelProviderSchema = z.enum(["openrouter", "openai", "xai"]);
const modelSelectionSchema = z.object({
  providerId: modelProviderSchema,
  modelId: z.string().min(1),
});

export function createHttpApp(
  application: AppApi,
  assets?: HttpAppAssets,
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
        enabled: z.boolean().optional(),
        tag: z.string().max(60).nullable().optional(),
        catchUpPolicy: z.enum(["catch_up", "skip_to_next"]).optional(),
        modelSelection: modelSelectionSchema.nullable().optional(),
      })
      .parse(await context.req.json());
    const input: UpdateTaskInput = {
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
  app.delete("/api/connectors/:id", async (context) => {
    await application.disconnectConnector(context.req.param("id"));
    return context.body(null, 204);
  });
  app.post("/api/connectors/:id/oauth", async (context) => {
    const manifestId = context.req.param("id");
    const redirectUrl = new URL(
      `/api/connectors/${encodeURIComponent(manifestId)}/oauth/callback`,
      context.req.url,
    ).toString();
    return context.json(
      await application.startConnectorOAuth(manifestId, redirectUrl),
    );
  });
  app.get("/api/connectors/:id/oauth/callback", async (context) => {
    const manifestId = context.req.param("id");
    const error = context.req.query("error");
    if (error) {
      const description = context.req.query("error_description") ?? error;
      return context.redirect(
        `/integrations/connections?oauthError=${encodeURIComponent(description)}`,
      );
    }
    const code = z.string().min(1).parse(context.req.query("code"));
    const state = context.req.query("state");
    const redirectUrl = new URL(context.req.url);
    redirectUrl.search = "";
    try {
      await application.completeConnectorOAuth(manifestId, {
        code,
        ...(state === undefined ? {} : { state }),
        redirectUrl: redirectUrl.toString(),
      });
      return context.redirect("/integrations/connections?oauth=connected");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      return context.redirect(
        `/integrations/connections?oauthError=${encodeURIComponent(message)}`,
      );
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

function parseEventCursor(value: string | undefined): number | undefined {
  if (value === undefined || !/^(0|[1-9]\d*)$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

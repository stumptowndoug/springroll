import { Hono } from "hono";
import { z } from "zod";
import type { TaskProposalDto } from "../shared.ts";
import type { LocalApplication, UpdateTaskInput } from "./application.ts";

export type AppApi = Pick<
  LocalApplication,
  | "snapshot"
  | "listRuns"
  | "getRun"
  | "listTasks"
  | "getTask"
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
  app.get("/api/tasks", async (context) =>
    context.json(await application.listTasks()),
  );
  app.get("/api/tasks/:id", async (context) => {
    const task = await application.getTask(context.req.param("id"));
    return task
      ? context.json(task)
      : context.json({ error: "Task not found" }, 404);
  });
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
        catchUpPolicy: z.enum(["catch_up", "skip_to_next"]).optional(),
        modelSelection: modelSelectionSchema.nullable().optional(),
      })
      .parse(await context.req.json());
    const input: UpdateTaskInput = {
      ...(parsed.enabled === undefined
        ? undefined
        : { enabled: parsed.enabled }),
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
  app.post("/api/tasks/:id/run", async (context) =>
    context.json(await application.runTaskNow(context.req.param("id"))),
  );
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
      return response ?? context.notFound();
    });
    app.get("*", (context) =>
      context.html(assets.indexHtml, 200, {
        "cache-control": "no-store",
      }),
    );
  }

  return app;
}

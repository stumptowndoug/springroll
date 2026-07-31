import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  type AgentRunner,
  AiSdkAgentRunner,
  CronScheduleEngine,
  defaultOpenAiModelId,
  defaultOpenRouterModelId,
  defaultXaiModelId,
  MacOsKeychainCredentialStore,
  modelSettings,
  OpenAiModelConnection,
  OpenRouterModelConnection,
  openLocalDatabase,
  type ProviderToolCapability,
  requiredProviderToolCapabilities,
  SqliteTickStore,
  startLocalTickLoop,
  tick,
  XaiModelConnection,
} from "@shrimp-roll/kernel";
import { eq } from "drizzle-orm";
import { LocalApplication } from "./server/application.ts";
import { createHttpApp, type HttpAppAssets } from "./server/http-app.ts";
import {
  type ModelCatalogSnapshot,
  ModelsDevCatalog,
} from "./server/model-catalog.ts";
import { chooseModelSelection } from "./server/model-selection.ts";
import { AiTaskProposalGenerator } from "./server/proposal-generator.ts";
import {
  openAiCredentialRef,
  openRouterCredentialRef,
  xaiCredentialRef,
} from "./server/sources.ts";
import type {
  ModelOptionDto,
  ModelProviderId,
  ModelSelectionDto,
} from "./shared.ts";

const databasePath =
  process.env.SHRIMPROLL_DB_PATH ??
  new URL("../../.local/shrimproll.sqlite", import.meta.url).pathname;
mkdirSync(dirname(databasePath), { recursive: true });

const localDatabase = openLocalDatabase({ filename: databasePath });
const credentials = new MacOsKeychainCredentialStore();
const models = new OpenRouterModelConnection(credentials);
const openAiModels = new OpenAiModelConnection(credentials);
const xaiModels = new XaiModelConnection(credentials);
const modelCatalog = new ModelsDevCatalog(
  new URL("../../.local/model-catalog.sqlite", import.meta.url).pathname,
);
const agent: AgentRunner = {
  async run(request) {
    const requiredCapabilities = requiredProviderToolCapabilities(
      request.tools,
    );
    const selection = await resolveModelSelection(
      request.task.modelSelection,
      requiredCapabilities,
    );
    const catalog = await modelCatalog
      .read()
      .catch((): ModelCatalogSnapshot => ({ models: [], stale: true }));
    const catalogModel = catalog.models.find(
      (model) =>
        model.providerId === selection.providerId &&
        model.modelId === selection.modelId,
    );
    const pricing = catalogModelPricing(catalogModel);
    await request.eventSink?.append(
      {
        type: "model_selection",
        provider: selection.providerId,
        modelId: selection.modelId,
        billing: "metered",
        ...(catalog.revision
          ? { catalogRevision: catalog.revision }
          : undefined),
        ...(pricing
          ? {
              inputUsdPerMillionTokens: pricing.inputUsdPerMillionTokens,
              outputUsdPerMillionTokens: pricing.outputUsdPerMillionTokens,
            }
          : undefined),
      },
      new Date(),
    );

    if (selection.providerId === "openrouter") {
      const runtime = await models.loadAgentRuntime(
        openRouterCredentialRef,
        selection.modelId,
      );
      return new AiSdkAgentRunner(runtime.model, {
        ...(pricing ? { pricing } : undefined),
        providerTools: runtime.providerTools,
        providerUsage: runtime.providerUsage,
        ...(catalog.revision
          ? { catalogRevision: catalog.revision }
          : undefined),
        emitModelSelection: false,
      }).run(request);
    }
    if (selection.providerId === "openai") {
      const model = await openAiModels.loadModel(
        openAiCredentialRef,
        selection.modelId,
      );
      return new AiSdkAgentRunner(model, {
        ...(pricing ? { pricing } : undefined),
        ...(catalog.revision
          ? { catalogRevision: catalog.revision }
          : undefined),
        emitModelSelection: false,
      }).run(request);
    }
    const runtime = await xaiModels.loadAgentRuntime(
      xaiCredentialRef,
      selection.modelId,
    );
    return new AiSdkAgentRunner(runtime.model, {
      ...((pricing ?? runtime.pricing)
        ? { pricing: pricing ?? runtime.pricing }
        : undefined),
      ...(catalog.revision ? { catalogRevision: catalog.revision } : undefined),
      emitModelSelection: false,
    }).run(request);
  },
};
const application = new LocalApplication(localDatabase.db, {
  credentials,
  models,
  openAiModels,
  xaiModels,
  modelCatalog,
  agent,
  proposalGenerator: new AiTaskProposalGenerator(async () => {
    const selection = await resolveModelSelection(undefined, []);
    if (selection.providerId === "openrouter") {
      return models.loadModel(openRouterCredentialRef, selection.modelId);
    }
    if (selection.providerId === "openai") {
      return openAiModels.loadModel(openAiCredentialRef, selection.modelId);
    }
    return xaiModels.loadModel(xaiCredentialRef, selection.modelId);
  }),
});
application.ensureBuiltinConnections();

const tickStore = new SqliteTickStore(localDatabase.db);
const schedule = new CronScheduleEngine(localDatabase.db);
const tickLoop = startLocalTickLoop({
  tick: () =>
    tick({
      store: tickStore,
      schedule,
      executor: application.executor,
    }).then(() => undefined),
  onError: (error) => {
    console.error(
      "Scheduled task check failed:",
      error instanceof Error ? error.message : String(error),
    );
  },
});

const assets = await loadAssets();
const httpApp = createHttpApp(application, assets);
const port = readPort(process.env.PORT);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  fetch: httpApp.fetch,
});

console.log(`ShrimpRoll is ready at ${server.url}`);

const shutdown = () => {
  tickLoop.stop();
  server.stop();
  modelCatalog.close();
  localDatabase.close();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

async function loadAssets(): Promise<HttpAppAssets> {
  const indexUrl = new URL("./client/index.html", import.meta.url);
  const indexHtml = await Bun.file(indexUrl).text();
  const assetsRoot = new URL("../dist/", import.meta.url);

  return {
    indexHtml,
    async read(path) {
      if (!/^[a-zA-Z0-9._-]+$/.test(path)) {
        return undefined;
      }
      const file = Bun.file(new URL(path, assetsRoot));
      if (!(await file.exists())) {
        return undefined;
      }

      return new Response(file);
    },
  };
}

function readPort(value: string | undefined): number {
  if (value === undefined) {
    return 4117;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError("PORT must be an integer between 1 and 65535");
  }
  return port;
}

async function resolveModelSelection(
  taskSelection:
    | { readonly providerId: string; readonly modelId: string }
    | undefined,
  requiredCapabilities: readonly ProviderToolCapability[],
): Promise<ModelSelectionDto> {
  const setting = localDatabase.db
    .select()
    .from(modelSettings)
    .where(eq(modelSettings.id, "default"))
    .get();
  const providerIds = ["openrouter", "openai", "xai"] as const;
  const connectionStates = await Promise.all(
    providerIds.map(async (providerId) => ({
      providerId,
      connected: await hasProviderCredential(providerId),
    })),
  );
  const connectedProviders = new Set(
    connectionStates
      .filter((state) => state.connected)
      .map((state) => state.providerId),
  );
  const defaultSelection =
    setting?.providerId &&
    setting.modelId &&
    isModelProviderId(setting.providerId)
      ? {
          providerId: setting.providerId,
          modelId: setting.modelId,
        }
      : undefined;

  return chooseModelSelection({
    taskSelection,
    defaultSelection,
    automaticSelections: providerIds.map((providerId) => ({
      providerId,
      modelId: defaultModelId(providerId),
    })),
    connectedProviders,
    requiredCapabilities,
  });
}

function hasProviderCredential(providerId: ModelProviderId): Promise<boolean> {
  return credentials
    .get(credentialReference(providerId))
    .then((credential) => Boolean(credential));
}

function credentialReference(providerId: ModelProviderId): string {
  if (providerId === "openrouter") return openRouterCredentialRef;
  if (providerId === "openai") return openAiCredentialRef;
  return xaiCredentialRef;
}

function defaultModelId(providerId: ModelProviderId): string {
  if (providerId === "openrouter") return defaultOpenRouterModelId;
  if (providerId === "openai") return defaultOpenAiModelId;
  return defaultXaiModelId;
}

function isModelProviderId(value: string): value is ModelProviderId {
  return value === "openrouter" || value === "openai" || value === "xai";
}

function catalogModelPricing(model: ModelOptionDto | undefined):
  | {
      readonly inputUsdPerMillionTokens: number;
      readonly outputUsdPerMillionTokens: number;
    }
  | undefined {
  return model?.inputUsdPerMillionTokens !== undefined &&
    model.outputUsdPerMillionTokens !== undefined
    ? {
        inputUsdPerMillionTokens: model.inputUsdPerMillionTokens,
        outputUsdPerMillionTokens: model.outputUsdPerMillionTokens,
      }
    : undefined;
}

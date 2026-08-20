import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type AgentRunner,
  AiSdkAgentRunner,
  AiSdkAssistant,
  AiSdkImageGenerationService,
  createImageGenerationToolSource,
  defaultOpenAiModelId,
  defaultOpenRouterModelId,
  defaultXaiModelId,
  FilesystemArtifactBlobStore,
  findImageModelDefinition,
  type ImageGenerationService,
  imageModelSettingId,
  MacOsKeychainCredentialStore,
  modelSettings,
  OpenAiModelConnection,
  OpenRouterModelConnection,
  openLocalDatabase,
  type ProviderToolCapability,
  requiredProviderToolCapabilities,
  SqliteRunArtifactRepository,
  tasks,
  webFetchProviderToolCapability,
  webSearchProviderToolCapability,
  XaiModelConnection,
} from "@springroll/kernel";
import { eq } from "drizzle-orm";
import { LocalApplication } from "./server/application.ts";
import {
  connectSpringrollMcpStdio,
  createSpringrollMcpHttpEndpoint,
  type SpringrollMcpHttpEndpoint,
} from "./server/application-mcp.ts";
import { createSpringrollApplicationToolRegistry } from "./server/application-tool-registry.ts";
import {
  createAiSdkApplicationTools,
  legacyAssistantConnectorProposalTools,
} from "./server/assistant-tools.ts";
import { createHttpApp, type HttpAppAssets } from "./server/http-app.ts";
import { chooseImageModel } from "./server/image-model-selection.ts";
import {
  AiIntegrationResearcher,
  GithubMcpRegistryClient,
  OfficialMcpRegistryClient,
  OfficialNpmRegistryClient,
  VerifiedLocalMcpResearcher,
  VerifiedOpenApiResearcher,
} from "./server/integration-researcher.ts";
import {
  type ModelCatalogSnapshot,
  SpringrollModelCatalog,
} from "./server/model-catalog.ts";
import {
  chooseModelExecution,
  providerToolBindingsForExecution,
} from "./server/model-selection.ts";
import { configureLocalRivetEnvironment } from "./server/rivet-environment.ts";
import {
  openAiCredentialRef,
  openRouterCredentialRef,
  xaiCredentialRef,
} from "./server/sources.ts";
import type {
  ModelExecutionDto,
  ModelOptionDto,
  ModelProviderId,
} from "./shared.ts";

const databasePath =
  process.env.SPRINGROLL_DB_PATH ??
  new URL("../../.local/springroll.sqlite", import.meta.url).pathname;
mkdirSync(dirname(databasePath), { recursive: true });

const rivetEnvironment = configureLocalRivetEnvironment(
  process.env,
  databasePath,
);

// One-time migration from the pre-rename install: adopt the shrimproll
// database (and its WAL sidecars) under the new name so recipes and run
// history survive the Springroll rename.
const legacyDatabasePath = databasePath.replace(
  /springroll\.sqlite$/,
  "shrimproll.sqlite",
);
if (
  legacyDatabasePath !== databasePath &&
  !existsSync(databasePath) &&
  existsSync(legacyDatabasePath)
) {
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(legacyDatabasePath + suffix)) {
      renameSync(legacyDatabasePath + suffix, databasePath + suffix);
    }
  }
}

const localDatabase = openLocalDatabase({ filename: databasePath });
const credentials = new MacOsKeychainCredentialStore();
const models = new OpenRouterModelConnection(credentials);
const openAiModels = new OpenAiModelConnection(credentials);
const xaiModels = new XaiModelConnection(credentials);
const artifactBlobs = new FilesystemArtifactBlobStore(
  join(dirname(databasePath), "artifacts"),
);
const runArtifacts = new SqliteRunArtifactRepository(localDatabase.db);
const imageGeneration: ImageGenerationService = {
  async generate(input) {
    const setting = localDatabase.db
      .select()
      .from(modelSettings)
      .where(eq(modelSettings.id, imageModelSettingId))
      .get();
    const taskSetting = input.taskId
      ? localDatabase.db
          .select({
            providerId: tasks.imageModelProviderId,
            modelId: tasks.imageModelId,
          })
          .from(tasks)
          .where(eq(tasks.id, input.taskId))
          .get()
      : undefined;
    const selection = await resolveImageModelSelection(
      taskSetting?.providerId && taskSetting.modelId
        ? { providerId: taskSetting.providerId, modelId: taskSetting.modelId }
        : setting?.providerId && setting.modelId
          ? { providerId: setting.providerId, modelId: setting.modelId }
          : undefined,
    );
    const definition = findImageModelDefinition(
      selection.providerId,
      selection.modelId,
      selection.name,
    );
    if (!definition) throw new Error("No supported image model is configured");
    const openRouterRuntime =
      definition.providerId === "openrouter"
        ? await models.loadImageRuntime(
            openRouterCredentialRef,
            definition.modelId,
          )
        : undefined;
    const model = openRouterRuntime
      ? openRouterRuntime.model
      : definition.providerId === "openai"
        ? await openAiModels.loadImageModel(
            openAiCredentialRef,
            definition.modelId,
          )
        : await xaiModels.loadImageModel(xaiCredentialRef, definition.modelId);
    const pricing =
      selection.inputUsdPerMillionTokens !== undefined &&
      selection.outputUsdPerMillionTokens !== undefined
        ? {
            inputUsdPerMillionTokens: selection.inputUsdPerMillionTokens,
            outputUsdPerMillionTokens: selection.outputUsdPerMillionTokens,
          }
        : undefined;
    return new AiSdkImageGenerationService(model, definition, {
      ...(pricing ? { pricing } : undefined),
      ...(openRouterRuntime
        ? { providerUsage: openRouterRuntime.providerUsage }
        : undefined),
    }).generate(input);
  },
};
const imageGenerationSource = createImageGenerationToolSource({
  generation: imageGeneration,
  blobs: artifactBlobs,
  artifacts: runArtifacts,
});
const modelCatalog = new SpringrollModelCatalog(
  process.env.SPRINGROLL_MODEL_CATALOG_PATH ??
    new URL("../../.local/model-catalog.sqlite", import.meta.url).pathname,
);
const agent: AgentRunner = {
  async run(request) {
    const requiredCapabilities = requiredProviderToolCapabilities(
      request.tools,
    );
    const execution = await resolveModelExecution(
      request.task.modelSelection,
      requiredCapabilities,
    );
    const catalog = await modelCatalog.read().catch(
      (): ModelCatalogSnapshot => ({
        models: [],
        imageModels: [],
        stale: true,
      }),
    );
    const catalogModel = catalog.models.find(
      (model) =>
        model.providerId === execution.providerId &&
        model.modelId === execution.modelId,
    );
    const pricing = catalogModelPricing(catalogModel);
    if (!request.continuation) {
      await request.eventSink?.append(
        {
          type: "model_selection",
          provider: execution.providerId,
          modelId: execution.modelId,
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
    }

    if (execution.providerId === "openrouter") {
      const runtime = await models.loadAgentRuntime(
        openRouterCredentialRef,
        execution.modelId,
      );
      return new AiSdkAgentRunner(runtime.model, {
        artifactReader: runArtifacts,
        ...(pricing ? { pricing } : undefined),
        providerTools: providerToolBindingsForExecution(
          runtime.providerTools,
          execution,
        ),
        providerUsage: runtime.providerUsage,
        ...(catalog.revision
          ? { catalogRevision: catalog.revision }
          : undefined),
        emitModelSelection: false,
      }).run(request);
    }
    if (execution.providerId === "openai") {
      const model = await openAiModels.loadModel(
        openAiCredentialRef,
        execution.modelId,
      );
      return new AiSdkAgentRunner(model, {
        artifactReader: runArtifacts,
        ...(pricing ? { pricing } : undefined),
        ...(catalog.revision
          ? { catalogRevision: catalog.revision }
          : undefined),
        emitModelSelection: false,
      }).run(request);
    }
    const runtime = await xaiModels.loadAgentRuntime(
      xaiCredentialRef,
      execution.modelId,
    );
    return new AiSdkAgentRunner(runtime.model, {
      artifactReader: runArtifacts,
      ...((pricing ?? runtime.pricing)
        ? { pricing: pricing ?? runtime.pricing }
        : undefined),
      ...(catalog.revision ? { catalogRevision: catalog.revision } : undefined),
      emitModelSelection: false,
    }).run(request);
  },
};
const loadAssistantRuntime = async (selection?: {
  readonly providerId: string;
  readonly modelId: string;
}) => {
  const execution = await resolveModelExecution(selection, []);
  const catalog = await modelCatalog.read().catch(
    (): ModelCatalogSnapshot => ({
      models: [],
      imageModels: [],
      stale: true,
    }),
  );
  const catalogModel = catalog.models.find(
    (model) =>
      model.providerId === execution.providerId &&
      model.modelId === execution.modelId,
  );
  const catalogPricing = catalogModelPricing(catalogModel);
  if (execution.providerId === "openrouter") {
    return {
      model: await models.loadModel(openRouterCredentialRef, execution.modelId),
      provider: execution.providerId,
      modelId: execution.modelId,
      billing: "metered" as const,
      ...(catalog.revision ? { catalogRevision: catalog.revision } : undefined),
      ...(catalogPricing ? { pricing: catalogPricing } : undefined),
    };
  }
  if (execution.providerId === "openai") {
    return {
      model: await openAiModels.loadModel(
        openAiCredentialRef,
        execution.modelId,
      ),
      provider: execution.providerId,
      modelId: execution.modelId,
      billing: "metered" as const,
      ...(catalog.revision ? { catalogRevision: catalog.revision } : undefined),
      ...(catalogPricing ? { pricing: catalogPricing } : undefined),
    };
  }
  const runtime = await xaiModels.loadAgentRuntime(
    xaiCredentialRef,
    execution.modelId,
  );
  return {
    model: runtime.model,
    provider: execution.providerId,
    modelId: execution.modelId,
    billing: "metered" as const,
    ...(catalog.revision ? { catalogRevision: catalog.revision } : undefined),
    ...((catalogPricing ?? runtime.pricing)
      ? { pricing: catalogPricing ?? runtime.pricing }
      : undefined),
  };
};

const application = new LocalApplication(localDatabase.db, {
  credentials,
  models,
  openAiModels,
  xaiModels,
  modelCatalog,
  agent,
  resolveModelExecution,
  integrationResearcher: new AiIntegrationResearcher({
    registry: new OfficialMcpRegistryClient(),
    githubRegistry: new GithubMcpRegistryClient(),
  }),
  localMcpResearcher: new VerifiedLocalMcpResearcher({
    npm: new OfficialNpmRegistryClient(),
  }),
  openApiResearcher: new VerifiedOpenApiResearcher(),
  extraToolSources: [imageGenerationSource],
  artifactBlobs,
  runArtifacts,
});
application.ensureBuiltinConnections();
await application.migrateBuiltInToolPins();
const applicationTools = createSpringrollApplicationToolRegistry(application);
if (process.argv.includes("--mcp-stdio")) {
  await runStdioMcp(applicationTools);
}
const assistantTools = createAiSdkApplicationTools(applicationTools, {
  exclude: legacyAssistantConnectorProposalTools,
});
const assistant = new AiSdkAssistant(localDatabase.db, {
  workflowTools: {
    research_connection: "connection_setup",
    propose_connection: "connection_setup",
  },
  loadRuntime: async (selection) => ({
    ...(await loadAssistantRuntime(selection)),
    tools: assistantTools,
    approvalPolicies: Object.fromEntries(
      applicationTools.definitions.map((definition) => [
        definition.name,
        { riskEffect: definition.policy.risk.effect },
      ]),
    ),
  }),
  loadDistillerRuntime: async () => {
    const runtime = await application.researchDistillerRuntime();
    return runtime
      ? {
          model: runtime.model,
          provider: runtime.provider,
          modelId: runtime.modelId,
        }
      : undefined;
  },
});

await application.executor.recoverInterruptedWork();
const { createLocalRivetTaskHost } = await import(
  "@springroll/kernel/host/rivet-local-task-host"
);
const taskRunHost = await createLocalRivetTaskHost({
  db: localDatabase.db,
  executor: application.executor,
  endpoint: rivetEnvironment.RIVET_ENDPOINT,
  onError: (error) => {
    console.error(
      "Local task actor failed:",
      error instanceof Error ? error.message : String(error),
    );
  },
});
application.attachTaskRunHost(taskRunHost);

const assets = await loadAssets();
const mcp = createDevelopmentMcpEndpoint(applicationTools);
const httpApp = createHttpApp(application, assets, assistant, mcp);
const port = readPort(process.env.PORT);
const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  // Chat and run SSE streams sit quiet while a tool call or model reasoning
  // runs — nothing is written for tens of seconds. Bun's default 10s idle
  // timeout closes those sockets mid-turn and the client reports a network
  // error even though the turn continues server-side.
  idleTimeout: 240,
  fetch: httpApp.fetch,
});

console.log(`Springroll is ready at ${server.url}`);
if (mcp) {
  console.log(`Springroll development MCP is enabled at ${server.url}mcp`);
}

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  server.stop();
  await mcp?.close();
  await application.close();
  await taskRunHost.shutdown();
  modelCatalog.close();
  localDatabase.close();
  process.exit(0);
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

async function runStdioMcp(
  registry: ReturnType<typeof createSpringrollApplicationToolRegistry>,
): Promise<never> {
  const connection = await connectSpringrollMcpStdio(registry);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await connection.close();
    modelCatalog.close();
    localDatabase.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());
  return new Promise<never>(() => undefined);
}

function createDevelopmentMcpEndpoint(
  registry: ReturnType<typeof createSpringrollApplicationToolRegistry>,
): SpringrollMcpHttpEndpoint | undefined {
  const bearerToken = process.env.SPRINGROLL_MCP_TOKEN;
  return bearerToken
    ? createSpringrollMcpHttpEndpoint(registry, { bearerToken })
    : undefined;
}

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

async function resolveModelExecution(
  taskSelection:
    | { readonly providerId: string; readonly modelId: string }
    | undefined,
  requiredCapabilities: readonly ProviderToolCapability[],
): Promise<ModelExecutionDto> {
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

  return chooseModelExecution({
    taskSelection,
    defaultSelection,
    automaticSelections: providerIds.map((providerId) => ({
      providerId,
      modelId: defaultModelId(providerId),
    })),
    connectedProviders,
    requiredCapabilities,
    portableCapabilities: new Set([
      webSearchProviderToolCapability,
      webFetchProviderToolCapability,
    ]),
  });
}

function hasProviderCredential(providerId: ModelProviderId): Promise<boolean> {
  return credentials
    .get(credentialReference(providerId))
    .then((credential) => Boolean(credential));
}

async function resolveImageModelSelection(
  configured:
    | { readonly providerId: string; readonly modelId: string }
    | undefined,
): Promise<ModelOptionDto> {
  const catalog = await modelCatalog.read();
  const connected = new Set(
    (
      await Promise.all(
        (["openrouter", "openai", "xai"] as const).map(async (providerId) => ({
          providerId,
          connected: await hasProviderCredential(providerId),
        })),
      )
    )
      .filter((provider) => provider.connected)
      .map((provider) => provider.providerId),
  );
  const available = catalog.imageModels.filter(
    (model) =>
      connected.has(model.providerId) &&
      findImageModelDefinition(model.providerId, model.modelId) !== undefined,
  );
  const fallback = chooseImageModel(available, configured);
  if (fallback) return fallback;
  throw new Error(
    "No image-generation model is available. Connect OpenRouter, OpenAI, or xAI and refresh the model catalog.",
  );
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

import {
  AiSdkAgentRunner,
  createHackerNewsToolSource,
  defaultOpenAiModelPricing,
  defaultOpenRouterModelPricing,
  hashToolSchema,
  MacOsKeychainCredentialStore,
  OpenAiModelConnection,
  OpenRouterModelConnection,
  runTask,
  type Task,
  XaiModelConnection,
} from "@shrimp-roll/kernel";
import type { CliActions, ModelProvider } from "./run-cli.ts";

const openAiCredentialRef = "openai-default";
const openRouterCredentialRef = "openrouter-default";
const xaiCredentialRef = "xai-default";

export function createDevelopmentCliActions(): CliActions {
  const credentials = new MacOsKeychainCredentialStore();
  const openAiConnection = new OpenAiModelConnection(credentials);
  const openRouterConnection = new OpenRouterModelConnection(credentials);
  const xaiConnection = new XaiModelConnection(credentials);

  return {
    connectOpenAi: (apiKey) =>
      openAiConnection.connect({
        credentialRef: openAiCredentialRef,
        apiKey,
      }),
    connectOpenRouter: (apiKey) =>
      openRouterConnection.connect({
        credentialRef: openRouterCredentialRef,
        apiKey,
      }),
    connectXai: (apiKey) =>
      xaiConnection.connect({
        credentialRef: xaiCredentialRef,
        apiKey,
      }),
    async runHackerNewsDigest(provider = "openai") {
      const source = createHackerNewsToolSource();
      const connection = {
        id: "development-hn",
        sourceId: source.id,
        credentialRef: "none",
        availableIn: ["local"] as const,
      };
      const session = await source.open({
        connection,
        location: "local",
      });
      const [descriptor] = await session.listTools();
      await session.close();

      if (!descriptor) {
        throw new Error("The Hacker News connector has no tools");
      }

      const task: Task = {
        id: crypto.randomUUID(),
        prompt: [
          "Summarize the top 10 Hacker News stories for my morning digest.",
          "Lead with the most interesting themes, mention notable scores, and include useful links.",
          "Keep it concise and readable.",
        ].join(" "),
        enabled: true,
        nextRunAt: new Date(),
        catchUpPolicy: "skip_to_next",
        tools: [
          {
            sourceId: source.id,
            connectionId: connection.id,
            name: descriptor.name,
            inputSchemaHash: await hashToolSchema(descriptor.inputSchema),
            risk: {
              effect: "read",
              openWorld: true,
              idempotent: true,
            },
            approval: "never",
          },
        ],
      };
      const { model, pricing } = await loadModel(provider, {
        openAiConnection,
        openRouterConnection,
        xaiConnection,
      });
      const agent = new AiSdkAgentRunner(model, {
        ...(pricing ? { pricing } : undefined),
      });

      return runTask(
        {
          task,
          connections: [connection],
          location: "local",
        },
        {
          agent,
          getToolSource: (sourceId) =>
            sourceId === source.id ? source : undefined,
        },
      );
    },
  };
}

async function loadModel(
  provider: ModelProvider,
  connections: {
    readonly openAiConnection: OpenAiModelConnection;
    readonly openRouterConnection: OpenRouterModelConnection;
    readonly xaiConnection: XaiModelConnection;
  },
) {
  if (provider === "openrouter") {
    return {
      model: await connections.openRouterConnection.loadModel(
        openRouterCredentialRef,
      ),
      pricing: defaultOpenRouterModelPricing,
    };
  }

  if (provider === "xai") {
    return connections.xaiConnection.loadAgentRuntime(xaiCredentialRef);
  }

  return {
    model: await connections.openAiConnection.loadModel(openAiCredentialRef),
    pricing: defaultOpenAiModelPricing,
  };
}

import {
  AiSdkAgentRunner,
  createHackerNewsToolSource,
  defaultOpenAiModelPricing,
  hashToolSchema,
  MacOsKeychainCredentialStore,
  OpenAiModelConnection,
  runTask,
  type Task,
} from "@shrimp-roll/kernel";
import type { CliActions } from "./run-cli.ts";

const openAiCredentialRef = "openai-default";

export function createDevelopmentCliActions(): CliActions {
  const credentials = new MacOsKeychainCredentialStore();
  const modelConnection = new OpenAiModelConnection(credentials);

  return {
    connectOpenAi: (apiKey) =>
      modelConnection.connect({
        credentialRef: openAiCredentialRef,
        apiKey,
      }),
    async runHackerNewsDigest() {
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
      const model = await modelConnection.loadModel(openAiCredentialRef);
      const agent = new AiSdkAgentRunner(model, {
        pricing: defaultOpenAiModelPricing,
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

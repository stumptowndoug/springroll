import {
  openAiApiKeyCreationUrl,
  openRouterApiKeyCreationUrl,
  type RunTaskResult,
} from "@shrimp-roll/kernel";

export type ModelProvider = "openai" | "openrouter";

export interface CliActions {
  connectOpenAi(apiKey: string): Promise<{
    readonly provider: string;
    readonly modelId: string;
  }>;
  connectOpenRouter(apiKey: string): Promise<{
    readonly provider: string;
    readonly modelId: string;
  }>;
  runHackerNewsDigest(provider?: ModelProvider): Promise<RunTaskResult>;
}

export interface CliOutput {
  write(message: string): void;
  writeError(message: string): void;
}

export interface RunCliOptions {
  readonly actions: CliActions;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly output: CliOutput;
}

export async function runCli(
  args: readonly string[],
  options: RunCliOptions,
): Promise<number> {
  const [command, argument] = args;

  try {
    if (command === "openai:connect") {
      const apiKey = options.environment.OPENAI_API_KEY;
      if (!apiKey) {
        options.output.writeError(
          `OPENAI_API_KEY is not set. Create a key at ${openAiApiKeyCreationUrl}, then retry with it set for this command.`,
        );
        return 1;
      }

      const result = await options.actions.connectOpenAi(apiKey);
      options.output.write(
        `Connected ${result.provider}/${result.modelId}; the key is stored in macOS Keychain.`,
      );
      return 0;
    }

    if (command === "openrouter:connect") {
      const apiKey = options.environment.OPENROUTER_API_KEY;
      if (!apiKey) {
        options.output.writeError(
          `OPENROUTER_API_KEY is not set. Create a key at ${openRouterApiKeyCreationUrl}, then retry with it set for this command.`,
        );
        return 1;
      }

      const result = await options.actions.connectOpenRouter(apiKey);
      options.output.write(
        `Connected ${result.provider}/${result.modelId}; the key is stored in macOS Keychain.`,
      );
      return 0;
    }

    if (command === "hn:once") {
      const provider = parseModelProvider(argument);
      const result = await options.actions.runHackerNewsDigest(provider);
      options.output.write(result.transcript.body);
      options.output.write(formatUsage(result));
      return 0;
    }

    options.output.write(helpText());
    return command === undefined || command === "help" ? 0 : 1;
  } catch (error) {
    options.output.writeError(
      error instanceof Error ? error.message : String(error),
    );
    return 1;
  }
}

function helpText(): string {
  return [
    "ShrimpRoll development CLI",
    "",
    "  openai:connect      Validate OPENAI_API_KEY and store it in macOS Keychain",
    "  openrouter:connect  Validate OPENROUTER_API_KEY and store it in macOS Keychain",
    "  hn:once [provider]  Run one live digest; provider is openai (default) or openrouter",
    "  help                Show this help",
    "",
    `Create an OpenAI API key: ${openAiApiKeyCreationUrl}`,
    `Create an OpenRouter API key: ${openRouterApiKeyCreationUrl}`,
  ].join("\n");
}

function parseModelProvider(value: string | undefined): ModelProvider {
  if (value === undefined || value === "openai") {
    return "openai";
  }
  if (value === "openrouter") {
    return value;
  }

  throw new TypeError(
    `Unknown model provider "${value}"; expected openai or openrouter`,
  );
}

function formatUsage(result: RunTaskResult): string {
  const parts = [
    result.usage.totalTokens === undefined
      ? undefined
      : `${result.usage.totalTokens} tokens`,
    result.usage.costUsdMicros === undefined
      ? undefined
      : `$${(result.usage.costUsdMicros / 1_000_000).toFixed(6)} estimated`,
    `${result.finishedAt.getTime() - result.startedAt.getTime()} ms`,
  ].filter((part): part is string => part !== undefined);

  return `\nRun metadata: ${parts.join(" · ")}`;
}
